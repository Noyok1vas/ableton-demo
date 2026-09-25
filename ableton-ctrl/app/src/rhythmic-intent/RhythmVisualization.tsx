import { useMemo } from 'react'
import { BARS_PER_LOOP, type CaptureState, type RenderedTap } from './types.ts'

type RhythmVisualizationProps = {
  taps: readonly RenderedTap[]
  state: CaptureState
  /** 0..1 playhead position (recording or loop playback), null to hide. */
  playhead: number | null
  /** The loop's 1/16 steps and beats — both follow the transport's meter. */
  gridDivisions: number
  beatsPerLoop: number
}

// ViewBox geometry. The SVG scales uniformly to the container width, so all
// values below are in viewBox units.
const W = 960
const H = 220
const PAD_X = 24
const TRACK_W = W - PAD_X * 2
const CENTER_Y = 96
const GRID_TOP = 16
const GRID_BOTTOM = 176
const LABEL_Y = 204

// Velocity → radius. Clamped so a weak tap stays visible and a strong tap
// cannot swallow its 1/16 neighbour (one grid step ≈ 29 units).
const R_MIN = 5
const R_MAX = 12
const radiusFor = (velocity: number) =>
  R_MIN + Math.min(Math.max(velocity, 0), 1) * (R_MAX - R_MIN)

const xFor = (pos: number) => PAD_X + pos * TRACK_W

// The staff the pattern is drawn on: the 1/16 grid (fine lines, stronger on
// each beat, heaviest on a barline), the beat numbers, and the centre line. It
// only changes with the meter, while the playhead above it moves every frame —
// so it is memoized on the two numbers the meter decides.
const staff = (divisions: number, beats: number) => (
  <>
    {Array.from({ length: divisions + 1 }, (_, i) => (
      <line
        key={i}
        x1={xFor(i / divisions)}
        y1={GRID_TOP}
        x2={xFor(i / divisions)}
        y2={GRID_BOTTOM}
        stroke={i % (divisions / beats) === 0 ? 'var(--line-strong)' : 'var(--line-fine)'}
        // Barline: the loop spans two bars, so the midpoint reads as a downbeat.
        strokeWidth={i % (divisions / BARS_PER_LOOP) === 0 ? '1.5' : '1'}
      />
    ))}
    {Array.from({ length: beats }, (_, beat) => (
      <text
        key={`beat-${beat}`}
        x={xFor(beat / beats)}
        y={LABEL_Y}
        className="rhythm-vis-beat num"
        textAnchor="middle"
      >
        {beat + 1}
      </text>
    ))}
    <line
      x1={PAD_X}
      y1={CENTER_Y}
      x2={W - PAD_X}
      y2={CENTER_Y}
      stroke="var(--line-fine)"
      strokeWidth="1"
    />
  </>
)

export function RhythmVisualization({
  taps,
  state,
  playhead,
  gridDivisions,
  beatsPerLoop,
}: RhythmVisualizationProps) {
  const STAFF = useMemo(() => staff(gridDivisions, beatsPerLoop), [gridDivisions, beatsPerLoop])
  return (
    <svg
      className="rhythm-vis"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Two-bar rhythm pattern"
    >
      {STAFF}

      {taps.map((tap) => {
        const x = xFor(tap.finalPos)
        const r = radiusFor(tap.velocity)
        if (!tap.kept) {
          // Removed by density: ghost outline at its transformed position.
          return (
            <circle
              key={tap.index}
              cx={x}
              cy={CENTER_Y}
              r={r}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.45"
            />
          )
        }
        const looseX = xFor(tap.loosePos)
        // Displacement hint: how far tightness moved this tap from its raw
        // (phase-rotated) position. Hidden when the shift is sub-pixel.
        const showShift = Math.abs(looseX - x) > 1.5
        return (
          <g key={tap.index}>
            {showShift && (
              <line
                x1={looseX}
                y1={CENTER_Y}
                x2={x}
                y2={CENTER_Y}
                stroke="var(--text-muted)"
                strokeWidth="1"
              />
            )}
            {showShift && (
              <line
                x1={looseX}
                y1={CENTER_Y - 5}
                x2={looseX}
                y2={CENTER_Y + 5}
                stroke="var(--text-muted)"
                strokeWidth="1"
              />
            )}
            <circle cx={x} cy={CENTER_Y} r={r} fill="var(--text)" />
          </g>
        )
      })}

      {/* Playhead: recording progress or loop-playback position */}
      {playhead !== null && (
        <line
          x1={xFor(playhead)}
          y1={GRID_TOP}
          x2={xFor(playhead)}
          y2={GRID_BOTTOM}
          stroke="var(--accent)"
          strokeWidth="1.5"
        />
      )}

      {state === 'ready' && (
        <text x={W / 2} y={CENTER_Y - 24} className="rhythm-vis-hint" textAnchor="middle">
          Tap a two-bar rhythm
        </text>
      )}
    </svg>
  )
}
