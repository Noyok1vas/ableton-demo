import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { View } from './types.ts'
import { zoomView } from './viewUtils.ts'

type CanvasSurfaceProps = {
  view: View
  onViewChange: (view: View) => void
  children: ReactNode
}

/**
 * White, infinite canvas. The background layer catches drags (pan) and wheel
 * (zoom); windows live in a separate transformed layer above it. The layer has
 * pointer-events:none so empty space falls through to the background, letting
 * pan start anywhere that isn't a window.
 */
export function CanvasSurface({ view, onViewChange, children }: CanvasSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const pan = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)

  // Wheel is attached natively (not via React) so it can be non-passive and
  // call preventDefault — required to stop the page/trackpad from scrolling.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        // Pinch / cmd+wheel → zoom toward the cursor.
        onViewChange(zoomView(v, Math.exp(-e.deltaY * 0.002), cx, cy))
      } else {
        // Plain wheel / two-finger scroll → pan.
        onViewChange({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onViewChange])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pan.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pan.current) return
    // Pan is screen-space: view.x/y are screen px, so no scale division.
    onViewChange({
      ...viewRef.current,
      x: pan.current.vx + (e.clientX - pan.current.px),
      y: pan.current.vy + (e.clientY - pan.current.py),
    })
  }
  const onPointerUp = () => {
    pan.current = null
  }

  return (
    <div className="surface" ref={surfaceRef}>
      <div
        className="surface-bg"
        data-canvas-background
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className="surface-layer"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
