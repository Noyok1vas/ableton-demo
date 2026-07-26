import { Slider } from './Slider.tsx'
import { useSoundIntent } from './session.tsx'
import { SOUND_DIMENSIONS, SOUND_MAX, SOUND_MIN } from './types.ts'
import './sound-intent.css'

const DESCRIPTION =
  'Sound Intent studies what a sound is like. Five continuous dimensions form one shared state that drives both the Ableton sound and its visual identity.'

/** The slider panel: five Sound Dimensions, UI only for now. */
export function SoundIntentScreen() {
  const { params, setParam } = useSoundIntent()

  return (
    <div className="si-screen">
      <div className="si-sliders">
        {SOUND_DIMENSIONS.map((dim) => (
          <Slider
            key={dim.id}
            label={dim.label}
            value={params[dim.id]}
            min={SOUND_MIN}
            max={SOUND_MAX}
            onChange={(v) => setParam(dim.id, v)}
          />
        ))}
      </div>
      <footer className="si-description">{DESCRIPTION}</footer>
    </div>
  )
}
