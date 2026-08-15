import {
  BARS_PER_LOOP,
  BEATS_PER_LOOP,
  GRID_DIVISIONS,
  type CaptureState,
  type RenderedTap,
} from './types.ts'

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
// cannot swallow its 1/16 neighbour (one grid step ≈ 29 units).
const R_MIN = 5
const R_MAX = 12
const radiusFor = (velocity: number) =>
  R_MIN + Math.min(Math.max(velocity, 0), 1) * (R_MAX - R_MIN)

const xFor = (pos: number) => PAD_X + pos * TRACK_W

// The staff the pattern is drawn on: the 1/16 grid (fine lines, stronger on
// each beat, heaviest on a barline), the beat numbers, and the centre line. It
// is the same picture every time, while the playhead above it moves every
// frame — so it is built once at module load rather than per render.
const STAFF = (
  <>
    {Array.from({ length: GRID_DIVISIONS + 1 }, (_, i) => (
      <line
        key={i}
        x1={xFor(i / GRID_DIVISIONS)}
        y1={GRID_TOP}
        x2={xFor(i / GRID_DIVISIONS)}
        y2={GRID_BOTTOM}
        stroke={i % (GRID_DIVISIONS / BEATS_PER_LOOP) === 0 ? 'var(--line-strong)' : 'var(--line-fine)'}
        // Barline: the loop spans two bars, so the midpoint reads as a downbeat.
        strokeWidth={i % (GRID_DIVISIONS / BARS_PER_LOOP) === 0 ? '1.5' : '1'}
      />
    ))}
    {Array.from({ length: BEATS_PER_LOOP }, (_, beat) => (
      <text
        key={`beat-${beat}`}
        x={xFor(beat / BEATS_PER_LOOP)}
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

export function RhythmVisualization({ taps, state, playhead }: RhythmVisualizationProps) {
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
