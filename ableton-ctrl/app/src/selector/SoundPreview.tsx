import { useEffect, useRef } from 'react'
import { renderPatternTile, type Pattern } from './patterns.ts'

// Velocity reads as size alone: a softer hit is a smaller mark, the same ink.
// Same floor as the Sound Visual's ring, so the two agree on scale.
const VELOCITY_MIN_SIZE = 0.68
const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/**
 * A sound's mark at its current STATE. Used everywhere a sound is shown: the
 * pads, the Main Screen's rack preview, and the one sound brought up large.
 *
 * Same field, same rasterizer, same printed look; the difference is that this
 * one is redrawn whenever the character moves, and drawn smaller as the
 * velocity drops.
 *
 * Rasterizing is tens of milliseconds of per-pixel work, and a dragged strip
 * asks for it far faster than the screen can show it — so a move only records
 * the wanted value and the work happens once, in the next animation frame.
 */
export function SoundPreview({
  pattern,
  character,
  velocity = 1,
}: {
  pattern: Pattern
  character: number
  velocity?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The latest requested values, read at paint time rather than closed over,
  // so several moves inside one frame collapse into the last one.
  const wantedRef = useRef(character)
  wantedRef.current = character
  const velocityRef = useRef(velocity)
  velocityRef.current = velocity
  // The painter's own "ask for a frame", published out of the effect so a
  // change can wake it without tearing it down and re-rolling grain.
  const scheduleRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId = 0
    // What is currently rasterized, so a resize or a velocity move repaints
    // without re-rolling the grain, and an unchanged character skips the
    // expensive part entirely.
    let tile: HTMLCanvasElement | null = null
    let tileAt = Number.NaN

    const paint = () => {
      rafId = 0
      if (tileAt !== wantedRef.current || !tile) {
        tileAt = wantedRef.current
        tile = renderPatternTile(pattern, tileAt)
      }
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const v = Math.min(1, Math.max(0, velocityRef.current))
      const size = lerp(VELOCITY_MIN_SIZE, 1, v)
      const dw = w * size
      const dh = h * size
      ctx.clearRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tile, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }

    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(paint)
    }
    scheduleRef.current = schedule

    paint()
    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      scheduleRef.current = null
    }
    // `character` and `velocity` are fed through refs; only a change of
    // identity rebuilds the painter, which keeps a drag from re-creating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern])

  useEffect(() => {
    scheduleRef.current?.()
  }, [character, velocity])

  return <canvas ref={canvasRef} className="sound-preview" />
}
