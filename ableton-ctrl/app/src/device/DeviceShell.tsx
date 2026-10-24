import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { MainScreen } from '../main-screen/MainScreen.tsx'
import { SelectorScreen } from '../selector/SelectorScreen.tsx'
import { CORNER_MM, DEVICE_UNITS, SCREEN_MM, u } from './geometry.ts'
import './device.css'

/** The stage's own margin each side (device.css), for the first guess. */
const STAGE_PAD = 12

/** A first fit from the window alone, before the stage can be measured. The
    canvases on the screen size their pixels when they mount, and a scale
    change alone (a transform) never tells their ResizeObservers — so the
    first scale has to be close to the real one, never zero. */
function initialScale(): number {
  const s = Math.min(
    (window.innerWidth - STAGE_PAD * 2) / DEVICE_UNITS.w,
    (window.innerHeight - STAGE_PAD * 2) / DEVICE_UNITS.h,
  )
  return s > 0 ? s : 1
}

/**
 * The instrument as one fixed device, upright. The hardware is a photograph
 * of it — the CAD rendered straight down (public/device.webp) — and the
 * screens are the UI, laid over the dark glass in the picture exactly where
 * the CAD puts them (geometry.ts). The device is laid out at its own size and
 * scaled as one piece to fit whatever is left of the viewport inside the
 * safe area — no canvas, nothing to pan or zoom, nothing to drag.
 *
 * Only the screens change. The deck is the hardware: the same eight pads in
 * the same places, always.
 */
export function DeviceShell() {
  const fitRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(initialScale)

  // Fit to the box the stage leaves after the safe-area padding. A
  // ResizeObserver catches everything that changes it — rotation, Safari's
  // toolbar settling, split view — without listening for each.
  useLayoutEffect(() => {
    const el = fitRef.current
    if (!el) return
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width < 32 || height < 32) return
      setScale(Math.min(width / DEVICE_UNITS.w, height / DEVICE_UNITS.h))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Safari's own pinch: an instrument played with several fingers must not
  // zoom the page. (touch-action covers double-tap; this covers the gesture.)
  useEffect(() => {
    const block = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', block)
    return () => document.removeEventListener('gesturestart', block)
  }, [])

  const style = {
    '--device-scale': scale,
    '--device-w': `${DEVICE_UNITS.w}px`,
    '--device-h': `${DEVICE_UNITS.h}px`,
    '--screen-x': `${u(SCREEN_MM.x)}px`,
    '--screen-y': `${u(SCREEN_MM.y)}px`,
    '--screen-size': `${u(SCREEN_MM.size)}px`,
    '--corner': `${u(CORNER_MM)}px`,
  } as CSSProperties

  return (
    <div className="device-stage">
      <div ref={fitRef} className="device-fit">
        <div className="device" style={style}>
          <img className="device-body" src="/device.webp" alt="" draggable={false} />
          <section className="device-screen" aria-label="Screen">
            <MainScreen />
          </section>
          <section className="device-deck" aria-label="Pads">
            <SelectorScreen />
          </section>
        </div>
      </div>
      <p className="device-rotate" role="status">
        Turn the iPad upright to play
      </p>
    </div>
  )
}
