import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { MainScreen } from '../main-screen/MainScreen.tsx'
import { SelectorScreen } from '../selector/SelectorScreen.tsx'
import './physical.css'

/** The square the UI is laid out in, in device units: the panel's own 720
    pixels, so on the 4 × 4 in display one unit is one pixel and every size
    in the CSS is its real size there. On any other window it is scaled as
    one piece to fit. */
const SCREEN_UNITS = 720

function initialScale(): number {
  const s = Math.min(window.innerWidth, window.innerHeight) / SCREEN_UNITS
  return s > 0 ? s : 1
}

/**
 * The physical demo: the main screen alone, full-bleed on a 4 × 4 in square
 * display (720 × 720). There is no hardware render around it — the real
 * device is the frame now.
 *
 * The eight pads are still mounted, so everything they drive (record on a
 * tap, audition on a hold, the rack preview) keeps working, but their UI is
 * hidden: the physical keys will play them.
 */
export function PhysicalShell() {
  const fitRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(initialScale)

  useLayoutEffect(() => {
    const el = fitRef.current
    if (!el) return
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width < 32 || height < 32) return
      setScale(Math.min(width, height) / SCREEN_UNITS)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A touch panel played with several fingers must not zoom the page.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', block)
    return () => document.removeEventListener('gesturestart', block)
  }, [])

  const style = {
    '--phys-scale': scale,
    '--phys-size': `${SCREEN_UNITS}px`,
  } as CSSProperties

  return (
    <div ref={fitRef} className="phys-stage">
      <section className="phys-screen" style={style} aria-label="Screen">
        <MainScreen />
      </section>
      {/* The pads: kept for their behaviour, hidden until the physical keys
          take their place. */}
      <section className="phys-deck" aria-hidden hidden>
        <SelectorScreen />
      </section>
    </div>
  )
}
