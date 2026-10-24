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
import { useSelector } from '../selector/session.tsx'
import { characterOf } from '../selector/character.ts'
import { useSoundEngine } from '../transport/session.tsx'
import { useSession } from '../rhythmic-intent/session.tsx'
import type { PatternId } from '../selector/patterns.ts'

/**
 * How long audition mode outlasts the last touch of a strip or pad — long
 * enough to let go of a long-pressed pad and reach a strip on the screen, or
 * another pad, without dropping back into recording on the way there.
 */
export const MOD_LINGER_MS = 2000

export type ModValue = {
  /** Audition mode: a pad is held long or a strip is touched, or was a moment
      ago. While it is on, the pads sound and preview without recording, and
      the screen shows the rack preview instead of the circular sequencer. */
  active: boolean
  /** The same, read at call time rather than at render — what a press asks,
      so a strip and a pad touched in the same instant still audition. */
  isActive: () => boolean
  /** The sound shown large on the Main Screen — the last pad pressed while
      auditioning. Null shows the whole rack. */
  focus: PatternId | null
  /** A strip or a held pad was pressed / released. Counted, so several can
      be held at once. */
  beginTouch: () => void
  endTouch: () => void
  /** A strip moved (or was nudged from the keyboard). */
  poke: () => void
  /** Play a pad in audition mode: selects it, sounds it with the strips'
      velocity and its own character, and brings its visual up large. Nothing
      is recorded. */
  audition: (id: PatternId, accented?: boolean) => void
  /** Bring a sound up large and enter audition mode without sounding it — a
      long-pressed pad, whose note already played on the press. */
  present: (id: PatternId) => void
}

const ModContext = createContext<ModValue | null>(null)

export function useMod(): ModValue {
  const value = useContext(ModContext)
  if (!value) throw new Error('useMod must be used inside <ModSession>')
  return value
}

/**
 * Audition mode's shared state — the two-handed mode of the instrument.
 *
 * Hold a pad long and it auditions rather than records; the screen shows the
 * sound large between two strips (velocity, character), so the other hand can
 * shape it before it is played into the loop. Lives above the tap trigger,
 * which asks it whether a press should record or audition.
 */
export function ModSession({ children }: { children: ReactNode }) {
  const { setGesture, character, currentVelocity } = useSelector()
  const { noteOn, suspendMetronome } = useSoundEngine()
  const { playing, togglePlay } = useSession()
  const [active, setActive] = useState(false)
  const [focus, setFocus] = useState<PatternId | null>(null)

  const touches = useRef(0)
  const activeRef = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  /** Stay in audition mode; if nothing is held, for MOD_LINGER_MS more. */
  const keepAlive = useCallback(() => {
    activeRef.current = true
    setActive(true)
    clearTimer()
    if (touches.current > 0) return
    timer.current = setTimeout(() => {
      timer.current = null
      activeRef.current = false
      setActive(false)
      setFocus(null)
    }, MOD_LINGER_MS)
  }, [])

  useEffect(() => clearTimer, [])

  const beginTouch = useCallback(() => {
    touches.current += 1
    keepAlive()
  }, [keepAlive])

  const endTouch = useCallback(() => {
    touches.current = Math.max(0, touches.current - 1)
    keepAlive()
  }, [keepAlive])

  // Read at the moment of the press, like every other tap.
  const characterRef = useRef(character)
  characterRef.current = character
  const velocityRef = useRef(currentVelocity)
  velocityRef.current = currentVelocity

  const audition = useCallback(
    (id: PatternId, accented = false) => {
      setGesture(id)
      setFocus(id)
      noteOn(velocityRef.current(accented), id, characterOf(id, characterRef.current) ?? undefined)
      keepAlive()
    },
    [setGesture, noteOn, keepAlive],
  )

  // Shaping a sound is listening to that sound alone: the loop and the
  // metronome pause for as long as audition mode lasts, and the loop picks up
  // again from its top when it ends — only if it was this that stopped it.
  const playingRef = useRef(playing)
  playingRef.current = playing
  const togglePlayRef = useRef(togglePlay)
  togglePlayRef.current = togglePlay
  const pausedLoop = useRef(false)
  useEffect(() => {
    suspendMetronome(active)
    if (active) {
      if (playingRef.current) {
        pausedLoop.current = true
        togglePlayRef.current()
      }
    } else if (pausedLoop.current) {
      pausedLoop.current = false
      if (!playingRef.current) togglePlayRef.current()
    }
  }, [active, suspendMetronome])

  const present = useCallback(
    (id: PatternId) => {
      setGesture(id)
      setFocus(id)
      keepAlive()
    },
    [setGesture, keepAlive],
  )

  const isActive = useCallback(() => activeRef.current, [])

  const value = useMemo<ModValue>(
    () => ({ active, isActive, focus, beginTouch, endTouch, poke: keepAlive, audition, present }),
    [active, isActive, focus, beginTouch, endTouch, keepAlive, audition, present],
  )
  return <ModContext.Provider value={value}>{children}</ModContext.Provider>
}
