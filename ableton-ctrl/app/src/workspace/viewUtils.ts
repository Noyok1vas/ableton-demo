import { MAX_SCALE, MIN_SCALE, type View } from './types.ts'

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Zoom by `factor` while keeping the surface-local point (cx, cy) fixed on
 * screen. Solving for the new translation: the canvas point under the cursor,
 * (c - t) / s, must map back to the same screen point after scaling.
 */
export function zoomView(view: View, factor: number, cx: number, cy: number): View {
  const scale = clampScale(view.scale * factor)
  const k = scale / view.scale
  return {
    scale,
    x: cx - (cx - view.x) * k,
    y: cy - (cy - view.y) * k,
  }
}
