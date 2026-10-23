import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { GRAIN_PX, pour, printSand } from '../chladni2/sand.ts'
import { buildShape, shapeAlpha, shapeFills, type ShapeParams } from './shape.ts'

/** Body units from the centre to the canvas's nearer edge. */
const SPAN = 1.75

export type ShapeCanvasHandle = { pulse: () => void }

/**
 * A shape, poured as sand and printed to fill its canvas. Poured once per
 * change of shape at `pourPx` px per body unit; a resize only reprints.
 */
export const ShapeCanvas = forwardRef<ShapeCanvasHandle, { shape: ShapeParams; pourPx: number; className?: string }>(
  function ShapeCanvas({ shape, pourPx, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const sand = useMemo(
      () => pour(buildShape(shape), { seed: 7, px: pourPx, fill: shapeFills(shape) }),
      [shape, pourPx],
    )
    const alpha = useMemo(() => shapeAlpha(shape), [shape])

    // A tap: the figure gives a small jolt, as the plate would.
    useImperativeHandle(ref, () => ({
      pulse: () => {
        canvasRef.current?.animate(
          [{ transform: 'scale(1.045)', filter: 'contrast(1.6)' }, { transform: 'scale(1)', filter: 'none' }],
          { duration: 240, easing: 'ease-out' },
        )
      },
    }))

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
        const px = Math.min(w, h) / (2 * SPAN)
        ctx.clearRect(0, 0, w, h)
        printSand(ctx, sand, w / 2, h / 2, px, GRAIN_PX * Math.max(0.7, px / pourPx), 1, alpha)
      }
      paint()
      const observer = new ResizeObserver(paint)
      observer.observe(canvas)
      return () => observer.disconnect()
    }, [sand, alpha, pourPx])

    return <canvas ref={canvasRef} className={className} />
  },
)
