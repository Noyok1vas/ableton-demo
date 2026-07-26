import { Workspace } from './workspace/Workspace.tsx'
import { RhythmicIntentSession } from './rhythmic-intent/session.tsx'
import { SoundIntentSession } from './sound-intent/session.tsx'
import { FxSession } from './fx/session.tsx'
import { TapSession } from './tap/session.tsx'

export default function App() {
  return (
    <RhythmicIntentSession>
      <SoundIntentSession>
        {/* FX describes the room every sound lands in, so it sits above the
            Sound Visual that reads it. */}
        <FxSession>
          {/* The shared tap trigger — needs both intent sessions above it. */}
          <TapSession>
            <Workspace />
          </TapSession>
        </FxSession>
      </SoundIntentSession>
    </RhythmicIntentSession>
  )
}
