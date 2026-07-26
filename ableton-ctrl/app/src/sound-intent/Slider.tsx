import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type React from 'react'

type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Horizontal slider matching the design system: 1px hairline track, solid black
 * fill up to the handle, radius 0. Drag the track anywhere to jump + scrub;
 * arrow keys nudge for accessibility.
 */
export function Slider({ label, value, min, max, onChange }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
      onChange(Math.round(min + ratio * (max - min)))
    },
    [max, min, onChange],
  )

  const dragging = useRef(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    setFromClientX(e.clientX)
    // Capture so the drag keeps tracking outside the track. Guarded because a
    // non-active pointer id (e.g. synthetic events) would otherwise throw.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no active pointer to capture — the click value still applied above */
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
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - 1
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next !== null) {
      e.preventDefault()
      onChange(clamp(next, min, max))
    }
  }

  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="si-slider">
      <div className="si-slider-head">
        <span className="si-slider-label">{label}</span>
        <span className="si-slider-value num">{value}</span>
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
        <div className="si-slider-fill" style={{ width: `${pct}%` }} />
        <div className="si-slider-handle" style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}
