import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_CHARACTER, characterOf, type CharacterState } from './character.ts'
import type { PatternId } from './patterns.ts'

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
      with no axis (SPLASH). This is the value that gets snapshotted onto a tap;
      after that the tap owns it and this can move freely. */
  currentCharacter: () => number | null
}

const SelectorContext = createContext<SelectorSessionValue | null>(null)

export function useSelector(): SelectorSessionValue {
  const value = useContext(SelectorContext)
  if (!value) throw new Error('useSelector must be used inside <SelectorSession>')
  return value
}

/**
 * What a tap IS, in two levels: its identity and its character.
 *
 * Lifted out of the Selector window because neither level is that window's
 * private state — the TAP button, Space, the Selector's own marks and the Sound
 * Visual all read the same choice, so selecting SPLASH or opening the hat
 * changes what the next tap sounds and what it draws, wherever it is fired.
 *
 * Both levels are LIVE values: they describe the next event, never a recorded
 * one. The moment a tap fires, its identity and character are copied onto it
 * and stop listening to this session — which is what makes a bar of hits at
 * different hardnesses possible at all.
 */
export function SelectorSession({ children }: { children: ReactNode }) {
  const [gesture, setGesture] = useState<PatternId>('hit')
  const [character, setCharacterState] = useState<CharacterState>(DEFAULT_CHARACTER)

  const setCharacter = useCallback((id: PatternId, value: number) => {
    const clamped = Math.min(1, Math.max(0, value))
    setCharacterState((prev) => (prev[id] === clamped ? prev : { ...prev, [id]: clamped }))
  }, [])

  // Read through the state React is rendering, so a tap fired in the same press
  // as a slider move still carries the value that was on screen.
  const currentCharacter = useCallback(
    () => characterOf(gesture, character),
    [gesture, character],
  )

  const value = useMemo<SelectorSessionValue>(
    () => ({ gesture, setGesture, character, setCharacter, currentCharacter }),
    [gesture, character, setCharacter, currentCharacter],
  )
  return <SelectorContext.Provider value={value}>{children}</SelectorContext.Provider>
}
