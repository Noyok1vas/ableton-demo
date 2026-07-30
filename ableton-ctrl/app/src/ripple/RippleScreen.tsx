import { RipplePad } from './RipplePad.tsx'
import { useRipple } from './session.tsx'
import { RIPPLE_MAX, RIPPLE_MIN } from './types.ts'
import { Slider } from '../sound-intent/Slider.tsx'
// The slider is the Sound Intent atom, styling included — one control, one
// look. ripple.css only adds this panel's own frame.
import '../sound-intent/sound-intent.css'
import './ripple.css'

const DESCRIPTION =
  'Ripple sounds one tap several times over. Each repeat is one ring, so the count you set is the number of rings the gesture leaves behind — here as a passing wave, on the Sound Visual as a mark that settles and stays. Rate, decay and the link to Live come next.'

/**
 * Ripple — the gesture's own window: the slider sets the repeats every RIPPLE
 * tap carries, the pad both previews the gesture (press it) and plays back any
 * RIPPLE tap fired elsewhere (the Selector's mark, the TAP button, Space).
 */
export function RippleScreen() {
  const { count, setCount } = useRipple()

  return (
    <div className="rp-screen">
      <RipplePad count={count} />
      <div className="si-sliders rp-controls">
        <Slider
          label="REPEATS"
          value={count}
          min={RIPPLE_MIN}
          max={RIPPLE_MAX}
          onChange={setCount}
        />
      </div>
      <footer className="si-description">{DESCRIPTION}</footer>
    </div>
  )
}
