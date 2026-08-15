import { STEPS_PER_BAR, STEPS_PER_BEAT, VOICE_IDS, VOICE_LABEL, type Pattern } from './patterns.ts'

const CELL = 15
const ROW = 15
const LABEL_W = 38
const NOTE = 9
const REST = 2.5

type PatternGridProps = {
  pattern: Pattern
  /** Name the three tracks down the left. Off for the compact grids inside a
      phrase block, where the rows are always in the same order anyway. */
  showLabels?: boolean
  /** 0..15 while this block is the one sounding; null otherwise. */
  activeStep?: number | null
}

/**
 * One block, drawn as what it is: three synchronized tracks, not three
 * patterns. Debugging only — the audience never sees a grid.
 */
export function PatternGrid({ pattern, showLabels = false, activeStep = null }: PatternGridProps) {
  const left = showLabels ? LABEL_W : 0
  const width = left + STEPS_PER_BAR * CELL
  const height = VOICE_IDS.length * ROW

  return (
    <svg
      className="mg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${pattern.id}: ${VOICE_IDS.map(
        (id) => `${VOICE_LABEL[id]} ${pattern.steps[id].join('')}`,
      ).join(', ')}`}
    >
      {/* Beat divisions — the only structure the eye needs to count by. */}
      {Array.from({ length: STEPS_PER_BAR / STEPS_PER_BEAT + 1 }, (_, beat) => (
        <line
          key={beat}
          className="mg-beat"
          x1={left + beat * STEPS_PER_BEAT * CELL}
          y1={0}
          x2={left + beat * STEPS_PER_BEAT * CELL}
          y2={height}
        />
      ))}

      {activeStep !== null && (
        <rect
          className="mg-playhead"
          x={left + activeStep * CELL}
          y={0}
          width={CELL}
          height={height}
        />
      )}

      {VOICE_IDS.map((id, row) => (
        <g key={id}>
          {showLabels && (
            <text className="mg-label" x={0} y={row * ROW + ROW / 2} dominantBaseline="middle">
              {VOICE_LABEL[id]}
            </text>
          )}
          {pattern.steps[id].map((step, index) => {
            const cx = left + index * CELL + CELL / 2
            const cy = row * ROW + ROW / 2
            const size = step ? NOTE : REST
            return (
              <rect
                key={index}
                className={step ? 'mg-note' : 'mg-rest'}
                x={cx - size / 2}
                y={cy - size / 2}
                width={size}
                height={size}
              />
            )
          })}
        </g>
      ))}
    </svg>
  )
}
