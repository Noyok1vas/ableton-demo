import { memo } from 'react'
import { useSession } from './session.tsx'
import { BEATS_PER_LOOP, type Tap } from './types.ts'
import './rhythmic-intent.css'

// Mini two-bar strip: a thin line threading through the tap dots, with beat
// numbers 1–8 underneath. ViewBox units; scales uniformly to the row width.
const W = 320
const H = 46
const PAD = 12
const LINE_Y = 18
const TRACK_W = W - PAD * 2

const MiniPattern = memo(function MiniPattern({
  taps,
  loopDuration,
}: {
  taps: readonly Tap[]
  loopDuration: number
}) {
  return (
    <svg className="collection-mini" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line
        x1={PAD}
        y1={LINE_Y}
        x2={W - PAD}
        y2={LINE_Y}
        stroke="var(--line-strong)"
        strokeWidth="0.75"
      />
      {Array.from({ length: BEATS_PER_LOOP }, (_, beat) => (
        <text
          key={beat}
          x={PAD + (beat / BEATS_PER_LOOP) * TRACK_W}
          y={H - 6}
          className="collection-beat num"
          textAnchor="middle"
        >
          {beat + 1}
        </text>
      ))}
      {taps.map((tap, i) => (
        <circle
          key={i}
          cx={PAD + (tap.time / loopDuration) * TRACK_W}
          cy={LINE_Y}
          r="4"
          fill="var(--text)"
        />
      ))}
    </svg>
  )
})

/** History of every captured loop. Clicking a row loads it as the current
    pattern; the main window's RESET clears the whole list. */
export function CollectionPanel() {
  const { collection, selectedId, loadEntry, loopDuration } = useSession()

  if (collection.length === 0) {
    return <div className="collection collection--empty">Tapped patterns appear here</div>
  }

  return (
    <div className="collection">
      <ul className="collection-list">
        {collection.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={`collection-row${entry.id === selectedId ? ' collection-row--selected' : ''}`}
              aria-pressed={entry.id === selectedId}
              onClick={() => loadEntry(entry.id)}
              // Space is reserved for tapping; block the button's native
              // Space activation (fires on keyup). Enter still loads.
              onKeyUp={(e) => {
                if (e.key === ' ') e.preventDefault()
              }}
            >
              <MiniPattern taps={entry.taps} loopDuration={loopDuration} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
