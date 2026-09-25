import { useEffect, useState, type KeyboardEvent } from 'react'
import { BPM_MAX, BPM_MIN, useSoundEngine } from './session.tsx'
import {
  METER_BEATS_MAX,
  METER_BEATS_MIN,
  METER_UNITS,
  formatMeter,
} from './meter.ts'
import { useSession } from '../rhythmic-intent/session.tsx'
import './transport.css'

/** Space must stay the tap key everywhere: a focused button here must not
    also be pressed by it. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/**
 * Transport — the hardware's clock section: PLAY/STOP, tempo and time
 * signature. Every value set here is also shown on the Sound Source screen;
 * this is where it is changed.
 *
 * PLAY restarts the pattern from its top and STOP keeps it, so stopping is
 * never destructive — RESET on the Sound Visual is what clears. A tap into a
 * stopped pattern starts it again, with the tap on the downbeat.
 */
export function TransportScreen() {
  const { bpm, setBpm, meter, setMeter } = useSoundEngine()
  const { playing, togglePlay, hasPattern } = useSession()

  // Free text while focused; a tempo only on blur or Enter (same contract the
  // field had in the Sound Source window). The session clamps.
  const [draft, setDraft] = useState(String(bpm))
  useEffect(() => setDraft(String(bpm)), [bpm])
  const commit = () => {
    const next = Number.parseInt(draft, 10)
    if (Number.isNaN(next)) setDraft(String(bpm))
    else setBpm(next)
  }

  const stepBeats = (delta: number) =>
    setMeter((m) => ({
      ...m,
      beats: Math.min(METER_BEATS_MAX, Math.max(METER_BEATS_MIN, m.beats + delta)),
    }))

  return (
    <div className="tp-screen">
      <button
        type="button"
        className={`tp-play${playing ? ' tp-play--on' : ''}`}
        aria-pressed={playing}
        disabled={!hasPattern}
        onClick={togglePlay}
        onKeyUp={swallowSpace}
      >
        <span className="tp-play-glyph" aria-hidden>
          {playing ? '■' : '▶'}
        </span>
        {playing ? 'STOP' : 'PLAY'}
      </button>

      <div className="tp-row">
        <span className="tp-label">
          <label htmlFor="tp-bpm">TEMPO</label>
        </span>
        <div className="tp-stepper">
          <button
            type="button"
            className="tp-step"
            aria-label="Slower"
            onClick={() => setBpm(bpm - 1)}
            onKeyUp={swallowSpace}
          >
            −
          </button>
          <input
            id="tp-bpm"
            className="tp-value tp-bpm num"
            type="number"
            inputMode="numeric"
            min={BPM_MIN}
            max={BPM_MAX}
            step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onKeyUp={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="tp-step"
            aria-label="Faster"
            onClick={() => setBpm(bpm + 1)}
            onKeyUp={swallowSpace}
          >
            +
          </button>
        </div>
        <span className="tp-unit">BPM</span>
      </div>

      <div className="tp-row">
        <span className="tp-label">METER</span>
        <div className="tp-stepper">
          <button
            type="button"
            className="tp-step"
            aria-label="Fewer beats per bar"
            disabled={meter.beats <= METER_BEATS_MIN}
            onClick={() => stepBeats(-1)}
            onKeyUp={swallowSpace}
          >
            −
          </button>
          <span className="tp-value tp-meter num" aria-live="polite">
            {formatMeter(meter)}
          </span>
          <button
            type="button"
            className="tp-step"
            aria-label="More beats per bar"
            disabled={meter.beats >= METER_BEATS_MAX}
            onClick={() => stepBeats(1)}
            onKeyUp={swallowSpace}
          >
            +
          </button>
        </div>
        <div className="tp-units" role="group" aria-label="Beat unit">
          {METER_UNITS.map((unit) => (
            <button
              key={unit}
              type="button"
              className={`tp-unit-choice num${meter.unit === unit ? ' tp-unit-choice--on' : ''}`}
              aria-pressed={meter.unit === unit}
              onClick={() => setMeter((m) => ({ ...m, unit }))}
              onKeyUp={swallowSpace}
            >
              /{unit}
            </button>
          ))}
        </div>
      </div>

      <p className="tp-keys">Enter play / stop · Space tap · Shift+Space accented tap</p>
    </div>
  )
}
