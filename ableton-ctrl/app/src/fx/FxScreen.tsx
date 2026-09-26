import { Knob } from '../rhythmic-intent/Knob.tsx'
import { useFx } from './session.tsx'
import { FX_CONTROLS, FX_MAX, FX_MIN } from './types.ts'
// The knob is Rhythmic Intent's atom, styling included — one control, one
// look. fx.css only lays the four out.
import '../rhythmic-intent/rhythmic-intent.css'
import './fx.css'

/** Dial diameter in px — sized so the 2×2 fills the section. */
const KNOB_SIZE = 116

const formatValue = (v: number) => String(Math.round(v))

/** The FX section: four knobs, 2×2. REVERB, HIGH PASS FILTER and SATURATE
    re-render the Sound Visual and drive the rack macro of the same name;
    ECHO is a placeholder (see fx/types.ts). */
export function FxScreen() {
  const { params, setParam } = useFx()

  return (
    <div className="fx-screen">
      <div className="fx-knobs">
        {FX_CONTROLS.map((control) => (
          <Knob
            key={control.id}
            label={control.label}
            value={params[control.id]}
            min={FX_MIN}
            max={FX_MAX}
            step={1}
            formatValue={formatValue}
            onChange={(v) => setParam(control.id, v)}
            idle={false}
            size={KNOB_SIZE}
            hint={control.hint}
          />
        ))}
      </div>
    </div>
  )
}
