import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { BPM_MAX, BPM_MIN, useSoundEngine } from './session.tsx'
import { METER_PRESETS, METER_UNITS, formatMeter, sameMeter, type Meter } from './meter.ts'
import { useSession } from '../rhythmic-intent/session.tsx'
import {
  IconChevron,
  IconMetronome,
  IconMinus,
  IconPlay,
  IconPlus,
  IconStop,
} from '../main-screen/icons.tsx'
import './transport.css'

/** Space must stay the tap key everywhere: a focused button here must not
    also be pressed by it. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** Where the meter pager stands: the preset that IS the meter, or — when the
    division has made it something no preset is (4/4 → /8 gives 4/8) — the
    preset with the same number of beats, so paging carries on from there. */
function pagerIndex(meter: Meter): number {
  const exact = METER_PRESETS.findIndex((p) => sameMeter(p, meter))
  if (exact >= 0) return exact
  const beats = METER_PRESETS.findIndex((p) => p.beats === meter.beats)
  return beats >= 0 ? beats : METER_PRESETS.findIndex((p) => sameMeter(p, { beats: 4, unit: 4 }))
}

/**
 * Transport — the clock, as the pill across the top of the Main Screen. All
 * icons, no words (guiding mode supplies those):
 *
 *   ▶ / ■   play and stop       ●○   metronome
 *   − 120 +  tempo               ‹ 4/4 ›  meter, paged through the common ones
 *   /2 /4 /8 /16  division — the note value that counts as one beat
 *
 * PLAY restarts the pattern from its top and STOP keeps it, so stopping is
 * never destructive — the + beside this bar is what starts a new one. A tap
 * into a stopped pattern starts it again, with the tap on the downbeat.
 */
export function TransportBar() {
  const { bpm, setBpm, meter, setMeter, metronome, setMetronome } = useSoundEngine()
  const { playing, togglePlay, hasPattern, playhead, beatsPerLoop } = useSession()

  // Free text while focused; a tempo only on blur or Enter. The session clamps.
  const [draft, setDraft] = useState(String(bpm))
  useEffect(() => setDraft(String(bpm)), [bpm])
  const commit = () => {
    const next = Number.parseInt(draft, 10)
    if (Number.isNaN(next)) setDraft(String(bpm))
    else setBpm(next)
  }

  const index = pagerIndex(meter)
  const page = (delta: number) => {
    const next = METER_PRESETS[index + delta]
    if (next) setMeter(() => next)
  }

  // The metronome's two dots trade places on every beat. While the loop plays
  // they are read off the playhead, so they swap exactly when the click sounds;
  // stopped (but armed) they keep time on their own at the tempo, so the
  // button still shows it is on.
  const beat = playing && playhead !== null ? Math.floor(playhead * beatsPerLoop) : null
  const lit: 0 | 1 = metronome && beat !== null ? ((beat % 2) as 0 | 1) : 0
  const freeRunning = metronome && beat === null
  const beatSeconds = (60 / bpm) * (4 / meter.unit)

  return (
    <div className="tp-bar" role="toolbar" aria-label="Transport">
      <div className="tp-group">
        <button
          type="button"
          className={`tp-btn tp-play${playing ? ' tp-btn--on' : ''}`}
          aria-label={playing ? 'Stop' : 'Play'}
          aria-pressed={playing}
          disabled={!hasPattern}
          onClick={togglePlay}
          onKeyUp={swallowSpace}
          data-hint={
            playing
              ? 'Stop — the pattern stays. Key: Enter'
              : 'Play the loop from the top. Key: Enter'
          }
        >
          {playing ? <IconStop /> : <IconPlay />}
        </button>
        <button
          type="button"
          className={`tp-btn tp-metronome${metronome ? ' tp-btn--on' : ''}${
            freeRunning ? ' tp-metronome--free' : ''
          }`}
          style={{ '--beat': `${beatSeconds}s` } as CSSProperties}
          aria-label="Metronome"
          aria-pressed={metronome}
          onClick={() => setMetronome(!metronome)}
          onKeyUp={swallowSpace}
          data-hint={
            metronome
              ? 'Metronome on — a click on every beat while the loop plays'
              : 'Metronome — a click on every beat while the loop plays'
          }
        >
          <IconMetronome lit={lit} />
        </button>
      </div>

      <span className="tp-divider" aria-hidden />

      <div className="tp-stepper">
        <button
          type="button"
          className="tp-btn"
          aria-label="Slower"
          onClick={() => setBpm(bpm - 1)}
          onKeyUp={swallowSpace}
          data-hint="Slower — one BPM down"
        >
          <IconMinus />
        </button>
        <input
          className="tp-value tp-bpm num"
          type="number"
          inputMode="numeric"
          aria-label="Tempo in BPM"
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
          data-hint="Tempo in BPM — type a value, or use − and +"
        />
        <button
          type="button"
          className="tp-btn"
          aria-label="Faster"
          onClick={() => setBpm(bpm + 1)}
          onKeyUp={swallowSpace}
          data-hint="Faster — one BPM up"
        >
          <IconPlus size={18} />
        </button>
      </div>

      <span className="tp-divider" aria-hidden />

      <div className="tp-group">
        <div className="tp-stepper">
          <button
            type="button"
            className="tp-btn"
            aria-label="Previous time signature"
            disabled={index <= 0}
            onClick={() => page(-1)}
            onKeyUp={swallowSpace}
            data-hint="Previous time signature"
          >
            <IconChevron dir="left" />
          </button>
          <span
            className="tp-value tp-meter num"
            aria-live="polite"
            data-hint="Time signature — page through the common ones with ‹ ›"
          >
            {formatMeter(meter)}
          </span>
          <button
            type="button"
            className="tp-btn"
            aria-label="Next time signature"
            disabled={index >= METER_PRESETS.length - 1}
            onClick={() => page(1)}
            onKeyUp={swallowSpace}
            data-hint="Next time signature"
          >
            <IconChevron dir="right" />
          </button>
        </div>
        <div className="tp-divisions" role="group" aria-label="Division">
          {METER_UNITS.map((unit) => {
            const on = meter.unit === unit
            return (
              <button
                key={unit}
                type="button"
                className={`tp-btn tp-division num${on ? ' tp-btn--on' : ''}`}
                aria-pressed={on}
                onClick={() => setMeter((m) => ({ ...m, unit }))}
                onKeyUp={swallowSpace}
                data-hint={`Division /${unit} — a 1/${unit} note counts as one beat`}
              >
                /{unit}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
