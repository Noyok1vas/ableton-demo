import { useEffect, useRef, useState } from 'react'
import type { View } from './types.ts'
import { zoomView } from './viewUtils.ts'

type ZoomControlProps = {
  view: View
  onViewChange: (view: View) => void
  onReset: () => void
}

/** Bigger steps on touch so overview → working size needs fewer taps. */
function zoomStep(): number {
  if (typeof window === 'undefined') return 1.2
  return window.matchMedia('(pointer: coarse)').matches ? 1.6 : 1.2
}

/** Compact zoom readout + in/out/reset, fixed bottom-right in screen space.
 *  +/- hold-repeat on touch so visitors are not stuck tapping. */
export function ZoomControl({ view, onViewChange, onReset }: ZoomControlProps) {
  const viewRef = useRef(view)
  viewRef.current = view
  const onViewChangeRef = useRef(onViewChange)
  onViewChangeRef.current = onViewChange
  const holdTimer = useRef<number | null>(null)
  const holdInterval = useRef<number | null>(null)
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const sync = () => setCoarse(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
      if (holdInterval.current !== null) window.clearInterval(holdInterval.current)
    }
  }, [])

  const zoomBy = (factor: number) => {
    const el = document.querySelector('.surface')
    const rect = el?.getBoundingClientRect()
    const cx = rect ? rect.width / 2 : 0
    const cy = rect ? rect.height / 2 : 0
    onViewChangeRef.current(zoomView(viewRef.current, factor, cx, cy))
  }

  const stopHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    if (holdInterval.current !== null) {
      window.clearInterval(holdInterval.current)
      holdInterval.current = null
    }
  }

  const startHold = (direction: 1 | -1) => {
    stopHold()
    const step = zoomStep()
    const factor = direction > 0 ? step : 1 / step
    zoomBy(factor)
    holdTimer.current = window.setTimeout(() => {
      holdInterval.current = window.setInterval(() => zoomBy(factor), 90)
    }, 280)
  }

  return (
    <div className={`zoomctl${coarse ? ' zoomctl--touch' : ''}`}>
      <button
        type="button"
        className="zoomctl-btn"
        aria-label="Zoom out"
        onPointerDown={(e) => {
          e.preventDefault()
          startHold(-1)
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onPointerLeave={stopHold}
      >
        −
      </button>
      <span className="zoomctl-readout num">{Math.round(view.scale * 100)}%</span>
      <button
        type="button"
        className="zoomctl-btn"
        aria-label="Zoom in"
        onPointerDown={(e) => {
          e.preventDefault()
          startHold(1)
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onPointerLeave={stopHold}
      >
        +
      </button>
      <button type="button" className="zoomctl-reset" onClick={onReset}>
        Reset view
      </button>
    </div>
  )
}
