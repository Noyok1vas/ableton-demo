import { Slider } from '../sound-intent/Slider.tsx'
import { useFx } from './session.tsx'
import { FX_CONTROLS, FX_MAX, FX_MIN } from './types.ts'
// The sliders are the Sound Intent atom, styling included — one control, one
// look. fx.css only adds this panel's own frame.
import '../sound-intent/sound-intent.css'
import './fx.css'

const DESCRIPTION =
  'FX studies how a sound behaves in space, not how it is made. Every control describes the room, so it applies to the whole field at once: REVERB scatters the marks, HIGH PASS FILTER and SATURATE re-map their tones. Each one also turns the rack macro of the same name in Live.'

/** The FX panel. All three controls re-render the Sound Visual and drive the
    Live rack macro of the same name. */
export function FxScreen() {
  const { params, setParam } = useFx()

  return (
    <div className="fx-screen">
      <div className="si-sliders">
        {FX_CONTROLS.map((control) => (
          <Slider
            key={control.id}
            label={control.label}
            value={params[control.id]}
            min={FX_MIN}
            max={FX_MAX}
            onChange={(v) => setParam(control.id, v)}
          />
        ))}
      </div>
      <footer className="si-description">{DESCRIPTION}</footer>
    </div>
  )
}
