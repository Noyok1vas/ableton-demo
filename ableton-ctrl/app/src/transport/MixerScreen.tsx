import type { KeyboardEvent } from 'react'
import { SOUND_VOICES } from './engine.ts'
import { TRACK_LEVEL_MAX, VOICE_LEVEL_MAX, useSoundEngine } from './session.tsx'
import { PATTERNS } from '../selector/patterns.ts'
import { Slider } from '../sound-intent/Slider.tsx'
import '../sound-intent/sound-intent.css'
import './transport.css'

const LABEL = Object.fromEntries(PATTERNS.map((p) => [p.id, p.label.toUpperCase()]))

/** Space stays the tap key: a focused switch must not also be pressed by it. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/**
 * Mixer — one channel per sound identity, in pad order, and the master.
 *
 * Mute and solo are switches over the fader rather than positions of it, so
 * turning them off brings back the level that was set. Solo is exclusive of
 * everything not soloed; a muted channel stays muted even when soloed. A
 * channel that can't be heard for either reason greys out.
 *
 * Built-in sound only: under Ableton the per-voice balance is Live's mixer.
 */
export function MixerScreen() {
  const { voiceMix, setVoiceLevel, toggleMute, toggleSolo, trackLevel, setTrackLevel } =
    useSoundEngine()
  const anySolo = SOUND_VOICES.some((v) => voiceMix[v].solo)

  return (
    <div className="mx-screen">
      {SOUND_VOICES.map((voice) => {
        const ch = voiceMix[voice]
        const silent = ch.mute || (anySolo && !ch.solo)
        const name = LABEL[voice] ?? voice.toUpperCase()
        return (
          <div key={voice} className={`mx-row${silent ? ' mx-row--silent' : ''}`}>
            <span className="mx-name">{name}</span>
            <button
              type="button"
              className={`mx-switch${ch.mute ? ' mx-switch--on' : ''}`}
              aria-pressed={ch.mute}
              aria-label={`Mute ${name}`}
              data-hint={`Mute ${name}`}
              onClick={() => toggleMute(voice)}
              onKeyUp={swallowSpace}
            >
              M
            </button>
            <button
              type="button"
              className={`mx-switch${ch.solo ? ' mx-switch--on' : ''}`}
              aria-pressed={ch.solo}
              aria-label={`Solo ${name}`}
              data-hint={`Solo ${name} — only soloed channels are heard`}
              onClick={() => toggleSolo(voice)}
              onKeyUp={swallowSpace}
            >
              S
            </button>
            <div data-hint={`${name} level`}>
              <Slider
                label={`${name} level`}
                value={ch.level}
                min={0}
                max={VOICE_LEVEL_MAX}
                onChange={(v) => setVoiceLevel(voice, v)}
              />
            </div>
            <span className="mx-level num">{ch.level}</span>
          </div>
        )
      })}

      <div className="mx-row mx-row--master">
        <span className="mx-name mx-master-label">MASTER</span>
        <div data-hint="Master level — everything the pads play">
          <Slider
            label="MASTER level"
            value={trackLevel.main}
            min={0}
            max={TRACK_LEVEL_MAX}
            onChange={(v) => setTrackLevel('main', v)}
          />
        </div>
        <span className="mx-level num">{trackLevel.main}</span>
      </div>
    </div>
  )
}
