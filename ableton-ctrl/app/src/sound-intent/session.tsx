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
import { useSoundEngine } from '../transport/session.tsx'
import type { PatternId } from '../selector/patterns.ts'

/** Dimensions that drive a sound macro, id → the macro's exact name. */
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
    to clear the previous bar's blots first. `gesture` is the Selector mark that
    fired it and `repeats` the RIPPLE count it carried — both snapshotted for
    the same reason as `params`: a mark is whatever it was when it sounded. */
export type SoundTap = {
  params: SoundParams
  pos: number
  newBar: boolean
  gesture: PatternId
  repeats: number
}

type TapListener = (tap: SoundTap) => void

export type SoundIntentSessionValue = {
  params: SoundParams
  setParam: (id: SoundDimensionId, value: number) => void
  /** Fire one sound event at `pos` (0..1 within the bar); `newBar` is true for
      the tap that starts a fresh bar, `gesture`/`repeats` describe which mark
      sounded. Currently drives only the Sound Visual; the Ableton parameter
      send will hang off the same call once dimensions are mapped. */
  emitTap: (pos: number, newBar: boolean, gesture: PatternId, repeats: number) => void
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
  const { setMacro, status, engineId } = useSoundEngine()
  const [params, setParams] = useState<SoundParams>(DEFAULT_SOUND_PARAMS)

  // Mirror params in a ref so emitTap always snapshots the current values
  // without needing to be re-created on every slider move.
  const paramsRef = useRef(params)
  paramsRef.current = params

  const listeners = useRef(new Set<TapListener>())

  const setParam = useCallback(
    (id: SoundDimensionId, value: number) => {
      setParams((prev) => ({ ...prev, [id]: value }))
      // Mapped dimensions (Energy) also drive the like-named macro on the
      // engine — the rack knob in Live, or its Web Audio counterpart.
      const macroName = MACRO_BY_ID.get(id)
      if (macroName != null) setMacro(macroName, toMacroValue(value))
    },
    [setMacro],
  )

  // A source that just came up knows nothing of earlier values (the bridge
  // also only forwards macros once a track is selected) — resend every mapped
  // dimension whenever it becomes ready, so the sound matches the sliders.
  const engineReady = status.ready
  useEffect(() => {
    if (!engineReady) return
    for (const [id, macroName] of MACRO_BY_ID) setMacro(macroName, toMacroValue(paramsRef.current[id]))
  }, [engineId, engineReady, setMacro])

  const emitTap = useCallback(
    (pos: number, newBar: boolean, gesture: PatternId, repeats: number) => {
      const tap: SoundTap = { params: { ...paramsRef.current }, pos, newBar, gesture, repeats }
      for (const listener of listeners.current) listener(tap)
      // TODO: once the five dimensions are mapped, also push these params to
      // Ableton here (via the bridge) so sound + visual share this one event.
    },
    [],
  )

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
