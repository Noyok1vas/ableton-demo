import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { View } from './types.ts'
import { zoomView } from './viewUtils.ts'

type CanvasSurfaceProps = {
  view: View
  onViewChange: (view: View) => void
  children: ReactNode
}

type Pinch = { dist: number; mx: number; my: number }

/** Fired on document when a two-finger canvas pinch starts, so window
 *  drag/resize can drop their pointer capture instead of fighting the zoom. */
export const CANVAS_PINCH_EVENT = 'canvaspinch'

function touchDistance(a: Touch, b: Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function touchMidpoint(a: Touch, b: Touch, rect: DOMRect) {
  return {
    mx: (a.clientX + b.clientX) / 2 - rect.left,
    my: (a.clientY + b.clientY) / 2 - rect.top,
  }
}

function pairFrom(touches: TouchList): [Touch, Touch] | null {
  if (touches.length < 2) return null
  return [touches[0], touches[1]]
}

/**
 * White, infinite canvas. The background layer catches drags (pan) and wheel
 * (zoom); windows live in a separate transformed layer above it. The layer has
 * pointer-events:none so empty space falls through to the background, letting
 * pan start anywhere that isn't a window.
 *
 * Two-finger pinch is listened for in capture on the surface so it still
 * works when the fingers land on a window (those windows own pointer capture
 * for one-finger drag). One-finger on a window is left alone.
 */
export function CanvasSurface({ view, onViewChange, children }: CanvasSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const pan = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)
  const pinch = useRef<Pinch | null>(null)

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

  // Capture + non-passive so two fingers on a window still zoom the canvas,
  // and so preventDefault actually stops Safari's page pinch.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return

    const beginPinch = (touches: TouchList) => {
      const pair = pairFrom(touches)
      if (!pair) return false
      pan.current = null
      document.dispatchEvent(new Event(CANVAS_PINCH_EVENT))
      const rect = el.getBoundingClientRect()
      pinch.current = { dist: touchDistance(pair[0], pair[1]), ...touchMidpoint(pair[0], pair[1], rect) }
      return true
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2 && beginPinch(e.touches)) e.preventDefault()
    }

    const onTouchMove = (e: TouchEvent) => {
      const pair = pairFrom(e.touches)
      if (!pair) return
      e.preventDefault()
      if (!pinch.current) beginPinch(e.touches)
      const state = pinch.current
      if (!state) return
      const rect = el.getBoundingClientRect()
      const dist = touchDistance(pair[0], pair[1])
      const { mx, my } = touchMidpoint(pair[0], pair[1], rect)
      const factor = state.dist > 0 ? dist / state.dist : 1
      const zoomed = zoomView(viewRef.current, factor, state.mx, state.my)
      onViewChange({
        ...zoomed,
        x: zoomed.x + (mx - state.mx),
        y: zoomed.y + (my - state.my),
      })
      pinch.current = { dist, mx, my }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch.current = null
    }

    const preventGesture = (e: Event) => e.preventDefault()

    const opts: AddEventListenerOptions = { capture: true, passive: false }
    el.addEventListener('touchstart', onTouchStart, opts)
    el.addEventListener('touchmove', onTouchMove, opts)
    el.addEventListener('touchend', onTouchEnd, opts)
    el.addEventListener('touchcancel', onTouchEnd, opts)
    // Safari fires these for page pinch; swallow them so only the canvas zooms.
    el.addEventListener('gesturestart', preventGesture, opts)
    el.addEventListener('gesturechange', preventGesture, opts)
    el.addEventListener('gestureend', preventGesture, opts)
    return () => {
      el.removeEventListener('touchstart', onTouchStart, opts)
      el.removeEventListener('touchmove', onTouchMove, opts)
      el.removeEventListener('touchend', onTouchEnd, opts)
      el.removeEventListener('touchcancel', onTouchEnd, opts)
      el.removeEventListener('gesturestart', preventGesture, opts)
      el.removeEventListener('gesturechange', preventGesture, opts)
      el.removeEventListener('gestureend', preventGesture, opts)
    }
  }, [onViewChange])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pinch.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pan.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pan.current || pinch.current) return
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
