import { useEffect, useRef } from 'react'
import { renderPatternTile, type Pattern } from './patterns.ts'

/**
 * The panel's preview — the STATE level, the counterpart to SelectorIcon.
 *
 * Same field, same rasterizer, same printed look; the difference is that this
 * one is redrawn whenever the character moves, so it always shows what the next
 * event will sound like rather than what kind of sound it is.
 *
 * Rasterizing is tens of milliseconds of per-pixel work, and a dragged slider
 * asks for it far faster than the screen can show it — so a move only records
 * the wanted value and the work happens once, in the next animation frame. That
 * is the same bargain the Sound Visual makes with its own re-placement, for the
 * same reason.
 */
export function SoundPreview({ pattern, character }: { pattern: Pattern; character: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The latest requested character, read at paint time rather than closed over,
  // so several moves inside one frame collapse into the last one.
  const wantedRef = useRef(character)
  wantedRef.current = character
  // The painter's own "ask for a frame", published out of the effect so a
  // character change can wake it without tearing it down and re-rolling grain.
  const scheduleRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId = 0
    // What is currently rasterized, so a resize repaints without re-rolling the
    // grain and an unchanged value skips the expensive part entirely.
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
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(tile, 0, 0, w, h)
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
    // `character` is fed through wantedRef; only a change of identity rebuilds
    // the painter, which is what keeps a drag from re-creating it every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern])

  useEffect(() => {
    scheduleRef.current?.()
  }, [character])

  return <canvas ref={canvasRef} className="sel-preview-canvas" />
}
