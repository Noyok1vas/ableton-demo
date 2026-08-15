import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

type CharacterSliderProps = {
  /** The two ends, low then high — e.g. ['SOFT', 'HARD']. */
  ends: [string, string]
  /** 0..1. */
  value: number
  onChange: (value: number) => void
  /** For the accessible name: "HIT character". */
  name: string
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** Arrow-key step. 1/40th of the travel — fine enough to hear a difference,
    coarse enough that holding a key crosses the range in about a second. */
const STEP = 0.025

/**
 * The character axis, as one slider labelled at both ends rather than with a
 * name and a number.
 *
 * That is the whole design of it: this control has no correct value and no
 * units, so a readout like "62" would invite reading it as a measurement.
 * Naming the two ends instead says the only true thing about the axis — which
 * way is which — and leaves everything between them to the ear.
 *
 * Continuous (0..1) rather than the 0..100 integers Sound Intent's sliders use,
 * because this value is recorded onto every event and compared against other
 * events; a unit interval is the honest shape for "how far along".
 */
export function CharacterSlider({ ends, value, onChange, name }: CharacterSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      if (rect.width === 0) return
      onChange(clamp01((clientX - rect.left) / rect.width))
    },
    [onChange],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    setFromClientX(e.clientX)
    // Capture so the drag keeps tracking outside the track. Guarded because a
    // non-active pointer id (e.g. a synthetic event) would otherwise throw.
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

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + STEP
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - STEP
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 1
    if (next !== null) {
      e.preventDefault()
      onChange(clamp01(next))
    }
    // Space is the global tap key; let it through rather than scrubbing here.
  }

  const pct = clamp01(value) * 100

  return (
    <div className="sel-character">
      <div className="sel-character-ends">
        <span className="sel-character-end">{ends[0]}</span>
        <span className="sel-character-end">{ends[1]}</span>
      </div>
      <div
        ref={trackRef}
        className="sel-character-track"
        role="slider"
        tabIndex={0}
        aria-label={`${name} character, ${ends[0]} to ${ends[1]}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuetext={`${Math.round(pct)}% toward ${ends[1]}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="sel-character-fill" style={{ width: `${pct}%` }} />
        <div className="sel-character-handle" style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}
