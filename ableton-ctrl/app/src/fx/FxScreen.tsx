import { Slider } from '../sound-intent/Slider.tsx'
import { useFx } from './session.tsx'
import { FX_CONTROLS, FX_MAX, FX_MIN } from './types.ts'
// The sliders are the Sound Intent atom, styling included — one control, one
// look. fx.css only adds this panel's own frame.
import '../sound-intent/sound-intent.css'
import './fx.css'

const DESCRIPTION =
  'FX studies how a sound behaves in space, not how it is made. Every control describes the room, so it applies to the whole field at once.'

/** The FX panel. Only REVERB is mapped; the other two are UI for now. */
export function FxScreen() {
  const { params, setParam } = useFx()

  return (
    <div className="fx-screen">
      <div className="si-sliders">
        {FX_CONTROLS.map((control) => (
          <div
            key={control.id}
            className={control.macroName ? 'fx-control' : 'fx-control fx-control-unmapped'}
          >
            <Slider
              label={control.label}
              value={params[control.id]}
              min={FX_MIN}
              max={FX_MAX}
              onChange={(v) => setParam(control.id, v)}
            />
          </div>
        ))}
      </div>
      <footer className="si-description">{DESCRIPTION}</footer>
    </div>
  )
}
