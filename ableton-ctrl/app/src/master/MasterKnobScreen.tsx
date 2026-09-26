import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { finiteIn, loadSaved, useSaved } from '../persist.ts'
import './master.css'

/**
 * Master Control — one large detented knob, for whatever the instrument's
 * master control turns out to be. It is deliberately unmapped for now: it
 * holds a position and remembers it, and nothing reads that position yet.
 *
 * Discrete, like a rotary selector switch: STEPS positions a fixed angle
 * apart, with a stop at each end, so it always rests ON a position and never
 * between two. Turning it is a rotation — drag around the dial and it clicks
 * from one position to the next — and any number can also be pressed directly.
 */
const STEPS = 12
/** The positions span this much of the circle, leaving one step's gap at the
    bottom between the last position and the first — the stops. */
const SWEEP_DEG = 330
const STEP_DEG = SWEEP_DEG / (STEPS - 1)
const START_DEG = -SWEEP_DEG / 2 // position 0, measured clockwise from 12 o'clock

// ViewBox geometry.
const VIEW = 400
const C = VIEW / 2
const BODY_R = 128
const TICK_IN = 146
const TICK_OUT = 160
const LABEL_R = 181
const POINTER_IN = 76
const POINTER_OUT = 120

const clampStep = (v: number) => Math.min(STEPS - 1, Math.max(0, v))
const angleOf = (step: number) => START_DEG + step * STEP_DEG
const polar = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180
  return { x: C + Math.sin(rad) * r, y: C - Math.cos(rad) * r }
}

/** Degrees clockwise from 12 o'clock of a pointer, about the dial's centre. */
function pointerAngle(svg: SVGSVGElement, e: { clientX: number; clientY: number }): number {
  const rect = svg.getBoundingClientRect()
  const dx = e.clientX - (rect.left + rect.width / 2)
  const dy = e.clientY - (rect.top + rect.height / 2)
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

/** The shorter way round between two angles, signed, in (-180, 180]. */
const angleStep = (from: number, to: number) => {
  const d = (((to - from) % 360) + 540) % 360 - 180
  return d === -180 ? 180 : d
}

export function MasterKnobScreen() {
  const [value, setValue] = useState(() =>
    Math.round(finiteIn(loadSaved('master'), 0, STEPS - 1) ?? 0),
  )
  useSaved('master', value)

  const svgRef = useRef<SVGSVGElement>(null)
  // A turn is measured as rotation accumulated since the press, not as where
  // the finger is: pressing anywhere on the dial never makes it jump, and a
  // turn that crosses the bottom gap keeps counting instead of flipping ends.
  const turn = useRef<{ id: number; start: number; last: number; travelled: number } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    turn.current = { id: e.pointerId, start: value, last: pointerAngle(svg, e), travelled: 0 }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    const t = turn.current
    if (!svg || !t || t.id !== e.pointerId) return
    const angle = pointerAngle(svg, e)
    t.travelled += angleStep(t.last, angle)
    t.last = angle
    setValue(clampStep(t.start + Math.round(t.travelled / STEP_DEG)))
  }

  const endTurn = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (turn.current?.id === e.pointerId) turn.current = null
  }

  const onKeyDown = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    let next: number | null = null
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + 1
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = STEPS - 1
    if (next !== null) {
      e.preventDefault()
      setValue(clampStep(next))
    }
  }

  return (
    <div className="mk-screen">
      <svg
        ref={svgRef}
        className="mk-dial"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="slider"
        tabIndex={0}
        aria-label="Master control"
        data-hint="Master control — 12 positions. Turn it, or press a number. Not assigned yet"
        aria-valuemin={1}
        aria-valuemax={STEPS}
        aria-valuenow={value + 1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endTurn}
        onPointerCancel={endTurn}
        onKeyDown={onKeyDown}
      >
        {/* The detents: one tick and one number per position. */}
        {Array.from({ length: STEPS }, (_, step) => {
          const a = angleOf(step)
          const tIn = polar(a, TICK_IN)
          const tOut = polar(a, TICK_OUT)
          const label = polar(a, LABEL_R)
          const on = step === value
          return (
            <g key={step} className={`mk-detent${on ? ' mk-detent--on' : ''}`}>
              <line x1={tIn.x} y1={tIn.y} x2={tOut.x} y2={tOut.y} className="mk-tick" />
              <text x={label.x} y={label.y} className="mk-number num" textAnchor="middle" dominantBaseline="central">
                {step + 1}
              </text>
              {/* A generous press target over the number: go straight there. */}
              <circle
                cx={label.x}
                cy={label.y}
                r={17}
                className="mk-hit"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setValue(step)
                }}
              />
            </g>
          )
        })}

        {/* The knob itself, turned to the current position. */}
        <g className="mk-body" style={{ transform: `rotate(${angleOf(value)}deg)` }}>
          <circle cx={C} cy={C} r={BODY_R} className="mk-cap" />
          <circle cx={C} cy={C} r={BODY_R - 14} className="mk-cap-inner" />
          <line x1={C} y1={C - POINTER_IN} x2={C} y2={C - POINTER_OUT} className="mk-pointer" />
        </g>

        <text x={C} y={C - 6} className="mk-readout num" textAnchor="middle" dominantBaseline="central">
          {value + 1}
        </text>
        <text x={C} y={C + 44} className="mk-caption" textAnchor="middle">
          UNASSIGNED
        </text>
      </svg>
    </div>
  )
}
