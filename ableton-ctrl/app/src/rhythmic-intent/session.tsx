import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { transformPattern } from './transform.ts'
import { useTapCapture, type TapCapture } from './useTapCapture.ts'
import {
  beatsPerLoopFor,
  gridDivisionsFor,
  loopDurationFor,
  DEFAULT_PARAMS,
  DEFAULT_PITCH,
  PAD_BASE_PITCH,
  PAD_GRID_SIZE,
  type CollectionEntry,
  type CollectionKind,
  type CollectionSelection,
  type RenderedTap,
  type SavedPattern,
  type Tap,
  type TransformParams,
} from './types.ts'
import { useSoundEngine } from '../transport/session.tsx'
import {
  SOUND_VOICES,
  type EngineStatus,
  type LoopEvent,
  type SoundVoiceId,
} from '../transport/engine.ts'
import { DEFAULT_METER, parseMeter, type Meter } from '../transport/meter.ts'
import { finiteIn, isRecord, loadSaved, mergeNumbers, useSaved } from '../persist.ts'

// ── What is remembered between visits ─────────────────────────────────────
// The working pattern and every Collection entry are saved in seconds together
// with the loop length they were measured against, and re-timed on the way
// back in — the tempo or meter may have moved since.
//
// Saved patterns, the working pattern and the knobs go to localStorage and
// outlive the page. The temporary half of the Collection is not stored at all:
// it lasts until the page is reloaded, which is what makes it temporary and
// what SAVE is for.

type SavedRhythm = {
  params: TransformParams
  pitch: number
  pattern: { taps: readonly Tap[]; duration: number }
  saved: SavedPattern[]
  selection: CollectionSelection | null
}

function parseTap(raw: unknown): Tap | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  const time = finiteIn(raw.time, 0, Number.MAX_SAFE_INTEGER)
  const velocity = finiteIn(raw.velocity, 0, 1)
  if (time === null || velocity === null) return null
  const voice = SOUND_VOICES.includes(raw.voice as SoundVoiceId)
    ? (raw.voice as SoundVoiceId)
    : undefined
  const character = finiteIn(raw.character, 0, 1) ?? undefined
  return { id: raw.id, time, velocity, voice, character }
}

/** A saved list of taps, re-timed from the loop they were played in to
    `duration`. Empty for anything that isn't one. */
function parseTaps(raw: unknown, from: unknown, duration: number): Tap[] {
  const source = finiteIn(from, 0.01, 600)
  if (!Array.isArray(raw) || source === null) return []
  const factor = duration / source
  return raw
    .map(parseTap)
    .filter((t): t is Tap => t !== null)
    .map((t) => ({ ...t, time: Math.min(t.time * factor, duration * 0.999999) }))
}

/** One stored Collection entry, kept at its own loop length. */
function parseEntry(raw: unknown): CollectionEntry | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  const duration = finiteIn(raw.duration, 0.01, 600)
  if (duration === null) return null
  const taps = parseTaps(raw.taps, duration, duration)
  if (taps.length === 0) return null
  return {
    id: raw.id,
    taps,
    duration,
    meter: parseMeter(raw.meter) ?? DEFAULT_METER,
    createdAt: finiteIn(raw.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? Date.now(),
  }
}

function parseSaved(raw: unknown): SavedPattern | null {
  const entry = parseEntry(raw)
  if (!entry || !isRecord(raw) || typeof raw.name !== 'string') return null
  return {
    ...entry,
    name: raw.name,
    savedAt: finiteIn(raw.savedAt, 0, Number.MAX_SAFE_INTEGER) ?? entry.createdAt,
  }
}

const parseList = <T,>(raw: unknown, parse: (e: unknown) => T | null): T[] =>
  Array.isArray(raw) ? raw.map(parse).filter((e): e is T => e !== null) : []

type Restored = SavedRhythm & { temporary: CollectionEntry[] }

function restoreRhythm(duration: number): Restored {
  const raw = loadSaved('rhythm')
  const stored = isRecord(raw) ? raw : {}
  const pattern = isRecord(stored.pattern) ? stored.pattern : {}
  const taps = parseTaps(pattern.taps, pattern.duration, duration)
  const saved = parseList(stored.saved, parseSaved)
  // Every visit starts with an empty temporary half.
  const temporary: CollectionEntry[] = []
  // Only kept if it still names an entry — a temporary one never survives a
  // reload. An orphaned working pattern is given a temporary entry of its own
  // by the session, so it can still be saved.
  const sel = isRecord(stored.selection) ? stored.selection : {}
  const selection: CollectionSelection | null =
    taps.length > 0 &&
    typeof sel.id === 'string' &&
    ((sel.kind === 'saved' && saved.some((e) => e.id === sel.id)) ||
      (sel.kind === 'temporary' && temporary.some((e) => e.id === sel.id)))
      ? { kind: sel.kind, id: sel.id }
      : null
  const pitch = finiteIn(stored.pitch, PAD_BASE_PITCH, PAD_BASE_PITCH + PAD_GRID_SIZE ** 2 - 1)
  return {
    params: mergeNumbers(DEFAULT_PARAMS, stored.params, 0, 100),
    pitch: pitch === null ? DEFAULT_PITCH : Math.round(pitch),
    pattern: { taps, duration },
    saved,
    temporary,
    selection,
  }
}

const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const pad2 = (n: number) => String(n).padStart(2, '0')

/** A saved pattern's name: the date and time it was saved, "2026-09-25 14:32".
    A second save inside the same minute gets a counter rather than a twin. */
function nameFor(date: Date, taken: readonly SavedPattern[]): string {
  const base = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
  const names = new Set(taken.map((e) => e.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

/** The pattern as the engine plays it: kept taps only, at their final place. */
const loopEvents = (rendered: readonly RenderedTap[]): LoopEvent[] =>
  rendered
    .filter((t) => t.kept)
    .map((t) => ({ pos: t.finalPos, velocity: t.velocity, voice: t.voice, character: t.character }))

export type Session = {
  capture: TapCapture
  params: TransformParams
  setParam: <K extends keyof TransformParams>(key: K, value: number) => void
  rendered: RenderedTap[]
  hasPattern: boolean
  /** Seconds one pass of the loop takes at the transport's current tempo. */
  loopDuration: number
  /** The transport's time signature, and what it makes of the loop: how many
      beats it spans and how many 1/16 steps its grid has. */
  meter: Meter
  beatsPerLoop: number
  gridDivisions: number
  /** What the sound source is doing right now — the status bar renders it. */
  status: EngineStatus
  /** MIDI pitch every tap/loop note plays on. */
  pitch: number
  /** Move the mapping to a different MIDI pitch. */
  setPitch: (pitch: number) => void
  /** Record a tap into the GUI and sound the note on the engine, played with
      the sound identity `voice` at character `character` and at `velocity`
      (0..1) — all stored on the tap, so the loop replays it as itself and no
      later slider move can edit it. Returns the new tap's id, so whoever fired
      it can attach its own record to that tap. */
  handleTap: (voice?: SoundVoiceId, character?: number, velocity?: number) => string
  /** Drop one tap by id — the Sound Visual's double-click on a mark. */
  removeTap: (id: string) => void
  /** Put one tap at `pos` (0..1) of the loop — the Sound Visual's drag on a
      mark. The position is the RAW one, the tap's own moment: TIGHTNESS and
      PHASE are applied on top of it as they are to every other tap, so a
      dragged mark obeys the same grid pull as a played one. */
  moveTap: (id: string, pos: number) => void
  /** Drop the tap added most recently — the Sound Visual's UNDO. */
  undoTap: () => void
  /** True while there is anything left to take back. */
  canUndo: boolean
  /** End the loop: clears the pattern and stops playback, but keeps the knobs
      and the Collection. This is what the Sound Visual's RESET does — the
      pattern IS that image, so wiping one wipes the other. */
  clearPattern: () => void
  /** Clear the pattern, the knobs, the collection, and stop playback. */
  handleReset: () => void
  playing: boolean
  /** 0..1 position of the loop while it plays, null while it is stopped. The
      one playhead: Rhythmic Intent draws it as a line, the Sound Visual as the
      angular gradient turning the canvas, and both read it from here. */
  playhead: number | null
  /** The transport's PLAY/STOP. Stopping keeps the pattern; PLAY starts it
      again from the top. Does nothing while there is nothing to play. */
  togglePlay: () => void
  /** The Collection's two halves, newest first. TEMPORARY is every tapped
      loop, recorded on its own; SAVED is what was kept on purpose. */
  temporary: CollectionEntry[]
  saved: SavedPattern[]
  /** The entry the working pattern belongs to, or null while a first pass is
      still being recorded. */
  selection: CollectionSelection | null
  /** Make an entry the working pattern. A running loop keeps running with it. */
  loadEntry: (kind: CollectionKind, id: string) => void
  /** Promote a temporary entry to a saved pattern, named with the date and
      time. It moves rather than copies, so nothing is listed twice. */
  savePattern: (temporaryId: string) => void
  /** Take a pattern out of the saved half. It goes back to the top of the
      temporary half rather than vanishing, so it is only really gone once the
      page is reloaded. */
  deleteSaved: (id: string) => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside <RhythmicIntentSession>')
  return session
}

/**
 * Shared state for every Rhythmic Intent window on the canvas (main screen,
 * Collection, …). Lives above the Workspace so it survives page switches.
 */
export function RhythmicIntentSession({ children }: { children: ReactNode }) {
  // Aliased: this session has its own startLoop/stopLoop/setPitch, which wrap
  // the engine's with the playhead animation and the pattern to send.
  const engine = useSoundEngine()
  const {
    noteOn,
    startLoop: engineStartLoop,
    stopLoop: engineStopLoop,
    setPitch: engineSetPitch,
    onExternalTap,
  } = engine
  // The tempo and meter are the transport's; the loop's length follows.
  const meter = engine.meter
  const loopDuration = loopDurationFor(engine.bpm, meter)
  const gridDivisions = gridDivisionsFor(meter)
  const beatsPerLoop = beatsPerLoopFor(meter)
  const loopDurationRef = useRef(loopDuration)
  loopDurationRef.current = loopDuration

  const meterRef = useRef(meter)
  meterRef.current = meter

  // Read once, against the loop length this visit opens with.
  const [restored] = useState(() => restoreRhythm(loopDuration))
  const [params, setParams] = useState<TransformParams>(restored.params)
  const [temporary, setTemporary] = useState<CollectionEntry[]>(restored.temporary)
  const [saved, setSaved] = useState<SavedPattern[]>(restored.saved)
  const [selection, setSelectionState] = useState<CollectionSelection | null>(restored.selection)
  // Mirrored so an edit can tell, within the same press, whether it has
  // already forked a saved pattern (a drag edits many times per frame).
  const selectionRef = useRef(selection)
  const setSelection = useCallback((next: CollectionSelection | null) => {
    selectionRef.current = next
    setSelectionState(next)
  }, [])

  /** A new temporary entry at the top of the list, selected — the Collection
      recording what is being played. Its taps are filled in by the sync below. */
  const recordTemporary = useCallback(
    (taps: readonly Tap[]) => {
      const entry: CollectionEntry = {
        id: newId('temp'),
        taps: [...taps],
        duration: loopDurationRef.current,
        meter: meterRef.current,
        createdAt: Date.now(),
      }
      setTemporary((prev) => [entry, ...prev])
      setSelection({ kind: 'temporary', id: entry.id })
    },
    [setSelection],
  )

  // ── Note pitch (the mapping) ─────────────────────────────────────
  // Lives here rather than in TransformParams: it's a routing setting, not
  // part of the tapped pattern, so RESET doesn't touch it.
  const [pitch, setPitchState] = useState<number>(restored.pitch)
  const pitchRef = useRef(pitch)
  pitchRef.current = pitch

  const setPitch = useCallback(
    (value: number) => {
      setPitchState(value)
      engineSetPitch(value)
    },
    [engineSetPitch],
  )

  // A source that just came up is back on its own default pitch — resend ours
  // whenever it becomes ready so the two stay in sync. Keyed on `engineId` too:
  // a switch between Ableton and the built-in kit hands us a different engine
  // that may already be ready, with no edge to catch.
  const engineReady = engine.status.ready
  const engineId = engine.engineId
  useEffect(() => {
    if (engineReady) engineSetPitch(pitchRef.current)
  }, [engineId, engineReady, engineSetPitch])

  // The loop enters the Collection — as a temporary entry — when its first
  // pass closes, newest first.
  const capture = useTapCapture(loopDuration, recordTemporary, restored.pattern.taps)

  // …and keeps up with it afterwards: the loop stays open, so every addition,
  // undo and deletion belongs to the same entry rather than spawning a new one.
  // Only a TEMPORARY entry follows the pattern like this. A saved one never
  // changes on its own: editing it forks a new temporary entry (see `fork`).
  // An entry emptied by undo has nothing left to keep, so it is dropped.
  const captureTaps = capture.taps
  useEffect(() => {
    if (selection?.kind !== 'temporary') return
    if (captureTaps.length === 0) {
      setTemporary((prev) => prev.filter((e) => e.id !== selection.id))
      setSelection(null)
      return
    }
    setTemporary((prev) =>
      prev.map((e) =>
        e.id === selection.id
          ? { ...e, taps: [...captureTaps], duration: loopDuration, meter }
          : e,
      ),
    )
  }, [captureTaps, selection, loopDuration, meter, setSelection])

  // A finished pattern always belongs to an entry, so it can always be saved:
  // one restored in a new tab (its temporary entry closed with the old one) or
  // left behind by deleting the saved pattern it was, is recorded afresh.
  const captureState = capture.state
  useEffect(() => {
    // Checked through the ref, which recordTemporary updates synchronously: an
    // effect that runs twice before the re-render (React's dev double-invoke)
    // must not record the same pattern twice.
    if (selectionRef.current === null && captureState === 'complete' && captureTaps.length > 0) {
      recordTemporary(captureTaps)
    }
  }, [selection, captureState, captureTaps, recordTemporary])

  /** Called before any edit. Editing a SAVED pattern must not change it — it
      was kept on purpose — so the working pattern moves to a fresh temporary
      entry first, and the edit lands there. */
  const fork = useCallback(() => {
    if (selectionRef.current?.kind === 'saved') recordTemporary(capture.taps)
  }, [capture.taps, recordTemporary])
  const forkRef = useRef(fork)
  forkRef.current = fork

  const rendered = useMemo(
    () => transformPattern(capture.taps, loopDuration, params, gridDivisions),
    [capture.taps, loopDuration, params, gridDivisions],
  )
  // Ref mirror so the playback loop always schedules the *current* transformed
  // pattern — knob changes and collection loads apply mid-loop.
  const renderedRef = useRef(rendered)
  renderedRef.current = rendered
  const hasPattern = capture.taps.length > 0

  // ── Loop playback ─────────────────────────────────────────────────
  // The *engine* schedules the looped notes (browser timers throttle when the
  // tab is backgrounded — e.g. while Live has focus), so a stalled tab never
  // silences the loop. There is no playhead animation here: the capture's loop
  // clock is already turning at the tempo, anchored to this same instant, so a
  // second rAF loop would only be a second copy of one number — and a second
  // 60 Hz state update pushed through every consumer of this session.
  const [playing, setPlaying] = useState(false)
  const playingRef = useRef(false)

  const stopLoop = useCallback(() => {
    playingRef.current = false
    setPlaying(false)
    engineStopLoop()
  }, [engineStopLoop])

  const captureAnchor = capture.anchor
  const startLoop = useCallback(() => {
    playingRef.current = true
    setPlaying(true)
    // The engine starts its loop at this instant, so putting the capture clock
    // here too collapses the three clocks — heard, drawn, recorded — into one.
    // Without it a tap played into a running loop would be filed at some
    // unrelated phase of the pattern it was played against.
    captureAnchor()
    // Handed over now, inside the press, not only from the effect below: the
    // press is what lets a browser start audio, and PLAY on a pattern restored
    // from the last visit is the first sound this page makes.
    engineStartLoop(loopEvents(renderedRef.current), loopDurationRef.current)
  }, [captureAnchor, engineStartLoop])

  // While playing, (re)send the loop whenever the transformed pattern changes:
  // pressing PLAY, turning a knob, or loading a collection entry mid-loop.
  useEffect(() => {
    if (!playing) return
    engineStartLoop(loopEvents(rendered), loopDuration)
    // `engineId` keeps a running loop alive across a source switch: the send
    // functions keep their identity when the engine underneath changes, so
    // without it the new engine would never be told what to play.
  }, [playing, rendered, loopDuration, engineStartLoop, engineId])

  useEffect(() => () => engineStopLoop(), [engineStopLoop])

  const togglePlay = useCallback(() => {
    if (playingRef.current) stopLoop()
    else if (renderedRef.current.some((t) => t.kept)) startLoop()
  }, [startLoop, stopLoop])

  // ── Actions ───────────────────────────────────────────────────────
  const { tap: captureTap, reset: captureReset, load: captureLoad } = capture
  const { remove: captureRemove, move: captureMove, undo: captureUndo } = capture

  const removeTap = useCallback(
    (id: string) => {
      forkRef.current()
      captureRemove(id)
    },
    [captureRemove],
  )

  const undoTap = useCallback(() => {
    forkRef.current()
    captureUndo()
  }, [captureUndo])

  // Core tap path. `sound` is false for physical-pad taps — the source has
  // already played the note (with real velocity), so echoing it would double.
  // Nothing here stops the loop any more: a tap is an addition to the loop that
  // is playing, which is what makes the pattern something you build up.
  //
  // And the first tap starts that loop. Overdubbing blind — adding notes to a
  // pattern you cannot hear — is not a thing anyone can do, so the loop is
  // audible from the moment it exists rather than only after PLAY. Nothing
  // doubles up: the engine re-queues a changed pattern from the current
  // instant, so a note added at a position the cycle has already passed waits
  // for the next time round, exactly as an overdub should.
  //
  // A tap into a STOPPED pattern restarts it, and the tap is its downbeat: the
  // loop is started (anchoring the clock) before the tap is filed, so it lands
  // at the top rather than wherever the stopped clock happened to be.
  const applyTap = useCallback(
    (velocity: number, sound: boolean, voice?: SoundVoiceId, character?: number) => {
      forkRef.current()
      const restart = !playingRef.current && renderedRef.current.length > 0
      if (restart) startLoop()
      const id = captureTap(velocity, voice, character)
      if (sound) noteOn(velocity, voice, character)
      if (!playingRef.current) startLoop()
      return id
    },
    [captureTap, noteOn, startLoop],
  )

  // Nothing left to hear: undoing or deleting the last note ends the playback
  // it started, rather than leaving the engine looping silence.
  const tapCount = capture.taps.length
  useEffect(() => {
    if (playing && tapCount === 0) stopLoop()
  }, [playing, tapCount, stopLoop])

  // GUI pad / Space: the Selector's velocity (or its accent), and the engine
  // plays the note.
  const handleTap = useCallback(
    (voice?: SoundVoiceId, character?: number, velocity = 1) =>
      applyTap(Math.min(1, Math.max(0, velocity)), true, voice, character),
    [applyTap],
  )

  // Physical pad → engine → here. Real velocity, no echo, and no identity: the
  // pad plays whatever the PITCH mapping points at, so the note it already
  // sounded is not one of the four. A ref keeps the subscription stable while
  // always calling the latest applyTap.
  const applyTapRef = useRef(applyTap)
  applyTapRef.current = applyTap
  useEffect(() => onExternalTap((velocity) => applyTapRef.current(velocity, false)), [onExternalTap])

  const clearPattern = useCallback(() => {
    stopLoop()
    captureReset()
    setSelection(null)
  }, [captureReset, stopLoop, setSelection])

  /** Everything but the saved patterns — those were kept on purpose. */
  const handleReset = useCallback(() => {
    clearPattern()
    setParams(DEFAULT_PARAMS)
    setTemporary([])
  }, [clearPattern])

  const loadEntry = useCallback(
    (kind: CollectionKind, id: string) => {
      const entry = (kind === 'saved' ? saved : temporary).find((e) => e.id === id)
      if (!entry) return
      // Re-timed from the loop it was played in to the one running now.
      const factor = loopDuration / entry.duration
      captureLoad(
        entry.taps.map((t) => ({ ...t, time: Math.min(t.time * factor, loopDuration * 0.999999) })),
      )
      setSelection({ kind, id })
      // If the loop is running it keeps running — with the loaded pattern.
    },
    [saved, temporary, captureLoad, loopDuration, setSelection],
  )

  const savePattern = useCallback(
    (temporaryId: string) => {
      const entry = temporary.find((e) => e.id === temporaryId)
      if (!entry || entry.taps.length === 0) return
      const now = new Date()
      const kept: SavedPattern = {
        ...entry,
        id: newId('saved'),
        name: nameFor(now, saved),
        savedAt: now.getTime(),
      }
      setSaved((prev) => [kept, ...prev])
      setTemporary((prev) => prev.filter((e) => e.id !== temporaryId))
      // The working pattern goes with it: what is playing IS that saved
      // pattern now, and the next edit forks a new temporary entry.
      if (selectionRef.current?.kind === 'temporary' && selectionRef.current.id === temporaryId) {
        setSelection({ kind: 'saved', id: kept.id })
      }
    },
    [temporary, saved, setSelection],
  )

  const deleteSaved = useCallback(
    (id: string) => {
      const kept = saved.find((e) => e.id === id)
      if (!kept) return
      // Back to temporary, without its name — the name belonged to the save.
      const entry: CollectionEntry = {
        id: newId('temp'),
        taps: kept.taps,
        duration: kept.duration,
        meter: kept.meter,
        createdAt: kept.createdAt,
      }
      setSaved((prev) => prev.filter((e) => e.id !== id))
      setTemporary((prev) => [entry, ...prev])
      // If it was the one playing, the working pattern moves down with it.
      if (selectionRef.current?.kind === 'saved' && selectionRef.current.id === id) {
        setSelection({ kind: 'temporary', id: entry.id })
      }
    },
    [saved, setSelection],
  )

  const moveTap = useCallback(
    (id: string, pos: number) => {
      forkRef.current()
      captureMove(id, pos * loopDuration)
    },
    [captureMove, loopDuration],
  )

  const setParam = useCallback(
    <K extends keyof TransformParams>(key: K, value: number) => {
      setParams((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const stored = useMemo<SavedRhythm>(
    () => ({
      params,
      pitch,
      pattern: { taps: capture.taps, duration: loopDuration },
      saved,
      selection,
    }),
    [params, pitch, capture.taps, loopDuration, saved, selection],
  )
  useSaved('rhythm', stored)

  const session: Session = {
    capture,
    params,
    setParam,
    rendered,
    hasPattern,
    loopDuration,
    meter,
    beatsPerLoop,
    gridDivisions,
    status: engine.status,
    pitch,
    setPitch,
    handleTap,
    removeTap,
    moveTap,
    undoTap,
    canUndo: hasPattern,
    clearPattern,
    handleReset,
    playing,
    playhead: playing && capture.state !== 'ready' ? capture.progress : null,
    togglePlay,
    temporary,
    saved,
    selection,
    loadEntry,
    savePattern,
    deleteSaved,
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}
