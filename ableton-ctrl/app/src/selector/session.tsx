import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { PatternId } from './patterns.ts'

export type SelectorSessionValue = {
  /** The gesture every tap currently fires, whichever surface fires it. */
  gesture: PatternId
  setGesture: (id: PatternId) => void
}

const SelectorContext = createContext<SelectorSessionValue | null>(null)

export function useSelector(): SelectorSessionValue {
  const value = useContext(SelectorContext)
  if (!value) throw new Error('useSelector must be used inside <SelectorSession>')
  return value
}

/**
 * The selected gesture, lifted out of the Selector window: it is no longer that
 * window's private highlight but the thing a tap *is*. The TAP button, the
 * Selector's own marks and the Sound Visual all read the same choice, so
 * selecting RIPPLE changes what the next tap sounds and what it draws.
 */
export function SelectorSession({ children }: { children: ReactNode }) {
  const [gesture, setGesture] = useState<PatternId>('bloom')
  const value = useMemo<SelectorSessionValue>(() => ({ gesture, setGesture }), [gesture])
  return <SelectorContext.Provider value={value}>{children}</SelectorContext.Provider>
}
