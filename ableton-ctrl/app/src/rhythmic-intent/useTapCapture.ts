import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureState, Tap } from './types.ts'

export type TapCapture = {
  state: CaptureState
  taps: readonly Tap[]
  /** 0..1 position of the loop clock. It runs for as long as the loop is open
      — through the first pass and every pass after it — so the playhead is
      always somewhere, not just while recording or playing. */
  progress: number
  /** Record one tap where the loop clock stands. Returns the new tap's id. */
  tap: (velocity?: number) => string
  /** Drop one tap by id — a double-click on its mark in the Sound Visual. */
  remove: (id: string) => void
  /** Drop the most recently added tap — the Sound Visual's UNDO. Note this is
      add order, not loop order: it takes back the last thing you played, which
      may sit anywhere in the loop. */
  undo: () => void
  /** Put the loop clock's zero at this instant, leaving the taps alone. The
      session calls it when playback starts so that taps added into a running
      loop land where they were heard. */
  anchor: () => void
  reset: () => void
  /** Replace the current pattern with an already-captured one (state → complete). */
  load: (taps: readonly Tap[]) => void
}

let sequence = 0
const nextId = () => `tap-${++sequence}`

/**
 * A loop you keep playing into. The first tap opens it and defines t=0 (not
 * necessarily the musical downbeat); `loopDuration` seconds later the first
 * pass closes — that is when `onComplete` fires and the loop enters the
 * Collection — but the clock keeps turning and the loop stays open. Every tap
 * after that lands at its wrapped position inside the SAME loop instead of
 * starting a new one, so a phrase can be built up a layer at a time and edited
 * (`remove`, `undo`) until the pattern is cleared outright.
 *
 * `onComplete` fires exactly once per loop, when the first pass closes — not
 * for the additions afterwards, and not when a pattern is merely re-loaded via
 * `load()`.
 */
export function useTapCapture(
  loopDuration: number,
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

  // Ref so finalize (scheduled once, at loop start) sees the latest callback.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const clockRef = useRef(false)
  // The loop's length can change under a running clock (the tempo is typed in
  // while you play), so everything below reads it through a ref instead of
  // closing over the value it was created with.
  const durationRef = useRef(loopDuration)
  durationRef.current = loopDuration

  /** The loop clock: one rAF loop that keeps `progress` turning for as long as
      the loop is open. It is what both playheads read when nothing is playing,
      which is why it does not stop when the first pass closes. */
  const startClock = useCallback(() => {
    if (clockRef.current) return
    clockRef.current = true
    const tick = () => {
      if (!clockRef.current) return
      const elapsed = (performance.now() - startRef.current) / 1000
      setProgress((((elapsed / durationRef.current) % 1) + 1) % 1)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const stopClock = useCallback(() => {
    clockRef.current = false
    cancelAnimationFrame(rafRef.current)
  }, [])

  /** Cancels the pending close of the first pass — not the clock. */
  const clearFinalize = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const stopTimers = useCallback(() => {
    stopClock()
    clearFinalize()
  }, [clearFinalize, stopClock])

  const setAllTaps = useCallback((next: Tap[]) => {
    tapsRef.current = next
    setTaps(next)
  }, [])

  const setCaptureState = useCallback((next: CaptureState) => {
    stateRef.current = next
    setState(next)
  }, [])

  /** The first pass is over: the loop is a pattern now, and stays open — so
      only the close is cancelled here. The clock turns straight on into the
      next pass, and the playhead with it. */
  const finalize = useCallback(() => {
    clearFinalize()
    setCaptureState('complete')
    onCompleteRef.current?.(tapsRef.current)
  }, [clearFinalize, setCaptureState])

  const startRecording = useCallback(
    (velocity: number) => {
      const tap: Tap = { id: nextId(), time: 0, velocity }
      startRef.current = performance.now()
      setCaptureState('recording')
      setAllTaps([tap])
      setProgress(0)

      timeoutRef.current = setTimeout(finalize, durationRef.current * 1000)
      startClock()
      return tap.id
    },
    [finalize, setAllTaps, setCaptureState, startClock],
  )

  const tap = useCallback(
    (velocity = 1): string => {
      if (stateRef.current === 'ready') return startRecording(velocity)

      const duration = durationRef.current
      const elapsed = (performance.now() - startRef.current) / 1000
      // The loop is circular, so one formula covers both passes: inside the
      // first one the wrap is a no-op, after it the tap folds back into the
      // same loop rather than opening a new one.
      const time = ((elapsed % duration) + duration) % duration
      // Timer race: the first pass has run out but its timeout has not fired
      // yet. Close it here so the tap is an addition, not part of the take.
      if (stateRef.current === 'recording' && elapsed >= duration) finalize()
      const record: Tap = { id: nextId(), time, velocity }
      setAllTaps([...tapsRef.current, record])
      return record.id
    },
    [finalize, setAllTaps, startRecording],
  )

  /** Emptying the pattern returns the loop to 'ready', so the next tap opens a
      fresh one rather than landing at some position of a loop nobody can see. */
  const dropTo = useCallback(
    (next: Tap[]) => {
      setAllTaps(next)
      if (next.length === 0) {
        stopTimers()
        setCaptureState('ready')
        setProgress(0)
      }
    },
    [setAllTaps, setCaptureState, stopTimers],
  )

  const remove = useCallback(
    (id: string) => dropTo(tapsRef.current.filter((t) => t.id !== id)),
    [dropTo],
  )

  const undo = useCallback(() => dropTo(tapsRef.current.slice(0, -1)), [dropTo])

  const anchor = useCallback(() => {
    startRef.current = performance.now()
  }, [])

  const reset = useCallback(() => {
    stopTimers()
    setCaptureState('ready')
    setAllTaps([])
    setProgress(0)
  }, [setAllTaps, setCaptureState, stopTimers])

  const load = useCallback(
    (pattern: readonly Tap[]) => {
      clearFinalize()
      setCaptureState('complete')
      setAllTaps([...pattern])
      // The loaded pattern's downbeat is now: additions land relative to it,
      // and its loop turns from here.
      startRef.current = performance.now()
      setProgress(0)
      startClock()
    },
    [clearFinalize, setAllTaps, setCaptureState, startClock],
  )

  // A tempo change re-times the loop rather than re-reading it: every tap's
  // seconds are scaled by the same factor as the loop itself, so the pattern
  // keeps its shape and only plays faster or slower. The clock keeps its phase
  // for the same reason — the playhead should not jump when the tempo does.
  const previousDurationRef = useRef(loopDuration)
  useEffect(() => {
    const previous = previousDurationRef.current
    if (previous === loopDuration) return
    previousDurationRef.current = loopDuration
    const factor = loopDuration / previous
    if (tapsRef.current.length > 0) {
      setAllTaps(tapsRef.current.map((t) => ({ ...t, time: t.time * factor })))
    }
    const now = performance.now()
    const phase = ((((now - startRef.current) / 1000 / previous) % 1) + 1) % 1
    startRef.current = now - phase * loopDuration * 1000
  }, [loopDuration, setAllTaps])

  useEffect(() => stopTimers, [stopTimers])

  return { state, taps, progress, tap, remove, undo, anchor, reset, load }
}
