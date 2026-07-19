import { BEATS_PER_BAR, GRID_DIVISIONS, type CaptureState, type RenderedTap } from './types.ts'

type RhythmVisualizationProps = {
  taps: readonly RenderedTap[]
  state: CaptureState
  /** 0..1 playhead position (recording or loop playback), null to hide. */
  playhead: number | null
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
// cannot swallow its 1/16 neighbour (one grid step ≈ 57 units).
const R_MIN = 6
const R_MAX = 16
const radiusFor = (velocity: number) =>
  R_MIN + Math.min(Math.max(velocity, 0), 1) * (R_MAX - R_MIN)

const xFor = (pos: number) => PAD_X + pos * TRACK_W

export function RhythmVisualization({ taps, state, playhead }: RhythmVisualizationProps) {
  const gridLines = Array.from({ length: GRID_DIVISIONS + 1 }, (_, i) => {
    const isBeat = i % (GRID_DIVISIONS / BEATS_PER_BAR) === 0
    return { x: xFor(i / GRID_DIVISIONS), isBeat }
  })

  return (
    <svg
      className="rhythm-vis"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="One-bar rhythm pattern"
    >
      {/* 1/16 grid: fine lines, with a stronger line on each beat */}
      {gridLines.map(({ x, isBeat }, i) => (
        <line
          key={i}
          x1={x}
          y1={GRID_TOP}
          x2={x}
          y2={GRID_BOTTOM}
          stroke={isBeat ? 'var(--line-strong)' : 'var(--line-fine)'}
          strokeWidth="1"
        />
      ))}

      {/* Beat numbers 1–4 */}
      {Array.from({ length: BEATS_PER_BAR }, (_, beat) => (
        <text
          key={beat}
          x={xFor(beat / BEATS_PER_BAR)}
          y={LABEL_Y}
          className="rhythm-vis-beat num"
          textAnchor="middle"
        >
          {beat + 1}
        </text>
      ))}

      {/* Center line the events sit on */}
      <line
        x1={PAD_X}
        y1={CENTER_Y}
        x2={W - PAD_X}
        y2={CENTER_Y}
        stroke="var(--line-fine)"
        strokeWidth="1"
      />

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
          Tap a one-bar rhythm
        </text>
      )}
    </svg>
  )
}
