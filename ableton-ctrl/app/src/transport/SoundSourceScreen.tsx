import { useState } from 'react'
import { useSoundEngine, type SourcePreference } from './session.tsx'
import { formatMeter } from './meter.ts'
import { useSession } from '../rhythmic-intent/session.tsx'
import { BARS_PER_LOOP } from '../rhythmic-intent/types.ts'
import { storageAvailable } from '../persist.ts'
import './sound-source.css'

const CHOICES: { id: SourcePreference; label: string }[] = [
  { id: 'auto', label: 'AUTO' },
  { id: 'ableton', label: 'ABLETON' },
  { id: 'builtin', label: 'BUILT-IN' },
]

/** The bridge line: three separate facts, so say which one is true rather
    than collapsing them into "offline". */
function bridgeLine(addressable: boolean, reachable: boolean): string {
  if (!addressable) return 'Not reachable from this page'
  return reachable ? 'Running' : 'Not running'
}

/**
 * The system screen — one of the two displays that stay in software (the other
 * is the Sound Visual). It shows the instrument's state and holds its main
 * menu, and nothing here is a performance control: tempo, meter and PLAY are
 * set on the Transport hardware and only READ here, the way a drum machine's
 * small screen shows what its knobs are doing.
 *
 *   top      — transport state and where the loop is: PLAY/STOP, bar.beat
 *   readouts — tempo and meter
 *   menu     — which source sounds (AUTO / ABLETON / BUILT-IN)
 *   facts    — what that source can see, and whether the set is being saved
 */
export function SoundSourceScreen() {
  const {
    status,
    source,
    preference,
    setPreference,
    bridgeReachable,
    bridgeAddressable,
    bpm,
    meter,
  } = useSoundEngine()
  const { playing, playhead, beatsPerLoop, hasPattern } = useSession()
  const [canSave] = useState(storageAvailable)

  // Where the loop is, as a drum machine counts it: bar.beat, from 1.
  const position =
    playing && playhead !== null
      ? `${Math.floor(playhead * BARS_PER_LOOP) + 1}.${
          (Math.floor(playhead * beatsPerLoop) % meter.beats) + 1
        }`
      : '—'

  return (
    <div className="ss-screen">
      <div className="ss-body">
        <div className="ss-display">
          <div className={`ss-state${playing ? ' ss-state--on' : ''}`}>
            <span aria-hidden>{playing ? '▶' : '■'}</span>
            {playing ? 'PLAYING' : hasPattern ? 'STOPPED' : 'READY'}
          </div>
          <div className="ss-readout">
            <span className="ss-readout-value num">{position}</span>
            <span className="ss-readout-label">BAR.BEAT</span>
          </div>
          <div className="ss-readout">
            <span className="ss-readout-value num">{bpm}</span>
            <span className="ss-readout-label">BPM</span>
          </div>
          <div className="ss-readout">
            <span className="ss-readout-value num">{formatMeter(meter)}</span>
            <span className="ss-readout-label">METER</span>
          </div>
        </div>

        <div className="ss-choices" role="group" aria-label="Sound source">
          {CHOICES.map((choice) => {
            const selected = preference === choice.id
            return (
              <button
                key={choice.id}
                type="button"
                className={`ss-choice${selected ? ' ss-choice--on' : ''}`}
                aria-pressed={selected}
                onClick={() => setPreference(choice.id)}
                // Space is the global tap trigger, so it must not also press
                // whichever of these buttons happens to hold focus.
                onKeyUp={(e) => {
                  if (e.key === ' ') e.preventDefault()
                }}
              >
                {choice.label}
              </button>
            )
          })}
        </div>

        <dl className="ss-facts">
          <div className="ss-fact">
            <dt>Sound</dt>
            <dd>
              <span className={`ss-dot${status.ready ? ' ss-dot--on' : ''}`} aria-hidden />
              {status.label}
              {preference === 'auto' && (
                <span className="ss-auto" title="Chosen by AUTO, not picked by hand">
                  AUTO
                </span>
              )}
            </dd>
          </div>
          <div className="ss-fact">
            <dt>Ableton bridge</dt>
            <dd>{bridgeLine(bridgeAddressable, bridgeReachable)}</dd>
          </div>
          {status.tags.length > 0 && (
            <div className="ss-fact">
              <dt>Inputs</dt>
              <dd>
                {status.tags.map((tag) => (
                  <span key={tag.label} className="ss-tag" title={tag.title}>
                    {tag.label}
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div className="ss-fact">
            <dt>Saved</dt>
            <dd>{canSave ? 'Automatically, in this browser' : 'Not available in this browser'}</dd>
          </div>
        </dl>

        {source === 'ableton' && (
          <p className="ss-note">
            Under Ableton the mixer's per-voice levels belong to Live's own mixer, and every pad
            plays the instrument selected there.
          </p>
        )}
        {preference === 'ableton' && !bridgeAddressable && (
          <p className="ss-note">
            This page is not served from the machine Live runs on, so the bridge cannot be reached
            from here. Run the app locally to play through Ableton.
          </p>
        )}
        {source === 'builtin' && !status.ready && (
          <p className="ss-note">Tap once, or press Space, to let the browser start audio.</p>
        )}
      </div>
    </div>
  )
}
