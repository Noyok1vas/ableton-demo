import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { SOUND_VOICES, type SoundVoiceId } from '../transport/engine.ts'
import { isRecord, loadSaved, useSaved } from '../persist.ts'
import { usePlaySound } from './play.ts'
import { DEFAULT_SHAPE, clampTo, completeShape, controlOf, randomShape, type ShapeParams } from './shape.ts'

/** A shape kept in a rack slot, and when it was put there. */
export type RackShape = { shape: ShapeParams; savedAt: number }
export type Rack = Record<SoundVoiceId, RackShape | null>

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
  /** Play a sound (making it the target) — from the viewport or a rack pad. */
  tap: (id: SoundVoiceId) => void
  /** The last tap: which sound, and a count that changes on every one, so
      a figure can jolt in time with it. */
  hit: { id: SoundVoiceId; n: number }
}

const ShapeContext = createContext<ShapeSessionValue | null>(null)

export function useShapeEditor(): ShapeSessionValue {
  const value = useContext(ShapeContext)
  if (!value) throw new Error('useShapeEditor must be used inside <ShapeSession>')
  return value
}

type Saved = { shape: ShapeParams; target: SoundVoiceId; rack: Rack }

function restore(): Saved {
  const raw = loadSaved('shapeEditor')
  const saved = isRecord(raw) ? raw : {}
  const rawRack = isRecord(saved.rack) ? saved.rack : {}
  const rack = Object.fromEntries(
    SOUND_VOICES.map((id) => {
      const slot = rawRack[id]
      if (!isRecord(slot) || !isRecord(slot.shape)) return [id, null]
      const savedAt = typeof slot.savedAt === 'number' ? slot.savedAt : Date.now()
      return [id, { shape: completeShape(slot.shape), savedAt }]
    }),
  ) as Rack
  const target = SOUND_VOICES.find((v) => v === saved.target) ?? 'kick'
  return { shape: completeShape(saved.shape), target, rack }
}

/**
 * The Chladni Editor's state, above the windows so it survives switching
 * pages: the shape being edited, which sound it is being tried against, and
 * the rack of shapes kept per sound. Saved in this browser.
 */
export function ShapeSession({ children }: { children: ReactNode }) {
  const [restored] = useState(restore)
  const [shape, setShape] = useState<ShapeParams>(restored.shape)
  const [target, setTarget] = useState<SoundVoiceId>(restored.target)
  const [rack, setRack] = useState<Rack>(restored.rack)
  const [hit, setHit] = useState<{ id: SoundVoiceId; n: number }>({ id: restored.target, n: 0 })
  const play = usePlaySound()
  const tap = useCallback(
    (id: SoundVoiceId) => {
      play(id)
      setTarget(id)
      setHit((prev) => ({ id, n: prev.n + 1 }))
    },
    [play],
  )

  const setControl = useCallback((id: string, value: number) => {
    const control = controlOf(id)
    if (!control) return
    const v = clampTo(control, value)
    setShape((prev) => (prev[id] === v ? prev : { ...prev, [id]: v }))
  }, [])

  const resetShape = useCallback(() => setShape({ ...DEFAULT_SHAPE }), [])
  const randomize = useCallback(() => setShape((prev) => randomShape(prev)), [])

  const saveTo = useCallback(
    (id: SoundVoiceId) => setRack((prev) => ({ ...prev, [id]: { shape: { ...shape }, savedAt: Date.now() } })),
    [shape],
  )
  const loadFrom = useCallback(
    (id: SoundVoiceId) => {
      const slot = rack[id]
      if (!slot) return
      setShape({ ...slot.shape })
      // Back on the sliders, it is tried against its own sound again.
      setTarget(id)
    },
    [rack],
  )
  const clearSlot = useCallback((id: SoundVoiceId) => setRack((prev) => ({ ...prev, [id]: null })), [])

  const saved = useMemo<Saved>(() => ({ shape, target, rack }), [shape, target, rack])
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
      tap,
      hit,
    }),
    [shape, setControl, resetShape, randomize, target, rack, saveTo, loadFrom, clearSlot, tap, hit],
  )
  return <ShapeContext.Provider value={value}>{children}</ShapeContext.Provider>
}
