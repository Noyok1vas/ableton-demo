import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { TransportBar } from '../transport/TransportBar.tsx'
import { CollectionPanel } from '../rhythmic-intent/CollectionPanel.tsx'
import { SoundVisualScreen } from '../sound-intent/SoundVisualScreen.tsx'
import { AgentBar } from '../agent/AgentBar.tsx'
import { useSession } from '../rhythmic-intent/session.tsx'
import { useSoundIntent } from '../sound-intent/session.tsx'
import { useGuide } from '../guide/session.tsx'
import { loadSaved, useSaved } from '../persist.ts'
import { IconList, IconPlus, IconSparkle, IconUndo } from './icons.tsx'
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

/**
 * The Main Screen — the big display. The Sound Visual fills all of it, and
 * the controls float over the canvas in two rows, all icons:
 *
 *   top     +  new pattern · [transport pill] · ↶ undo
 *   bottom  ≡  Collection  · [agent bar]      · ✦ guiding mode
 *
 * The Collection opens as a window floating over the left of the canvas,
 * between the + and the ≡. Guiding mode is the words the icons leave out:
 * while it is on, pointing at any control explains it.
 *
 * While a mod strip is in use the sequencer gives way to the rack preview
 * (see RackPreview); the two rows stay on top of it.
 */
export function MainScreen() {
  const { clearPattern, undoTap, canUndo, hasPattern } = useSession()
  const { on: guiding, setOn: setGuiding } = useGuide()
  const { onTap } = useSoundIntent()
  const [libraryOpen, setLibraryOpen] = useState(() => loadSaved('ui.collectionOpen') === true)

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
  useSaved('ui.collectionOpen', libraryOpen)

  // Escape closes the library, as it would any floating window.
  useEffect(() => {
    if (!libraryOpen) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setLibraryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [libraryOpen])

  return (
    <div className="ms-screen" onPointerDownCapture={onCanvasPress} onPointerUpCapture={onCanvasPress}>
      <SoundVisualScreen controls={false} />
      <RackPreview />

      <div className={`ms-overlay${quiet ? ' ms-overlay--quiet' : ''}`}>
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

        {libraryOpen && (
          <div className="ms-library" role="dialog" aria-label="Collection">
            <CollectionPanel />
          </div>
        )}

        <div className="ms-row ms-row--bottom">
          <button
            type="button"
            className={`ms-circle${libraryOpen ? ' ms-circle--on' : ''}`}
            aria-label="Collection"
            aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen((o) => !o)}
            onKeyUp={swallowSpace}
            data-hint="Collection — your saved and temporary patterns"
          >
            <IconList />
          </button>
          <AgentBar />
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
