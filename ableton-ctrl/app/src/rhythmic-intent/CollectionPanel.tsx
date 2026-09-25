import { memo } from 'react'
import { useSession } from './session.tsx'
import type { Tap } from './types.ts'
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
  beats,
}: {
  taps: readonly Tap[]
  loopDuration: number
  beats: number
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
      {Array.from({ length: beats }, (_, beat) => (
        <text
          key={beat}
          x={PAD + (beat / beats) * TRACK_W}
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
          // Velocity reads as size here too: an accent is the biggest dot.
          r={2.5 + 2 * Math.min(1, Math.max(0, tap.velocity))}
          fill="var(--text)"
        />
      ))}
    </svg>
  )
})

/** History of every captured loop. Clicking a row loads it as the current
    pattern; the main window's RESET clears the whole list. */
export function CollectionPanel() {
  const { collection, selectedId, loadEntry, beatsPerLoop } = useSession()

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
              <MiniPattern taps={entry.taps} loopDuration={entry.duration} beats={beatsPerLoop} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
