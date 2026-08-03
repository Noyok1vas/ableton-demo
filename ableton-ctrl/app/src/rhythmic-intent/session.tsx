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
  BAR_DURATION,
  DEFAULT_PARAMS,
  DEFAULT_PITCH,
  type CollectionEntry,
  type RenderedTap,
  type Tap,
  type TransformParams,
} from './types.ts'
import { useSoundEngine } from '../transport/session.tsx'
import type { EngineStatus } from '../transport/engine.ts'

export type Session = {
  capture: TapCapture
  params: TransformParams
  setParam: <K extends keyof TransformParams>(key: K, value: number) => void
  rendered: RenderedTap[]
  hasPattern: boolean
  /** What the sound source is doing right now — the status bar renders it. */
  status: EngineStatus
  /** MIDI pitch every tap/loop note plays on. */
  pitch: number
  /** Move the mapping to a different MIDI pitch. */
  setPitch: (pitch: number) => void
  /** Record a tap into the GUI and sound the note on the engine. */
  handleTap: () => void
  /** Clear the pattern, the knobs, the collection, and stop playback. */
  handleReset: () => void
  playing: boolean
  /** 0..1 loop position while playing. */
  playPos: number
  togglePlay: () => void
  collection: CollectionEntry[]
  selectedId: string | null
  loadEntry: (id: string) => void
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
  const [params, setParams] = useState<TransformParams>(DEFAULT_PARAMS)
  const [collection, setCollection] = useState<CollectionEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // ── Note pitch (the mapping) ─────────────────────────────────────
  // Lives here rather than in TransformParams: it's a routing setting, not
  // part of the tapped pattern, so RESET doesn't touch it.
  const [pitch, setPitchState] = useState<number>(DEFAULT_PITCH)
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

  // Every completed bar automatically enters the collection, newest first.
  const onBarComplete = useCallback((taps: readonly Tap[]) => {
    const entry: CollectionEntry = { id: crypto.randomUUID(), taps: [...taps] }
    setCollection((prev) => [entry, ...prev])
    setSelectedId(entry.id)
  }, [])

  const capture = useTapCapture(BAR_DURATION, onBarComplete)

  const rendered = useMemo(
    () => transformPattern(capture.taps, BAR_DURATION, params),
    [capture.taps, params],
  )
  // Ref mirror so the playback loop always schedules the *current* transformed
  // pattern — knob changes and collection loads apply mid-loop.
  const renderedRef = useRef(rendered)
  renderedRef.current = rendered
  const hasPattern = capture.taps.length > 0

  // ── Loop playback ─────────────────────────────────────────────────
  // The *engine* schedules the looped notes (browser timers throttle when the
  // tab is backgrounded — e.g. while Live has focus). The rAF loop here only
  // animates the playhead, so a stalled tab never silences the loop.
  const [playing, setPlaying] = useState(false)
  const [playPos, setPlayPos] = useState(0)
  const playingRef = useRef(false)
  const playStartRef = useRef(0)
  const rafRef = useRef(0)

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    playingRef.current = false
    setPlaying(false)
    setPlayPos(0)
    engineStopLoop()
  }, [engineStopLoop])

  const startLoop = useCallback(() => {
    playingRef.current = true
    setPlaying(true)
    playStartRef.current = performance.now()
    const tick = (now: number) => {
      if (!playingRef.current) return
      setPlayPos((((now - playStartRef.current) / 1000) % BAR_DURATION) / BAR_DURATION)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // While playing, (re)send the loop whenever the transformed pattern changes:
  // pressing PLAY, turning a knob, or loading a collection entry mid-loop.
  useEffect(() => {
    if (!playing) return
    engineStartLoop(
      rendered.filter((t) => t.kept).map((t) => ({ pos: t.finalPos, velocity: t.velocity })),
      BAR_DURATION,
    )
    // `engineId` keeps a running loop alive across a source switch: the send
    // functions keep their identity when the engine underneath changes, so
    // without it the new engine would never be told what to play.
  }, [playing, rendered, engineStartLoop, engineId])

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current)
      engineStopLoop()
    },
    [engineStopLoop],
  )

  const togglePlay = useCallback(() => {
    if (playingRef.current) stopLoop()
    else if (renderedRef.current.some((t) => t.kept)) startLoop()
  }, [startLoop, stopLoop])

  // ── Actions ───────────────────────────────────────────────────────
  const { tap: captureTap, reset: captureReset, load: captureLoad, state: captureState } = capture

  // Core tap path. `sound` is false for physical-pad taps — the source has
  // already played the note (with real velocity), so echoing it would double.
  const applyTap = useCallback(
    (velocity: number, sound: boolean) => {
      // A tap that begins a fresh bar replaces the loop — stop it so the new
      // rhythm is heard alone.
      if (captureState !== 'recording') {
        stopLoop()
        setSelectedId(null)
      }
      captureTap(velocity)
      if (sound) noteOn(velocity)
    },
    [captureState, captureTap, noteOn, stopLoop],
  )

  // GUI button / Space: uniform velocity, the engine plays the note.
  const handleTap = useCallback(() => applyTap(1, true), [applyTap])

  // Physical pad → engine → here. Real velocity, no echo. A ref keeps the
  // subscription stable while always calling the latest applyTap.
  const applyTapRef = useRef(applyTap)
  applyTapRef.current = applyTap
  useEffect(() => onExternalTap((velocity) => applyTapRef.current(velocity, false)), [onExternalTap])

  const handleReset = useCallback(() => {
    stopLoop()
    captureReset()
    setParams(DEFAULT_PARAMS)
    setCollection([])
    setSelectedId(null)
  }, [captureReset, stopLoop])

  const loadEntry = useCallback(
    (id: string) => {
      const entry = collection.find((e) => e.id === id)
      if (!entry) return
      captureLoad(entry.taps)
      setSelectedId(id)
      // If the loop is running it keeps running — with the loaded pattern.
    },
    [collection, captureLoad],
  )

  const setParam = useCallback(
    <K extends keyof TransformParams>(key: K, value: number) => {
      setParams((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  const session: Session = {
    capture,
    params,
    setParam,
    rendered,
    hasPattern,
    status: engine.status,
    pitch,
    setPitch,
    handleTap,
    handleReset,
    playing,
    playPos,
    togglePlay,
    collection,
    selectedId,
    loadEntry,
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}
