import { useEffect, useState } from 'react'
import { DeviceShell } from './device/DeviceShell.tsx'
import { Workspace } from './workspace/Workspace.tsx'
import { SoundEngineSession } from './transport/session.tsx'
import { RhythmicIntentSession } from './rhythmic-intent/session.tsx'
import { SoundIntentSession } from './sound-intent/session.tsx'
import { FxSession } from './fx/session.tsx'
import { SelectorSession } from './selector/session.tsx'
import { RippleSession } from './ripple/session.tsx'
import { TapSession } from './tap/session.tsx'
import { MarchSession } from './march/session.tsx'
import { GuideSession } from './guide/session.tsx'
import { HintLayer } from './guide/HintLayer.tsx'
import { ModSession } from './mod/session.tsx'
import { DrumSession } from './chladni2/session.tsx'
import { ShapeSession } from './chladni-editor/session.tsx'

/** The two pages: the device, and the Chladni Editor's canvas. */
type PageId = 'device' | 'chladni-editor'

/** Cmd+A (Ctrl+A off a Mac) swaps between the two pages, unless focus is in
    a text field, where it still selects the text. */
function usePageToggle(): PageId {
  const [page, setPage] = useState<PageId>('device')
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'a' || e.repeat) return
      const el = document.activeElement as HTMLElement | null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      e.preventDefault()
      setPage((prev) => (prev === 'device' ? 'chladni-editor' : 'device'))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return page
}

export default function App() {
  const page = usePageToggle()
  return (
    // The one sound source everything plays through, outermost because all
    // three of Rhythmic Intent, Sound Intent and FX reach for it.
    <SoundEngineSession>
      <RhythmicIntentSession>
        <SoundIntentSession>
          {/* FX describes the room every sound lands in, so it sits above the
              Sound Visual that reads it. */}
          <FxSession>
            {/* Which gesture a tap fires, and how many repeats it carries: both
                are stamped onto the tap, so they sit above the trigger. */}
            <SelectorSession>
              {/* The mod strips decide whether a pad records or auditions, so
                  they sit between what a tap is and the trigger that fires it. */}
              <ModSession>
              <RippleSession>
                {/* Chladni 2's knobs, which the Chladni Editor's Sound Controls
                    set and its taps play from. */}
                <DrumSession>
                {/* The shared tap trigger — needs every session above it. */}
                <TapSession>
                  {/* March reads only the transport's tempo and plays its own
                      three fixed voices, so it sits at the inside edge: nothing
                      else in the app depends on it. */}
                  <MarchSession>
                    {/* Guiding mode touches only what is drawn, so it sits
                        innermost, with its one layer of hints beside the
                        device rather than inside it. */}
                    <GuideSession>
                      {/* The Chladni Editor's figure and rack, kept above the
                          pages so switching away and back keeps them. */}
                      <ShapeSession>
                        {page === 'device' ? <DeviceShell /> : <Workspace />}
                      </ShapeSession>
                      <HintLayer />
                    </GuideSession>
                  </MarchSession>
                </TapSession>
                </DrumSession>
              </RippleSession>
              </ModSession>
            </SelectorSession>
          </FxSession>
        </SoundIntentSession>
      </RhythmicIntentSession>
    </SoundEngineSession>
  )
}
