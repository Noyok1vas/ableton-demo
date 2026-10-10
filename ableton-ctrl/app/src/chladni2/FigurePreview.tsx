import { useEffect, useMemo, useRef } from 'react'
import type { DrumParams, SoundVoiceId } from '../transport/engine.ts'
import { figureOf } from './glyphs.ts'
import { GRAIN_PX, pour, printSand } from './sand.ts'

// Velocity reads as size alone (channel 10), over the same range as every
// other mark in the app, so the two Chladni pages agree on scale.
const VELOCITY_MIN_SIZE = 0.45
const VELOCITY_MAX_SIZE = 1.3
/** Body units from the centre to the pad's edge, at velocity 1. */
const SPAN = 1.75
/** Px per body unit the sand is poured at; printing rescales from it. */
const POUR_PX = 150

/** A sound's figure at its knobs, drawn smaller as the velocity drops. */
export function FigurePreview({
  id,
  params,
  velocity,
  fill,
  seed = 1,
}: {
  id: SoundVoiceId
  params: DrumParams
  velocity: number
  fill: boolean
  seed?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Poured once per change of knobs; a velocity move or a resize only reprints.
  const key = JSON.stringify(params)
  const sand = useMemo(
    () => pour(figureOf(id, JSON.parse(key) as DrumParams), { seed, px: POUR_PX, fill }),
    [id, key, fill, seed],
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
      const px = (Math.min(w, h) / (2 * SPAN)) * size
      ctx.clearRect(0, 0, w, h)
      // Grains keep the size they were poured for, so density reads the same
      // however large the pad is.
      printSand(ctx, sand, w / 2, h / 2, px, GRAIN_PX * Math.max(0.7, px / POUR_PX))
    }
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [sand, velocity])

  return <canvas ref={canvasRef} className="c2-figure" />
}
