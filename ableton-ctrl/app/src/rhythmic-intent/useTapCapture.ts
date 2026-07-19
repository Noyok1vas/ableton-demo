import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureState, Tap } from './types.ts'

export type TapCapture = {
  state: CaptureState
  taps: readonly Tap[]
  /** 0..1 position of the recording playhead within the bar. */
  progress: number
  /** Record one tap. Returns true if the tap was registered. */
  tap: (velocity?: number) => boolean
  reset: () => void
  /** Replace the current pattern with an already-captured one (state → complete). */
  load: (taps: readonly Tap[]) => void
}

/**
 * Simulated one-bar capture window. The first tap opens the window and defines
 * t=0 (not necessarily the musical downbeat); the window closes by itself after
 * `barDuration` seconds. A tap landing after the window has closed is ignored
 * and the next tap starts a fresh bar.
 *
 * `onComplete` fires exactly once per recorded bar, when the window closes —
 * not when a pattern is merely re-loaded via `load()`.
 */
export function useTapCapture(
  barDuration: number,
  onComplete?: (taps: readonly Tap[]) => void,
): TapCapture {
  const [state, setState] = useState<CaptureState>('ready')
  const [taps, setTaps] = useState<Tap[]>([])
  const [progress, setProgress] = useState(0)

  const stateRef = useRef<CaptureState>('ready')
  const tapsRef = useRef<Tap[]>([])
  const startRef = useRef(0)
  const rafRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ref so finalize (scheduled once, at bar start) sees the latest callback.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const stopTimers = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const setAllTaps = useCallback((next: Tap[]) => {
    tapsRef.current = next
    setTaps(next)
  }, [])

  const finalize = useCallback(() => {
    stopTimers()
    stateRef.current = 'complete'
    setState('complete')
    setProgress(1)
    onCompleteRef.current?.(tapsRef.current)
  }, [stopTimers])

  const startRecording = useCallback(
    (velocity: number) => {
      startRef.current = performance.now()
      stateRef.current = 'recording'
      setState('recording')
      setAllTaps([{ time: 0, velocity }])
      setProgress(0)

      timeoutRef.current = setTimeout(finalize, barDuration * 1000)
      const tick = () => {
        const elapsed = (performance.now() - startRef.current) / 1000
        setProgress(Math.min(elapsed / barDuration, 1))
        if (elapsed < barDuration) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [barDuration, finalize, setAllTaps],
  )

  const tap = useCallback(
    (velocity = 1): boolean => {
      if (stateRef.current === 'recording') {
        const elapsed = (performance.now() - startRef.current) / 1000
        if (elapsed >= barDuration) {
          // Timer race: the bar already ended; drop the tap instead of letting
          // it silently start a new bar.
          finalize()
          return false
        }
        setAllTaps([...tapsRef.current, { time: elapsed, velocity }])
        return true
      }
      // 'ready' or 'complete': this tap begins a fresh pattern.
      startRecording(velocity)
      return true
    },
    [barDuration, finalize, setAllTaps, startRecording],
  )

  const reset = useCallback(() => {
    stopTimers()
    stateRef.current = 'ready'
    setState('ready')
    setAllTaps([])
    setProgress(0)
  }, [setAllTaps, stopTimers])

  const load = useCallback(
    (pattern: readonly Tap[]) => {
      stopTimers()
      stateRef.current = 'complete'
      setState('complete')
      setAllTaps([...pattern])
      setProgress(1)
    },
    [setAllTaps, stopTimers],
  )

  useEffect(() => stopTimers, [stopTimers])

  return { state, taps, progress, tap, reset, load }
}
