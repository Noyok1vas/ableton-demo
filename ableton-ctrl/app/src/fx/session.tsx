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
import {
  DEFAULT_FX_PARAMS,
  FX_CONTROLS,
  FX_MAX,
  FX_MIN,
  type FxControlId,
  type FxParams,
} from './types.ts'
import { useSoundEngine } from '../transport/session.tsx'

/** Controls that drive a sound parameter, id → that parameter's exact name. */
const MACRO_BY_ID = new Map<FxControlId, string>(
  FX_CONTROLS.filter((c) => c.macroName != null).map((c) => [c.id, c.macroName as string]),
)

/** A control's 0..100 value → the macro's 0..127 range. */
function toMacroValue(value: number): number {
  return Math.round(((value - FX_MIN) / (FX_MAX - FX_MIN)) * 127)
}

export type FxSessionValue = {
  params: FxParams
  setParam: (id: FxControlId, value: number) => void
}

const FxContext = createContext<FxSessionValue | null>(null)

export function useFx(): FxSessionValue {
  const value = useContext(FxContext)
  if (!value) throw new Error('useFx must be used inside <FxSession>')
  return value
}

/**
 * Shared FX state. Unlike Sound Intent there is no per-tap snapshot: an effect
 * describes the room, so its current value is simply read by whatever needs it
 * and pushed to Live with `scope: 'all'` so it lands on every track that
 * carries the macro. Nothing on the canvas reads it today — see fx/types.ts.
 */
export function FxSession({ children }: { children: ReactNode }) {
  const { setMacro, status, engineId } = useSoundEngine()
  const [params, setParams] = useState<FxParams>(DEFAULT_FX_PARAMS)

  const paramsRef = useRef(params)
  paramsRef.current = params

  const setParam = useCallback(
    (id: FxControlId, value: number) => {
      setParams((prev) => ({ ...prev, [id]: value }))
      const macroName = MACRO_BY_ID.get(id)
      if (macroName != null) setMacro(macroName, toMacroValue(value), 'all')
    },
    [setMacro],
  )

  // A source that just came up knows nothing of earlier values — resend every
  // mapped control whenever it becomes ready, so the sound matches the sliders.
  // Switching source counts: the new engine may arrive already ready.
  const engineReady = status.ready
  useEffect(() => {
    if (!engineReady) return
    for (const [id, macroName] of MACRO_BY_ID) {
      setMacro(macroName, toMacroValue(paramsRef.current[id]), 'all')
    }
  }, [engineId, engineReady, setMacro])

  const value = useMemo<FxSessionValue>(() => ({ params, setParam }), [params, setParam])

  return <FxContext.Provider value={value}>{children}</FxContext.Provider>
}
