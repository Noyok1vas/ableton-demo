import { useEffect, useState, type KeyboardEvent } from 'react'
import { TransportBar } from '../transport/TransportBar.tsx'
import { CollectionPanel } from '../rhythmic-intent/CollectionPanel.tsx'
import { SoundVisual3D } from '../sound-visual/SoundVisual3D.tsx'
import { TURNS } from '../sound-visual/scene.ts'
import { SectionStack } from './SectionStack.tsx'
import { useSession } from '../rhythmic-intent/session.tsx'
import { useGuide } from '../guide/session.tsx'
import { useMod } from '../mod/session.tsx'
import { useSoundEngine } from '../transport/session.tsx'
import { SoundSourceScreen } from '../transport/SoundSourceScreen.tsx'
import { loadSaved, useSaved } from '../persist.ts'
import { ExtractPanel } from '../extract/ExtractPanel.tsx'
import { AssistDock } from '../agent/AssistDock.tsx'
import type { GrooveContext } from '../agent/groove.ts'
import { IconGlobe, IconList, IconPlus, IconSliders, IconSparkle, IconUndo, IconWave } from './icons.tsx'
import { RackPreview } from './RackPreview.tsx'
import './main-screen.css'

/** Space is the tap key everywhere; a focused button must not also be
    pressed by it. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** The screen's panels — at most one is open. */
type Panel = 'collection' | 'settings' | 'extract'

type ExtractLive = 'idle' | 'recording' | 'reading' | 'preview'

function restorePanel(): Panel | null {
  const saved = loadSaved('ui.panel')
  return saved === 'collection' || saved === 'settings' ? saved : null
}

/**
 * The screen — the device's one display, and the only part of it that
 * changes (see design/system.md). The Sound Visual fills all of it, and the
 * controls float over it in two rows, all icons:
 *
 *   top     +  new pattern · [transport pill] · ↶ undo
 *   bottom  ≡  Collection  · [section stack]  · ⚙ Settings · ✦ assistant
 *   left    ◍  arrange — the song as a helix, on or off
 *   right   ∿  extract — one bar from a short take
 *
 * Collection, Settings and Extract each float over the ring, and only one is
 * open. Loading a pattern, or keeping an extracted bar, closes its block.
 * The assistant is the star: while it is on, pointing at a control explains
 * it, and a short block at the bottom takes one spoken question. The ring
 * stays underneath all of them.
 *
 * While a pad is held long (audition) the sequencer gives way to the rack
 * preview (see RackPreview), and the panels step aside for it.
 */
export function MainScreen() {
  const { clearPattern, undoTap, canUndo, hasPattern, view, setView, section, openSection, rendered } =
    useSession()
  const { on: guiding, setOn: setGuiding } = useGuide()
  const { active: auditioning } = useMod()
  const { status, source, bpm } = useSoundEngine()
  const needsUnlock = source === 'builtin' && !status.ready
  const [panel, setPanel] = useState<Panel | null>(restorePanel)
  const [extractLive, setExtractLive] = useState<ExtractLive>('idle')
  const [fromTake, setFromTake] = useState(false)
  // CREATE is one section, as a ring; ARRANGE is the whole song (the session
  // keeps which, since it decides what plays). `highlight` is the section a
  // finger on the stack is over.
  const [highlight, setHighlight] = useState<number | null>(null)
  // A hand is on the song in ARRANGE — turning it, sliding it, pinching it:
  // every control steps out of the way until the hand lets go.
  const [handling, setHandling] = useState(false)
  const toggle = (which: Panel) => setPanel((open) => (open === which ? null : which))

  useSaved('ui.panel', panel === 'extract' ? null : panel)

  // Escape closes the open panel, as it would any floating window.
  useEffect(() => {
    if (!panel) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])

  return (
    <div className={`ms-screen${auditioning ? ' ms-screen--audition' : ''}`}>
      <SoundVisual3D highlight={highlight} onHold={setHandling} />
      <RackPreview />

      <div
        className={`ms-overlay${auditioning ? ' ms-overlay--audition' : ''}${
          handling && view === 'arrange' ? ' ms-overlay--handling' : ''
        }`}
      >
        <div className="ms-row ms-row--top">
          <button
            type="button"
            className="ms-circle"
            aria-label="New pattern"
            disabled={!hasPattern}
            onClick={() => {
              clearPattern()
              setFromTake(false)
            }}
            onKeyUp={swallowSpace}
            data-hint="New pattern — clears the ring. The loop you had stays in the Collection"
          >
            <IconPlus />
          </button>
          <TransportBar />
          <button
            type="button"
            className="ms-circle"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={undoTap}
            onKeyUp={swallowSpace}
            data-hint="Undo — takes back the last tap"
          >
            <IconUndo />
          </button>
        </div>

        <div className="ms-side">
          <button
            type="button"
            className={`ms-circle${view === 'arrange' ? ' ms-circle--on' : ''}`}
            aria-label="Arrange"
            aria-pressed={view === 'arrange'}
            onClick={() => setView(view === 'arrange' ? 'create' : 'arrange')}
            onKeyUp={swallowSpace}
            data-hint="Arrange — the whole song as a helix, played through. Press again for the ring, looping one section"
          >
            <IconGlobe />
          </button>
        </div>

        <div className="ms-side ms-side--right">
          <button
            type="button"
            className={`ms-circle${panel === 'extract' ? ' ms-circle--on' : ''}`}
            aria-label="Extract"
            aria-expanded={panel === 'extract'}
            onClick={() => toggle('extract')}
            onKeyUp={swallowSpace}
            data-hint="Extract — record 10 to 15 seconds and pull one bar of drums onto the ring"
          >
            <IconWave />
          </button>
        </div>

        {panel === 'collection' && (
          <div className="ms-panel ms-panel--left" role="dialog" aria-label="Collection">
            <CollectionPanel onLoaded={() => setPanel(null)} />
          </div>
        )}
        {panel === 'settings' && (
          <div className="ms-panel ms-panel--right" role="dialog" aria-label="Settings">
            <SoundSourceScreen />
          </div>
        )}
        {panel === 'extract' && (
          <div className="ms-panel ms-panel--extract">
            <ExtractPanel
              onClose={() => setPanel(null)}
              onKept={() => setFromTake(true)}
              onLive={setExtractLive}
            />
          </div>
        )}

        {needsUnlock && (
          <p className="ms-toast" role="status">
            Tap any pad once to start sound
          </p>
        )}

        <div className="ms-row ms-row--bottom">
          <button
            type="button"
            className={`ms-circle${panel === 'collection' ? ' ms-circle--on' : ''}`}
            aria-label="Collection"
            aria-expanded={panel === 'collection'}
            onClick={() => toggle('collection')}
            onKeyUp={swallowSpace}
            data-hint="Collection — your saved and temporary patterns"
          >
            <IconList />
          </button>
          <span className="ms-spacer" aria-hidden />
          {view === 'arrange' && (
            <SectionStack
              count={TURNS}
              current={section}
              highlight={highlight}
              onHighlight={setHighlight}
              onSelect={(next) => {
                setHighlight(null)
                openSection(next)
              }}
            />
          )}
          <span className="ms-spacer" aria-hidden />
          <button
            type="button"
            className={`ms-circle${panel === 'settings' ? ' ms-circle--on' : ''}`}
            aria-label="Settings"
            aria-expanded={panel === 'settings'}
            onClick={() => toggle('settings')}
            onKeyUp={swallowSpace}
            data-hint="Settings — which source plays the sounds, and what it can reach"
          >
            <IconSliders />
          </button>
          <button
            type="button"
            className={`ms-circle${guiding ? ' ms-circle--on' : ''}`}
            aria-label="Assistant"
            aria-pressed={guiding}
            onClick={() => setGuiding(!guiding)}
            onKeyUp={swallowSpace}
            data-hint="Assistant is on — point at a control, or ask from the bar below. Press to close"
          >
            <IconSparkle filled={guiding} />
          </button>
        </div>

        {guiding && (
          <AssistDock
            context={{
              view,
              bpm,
              taps: rendered.map((tap) => ({ pos: tap.finalPos, voice: tap.voice, kept: tap.kept })),
              live: panel === 'extract' ? extractLive : null,
              fromTake,
            } satisfies GrooveContext}
          />
        )}
      </div>
    </div>
  )
}
