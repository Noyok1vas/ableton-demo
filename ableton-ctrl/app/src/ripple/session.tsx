import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_RIPPLE_COUNT } from './types.ts'

export type RippleSessionValue = {
  /** Repeats per tap, RIPPLE_MIN..RIPPLE_MAX — one ring each. */
  count: number
  setCount: (count: number) => void
}

const RippleContext = createContext<RippleSessionValue | null>(null)

export function useRipple(): RippleSessionValue {
  const value = useContext(RippleContext)
  if (!value) throw new Error('useRipple must be used inside <RippleSession>')
  return value
}

/**
 * The repeat count, shared: the Ripple window sets it, the tap trigger stamps
 * it onto every RIPPLE tap, and the Sound Visual draws that many rings. One
 * number, so the pad's preview and the mark on the bar always agree.
 */
export function RippleSession({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(DEFAULT_RIPPLE_COUNT)
  const value = useMemo<RippleSessionValue>(() => ({ count, setCount }), [count])
  return <RippleContext.Provider value={value}>{children}</RippleContext.Provider>
}
