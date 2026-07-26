import { TapButton } from '../rhythmic-intent/TapButton.tsx'
import { useTap } from './session.tsx'
// Base .tap-button styling lives with Rhythmic Intent; tap.css adds the
// fill-the-window layout for this standalone viewport.
import '../rhythmic-intent/rhythmic-intent.css'
import './tap.css'

/**
 * The tap trigger, pulled out of Rhythmic Intent into its own window so a single
 * press drives both modules at once. The trigger itself (bar clock, MIDI note,
 * sound event, global Space) lives in TapSession — this window is one of its
 * surfaces, the Selector's BLOOM mark is another.
 */
export function TapScreen() {
  const { fireTap, recording } = useTap()

  return (
    <div className="tap-window">
      <TapButton onTap={fireTap} recording={recording} />
    </div>
  )
}
