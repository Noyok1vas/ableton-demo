import { Workspace } from './workspace/Workspace.tsx'
import { RhythmicIntentSession } from './rhythmic-intent/session.tsx'

export default function App() {
  return (
    <RhythmicIntentSession>
      <Workspace />
    </RhythmicIntentSession>
  )
}
