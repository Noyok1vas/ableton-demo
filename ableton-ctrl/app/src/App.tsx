import { Workspace } from './workspace/Workspace.tsx'
import { RhythmicIntentSession } from './rhythmic-intent/session.tsx'
import { SoundIntentSession } from './sound-intent/session.tsx'
import { FxSession } from './fx/session.tsx'
import { SelectorSession } from './selector/session.tsx'
import { RippleSession } from './ripple/session.tsx'
import { TapSession } from './tap/session.tsx'

export default function App() {
  return (
    <RhythmicIntentSession>
      <SoundIntentSession>
        {/* FX describes the room every sound lands in, so it sits above the
            Sound Visual that reads it. */}
        <FxSession>
          {/* Which gesture a tap fires, and how many repeats it carries: both
              are stamped onto the tap, so they sit above the trigger. */}
          <SelectorSession>
            <RippleSession>
              {/* The shared tap trigger — needs every session above it. */}
              <TapSession>
                <Workspace />
              </TapSession>
            </RippleSession>
          </SelectorSession>
        </FxSession>
      </SoundIntentSession>
    </RhythmicIntentSession>
  )
}
