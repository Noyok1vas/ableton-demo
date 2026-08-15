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
import { generatePhrase, type Phrase } from './grammar.ts'
import { PATTERNS_BY_ID, barDurationFor, phraseEvents, type Pattern } from './patterns.ts'
import { useSoundEngine } from '../transport/session.tsx'

/** What the March track is looping right now. */
export type MarchLoop = {
  /** New identity on every launch, so re-generating the same blocks still
      restarts the phrase. */
  key: string
  patterns: readonly Pattern[]
  /** Block ids in play order — what the inspector lights up. */
  ids: readonly string[]
  bars: number
  /** True when this is one block on its own rather than a generated phrase. */
  audition: boolean
}

export type MarchSessionValue = {
  /** Seconds one March bar takes at the transport's tempo — the same bar the
      tapped loop is counting in. */
  barDuration: number

  // ── The gesture ───────────────────────────────────────────────────
  /** True between press and release. */
  holding: boolean
  /** `performance.now()` at the press, or null when not holding. The windows
      animate the growing gesture from this themselves — the number is never
      pushed through state per frame, so a held button doesn't re-render every
      window on the canvas at 60Hz. */
  gestureStart: number | null
  beginGesture: () => void
  /** Release: measure, quantize, generate, loop. */
  endGesture: () => void
  /** Abandon a hold without generating anything (pointer cancelled). */
  cancelGesture: () => void

  // ── The result ────────────────────────────────────────────────────
  /** The most recent generated phrase — what the Current Phrase inspector
      shows. Outlives the loop, so it can be relaunched and read. */
  phrase: Phrase | null
  loop: MarchLoop | null
  /** Relaunch the current phrase. */
  playPhrase: () => void
  /** Loop one block on its own — the Family window's debugging path. It takes
      the March track over until the phrase is put back. */
  playPattern: (id: string) => void
  stop: () => void
  /** 0..1 through the phrase; null when stopped, and null while March is queued
      waiting for the downbeat it will join on. */
  marchPhase: () => number | null
}

const MarchContext = createContext<MarchSessionValue | null>(null)

export function useMarch(): MarchSessionValue {
  const value = useContext(MarchContext)
  if (!value) throw new Error('useMarch must be used inside <MarchSession>')
  return value
}

/**
 * The March session: one gesture recorder, one generator, and the state of the
 * March track, shared by the audience window and the designer window so both
 * are looking at the same generated phrase rather than at two copies of it.
 *
 * The sound is not here. March is a track on the same engine as everything
 * else, which is what lets the two loops share a downbeat rather than merely a
 * tempo — see `transport/webAudioEngine.ts`. This session decides *what* loops;
 * the engine decides when each note sounds.
 */
export function MarchSession({ children }: { children: ReactNode }) {
  const { bpm, engineId, startMarchLoop, stopMarchLoop, marchPhase } = useSoundEngine()
  const barDuration = barDurationFor(bpm)

  /** The press instant, measured here rather than read back out of state: the
      release has to see it immediately and exactly once. */
  const pressedAt = useRef<number | null>(null)

  const [holding, setHolding] = useState(false)
  const [gestureStart, setGestureStart] = useState<number | null>(null)
  const [phrase, setPhrase] = useState<Phrase | null>(null)
  const [loop, setLoop] = useState<MarchLoop | null>(null)

  // The one place the March track is driven. Keyed on the tempo as well as the
  // loop, so a tempo change re-times March exactly as it re-times the tapped
  // loop; and on `engineId`, so a source switch hands the new engine the phrase
  // the old one was playing.
  useEffect(() => {
    if (!loop) {
      stopMarchLoop()
      return
    }
    startMarchLoop(phraseEvents(loop.patterns), loop.bars * barDuration, barDuration)
  }, [loop, barDuration, engineId, startMarchLoop, stopMarchLoop])

  useEffect(() => () => stopMarchLoop(), [stopMarchLoop])

  const launch = useCallback((patterns: readonly Pattern[], audition: boolean) => {
    if (patterns.length === 0) return
    setLoop({
      key: crypto.randomUUID(),
      patterns,
      ids: patterns.map((pattern) => pattern.id),
      bars: patterns.length,
      audition,
    })
  }, [])

  const stop = useCallback(() => setLoop(null), [])

  // ── Gesture ───────────────────────────────────────────────────────
  const beginGesture = useCallback(() => {
    const at = performance.now()
    pressedAt.current = at
    setGestureStart(at)
    setHolding(true)
  }, [])

  const endGesture = useCallback(() => {
    const at = pressedAt.current
    if (at === null) return
    pressedAt.current = null
    setHolding(false)
    setGestureStart(null)
    const next = generatePhrase((performance.now() - at) / 1000, barDuration)
    setPhrase(next)
    launch(next.patterns, false)
  }, [barDuration, launch])

  const cancelGesture = useCallback(() => {
    pressedAt.current = null
    setHolding(false)
    setGestureStart(null)
  }, [])

  // ── Relaunching ───────────────────────────────────────────────────
  const playPhrase = useCallback(() => {
    if (phrase) launch(phrase.patterns, false)
  }, [phrase, launch])

  const playPattern = useCallback(
    (id: string) => {
      const pattern = PATTERNS_BY_ID.get(id)
      if (pattern) launch([pattern], true)
    },
    [launch],
  )

  const value = useMemo<MarchSessionValue>(
    () => ({
      barDuration,
      holding,
      gestureStart,
      beginGesture,
      endGesture,
      cancelGesture,
      phrase,
      loop,
      playPhrase,
      playPattern,
      stop,
      marchPhase,
    }),
    [
      barDuration,
      holding,
      gestureStart,
      beginGesture,
      endGesture,
      cancelGesture,
      phrase,
      loop,
      playPhrase,
      playPattern,
      stop,
      marchPhase,
    ],
  )

  return <MarchContext.Provider value={value}>{children}</MarchContext.Provider>
}
