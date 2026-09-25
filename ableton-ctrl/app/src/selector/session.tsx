import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_CHARACTER, characterOf, type CharacterState } from './character.ts'
import type { PatternId } from './patterns.ts'
import { SOUND_VOICES, type SoundVoiceId } from '../transport/engine.ts'
import { finiteIn, isRecord, loadSaved, mergeNumbers, useSaved } from '../persist.ts'

/** Velocity, as the panel shows it: 1..100. */
export const VELOCITY_MIN = 1
export const VELOCITY_MAX = 100
/** Where an unaccented tap sits by default — far enough under an accent that
    the accent is plainly heard, the way a drum machine's accent is. */
export const DEFAULT_VELOCITY = 70

export type SelectorSessionValue = {
  /** The sound identity every tap currently fires, whichever surface fires it. */
  gesture: PatternId
  setGesture: (id: PatternId) => void
  /** Each identity's character, 0..1, held per identity rather than as one
      shared number: SOFT/HARD and CLOSED/OPEN are different axes, and moving
      one has no business moving the other. */
  character: CharacterState
  setCharacter: (id: PatternId, value: number) => void
  /** The character an event fired right now would carry — null for an identity
      with no axis (SPLASH, RIM). This is the value that gets snapshotted onto a
      tap; after that the tap owns it and this can move freely. */
  currentCharacter: () => number | null
  /** How hard an ordinary tap is played, VELOCITY_MIN..VELOCITY_MAX. */
  velocity: number
  setVelocity: (value: number) => void
  /** Latched accent: while on, every tap is played at full velocity. */
  accent: boolean
  setAccent: (on: boolean) => void
  /** The velocity a tap fired right now would carry, 0..1. `accented` is an
      accent from somewhere other than the latch — Shift held on the keyboard. */
  currentVelocity: (accented?: boolean) => number
}

const SelectorContext = createContext<SelectorSessionValue | null>(null)

export function useSelector(): SelectorSessionValue {
  const value = useContext(SelectorContext)
  if (!value) throw new Error('useSelector must be used inside <SelectorSession>')
  return value
}

type SavedSelector = { gesture: PatternId; character: CharacterState; velocity: number }

/** The accent latch is left out on purpose: coming back to an instrument that
    plays every note accented, with nothing to say why, reads as a fault. */
function restoreSelector(): SavedSelector {
  const raw = loadSaved('selector')
  const saved = isRecord(raw) ? raw : {}
  return {
    gesture: SOUND_VOICES.includes(saved.gesture as SoundVoiceId)
      ? (saved.gesture as PatternId)
      : 'hit',
    character: mergeNumbers(DEFAULT_CHARACTER, saved.character, 0, 1),
    velocity: Math.round(finiteIn(saved.velocity, VELOCITY_MIN, VELOCITY_MAX) ?? DEFAULT_VELOCITY),
  }
}

/**
 * What a tap IS, in three levels: its identity, its character, and how hard
 * it is played.
 *
 * Lifted out of the Selector window because none of them is that window's
 * private state — the Selector's pads, Space and the Sound Visual all read the
 * same choice, so selecting SPLASH or opening the hat changes what the next tap
 * sounds and what it draws, wherever it is fired.
 *
 * All three are LIVE values: they describe the next event, never a recorded
 * one. The moment a tap fires, they are copied onto it and stop listening to
 * this session — which is what makes a bar of hits at different hardnesses
 * and different velocities possible at all.
 */
export function SelectorSession({ children }: { children: ReactNode }) {
  const [restored] = useState(restoreSelector)
  const [gesture, setGesture] = useState<PatternId>(restored.gesture)
  const [character, setCharacterState] = useState<CharacterState>(restored.character)
  const [velocity, setVelocityState] = useState(restored.velocity)
  const [accent, setAccent] = useState(false)

  const setCharacter = useCallback((id: PatternId, value: number) => {
    const clamped = Math.min(1, Math.max(0, value))
    setCharacterState((prev) => (prev[id] === clamped ? prev : { ...prev, [id]: clamped }))
  }, [])

  const setVelocity = useCallback((value: number) => {
    if (!Number.isFinite(value)) return
    setVelocityState(Math.min(VELOCITY_MAX, Math.max(VELOCITY_MIN, Math.round(value))))
  }, [])

  // Read through the state React is rendering, so a tap fired in the same press
  // as a slider move still carries the value that was on screen.
  const currentCharacter = useCallback(
    () => characterOf(gesture, character),
    [gesture, character],
  )

  const currentVelocity = useCallback(
    (accented = false) => (accent || accented ? 1 : velocity / VELOCITY_MAX),
    [accent, velocity],
  )

  const saved = useMemo<SavedSelector>(
    () => ({ gesture, character, velocity }),
    [gesture, character, velocity],
  )
  useSaved('selector', saved)

  const value = useMemo<SelectorSessionValue>(
    () => ({
      gesture,
      setGesture,
      character,
      setCharacter,
      currentCharacter,
      velocity,
      setVelocity,
      accent,
      setAccent,
      currentVelocity,
    }),
    [gesture, character, setCharacter, currentCharacter, velocity, setVelocity, accent, currentVelocity],
  )
  return <SelectorContext.Provider value={value}>{children}</SelectorContext.Provider>
}
