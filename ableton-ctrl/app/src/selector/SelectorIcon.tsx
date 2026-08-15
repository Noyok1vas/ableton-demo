import { useEffect, useMemo, useRef } from 'react'
import { IDENTITY_CHARACTER } from './character.ts'
import { renderPatternTile, type Pattern } from './patterns.ts'

/**
 * One selector mark — the IDENTITY level. The pattern is rasterized once into a
 * small tile and then drawn scaled to fit, with smoothing; that upscale is what
 * gives the marks their soft, printed look instead of a crisp vector edge.
 *
 * Deliberately fixed at IDENTITY_CHARACTER and never redrawn. This icon answers
 * "which sound is this", and the answer does not change when a slider moves —
 * the panel's preview is where the current state lives. Keeping the two apart
 * is what lets the grid stay a stable set of four things to choose between.
 */
export function SelectorIcon({ pattern }: { pattern: Pattern }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The grain is random per rasterization; keep one tile per pattern so a
  // resize (or a re-render) doesn't reshuffle the mark's texture.
  const tile = useMemo(() => renderPatternTile(pattern, IDENTITY_CHARACTER), [pattern])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
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
      ctx.drawImage(tile, 0, 0, w, h)
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [tile])

  return <canvas ref={canvasRef} className="sel-icon" />
}
