import { useEffect, useState } from 'react'
import {
  BPM_MAX,
  BPM_MIN,
  TRACK_LEVEL_MAX,
  useSoundEngine,
  type SourcePreference,
} from './session.tsx'
import { Slider } from '../sound-intent/Slider.tsx'
// The faders are the Sound Intent atom, styling included — one control, one
// look. sound-source.css only adds where they sit.
import '../sound-intent/sound-intent.css'
import './sound-source.css'

const DESCRIPTION =
  'Sound Source decides where a tap is heard. Ableton plays the selected instrument through the local bridge; Built-in synthesizes the same 16 pads in this tab, so the prototype can be played with no Live set at all. Auto takes Ableton whenever its bridge is running and falls back to the built-in kit when it is not. Tempo is the clock all of it runs on: change it and both loops re-time, keeping the patterns they hold. The two faders are the mix between the tapped rhythm and the March layer underneath it.'

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
 * Picks which source sounds, and explains what the one currently playing can
 * see. The Rhythmic Intent status bar names the source in one line; everything
 * behind that line — whether a bridge is up, which inputs it found — lives
 * here, so the status bar stays a label rather than a diagnostic.
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
    setBpm,
    trackLevel,
    setTrackLevel,
  } = useSoundEngine()

  // The field is free text while it has focus — half-typed numbers and an empty
  // box are states you have to be able to pass through — and only becomes a
  // tempo on blur or Enter. Committed values flow back in from the session,
  // which is what clamps them.
  const [draft, setDraft] = useState(String(bpm))
  useEffect(() => setDraft(String(bpm)), [bpm])

  const commit = () => {
    const next = Number.parseInt(draft, 10)
    if (Number.isNaN(next)) setDraft(String(bpm))
    else setBpm(next)
  }

  return (
    <div className="ss-screen">
      <div className="ss-body">
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
            <dt>Playing</dt>
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
          <div className="ss-fact">
            <dt>
              <label htmlFor="ss-bpm">Tempo</label>
            </dt>
            <dd>
              <input
                id="ss-bpm"
                className="ss-bpm num"
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
                // Space is the global tap trigger everywhere else; inside a text
                // field it has to stay a space, and the global listener already
                // steps aside for inputs. Stopping it here keeps it from also
                // scrolling the canvas underneath.
                onKeyUp={(e) => e.stopPropagation()}
              />
              <span className="ss-unit">BPM</span>
            </dd>
          </div>
          <div className="ss-fact">
            <dt>Inputs</dt>
            <dd>
              {status.tags.length === 0
                ? '—'
                : status.tags.map((tag) => (
                    <span key={tag.label} className="ss-tag" title={tag.title}>
                      {tag.label}
                    </span>
                  ))}
            </dd>
          </div>
        </dl>

        {/* Two tracks, two faders. RHYTHM is every tap — the loop Rhythmic
            Intent holds and the pad Sound Intent shapes; MARCH is the generated
            layer, resting under it. */}
        <div className="ss-mix">
          <span className="ss-mix-title">Tracks</span>
          <div className="si-sliders">
            <Slider
              label="RHYTHM"
              value={trackLevel.main}
              min={0}
              max={TRACK_LEVEL_MAX}
              onChange={(v) => setTrackLevel('main', v)}
            />
            <Slider
              label="MARCH"
              value={trackLevel.march}
              min={0}
              max={TRACK_LEVEL_MAX}
              onChange={(v) => setTrackLevel('march', v)}
            />
          </div>
        </div>

        {source === 'ableton' && (
          <p className="ss-note">
            March always sounds in this tab — three voices at once is more than the bridge can send
            to Live. Under Ableton, RHYTHM belongs to Live's own mixer.
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

      <footer className="ss-description">{DESCRIPTION}</footer>
    </div>
  )
}
