import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { loadSaved, useSaved } from '../persist.ts'

/**
 * Guiding mode — on or off, for the whole instrument.
 *
 * The controls carry no written labels on the Main Screen; they are icons. So
 * learning them has to live somewhere, and this is where: while guiding mode is
 * on, pointing at any control that carries a `data-hint` shows what it does
 * (see HintLayer). Off, nothing appears and the icons stand on their own.
 */
export type GuideValue = {
  on: boolean
  setOn: (on: boolean) => void
}

const GuideContext = createContext<GuideValue | null>(null)

export function useGuide(): GuideValue {
  const value = useContext(GuideContext)
  if (!value) throw new Error('useGuide must be used inside <GuideSession>')
  return value
}

export function GuideSession({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(() => loadSaved('guide') === true)
  useSaved('guide', on)
  const value = useMemo<GuideValue>(() => ({ on, setOn }), [on])
  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>
}
