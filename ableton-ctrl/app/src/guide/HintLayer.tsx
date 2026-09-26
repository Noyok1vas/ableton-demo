import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useGuide } from './session.tsx'
import './guide.css'

/** How long a hint stays up after a touch, which has no hover to end it. */
const TOUCH_HINT_MS = 1800
/** Room between a control and its hint, in px. */
const GAP = 10

type Shown = { text: string; x: number; y: number; below: boolean }

/** The nearest element (itself or an ancestor) that carries a hint. */
function hinted(target: EventTarget | null): HTMLElement | SVGElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement | SVGElement>('[data-hint]')
}

/**
 * The hints themselves. One layer for the whole page, drawn in screen space
 * (portalled to <body>) rather than inside the zoomable canvas, so a hint is
 * readable at any zoom and is never clipped by the window it points into.
 *
 * Any element opts in with `data-hint="…"`; nothing else is needed. With a
 * mouse the hint follows hover; a touch has no hover, so pressing a control
 * shows its hint for a moment instead. Keyboard focus shows it too.
 */
export function HintLayer() {
  const { on } = useGuide()
  const [shown, setShown] = useState<Shown | null>(null)
  const current = useRef<Element | null>(null)
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!on) {
      setShown(null)
      current.current = null
      return
    }

    const show = (el: HTMLElement | SVGElement) => {
      const text = el.getAttribute('data-hint')
      if (!text) return
      current.current = el
      const rect = el.getBoundingClientRect()
      // Below by default; above when the control sits in the lower part of
      // the window, where a hint below would run off the bottom.
      const below = rect.bottom < window.innerHeight * 0.7
      setShown({
        text,
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom + GAP : rect.top - GAP,
        below,
      })
    }
    const hide = () => {
      current.current = null
      setShown(null)
    }
    const clearTouch = () => {
      if (touchTimer.current !== null) clearTimeout(touchTimer.current)
      touchTimer.current = null
    }

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = hinted(e.target)
      if (el === current.current) return
      if (el) show(el)
      else hide()
    }
    const onLeaveWindow = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !e.relatedTarget) hide()
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      const el = hinted(e.target)
      clearTouch()
      if (!el) return hide()
      show(el)
      touchTimer.current = setTimeout(hide, TOUCH_HINT_MS)
    }
    const onFocus = (e: FocusEvent) => {
      const el = hinted(e.target)
      if (el) show(el)
    }
    // A pan or zoom of the canvas moves the control out from under its hint.
    const onWheel = () => hide()

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onLeaveWindow)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      clearTouch()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onLeaveWindow)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      window.removeEventListener('wheel', onWheel)
    }
  }, [on])

  if (!on || !shown) return null
  return createPortal(
    <div
      className={`hint${shown.below ? ' hint--below' : ' hint--above'}`}
      style={{ left: shown.x, top: shown.y }}
      role="tooltip"
    >
      {shown.text}
    </div>,
    document.body,
  )
}
