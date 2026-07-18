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
}

/**
 * Simulated one-bar capture window. The first tap opens the window and defines
 * t=0 (not necessarily the musical downbeat); the window closes by itself after
 * `barDuration` seconds. A tap landing after the window has closed is ignored
 * and the next tap starts a fresh bar.
 */
export function useTapCapture(barDuration: number): TapCapture {
  const [state, setState] = useState<CaptureState>('ready')
  const [taps, setTaps] = useState<Tap[]>([])
  const [progress, setProgress] = useState(0)

  const stateRef = useRef<CaptureState>('ready')
  const startRef = useRef(0)
  const rafRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopTimers = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const finalize = useCallback(() => {
    stopTimers()
    stateRef.current = 'complete'
    setState('complete')
    setProgress(1)
  }, [stopTimers])

  const startRecording = useCallback(
    (velocity: number) => {
      startRef.current = performance.now()
      stateRef.current = 'recording'
      setState('recording')
      setTaps([{ time: 0, velocity }])
      setProgress(0)

      timeoutRef.current = setTimeout(finalize, barDuration * 1000)
      const tick = () => {
        const elapsed = (performance.now() - startRef.current) / 1000
        setProgress(Math.min(elapsed / barDuration, 1))
        if (elapsed < barDuration) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [barDuration, finalize],
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
        setTaps((prev) => [...prev, { time: elapsed, velocity }])
        return true
      }
      // 'ready' or 'complete': this tap begins a fresh pattern.
      startRecording(velocity)
      return true
    },
    [barDuration, finalize, startRecording],
  )

  const reset = useCallback(() => {
    stopTimers()
    stateRef.current = 'ready'
    setState('ready')
    setTaps([])
    setProgress(0)
  }, [stopTimers])

  useEffect(() => stopTimers, [stopTimers])

  return { state, taps, progress, tap, reset }
}
