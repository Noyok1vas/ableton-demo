import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { SOUND_VOICES, type DrumParams, type SoundVoiceId } from '../transport/engine.ts'
import { isRecord, loadSaved, useSaved } from '../persist.ts'
import { completeDrum } from '../chladni2/params.ts'
import { usePlaySound } from './play.ts'
import {
  ROLE_LABELS,
  STARTER_KIT,
  figuresFor,
  labelsFor,
  type CatalogKit,
} from './library.ts'
import { SOUND_PACK } from './soundPack.ts'
import { DEFAULT_SHAPE, clampTo, completeShape, controlOf, randomShape, type ShapeParams } from './shape.ts'

/** A shape kept in a rack slot, and when it was put there. */
export type RackShape = { shape: ShapeParams; savedAt: number }
export type Rack = Record<SoundVoiceId, RackShape | null>

/** A kit the laboratory keeps: eight names, their figures, and the knobs. */
export type KeptKit = {
  id: string
  name: string
  savedAt: number
  labels: Record<SoundVoiceId, string>
  shapes: Partial<Record<SoundVoiceId, ShapeParams>>
  drums: Record<SoundVoiceId, DrumParams>
}

export type ShapeSessionValue = {
  /** The shape on the editor's sliders right now. */
  shape: ShapeParams
  setControl: (id: string, value: number) => void
  resetShape: () => void
  randomize: () => void
  /** The sound the viewport plays, and the slot SAVE writes to. */
  target: SoundVoiceId
  setTarget: (id: SoundVoiceId) => void
  /** The drum rack: one saved shape per sound, or none yet. */
  rack: Rack
  saveTo: (id: SoundVoiceId) => void
  loadFrom: (id: SoundVoiceId) => void
  clearSlot: (id: SoundVoiceId) => void
  /** Put the sound pack's figures (soundPack.ts) into their slots. */
  loadPack: () => void
  /** Play a sound (making it the target) — from the viewport or a rack pad. */
  tap: (id: SoundVoiceId) => void
  /** The last tap: which sound, and a count that changes on every one, so
      a figure can jolt in time with it. */
  hit: { id: SoundVoiceId; n: number }
  /** The kit on the plate: its name, and the name of each slot. */
  kitId: string
  kitName: string
  setKitName: (name: string) => void
  labels: Record<SoundVoiceId, string>
  /** Kits kept in this browser. */
  mine: KeptKit[]
  /** Load a catalogue kit's eight figures and names. Knobs are left alone. */
  loadCatalog: (kit: CatalogKit) => void
  /** Load a kept kit's figures, names, and report its knobs for the caller to apply. */
  loadKept: (kit: KeptKit) => void
  /** Select a slot: its figure comes onto the plate and it plays. */
  select: (id: SoundVoiceId) => void
  /** Write the rack into My Library. Returns the kit that was written. */
  keepKit: (drums: Record<SoundVoiceId, DrumParams>) => KeptKit
  /** The last kit committed for the instrument, if one has been. */
  held: { name: string; at: number } | null
  holdForHardware: () => void
}

const ShapeContext = createContext<ShapeSessionValue | null>(null)

export function useShapeEditor(): ShapeSessionValue {
  const value = useContext(ShapeContext)
  if (!value) throw new Error('useShapeEditor must be used inside <ShapeSession>')
  return value
}

type Saved = {
  shape: ShapeParams
  target: SoundVoiceId
  rack: Rack
  kitId: string
  kitName: string
  labels: Record<SoundVoiceId, string>
  mine: KeptKit[]
  held: { name: string; at: number } | null
}

const freshLabels = () => labelsFor(STARTER_KIT)

function restoreLabels(raw: unknown, fallback: Record<SoundVoiceId, string>): Record<SoundVoiceId, string> {
  const src = isRecord(raw) ? raw : {}
  return Object.fromEntries(
    SOUND_VOICES.map((id) => {
      const value = src[id]
      return [id, typeof value === 'string' && value.trim() ? value.slice(0, 24) : fallback[id]]
    }),
  ) as Record<SoundVoiceId, string>
}

function restoreRack(raw: unknown): Rack {
  const src = isRecord(raw) ? raw : {}
  return Object.fromEntries(
    SOUND_VOICES.map((id) => {
      const slot = src[id]
      if (!isRecord(slot) || !isRecord(slot.shape)) return [id, null]
      const savedAt = typeof slot.savedAt === 'number' ? slot.savedAt : Date.now()
      return [id, { shape: completeShape(slot.shape), savedAt }]
    }),
  ) as Rack
}

function restoreMine(raw: unknown): KeptKit[] {
  if (!Array.isArray(raw)) return []
  const kits: KeptKit[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') continue
    const shapesRaw = isRecord(item.shapes) ? item.shapes : {}
    const shapes: Partial<Record<SoundVoiceId, ShapeParams>> = {}
    for (const id of SOUND_VOICES) {
      if (isRecord(shapesRaw[id])) shapes[id] = completeShape(shapesRaw[id])
    }
    const drumsRaw = isRecord(item.drums) ? item.drums : {}
    const drums = Object.fromEntries(
      SOUND_VOICES.map((id) => [id, completeDrum(id, isRecord(drumsRaw[id]) ? (drumsRaw[id] as DrumParams) : undefined)]),
    ) as Record<SoundVoiceId, DrumParams>
    kits.push({
      id: item.id,
      name: item.name.slice(0, 24),
      savedAt: typeof item.savedAt === 'number' ? item.savedAt : Date.now(),
      labels: restoreLabels(item.labels, ROLE_LABELS),
      shapes,
      drums,
    })
  }
  return kits
}

function fresh(): Saved {
  const now = Date.now()
  const figures = figuresFor(STARTER_KIT)
  const rack = Object.fromEntries(
    SOUND_VOICES.map((id) => [id, { shape: figures[id], savedAt: now }]),
  ) as Rack
  return {
    shape: { ...figures.kick },
    target: 'kick',
    rack,
    kitId: STARTER_KIT.id,
    kitName: STARTER_KIT.name,
    labels: freshLabels(),
    mine: [],
    held: null,
  }
}

function restore(): Saved {
  const raw = loadSaved('shapeEditor')
  if (!isRecord(raw)) return fresh()
  const target = SOUND_VOICES.find((v) => v === raw.target) ?? 'kick'
  const held = isRecord(raw.held) && typeof raw.held.name === 'string'
    ? { name: raw.held.name, at: typeof raw.held.at === 'number' ? raw.held.at : Date.now() }
    : null
  return {
    shape: completeShape(raw.shape),
    target,
    rack: restoreRack(raw.rack),
    kitId: typeof raw.kitId === 'string' ? raw.kitId : '',
    kitName: typeof raw.kitName === 'string' && raw.kitName.trim() ? raw.kitName.slice(0, 24) : 'FIGURE',
    labels: restoreLabels(raw.labels, ROLE_LABELS),
    mine: restoreMine(raw.mine),
    held,
  }
}

function rackFromFigures(figures: Record<SoundVoiceId, ShapeParams>): Rack {
  const now = Date.now()
  return Object.fromEntries(SOUND_VOICES.map((id) => [id, { shape: figures[id], savedAt: now }])) as Rack
}

/**
 * The Chladni Editor's state, above the windows so it survives switching
 * pages: the shape being edited, which sound it is being tried against, the
 * rack, and the kits kept in the laboratory. Saved in this browser.
 */
export function ShapeSession({ children }: { children: ReactNode }) {
  const [restored] = useState(restore)
  const [shape, setShape] = useState<ShapeParams>(restored.shape)
  const [target, setTarget] = useState<SoundVoiceId>(restored.target)
  const [rack, setRack] = useState<Rack>(restored.rack)
  const [kitId, setKitId] = useState(restored.kitId)
  const [kitName, setKitNameState] = useState(restored.kitName)
  const [labels, setLabels] = useState(restored.labels)
  const [mine, setMine] = useState<KeptKit[]>(restored.mine)
  const [held, setHeld] = useState(restored.held)
  const [hit, setHit] = useState<{ id: SoundVoiceId; n: number }>({ id: restored.target, n: 0 })
  const play = usePlaySound()

  const shapeRef = useRef(shape)
  shapeRef.current = shape
  const rackRef = useRef(rack)
  rackRef.current = rack
  const targetRef = useRef(target)
  targetRef.current = target
  const kitIdRef = useRef(kitId)
  kitIdRef.current = kitId
  const kitNameRef = useRef(kitName)
  kitNameRef.current = kitName
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const mineRef = useRef(mine)
  mineRef.current = mine

  const writeShape = useCallback((next: ShapeParams, slot: SoundVoiceId = targetRef.current) => {
    setShape(next)
    setRack((prev) => ({
      ...prev,
      [slot]: { shape: next, savedAt: prev[slot]?.savedAt ?? Date.now() },
    }))
  }, [])

  const tap = useCallback(
    (id: SoundVoiceId) => {
      play(id)
      setTarget(id)
      setHit((prev) => ({ id, n: prev.n + 1 }))
    },
    [play],
  )

  const setControl = useCallback(
    (id: string, value: number) => {
      const control = controlOf(id)
      if (!control) return
      const v = clampTo(control, value)
      if (shapeRef.current[id] === v) return
      writeShape({ ...shapeRef.current, [id]: v })
    },
    [writeShape],
  )

  const resetShape = useCallback(() => writeShape({ ...DEFAULT_SHAPE }), [writeShape])
  const randomize = useCallback(() => writeShape(randomShape(shapeRef.current)), [writeShape])

  const setKitName = useCallback((name: string) => {
    setKitNameState(name.slice(0, 24))
  }, [])

  const saveTo = useCallback(
    (id: SoundVoiceId) => setRack((prev) => ({ ...prev, [id]: { shape: { ...shapeRef.current }, savedAt: Date.now() } })),
    [],
  )
  const loadFrom = useCallback((id: SoundVoiceId) => {
    const slot = rackRef.current[id]
    if (!slot) return
    setShape({ ...slot.shape })
    setTarget(id)
  }, [])
  const clearSlot = useCallback((id: SoundVoiceId) => {
    setRack((prev) => ({ ...prev, [id]: null }))
    if (id === targetRef.current) setShape({ ...DEFAULT_SHAPE })
  }, [])
  const loadPack = useCallback(() => {
    const now = Date.now()
    setRack((prev) => {
      const next = { ...prev }
      for (const id of SOUND_VOICES) {
        const packed = SOUND_PACK[id]
        if (packed) next[id] = { shape: completeShape(packed), savedAt: now }
      }
      return next
    })
  }, [])

  const loadCatalog = useCallback((kit: CatalogKit) => {
    const figures = figuresFor(kit)
    const nextRack = rackFromFigures(figures)
    setRack(nextRack)
    setLabels(labelsFor(kit))
    setKitId(kit.id)
    setKitNameState(kit.name)
    setTarget('kick')
    setShape({ ...figures.kick })
  }, [])

  const loadKept = useCallback((kit: KeptKit) => {
    const now = Date.now()
    const nextRack = Object.fromEntries(
      SOUND_VOICES.map((id) => {
        const figure = kit.shapes[id]
        return [id, figure ? { shape: completeShape(figure), savedAt: now } : null]
      }),
    ) as Rack
    setRack(nextRack)
    setLabels(restoreLabels(kit.labels, ROLE_LABELS))
    setKitId(kit.id)
    setKitNameState(kit.name)
    const first = SOUND_VOICES.find((id) => nextRack[id]) ?? 'kick'
    setTarget(first)
    setShape(nextRack[first] ? { ...nextRack[first]!.shape } : { ...DEFAULT_SHAPE })
  }, [])

  const select = useCallback(
    (id: SoundVoiceId) => {
      const slot = rackRef.current[id]
      setTarget(id)
      setShape(slot ? { ...slot.shape } : { ...DEFAULT_SHAPE })
      play(id)
      setHit((prev) => ({ id, n: prev.n + 1 }))
    },
    [play],
  )

  const keepKit = useCallback((drums: Record<SoundVoiceId, DrumParams>): KeptKit => {
    const shapes: Partial<Record<SoundVoiceId, ShapeParams>> = {}
    for (const id of SOUND_VOICES) {
      const slot = rackRef.current[id]
      if (slot) shapes[id] = { ...slot.shape }
    }
    const drumsCopy = Object.fromEntries(
      SOUND_VOICES.map((id) => [id, completeDrum(id, drums[id])]),
    ) as Record<SoundVoiceId, DrumParams>
    const existing = mineRef.current.find((k) => k.id === kitIdRef.current)
    const id = existing ? existing.id : `mine-${Date.now()}`
    const entry: KeptKit = {
      id,
      name: kitNameRef.current.trim() || 'UNTITLED',
      savedAt: Date.now(),
      labels: { ...labelsRef.current },
      shapes,
      drums: drumsCopy,
    }
    if (!existing) setKitId(id)
    setMine((prev) => (existing ? prev.map((k) => (k.id === id ? entry : k)) : [entry, ...prev]))
    return entry
  }, [])

  const holdForHardware = useCallback(() => {
    setHeld({ name: kitNameRef.current.trim() || 'UNTITLED', at: Date.now() })
  }, [])

  const saved = useMemo<Saved>(
    () => ({ shape, target, rack, kitId, kitName, labels, mine, held }),
    [shape, target, rack, kitId, kitName, labels, mine, held],
  )
  useSaved('shapeEditor', saved)

  const value = useMemo<ShapeSessionValue>(
    () => ({
      shape,
      setControl,
      resetShape,
      randomize,
      target,
      setTarget,
      rack,
      saveTo,
      loadFrom,
      clearSlot,
      loadPack,
      tap,
      hit,
      kitId,
      kitName,
      setKitName,
      labels,
      mine,
      loadCatalog,
      loadKept,
      select,
      keepKit,
      held,
      holdForHardware,
    }),
    [
      shape,
      setControl,
      resetShape,
      randomize,
      target,
      rack,
      saveTo,
      loadFrom,
      clearSlot,
      loadPack,
      tap,
      hit,
      kitId,
      kitName,
      setKitName,
      labels,
      mine,
      loadCatalog,
      loadKept,
      select,
      keepKit,
      held,
      holdForHardware,
    ],
  )
  return <ShapeContext.Provider value={value}>{children}</ShapeContext.Provider>
}
