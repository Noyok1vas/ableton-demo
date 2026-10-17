import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { MainScreen } from '../main-screen/MainScreen.tsx'
import { SelectorScreen } from '../selector/SelectorScreen.tsx'
import './device.css'

/** The device's own size, in device units — see design/system.md. */
const DEVICE_W = 1024
const DEVICE_H = 1536
/** The stage's own margin each side (device.css), for the first guess. */
const STAGE_PAD = 12

/** A first fit from the window alone, before the stage can be measured. The
    canvases on the screen size their pixels when they mount, and a scale
    change alone (a transform) never tells their ResizeObservers — so the
    first scale has to be close to the real one, never zero. */
function initialScale(): number {
  const s = Math.min(
    (window.innerWidth - STAGE_PAD * 2) / DEVICE_W,
    (window.innerHeight - STAGE_PAD * 2) / DEVICE_H,
  )
  return s > 0 ? s : 1
}

/**
 * The instrument as one fixed device, upright: the screen on top, the eight
 * pads below, heights 2:1. It is laid out at its own size and scaled as one
 * piece to fit whatever is left of the viewport inside the safe area — no
 * canvas, nothing to pan or zoom, nothing to drag.
 *
 * Only the screen changes. The deck is the hardware: the same eight pads in
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
      setScale(Math.min(width / DEVICE_W, height / DEVICE_H))
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

  return (
    <div className="device-stage">
      <div ref={fitRef} className="device-fit">
        <div className="device" style={{ '--device-scale': scale } as CSSProperties}>
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
