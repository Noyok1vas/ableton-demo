import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { BridgeEngine, isBridgeAddressable, probeBridge } from './bridgeEngine.ts'
import { WebAudioEngine } from './webAudioEngine.ts'
import type {
  EngineStatus,
  LoopEvent,
  MacroScope,
  MarchEvent,
  SoundEngine,
  SoundSourceId,
  TrackId,
} from './engine.ts'

/** What the listener asked for. `'auto'` is not a source — it is the standing
    instruction "Ableton whenever its bridge is running, otherwise the built-in
    kit", which is what makes the same build work on this machine and on a
    deployed page. */
export type SourcePreference = 'auto' | SoundSourceId

/** Techno's own tempo, which is what this instrument is for — a loop tapped at
    130 already sits in the music it belongs to, where a neutral 120 asks the
    player to hear past it. */
export const DEFAULT_BPM = 130
export const BPM_MIN = 60
export const BPM_MAX = 200

/** Track levels are typed as percentages because that is what the faders read.
 *
 * MARCH rests at 60: it is the layer *behind* the tapped rhythm, and a second
 * percussion part at the same level stops supporting the first and starts
 * arguing with it. Both are free to move — the default is a starting balance,
 * not a rule. */
export const TRACK_LEVEL_MAX = 100
export const DEFAULT_TRACK_LEVEL: Record<TrackId, number> = { main: 100, march: 60 }

/** How often `auto` re-checks for a bridge while playing the built-in kit, so
    starting the bridge after the app still "just works". */
const PROBE_MS = 3000

/** How long the bridge may be unreachable before `auto` gives up on it and
    falls back. Covers the gap between choosing Ableton and its socket opening,
    which would otherwise read as a failure and bounce straight back. */
const DROP_GRACE_MS = 4000

/** What the status bar shows for the one frame before the engine reports in.
    Each engine's own first status says the same thing, so nothing flickers. */
const INITIAL_STATUS: Record<SoundSourceId, EngineStatus> = {
  ableton: {
    source: 'ableton',
    connected: false,
    ready: false,
    label: 'Bridge offline',
    labelTitle: null,
    tags: [],
  },
  builtin: {
    source: 'builtin',
    connected: false,
    ready: false,
    label: 'Built-in sound — tap to start',
    labelTitle: 'Browsers only allow audio to start from a click or key press',
    tags: [],
  },
}

export type SoundEngineSessionValue = {
  status: EngineStatus
  /** Which source is actually playing right now. */
  source: SoundSourceId
  /** What was asked for, which under `'auto'` need not be what is playing. */
  preference: SourcePreference
  setPreference: (preference: SourcePreference) => void
  /** Bumped once a newly built engine is installed and running.
   *
   * Modules use this — not `source` — as the dependency that re-applies their
   * state to a fresh engine (pitch, macros, a running loop). `source` changes
   * during the render that *decides* to swap, and React runs a child's effects
   * before its parent's, so an effect keyed on `source` would fire while this
   * session is still holding the outgoing engine and would hand its work to
   * the one being torn down. This is set from inside the swap itself, so by
   * the time it changes the new engine is already the one being addressed. */
  engineId: number
  /** Whether a bridge process is listening. Under `'auto'` this is what
      decides the source. */
  bridgeReachable: boolean
  /** False when this page can't reach a bridge at all because it isn't served
      locally — the Ableton option is still offered, it just can't connect from
      here. */
  bridgeAddressable: boolean
  /** The tempo everything is measured against. It lives here, with the
      transport, rather than in Rhythmic Intent: the loop's length is a property
      of the clock, and Rhythmic Intent is only one of the things playing to it.
      Typed into the Sound Source window; the loop re-times to follow. */
  bpm: number
  setBpm: (bpm: number) => void
  /** Play one note now. `velocity` is 0..1. */
  noteOn: (velocity?: number) => void
  /** Start or replace the looping bar. */
  startLoop: (events: readonly LoopEvent[], barDuration: number) => void
  stopLoop: () => void
  /** Start or replace the March phrase on the second track. It joins the grid
      the tapped loop is already on, so the two share a downbeat. */
  startMarchLoop: (
    events: readonly MarchEvent[],
    phraseDuration: number,
    barDuration: number,
  ) => void
  stopMarchLoop: () => void
  /** 0..1 through the March phrase; null when stopped or still queued. */
  marchPhase: () => number | null
  /** Fader positions, 0..100. Lives here rather than in either module because
      it is a property of the mix, which is the transport's business. */
  trackLevel: Record<TrackId, number>
  setTrackLevel: (track: TrackId, level: number) => void
  /** Move the mapping: every future note plays on this MIDI pitch. */
  setPitch: (pitch: number) => void
  /** Set the macro named `name` (e.g. "Energy") to `value` (0..127) — resolved
      by name, not by slot. `scope` picks the selected track (default) or
      everything carrying the macro. */
  setMacro: (name: string, value: number, scope?: MacroScope) => void
  /** Subscribe to taps the source originates (a hardware pad); returns an
      unsubscribe. Stable identity. */
  onExternalTap: (listener: (velocity: number) => void) => () => void
}

const SoundEngineContext = createContext<SoundEngineSessionValue | null>(null)

export function useSoundEngine(): SoundEngineSessionValue {
  const value = useContext(SoundEngineContext)
  if (!value) throw new Error('useSoundEngine must be used inside <SoundEngineSession>')
  return value
}

/**
 * Owns the one sound engine the whole app plays through. It is a session rather
 * than a hook because the engine is a single shared connection: three modules
 * ask it to sound things (Rhythmic Intent's notes, Sound Intent's and FX's
 * macros), and each calling a hook of its own opened three sockets to the same
 * bridge. Sits outermost in App so every module sees the same engine, and the
 * same status.
 */
export function SoundEngineSession({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<SourcePreference>('auto')
  const [bridgeReachable, setBridgeReachable] = useState(false)
  const [bridgeAddressable] = useState(isBridgeAddressable)
  const [bpm, setBpmState] = useState(DEFAULT_BPM)
  const [trackLevel, setTrackLevelState] =
    useState<Record<TrackId, number>>(DEFAULT_TRACK_LEVEL)

  // Clamped here rather than at the input, so no caller can put the loop at a
  // tempo the engines will not honour anyway (both clamp the bar they are given).
  const setBpm = useCallback((next: number) => {
    if (!Number.isFinite(next)) return
    setBpmState(Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(next))))
  }, [])

  // `auto` starts on the built-in kit and moves to Ableton once a bridge
  // answers, rather than the reverse: an unanswered bridge would mean silence
  // while we waited, and silence is the one thing the built-in source exists
  // to prevent.
  const source: SoundSourceId =
    preference === 'auto' ? (bridgeReachable ? 'ableton' : 'builtin') : preference

  const [status, setStatus] = useState<EngineStatus>(() => INITIAL_STATUS[source])
  const [engineId, setEngineId] = useState(0)
  const engineRef = useRef<SoundEngine | null>(null)

  useEffect(() => {
    const engine: SoundEngine = source === 'builtin' ? new WebAudioEngine() : new BridgeEngine()
    engineRef.current = engine
    const unsubscribe = engine.onStatus(setStatus)
    engine.start()
    // Announce the swap only now that the new engine is the one behind every
    // send function, so modules re-apply their state to it and not to the
    // engine it replaced.
    setEngineId((id) => id + 1)
    return () => {
      unsubscribe()
      engine.dispose()
      engineRef.current = null
    }
  }, [source])

  // Watch for a bridge while something else is playing. Stops as soon as the
  // bridge engine is the one running — from then on it reports for itself, and
  // a second socket to the same process is exactly what this session exists to
  // avoid.
  useEffect(() => {
    if (!bridgeAddressable || source === 'ableton') return
    let cancelled = false
    const check = async () => {
      const reachable = await probeBridge()
      if (!cancelled) setBridgeReachable(reachable)
    }
    void check()
    const timer = setInterval(() => void check(), PROBE_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [bridgeAddressable, source])

  // While the bridge engine is the one running, its own view is the truth. A
  // drop is only believed after a grace period, so the moments before its
  // socket opens don't bounce `auto` straight back to the built-in kit.
  const bridgeEngineConnected = source === 'ableton' && status.connected
  useEffect(() => {
    if (source !== 'ableton') return
    if (bridgeEngineConnected) {
      setBridgeReachable(true)
      return
    }
    const timer = setTimeout(() => setBridgeReachable(false), DROP_GRACE_MS)
    return () => clearTimeout(timer)
  }, [source, bridgeEngineConnected])

  const noteOn = useCallback((velocity = 1) => {
    engineRef.current?.noteOn(velocity)
  }, [])

  const startLoop = useCallback((events: readonly LoopEvent[], barDuration: number) => {
    engineRef.current?.startLoop(events, barDuration)
  }, [])

  const stopLoop = useCallback(() => {
    engineRef.current?.stopLoop()
  }, [])

  const setPitch = useCallback((pitch: number) => {
    engineRef.current?.setPitch(pitch)
  }, [])

  const setMacro = useCallback((name: string, value: number, scope: MacroScope = 'selected') => {
    engineRef.current?.setMacro(name, value, scope)
  }, [])

  const startMarchLoop = useCallback(
    (events: readonly MarchEvent[], phraseDuration: number, barDuration: number) => {
      engineRef.current?.startMarchLoop(events, phraseDuration, barDuration)
    },
    [],
  )

  const stopMarchLoop = useCallback(() => {
    engineRef.current?.stopMarchLoop()
  }, [])

  const marchPhase = useCallback(() => engineRef.current?.marchPhase() ?? null, [])

  const setTrackLevel = useCallback((track: TrackId, level: number) => {
    if (!Number.isFinite(level)) return
    const clamped = Math.min(TRACK_LEVEL_MAX, Math.max(0, Math.round(level)))
    setTrackLevelState((prev) => ({ ...prev, [track]: clamped }))
    engineRef.current?.setTrackGain(track, clamped / TRACK_LEVEL_MAX)
  }, [])

  // A source that just came up is at its own default levels. Re-send both
  // faders whenever a new engine is installed, for the same reason Rhythmic
  // Intent re-sends its pitch.
  useEffect(() => {
    for (const track of ['main', 'march'] as const) {
      engineRef.current?.setTrackGain(track, trackLevel[track] / TRACK_LEVEL_MAX)
    }
    // Only on a swap: every deliberate move already went straight to the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineId])

  const onExternalTap = useCallback((listener: (velocity: number) => void) => {
    // The engine outlives individual renders; guard in case it's mid-teardown.
    return engineRef.current?.onExternalTap(listener) ?? (() => {})
  }, [])

  const value: SoundEngineSessionValue = {
    status,
    source,
    preference,
    setPreference,
    engineId,
    bridgeReachable,
    bridgeAddressable,
    bpm,
    setBpm,
    noteOn,
    startLoop,
    stopLoop,
    startMarchLoop,
    stopMarchLoop,
    marchPhase,
    trackLevel,
    setTrackLevel,
    setPitch,
    setMacro,
    onExternalTap,
  }

  return <SoundEngineContext.Provider value={value}>{children}</SoundEngineContext.Provider>
}
