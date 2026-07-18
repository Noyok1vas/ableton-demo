import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { WindowLimits, WindowState } from './types.ts'
import { clamp } from './viewUtils.ts'

type DraggableWindowProps = {
  window: WindowState
  /** Current canvas zoom, so screen deltas convert to canvas deltas. */
  scale: number
  limits: WindowLimits
  onChange: (patch: Partial<WindowState>) => void
  children: ReactNode
}

/**
 * A window on the canvas: drag by its title bar, resize from the bottom-right
 * corner within `limits`. Both gestures divide the screen-space pointer delta
 * by `scale` because the window sits inside the zoomed layer.
 */
export function DraggableWindow({
  window: win,
  scale,
  limits,
  onChange,
  children,
}: DraggableWindowProps) {
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const resize = useRef<{ px: number; py: number; w: number; h: number } | null>(null)

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

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resize.current = { px: e.clientX, py: e.clientY, w: win.w, h: win.h }
  }
  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resize.current) return
    onChange({
      w: clamp(resize.current.w + (e.clientX - resize.current.px) / scale, limits.minW, limits.maxW),
      h: clamp(resize.current.h + (e.clientY - resize.current.py) / scale, limits.minH, limits.maxH),
    })
  }
  const onResizePointerUp = () => {
    resize.current = null
  }

  return (
    <div className="cwindow" style={{ left: win.x, top: win.y, width: win.w, height: win.h }}>
      <div
        className="cwindow-titlebar"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerUp}
      >
        <span className="cwindow-title">{win.title}</span>
      </div>
      <div className="cwindow-body">{children}</div>
      <div
        className="cwindow-resize"
        aria-label="Resize window"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />
    </div>
  )
}
