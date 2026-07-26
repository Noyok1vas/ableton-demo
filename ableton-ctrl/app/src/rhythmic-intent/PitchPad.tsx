import { noteName, PAD_BASE_PITCH, PAD_GRID_SIZE } from './types.ts'

type PitchPadProps = {
  value: number
  onChange: (pitch: number) => void
}

/** 4×4 grid mirroring a standard Ableton Drum Rack's pad layout: bottom-left
    is the lowest note (C1), rows read left-to-right, bottom-to-top. Replaces
    a free-spinning knob so the mapping only ever lands on a real pad. */
export function PitchPad({ value, onChange }: PitchPadProps) {
  const rows = Array.from({ length: PAD_GRID_SIZE }, (_, rowFromTop) => {
    const row = PAD_GRID_SIZE - 1 - rowFromTop
    return Array.from({ length: PAD_GRID_SIZE }, (_, col) => PAD_BASE_PITCH + row * PAD_GRID_SIZE + col)
  })

  return (
    <div className="pitch-pad">
      <div className="pitch-pad-grid" role="group" aria-label="Pitch pad">
        {rows.map((row) => (
          <div className="pitch-pad-row" key={row[0]}>
            {row.map((pitch) => (
              <button
                key={pitch}
                type="button"
                className={`pitch-pad-cell${pitch === value ? ' pitch-pad-cell--selected' : ''}`}
                aria-pressed={pitch === value}
                aria-label={noteName(pitch)}
                onClick={() => onChange(pitch)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="knob-label">PITCH</div>
      <div className="knob-value num">{noteName(value)}</div>
    </div>
  )
}
