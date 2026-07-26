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
  DEFAULT_SOUND_PARAMS,
  SOUND_DIMENSIONS,
  SOUND_MAX,
  SOUND_MIN,
  type SoundDimensionId,
  type SoundParams,
} from './types.ts'
import { useBridge } from '../transport/useBridge.ts'

/** Dimensions that drive an Ableton rack macro, id → the macro's exact name. */
const MACRO_BY_ID = new Map<SoundDimensionId, string>(
  SOUND_DIMENSIONS.filter((d) => d.macroName != null).map((d) => [d.id, d.macroName as string]),
)

/** A dimension's 0..100 slider value → the macro's 0..127 range. */
function toMacroValue(value: number): number {
  return Math.round(((value - SOUND_MIN) / (SOUND_MAX - SOUND_MIN)) * 127)
}

/** A single sound event. `params` is a snapshot of the Semantic State at the
    moment of the tap, so a later visual/sound reads the values it was fired
    with even if the sliders move afterwards. `pos` is the tap's 0..1 position
    within the rhythmic bar (the Sound Visual maps it to an angle on its
    circle); `newBar` marks the tap that begins a fresh bar, telling the visual
    to clear the previous bar's blots first. */
export type SoundTap = { params: SoundParams; pos: number; newBar: boolean }

type TapListener = (tap: SoundTap) => void

export type SoundIntentSessionValue = {
  params: SoundParams
  setParam: (id: SoundDimensionId, value: number) => void
  /** Fire one sound event at `pos` (0..1 within the bar); `newBar` is true for
      the tap that starts a fresh bar. Currently drives only the Sound Visual;
      the Ableton parameter send will hang off the same call once dimensions
      are mapped. */
  emitTap: (pos: number, newBar: boolean) => void
  /** Subscribe to taps (the Sound Visual canvas does). Returns an unsubscribe. */
  onTap: (listener: TapListener) => () => void
}

const SoundIntentContext = createContext<SoundIntentSessionValue | null>(null)

export function useSoundIntent(): SoundIntentSessionValue {
  const value = useContext(SoundIntentContext)
  if (!value) throw new Error('useSoundIntent must be used inside <SoundIntentSession>')
  return value
}

/**
 * Shared state for every Sound Intent surface on the canvas (the slider panel
 * and the visual). Lives above the Workspace so it survives page switches, the
 * same way RhythmicIntentSession does — but entirely independent of it.
 */
export function SoundIntentSession({ children }: { children: ReactNode }) {
  const { sendMacro, state: linkState } = useBridge()
  const [params, setParams] = useState<SoundParams>(DEFAULT_SOUND_PARAMS)

  // Mirror params in a ref so emitTap always snapshots the current values
  // without needing to be re-created on every slider move.
  const paramsRef = useRef(params)
  paramsRef.current = params

  const listeners = useRef(new Set<TapListener>())

  const setParam = useCallback(
    (id: SoundDimensionId, value: number) => {
      setParams((prev) => ({ ...prev, [id]: value }))
      // Mapped dimensions (Energy) also drive the like-named rack knob in Live.
      const macroName = MACRO_BY_ID.get(id)
      if (macroName != null) sendMacro(macroName, toMacroValue(value))
    },
    [sendMacro],
  )

  // The bridge only forwards macros once a track is selected, and a bridge
  // restart drops any earlier value — resend every mapped dimension whenever
  // the link (re)connects so Live matches the sliders.
  useEffect(() => {
    if (linkState.link !== 'connected') return
    for (const [id, macroName] of MACRO_BY_ID) sendMacro(macroName, toMacroValue(paramsRef.current[id]))
  }, [linkState.link, sendMacro])

  const emitTap = useCallback((pos: number, newBar: boolean) => {
    const tap: SoundTap = { params: { ...paramsRef.current }, pos, newBar }
    for (const listener of listeners.current) listener(tap)
    // TODO: once the five dimensions are mapped, also push these params to
    // Ableton here (via the bridge) so sound + visual share this one event.
  }, [])

  const onTap = useCallback((listener: TapListener) => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])

  const value = useMemo<SoundIntentSessionValue>(
    () => ({ params, setParam, emitTap, onTap }),
    [params, setParam, emitTap, onTap],
  )

  return <SoundIntentContext.Provider value={value}>{children}</SoundIntentContext.Provider>
}
