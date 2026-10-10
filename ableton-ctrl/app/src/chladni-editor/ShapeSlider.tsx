import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type React from 'react'
import type { ShapeControl } from './shape.ts'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** How many decimals a control's step needs. */
const decimals = (step: number) => {
  const text = String(step)
  return text.includes('.') ? text.split('.')[1].length : 0
}

/**
 * The Sound Intent slider again (same hairline track, same black fill), for a
 * control with its own range and step: drag anywhere on the track, arrow keys
 * nudge one step, and the value reads in the control's own units.
 */
export function ShapeSlider({
  control,
  value,
  onChange,
}: {
  control: ShapeControl
  value: number
  onChange: (value: number) => void
}) {
  const { min, max, step, label, unit } = control
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const setFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
      onChange(min + ratio * (max - min))
    },
    [min, max, onChange],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    setFromClientX(e.clientX)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no active pointer to capture */
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) setFromClientX(e.clientX)
  }
  const onPointerUp = () => {
    dragging.current = false
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next !== null) {
      e.preventDefault()
      onChange(clamp(next, min, max))
    }
  }

  // A range that crosses zero fills from zero, so a signed control reads as one.
  const pctOf = (v: number) => ((v - min) / (max - min)) * 100
  const zero = min < 0 && max > 0 ? pctOf(0) : 0
  const pct = pctOf(value)

  return (
    <div className="si-slider ce-slider">
      <div className="si-slider-head">
        <span className="si-slider-label">{label}</span>
        <span className="si-slider-value num">
          {value.toFixed(decimals(step))}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div
        ref={trackRef}
        className="si-slider-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div
          className="si-slider-fill"
          style={{ left: `${Math.min(zero, pct)}%`, width: `${Math.abs(pct - zero)}%` }}
        />
        <div className="si-slider-handle" style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}
