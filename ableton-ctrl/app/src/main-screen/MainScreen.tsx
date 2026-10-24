import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { TransportBar } from '../transport/TransportBar.tsx'
import { CollectionPanel } from '../rhythmic-intent/CollectionPanel.tsx'
import { SoundVisual3D, type Mode } from '../sound-visual/SoundVisual3D.tsx'
import { TURNS } from '../sound-visual/scene.ts'
import { SectionStack } from './SectionStack.tsx'
import { useSession } from '../rhythmic-intent/session.tsx'
import { useSoundIntent } from '../sound-intent/session.tsx'
import { useGuide } from '../guide/session.tsx'
import { useMod } from '../mod/session.tsx'
import { useSoundEngine } from '../transport/session.tsx'
import { SoundSourceScreen } from '../transport/SoundSourceScreen.tsx'
import { loadSaved, useSaved } from '../persist.ts'
import { IconGlobe, IconList, IconPlus, IconSliders, IconSparkle, IconUndo } from './icons.tsx'
import { RackPreview } from './RackPreview.tsx'
import './main-screen.css'

/** Space is the tap key everywhere; a focused button must not also be
    pressed by it. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** How long after the last tap (or mark drag) the bars come back. Long enough
    to span the gaps inside a phrase, short enough that they return as soon as
    the playing stops. */
const QUIET_MS = 2200

/** The screen's panels — at most one is open. */
type Panel = 'collection' | 'settings'

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
 *   bottom  ≡  Collection  · [section stack]  · ⚙ Settings · ✦ guiding mode
 *   left    ◍  arrange — the song as a helix, on or off
 *
 * Collection floats over the left of the screen, Settings over the right;
 * only one is open at a time. Guiding mode is the words the icons leave out:
 * while it is on, pointing at any control explains it.
 *
 * While a pad is held long (audition) the sequencer gives way to the rack
 * preview (see RackPreview), and the panels step aside for it.
 */
export function MainScreen() {
  const { clearPattern, undoTap, canUndo, hasPattern } = useSession()
  const { on: guiding, setOn: setGuiding } = useGuide()
  const { onTap } = useSoundIntent()
  const { active: auditioning } = useMod()
  const { status, source } = useSoundEngine()
  const needsUnlock = source === 'builtin' && !status.ready
  const [panel, setPanel] = useState<Panel | null>(restorePanel)
  // CREATE is the ring; ARRANGE is the whole song, for looking at. The Sound
  // Visual swings its camera between the two. `section` is the pass of the
  // song the ring shows, carried on by the playhead or chosen on the stack;
  // `highlight` the one a finger on the stack is over.
  const [mode, setMode] = useState<Mode>('create')
  const [section, setSection] = useState(0)
  const [highlight, setHighlight] = useState<number | null>(null)
  const toggle = (which: Panel) => setPanel((open) => (open === which ? null : which))

  // While you are playing into the ring — tapping, or dragging a mark — the
  // two bars step back to 20% so the picture is all there is. They return
  // QUIET_MS after the last gesture, or at once under the pointer.
  const [quiet, setQuiet] = useState(false)
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poke = () => {
    setQuiet(true)
    if (quietTimer.current !== null) clearTimeout(quietTimer.current)
    quietTimer.current = setTimeout(() => setQuiet(false), QUIET_MS)
  }
  const pokeRef = useRef(poke)
  pokeRef.current = poke
  // Every tap, from any surface — pads, Space — arrives here.
  useEffect(() => onTap(() => pokeRef.current()), [onTap])
  useEffect(
    () => () => {
      if (quietTimer.current !== null) clearTimeout(quietTimer.current)
    },
    [],
  )
  // A press on the canvas itself is a mark being moved or removed.
  const onCanvasPress = (e: PointerEvent) => {
    if (e.target instanceof HTMLCanvasElement) poke()
  }
  useSaved('ui.panel', panel)

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
    <div
      className={`ms-screen${auditioning ? ' ms-screen--audition' : ''}`}
      onPointerDownCapture={onCanvasPress}
      onPointerUpCapture={onCanvasPress}
    >
      <SoundVisual3D
        mode={mode}
        section={section}
        highlight={highlight}
        onSection={setSection}
      />
      <RackPreview />

      <div
        className={`ms-overlay${quiet ? ' ms-overlay--quiet' : ''}${
          auditioning ? ' ms-overlay--audition' : ''
        }`}
      >
        <div className="ms-row ms-row--top">
          <button
            type="button"
            className="ms-circle"
            aria-label="New pattern"
            disabled={!hasPattern}
            onClick={clearPattern}
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
            className={`ms-circle${mode === 'arrange' ? ' ms-circle--on' : ''}`}
            aria-label="Arrange"
            aria-pressed={mode === 'arrange'}
            onClick={() => setMode(mode === 'arrange' ? 'create' : 'arrange')}
            onKeyUp={swallowSpace}
            data-hint="Arrange — the whole song as a helix, every mark a dot sized by how hard it was played. Press again for the ring"
          >
            <IconGlobe />
          </button>
        </div>

        {panel === 'collection' && (
          <div className="ms-panel ms-panel--left" role="dialog" aria-label="Collection">
            <CollectionPanel />
          </div>
        )}
        {panel === 'settings' && (
          <div className="ms-panel ms-panel--right" role="dialog" aria-label="Settings">
            <SoundSourceScreen />
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
          <SectionStack
            count={TURNS}
            current={section}
            highlight={highlight}
            onHighlight={setHighlight}
            onSelect={(next) => {
              setSection(next)
              setMode('create')
            }}
          />
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
            aria-label="Guiding mode"
            aria-pressed={guiding}
            onClick={() => setGuiding(!guiding)}
            onKeyUp={swallowSpace}
            data-hint="Guiding mode is on — point at any control to see what it does. Press to turn off"
          >
            <IconSparkle filled={guiding} />
          </button>
        </div>
      </div>
    </div>
  )
}
