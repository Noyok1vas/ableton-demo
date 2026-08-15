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
  loopDurationFor,
  DEFAULT_PARAMS,
  DEFAULT_PITCH,
  type CollectionEntry,
  type RenderedTap,
  type Tap,
  type TransformParams,
} from './types.ts'
import { useSoundEngine } from '../transport/session.tsx'
import type { EngineStatus, SoundVoiceId } from '../transport/engine.ts'

export type Session = {
  capture: TapCapture
  params: TransformParams
  setParam: <K extends keyof TransformParams>(key: K, value: number) => void
  rendered: RenderedTap[]
  hasPattern: boolean
  /** Seconds one pass of the loop takes at the transport's current tempo. */
  loopDuration: number
  /** What the sound source is doing right now — the status bar renders it. */
  status: EngineStatus
  /** MIDI pitch every tap/loop note plays on. */
  pitch: number
  /** Move the mapping to a different MIDI pitch. */
  setPitch: (pitch: number) => void
  /** Record a tap into the GUI and sound the note on the engine, played with
      the sound identity `voice` at character `character` — both stored on the
      tap, so the loop replays it as itself and no later slider move can edit
      it. Returns the new tap's id, so whoever fired it can attach its own
      record to that tap. */
  handleTap: (voice?: SoundVoiceId, character?: number) => string
  /** Drop one tap by id — the Sound Visual's double-click on a mark. */
  removeTap: (id: string) => void
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
  /** 0..1 position of the loop, or null before there is a loop. The one
      playhead: Rhythmic Intent draws it as a line, the Sound Visual as the
      angular gradient turning the canvas, and both read it from here. */
  playhead: number | null
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
  // The tempo is the transport's; the loop's length follows from it.
  const loopDuration = loopDurationFor(engine.bpm)

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

  // The loop enters the collection when its first pass closes, newest first.
  const onLoopComplete = useCallback((taps: readonly Tap[]) => {
    const entry: CollectionEntry = { id: crypto.randomUUID(), taps: [...taps] }
    setCollection((prev) => [entry, ...prev])
    setSelectedId(entry.id)
  }, [])

  const capture = useTapCapture(loopDuration, onLoopComplete)

  // …and keeps up with it afterwards: the loop stays open, so every addition,
  // undo and deletion belongs to the same entry rather than spawning a new one.
  const captureTaps = capture.taps
  useEffect(() => {
    if (!selectedId) return
    setCollection((prev) =>
      prev.map((e) => (e.id === selectedId ? { ...e, taps: [...captureTaps] } : e)),
    )
  }, [captureTaps, selectedId])

  const rendered = useMemo(
    () => transformPattern(capture.taps, loopDuration, params),
    [capture.taps, loopDuration, params],
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
  }, [captureAnchor])

  // While playing, (re)send the loop whenever the transformed pattern changes:
  // pressing PLAY, turning a knob, or loading a collection entry mid-loop.
  useEffect(() => {
    if (!playing) return
    engineStartLoop(
      rendered
        .filter((t) => t.kept)
        .map((t) => ({
          pos: t.finalPos,
          velocity: t.velocity,
          voice: t.voice,
          character: t.character,
        })),
      loopDuration,
    )
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
  const { remove: removeTap, undo: undoTap } = capture

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
  const applyTap = useCallback(
    (velocity: number, sound: boolean, voice?: SoundVoiceId, character?: number) => {
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

  // GUI button / Space: uniform velocity, the engine plays the note.
  const handleTap = useCallback(
    (voice?: SoundVoiceId, character?: number) => applyTap(1, true, voice, character),
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
    setSelectedId(null)
  }, [captureReset, stopLoop])

  const handleReset = useCallback(() => {
    clearPattern()
    setParams(DEFAULT_PARAMS)
    setCollection([])
  }, [clearPattern])

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
    loopDuration,
    status: engine.status,
    pitch,
    setPitch,
    handleTap,
    removeTap,
    undoTap,
    canUndo: hasPattern,
    clearPattern,
    handleReset,
    playing,
    playhead: capture.state === 'ready' ? null : capture.progress,
    togglePlay,
    collection,
    selectedId,
    loadEntry,
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}
