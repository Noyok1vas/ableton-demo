import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { View } from './types.ts'
import { zoomView } from './viewUtils.ts'

type CanvasSurfaceProps = {
  view: View
  onViewChange: (view: View) => void
  children: ReactNode
}

/** Baseline for one continuous pinch — always scale from the gesture's
 *  starting view, never frame-to-frame (which feels sticky on iPad). */
type Pinch = {
  view0: View
  dist0: number
  mx0: number
  my0: number
}

/** Fired on document when a two-finger canvas pinch starts, so window
 *  drag/resize can drop their pointer capture instead of fighting the zoom. */
export const CANVAS_PINCH_EVENT = 'canvaspinch'

/** Safari-only gesture events carry a cumulative `scale` from gesturestart. */
type GestureEventLike = Event & {
  scale: number
  clientX: number
  clientY: number
}

/** Soften tiny finger jitter, amplify larger pinches so overview→usable is
 *  fewer finger-widths of travel on a fitted iPad canvas (~0.36 → 1). */
function pinchBoost(raw: number): number {
  if (raw <= 0) return 1
  return Math.pow(raw, 1.35)
}

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
 * Pinch is handled two ways: Safari's gesture* events (reliable on iPad), and
 * a two-finger touch fallback for other browsers. Both use a gesture-start
 * baseline so the zoom tracks the fingers instead of fighting frame noise.
 */
export function CanvasSurface({ view, onViewChange, children }: CanvasSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const pan = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)
  const pinch = useRef<Pinch | null>(null)
  /** 'gesture' = Safari owns this pinch; ignore parallel touchmove math. */
  const pinchMode = useRef<'none' | 'gesture' | 'touch'>('none')
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

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
        // Trackpad pinch / cmd+wheel → zoom toward the cursor.
        onViewChange(zoomView(v, Math.exp(-e.deltaY * 0.002), cx, cy))
      } else {
        onViewChange({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onViewChange])

  // Capture + non-passive on the surface so two fingers on a window still
  // zoom, and so preventDefault stops Safari's page-level pinch.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return

    const announcePinch = () => {
      pan.current = null
      document.dispatchEvent(new Event(CANVAS_PINCH_EVENT))
    }

    const applyPinch = (rawFactor: number, mx: number, my: number, state: Pinch) => {
      const factor = pinchBoost(rawFactor)
      const zoomed = zoomView(state.view0, factor, state.mx0, state.my0)
      onViewChange({
        ...zoomed,
        x: zoomed.x + (mx - state.mx0),
        y: zoomed.y + (my - state.my0),
      })
    }

    const beginTouchPinch = (touches: TouchList) => {
      const pair = pairFrom(touches)
      if (!pair) return false
      announcePinch()
      const rect = el.getBoundingClientRect()
      const mid = touchMidpoint(pair[0], pair[1], rect)
      pinch.current = {
        view0: viewRef.current,
        dist0: Math.max(touchDistance(pair[0], pair[1]), 1),
        mx0: mid.mx,
        my0: mid.my,
      }
      pinchMode.current = 'touch'
      return true
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return
      // Safari will also fire gesture*; prefer that path once it starts.
      if (pinchMode.current === 'gesture') {
        e.preventDefault()
        return
      }
      if (beginTouchPinch(e.touches)) e.preventDefault()
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length < 2) return
      e.preventDefault()
      if (pinchMode.current === 'gesture') return
      if (!pinch.current || pinchMode.current !== 'touch') beginTouchPinch(e.touches)
      const state = pinch.current
      if (!state || pinchMode.current !== 'touch') return
      const pair = pairFrom(e.touches)
      if (!pair) return
      const rect = el.getBoundingClientRect()
      const mid = touchMidpoint(pair[0], pair[1], rect)
      applyPinch(touchDistance(pair[0], pair[1]) / state.dist0, mid.mx, mid.my, state)
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) return
      if (pinchMode.current === 'touch') {
        pinch.current = null
        pinchMode.current = 'none'
      }
    }

    const onGestureStart = (e: Event) => {
      const ge = e as GestureEventLike
      ge.preventDefault()
      announcePinch()
      const rect = el.getBoundingClientRect()
      pinch.current = {
        view0: viewRef.current,
        dist0: 1,
        mx0: ge.clientX - rect.left,
        my0: ge.clientY - rect.top,
      }
      pinchMode.current = 'gesture'
    }

    const onGestureChange = (e: Event) => {
      const ge = e as GestureEventLike
      ge.preventDefault()
      const state = pinch.current
      if (!state || pinchMode.current !== 'gesture') return
      const rect = el.getBoundingClientRect()
      applyPinch(ge.scale, ge.clientX - rect.left, ge.clientY - rect.top, state)
    }

    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      if (pinchMode.current === 'gesture') {
        pinch.current = null
        pinchMode.current = 'none'
      }
    }

    const opts: AddEventListenerOptions = { capture: true, passive: false }
    el.addEventListener('touchstart', onTouchStart, opts)
    el.addEventListener('touchmove', onTouchMove, opts)
    el.addEventListener('touchend', onTouchEnd, opts)
    el.addEventListener('touchcancel', onTouchEnd, opts)
    // Listen on both the surface and the document: Safari sometimes targets
    // the window under the fingers, and a surface-only listener misses it.
    el.addEventListener('gesturestart', onGestureStart, opts)
    el.addEventListener('gesturechange', onGestureChange, opts)
    el.addEventListener('gestureend', onGestureEnd, opts)
    document.addEventListener('gesturestart', onGestureStart, opts)
    document.addEventListener('gesturechange', onGestureChange, opts)
    document.addEventListener('gestureend', onGestureEnd, opts)
    return () => {
      el.removeEventListener('touchstart', onTouchStart, opts)
      el.removeEventListener('touchmove', onTouchMove, opts)
      el.removeEventListener('touchend', onTouchEnd, opts)
      el.removeEventListener('touchcancel', onTouchEnd, opts)
      el.removeEventListener('gesturestart', onGestureStart, opts)
      el.removeEventListener('gesturechange', onGestureChange, opts)
      el.removeEventListener('gestureend', onGestureEnd, opts)
      document.removeEventListener('gesturestart', onGestureStart, opts)
      document.removeEventListener('gesturechange', onGestureChange, opts)
      document.removeEventListener('gestureend', onGestureEnd, opts)
    }
  }, [onViewChange])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pinch.current || pinchMode.current !== 'none') return
    // Double-tap empty canvas → zoom in toward the tap (fallback when pinch
    // feels awkward). Two taps within 320ms and 28px.
    const now = performance.now()
    const prev = lastTap.current
    if (prev && now - prev.t < 320 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 28) {
      lastTap.current = null
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect) {
        onViewChange(zoomView(viewRef.current, 1.8, e.clientX - rect.left, e.clientY - rect.top))
      }
      return
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY }

    e.currentTarget.setPointerCapture(e.pointerId)
    pan.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pan.current || pinch.current || pinchMode.current !== 'none') return
    // A drag cancels an in-progress double-tap candidate.
    if (lastTap.current && Math.hypot(e.clientX - lastTap.current.x, e.clientY - lastTap.current.y) > 12) {
      lastTap.current = null
    }
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
