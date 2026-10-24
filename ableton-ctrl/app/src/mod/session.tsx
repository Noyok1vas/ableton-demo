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

export type ModValue = {
  /** Audition mode: a pad is held past a long press. While it is on, the pads
      and the glass sound and preview without recording, and the screen shows
      that sound large instead of the circular sequencer. Letting go of every
      held pad leaves it at once. */
  active: boolean
  /** The same, read at call time rather than at render — what a press asks,
      so a second pad touched while one is held still auditions. */
  isActive: () => boolean
  /** The sound shown large on the Main Screen — the last pad pressed while
      auditioning. Null shows the whole rack. */
  focus: PatternId | null
  /** A held pad was pressed / released. Counted, so several can be held at
      once. The view stays only while at least one is down. */
  beginTouch: () => void
  endTouch: () => void
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
 * shape it and tap the glass to hear it. Letting go of the pad returns to the
 * sequencer at once. Lives above the tap trigger, which asks it whether a
 * press should record or audition.
 */
export function ModSession({ children }: { children: ReactNode }) {
  const { setGesture, character, currentVelocity } = useSelector()
  const { noteOn, suspendMetronome } = useSoundEngine()
  const { playing, togglePlay } = useSession()
  const [active, setActive] = useState(false)
  const [focus, setFocus] = useState<PatternId | null>(null)

  const touches = useRef(0)
  const activeRef = useRef(false)

  const show = useCallback(() => {
    activeRef.current = true
    setActive(true)
  }, [])

  const beginTouch = useCallback(() => {
    touches.current += 1
    show()
  }, [show])

  const endTouch = useCallback(() => {
    touches.current = Math.max(0, touches.current - 1)
    if (touches.current > 0) return
    activeRef.current = false
    setActive(false)
    setFocus(null)
  }, [])

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
      show()
    },
    [setGesture, noteOn, show],
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
      show()
    },
    [setGesture, show],
  )

  const isActive = useCallback(() => activeRef.current, [])

  const value = useMemo<ModValue>(
    () => ({ active, isActive, focus, beginTouch, endTouch, audition, present }),
    [active, isActive, focus, beginTouch, endTouch, audition, present],
  )
  return <ModContext.Provider value={value}>{children}</ModContext.Provider>
}
