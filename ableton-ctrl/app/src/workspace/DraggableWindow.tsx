import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { CANVAS_PINCH_EVENT } from './CanvasSurface.tsx'
import { WINDOW_TIER } from './pages.ts'
import type { WindowState } from './types.ts'

type DraggableWindowProps = {
  window: WindowState
  /** Current canvas zoom, so screen deltas convert to canvas deltas. */
  scale: number
  onChange: (patch: Partial<WindowState>) => void
  children: ReactNode
}

/**
 * A window on the canvas: drag by its title bar. Size is fixed by the page
 * layout — the demo no longer exposes a resize grip. Its outline says where
 * the function goes in the product: black for software (a screen), grey for
 * hardware (a control surface) — see WindowTier.
 */
export function DraggableWindow({
  window: win,
  scale,
  onChange,
  children,
}: DraggableWindowProps) {
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const cancel = () => {
      drag.current = null
    }
    document.addEventListener(CANVAS_PINCH_EVENT, cancel)
    return () => document.removeEventListener(CANVAS_PINCH_EVENT, cancel)
  }, [])

  const onTitlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y }
  }
  const onTitlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    onChange({
      x: drag.current.x + (e.clientX - drag.current.px) / scale,
      y: drag.current.y + (e.clientY - drag.current.py) / scale,
    })
  }
  const onTitlePointerUp = () => {
    drag.current = null
  }

  const tier = WINDOW_TIER[win.kind]
  return (
    <div
      className={`cwindow cwindow--${tier}`}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h }}
    >
      <div
        className="cwindow-titlebar"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerUp}
      >
        <span className="cwindow-title">{win.title}</span>
        <span className="cwindow-tier">{tier === 'software' ? 'SCREEN' : 'HARDWARE'}</span>
      </div>
      <div className="cwindow-body">{children}</div>
    </div>
  )
}
