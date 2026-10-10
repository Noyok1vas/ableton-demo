import { useEffect, useMemo, useRef } from 'react'
import { renderModalTile, type ModalGlyph, type ModalOptions } from './glyphs.ts'

// Velocity reads as size alone, over the same range as SoundPreview's, so the
// hand-drawn and modal marks beside each other always agree on scale.
const VELOCITY_MIN_SIZE = 0.45
const VELOCITY_MAX_SIZE = 1.3

/** A modal mark at its character, drawn smaller as the velocity drops. */
export function ModalPreview({
  glyph,
  character,
  velocity,
  options,
}: {
  glyph: ModalGlyph
  character: number
  velocity: number
  options: ModalOptions
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Stippled once per character; a velocity move or a resize only rescales it.
  const tile = useMemo(
    () => renderModalTile(glyph, character, options),
    [glyph, character, options],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const paint = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const v = Math.min(1, Math.max(0, velocity))
      const size = VELOCITY_MIN_SIZE + (VELOCITY_MAX_SIZE - VELOCITY_MIN_SIZE) * v
      ctx.clearRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tile, (w - w * size) / 2, (h - h * size) / 2, w * size, h * size)
    }
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [tile, velocity])

  return <canvas ref={canvasRef} className="sound-preview" />
}
