import type React from 'react'
import { ShapeSlider } from './ShapeSlider.tsx'
import { Steps } from './ShapeControls.tsx'
import { useShapeEditor } from './session.tsx'
import type { ShapeControl } from './shape.ts'
import { DRUM_PARAMS, type DrumParamDef } from '../chladni2/params.ts'
import { useDrum } from '../chladni2/session.tsx'
import { PATTERNS } from '../selector/patterns.ts'
import type { DrumParams, SoundVoiceId } from '../transport/engine.ts'
import '../sound-intent/sound-intent.css'
import './chladni-editor.css'

const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** A knob as the editor's controls take it: 0..1, or a step index. */
const asControl = (def: DrumParamDef): ShapeControl => ({
  id: def.id,
  label: def.label,
  min: 0,
  max: def.steps ? def.steps.length - 1 : 1,
  step: def.steps ? 1 : 0.01,
  initial: def.initial,
  steps: def.steps,
})

/** Knobs that do nothing to the sound as the others stand, with the reason —
    read off `resolveDrumVoice` in kit.ts. */
function inactiveKnobs(id: SoundVoiceId, params: DrumParams): Map<string, string> {
  const off = new Map<string, string>()
  if (id === 'fx' && params.amnt === 0) off.set('mod', 'AMNT is 0')
  return off
}

/**
 * The knobs of the sound the figure is being tried against — the same knobs,
 * and the same values, as the Chladni 2 pads — so a tap on the figure plays
 * the sound as set here. Choosing another sound under the figure brings up
 * its knobs.
 */
export function SoundControls() {
  const { target } = useShapeEditor()
  const { params, setParam, resetSound } = useDrum()
  const values = params[target]
  const off = inactiveKnobs(target, values)
  const label = PATTERNS.find((p) => p.id === target)?.label.toUpperCase() ?? ''

  return (
    <div className="ce-controls" data-no-pinch>
      <div className="ce-sound-head">
        <span className="ce-sound-name">{label}</span>
        <button
          type="button"
          className="ce-button"
          onClick={() => resetSound(target)}
          onKeyUp={swallowSpace}
        >
          RESET
        </button>
      </div>
      <div className="ce-sound-list">
        {DRUM_PARAMS[target].map((def) => {
          const control = asControl(def)
          const props = {
            control,
            value: values[def.id],
            onChange: (v: number) => setParam(target, def.id, v),
            off: off.get(def.id),
          }
          return def.steps ? <Steps key={def.id} {...props} /> : <ShapeSlider key={def.id} {...props} />
        })}
      </div>
    </div>
  )
}
