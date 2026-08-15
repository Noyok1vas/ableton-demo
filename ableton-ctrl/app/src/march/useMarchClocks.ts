import { useEffect, useState } from 'react'
import { STEPS_PER_BAR } from './patterns.ts'
import { useMarch } from './session.tsx'

/**
 * March's two moving numbers — how long the gesture has been held, and where
 * the looping phrase has reached.
 *
 * Both live in the *window* that draws them rather than in the session. They
 * change every frame, and the session sits above the whole canvas: pushing 60Hz
 * through it would re-render every other window in the app, Sound Visual
 * included, for the sake of one growing bar.
 */

/** Seconds the March button has been held, updated per frame. 0 when idle. */
export function useHeldSeconds(): number {
  const { gestureStart } = useMarch()
  const [held, setHeld] = useState(0)

  useEffect(() => {
    if (gestureStart === null) {
      setHeld(0)
      return
    }
    let frame = 0
    const step = () => {
      setHeld((performance.now() - gestureStart) / 1000)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [gestureStart])

  return held
}

export type PlayheadPosition = {
  /** 0..1 through the phrase. */
  progress: number
  /** Which block of the phrase is sounding — its index in `loop.ids`. */
  barIndex: number
  /** 0..15 within that block. */
  step: number
}

/**
 * Where the March loop has reached, or null when it is stopped — and also null
 * in the moments after a launch while the phrase is queued, waiting for the
 * downbeat it will join on. The windows read that null as "queued", which is
 * exactly what it means.
 *
 * The number comes from the engine, which is reading its own audio clock, so
 * the drawn playhead and the scheduled notes cannot drift apart.
 */
export function useMarchPlayhead(): PlayheadPosition | null {
  const { loop, marchPhase } = useMarch()
  const [position, setPosition] = useState<PlayheadPosition | null>(null)

  useEffect(() => {
    if (!loop) {
      setPosition(null)
      return
    }
    let frame = 0
    const step = () => {
      const progress = marchPhase()
      if (progress === null) {
        setPosition(null)
      } else {
        const barIndex = Math.min(loop.bars - 1, Math.floor(progress * loop.bars))
        const within = progress * loop.bars - barIndex
        setPosition({
          progress,
          barIndex,
          step: Math.min(STEPS_PER_BAR - 1, Math.floor(within * STEPS_PER_BAR)),
        })
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [loop, marchPhase])

  return position
}
