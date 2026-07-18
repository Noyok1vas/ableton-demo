import { useCallback, useRef } from 'react'
import type React from 'react'

type KnobProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  formatValue: (value: number) => string
  onChange: (value: number) => void
  /** True when there is no pattern yet — knob stays interactive but looks idle. */
  idle: boolean
}

const SWEEP_DEG = 270 // -135° .. +135°
const DRAG_RANGE_PX = 150 // vertical pixels for a full min→max sweep

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v))

export function Knob({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
  idle,
}: KnobProps) {
  const dragStart = useRef<{ y: number; value: number } | null>(null)

  const setSteppedValue = useCallback(
    (raw: number) => {
      const stepped = Math.round(raw / step) * step
      onChange(clamp(stepped, min, max))
    },
    [max, min, onChange, step],
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { y: e.clientY, value }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    const dy = dragStart.current.y - e.clientY
    setSteppedValue(dragStart.current.value + (dy / DRAG_RANGE_PX) * (max - min))
  }

  const onPointerUp = () => {
    dragStart.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + step
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - step
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next !== null) {
      e.preventDefault()
      onChange(clamp(next, min, max))
    }
  }

  const norm = (value - min) / (max - min)
  const angle = -SWEEP_DEG / 2 + norm * SWEEP_DEG

  // Value arc along the rim, drawn with stroke-dasharray on a circle path.
  const R = 26
  const rim = 2 * Math.PI * R
  const arcLen = (norm * SWEEP_DEG * rim) / 360

  return (
    <div className={`knob${idle ? ' knob--idle' : ''}`}>
      <div
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatValue(value)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="var(--surface-2)"
            stroke="var(--line-strong)"
            strokeWidth="1"
          />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeDasharray={`${arcLen} ${rim}`}
            transform="rotate(135 32 32)"
            className="knob-arc"
          />
          <line
            x1="32"
            y1="32"
            x2="32"
            y2="9"
            stroke="var(--text)"
            strokeWidth="2"
            transform={`rotate(${angle} 32 32)`}
            className="knob-pointer"
          />
        </svg>
      </div>
      <div className="knob-label">{label}</div>
      <div className="knob-value num">{formatValue(value)}</div>
    </div>
  )
}
