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
import { SOUND_VOICES, type DrumParams, type SoundVoiceId } from '../transport/engine.ts'
import { isRecord, loadSaved, useSaved } from '../persist.ts'
import { DEFAULT_DRUM, completeDrum } from './params.ts'

export type DrumState = Record<SoundVoiceId, DrumParams>

export type DrumSessionValue = {
  /** Every sound's knobs as they stand — live values for the next tap. */
  params: DrumState
  setParam: (id: SoundVoiceId, key: string, value: number) => void
  /** Put one sound's knobs back at their 909 positions. */
  resetSound: (id: SoundVoiceId) => void
  /** A copy of `id`'s knobs for a tap fired now. Read at the instant of the
      press, like the Selector's character, and never again. */
  snapshot: (id: SoundVoiceId) => DrumParams
  /** True while the Chladni 2 page is on screen. A tap fired then — from its
      pads or from Space — carries the knobs and plays from them. */
  isActive: () => boolean
  /** Mark the page as on screen for as long as the caller is mounted. */
  hold: () => () => void
  /** Draw the faint |ψ|² body under the sand. */
  fill: boolean
  setFill: (on: boolean) => void
}

const DrumContext = createContext<DrumSessionValue | null>(null)

export function useDrum(): DrumSessionValue {
  const value = useContext(DrumContext)
  if (!value) throw new Error('useDrum must be used inside <DrumSession>')
  return value
}

/** While mounted, taps fired anywhere carry the Chladni 2 knobs. */
export function useDrumPage(): void {
  const { hold } = useDrum()
  useEffect(() => hold(), [hold])
}

type SavedDrum = { params: DrumState; fill: boolean }

function restoreDrum(): SavedDrum {
  const raw = loadSaved('drum')
  const saved = isRecord(raw) ? raw : {}
  const params = isRecord(saved.params) ? saved.params : {}
  return {
    params: Object.fromEntries(
      SOUND_VOICES.map((id) => {
        const stored = params[id]
        return [id, completeDrum(id, isRecord(stored) ? (stored as DrumParams) : undefined)]
      }),
    ) as DrumState,
    fill: saved.fill === true,
  }
}

/**
 * The Chladni 2 page's knobs, lifted out of its windows so they survive the
 * page being switched away and back, and so the one tap trigger (TapSession)
 * can stamp them onto a tap. Independent of the Selector's characters: the
 * two pages describe the same eight sounds two different ways.
 */
export function DrumSession({ children }: { children: ReactNode }) {
  const [restored] = useState(restoreDrum)
  const [params, setParams] = useState<DrumState>(restored.params)
  const [fill, setFill] = useState(restored.fill)
  const paramsRef = useRef(params)
  paramsRef.current = params
  const holders = useRef(0)

  const setParam = useCallback((id: SoundVoiceId, key: string, value: number) => {
    setParams((prev) => {
      const next = completeDrum(id, { ...prev[id], [key]: value })
      return next[key] === prev[id][key] ? prev : { ...prev, [id]: next }
    })
  }, [])

  const resetSound = useCallback((id: SoundVoiceId) => {
    setParams((prev) => ({ ...prev, [id]: { ...DEFAULT_DRUM[id] } }))
  }, [])

  const snapshot = useCallback((id: SoundVoiceId) => ({ ...paramsRef.current[id] }), [])
  const isActive = useCallback(() => holders.current > 0, [])
  const hold = useCallback(() => {
    holders.current++
    return () => {
      holders.current--
    }
  }, [])

  const saved = useMemo<SavedDrum>(() => ({ params, fill }), [params, fill])
  useSaved('drum', saved)

  const value = useMemo<DrumSessionValue>(
    () => ({ params, setParam, resetSound, snapshot, isActive, hold, fill, setFill }),
    [params, setParam, resetSound, snapshot, isActive, hold, fill],
  )
  return <DrumContext.Provider value={value}>{children}</DrumContext.Provider>
}
