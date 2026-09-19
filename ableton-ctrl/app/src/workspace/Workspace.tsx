import { useCallback, useLayoutEffect, useState } from 'react'
import { CanvasSurface } from './CanvasSurface.tsx'
import { DraggableWindow } from './DraggableWindow.tsx'
import { INITIAL_WINDOWS, WINDOW_LIMITS } from './pages.ts'
import type { PageId, View, WindowKind, WindowState } from './types.ts'
import { clampScale } from './viewUtils.ts'
import { SoundSourceScreen } from '../transport/SoundSourceScreen.tsx'
import { RhythmicIntentScreen } from '../rhythmic-intent/RhythmicIntentScreen.tsx'
import { CollectionPanel } from '../rhythmic-intent/CollectionPanel.tsx'
import { SoundIntentScreen } from '../sound-intent/SoundIntentScreen.tsx'
import { SoundVisualScreen } from '../sound-intent/SoundVisualScreen.tsx'
import { FxScreen } from '../fx/FxScreen.tsx'
import { SelectorScreen } from '../selector/SelectorScreen.tsx'
import { RippleScreen } from '../ripple/RippleScreen.tsx'
import { MarchIntentScreen } from '../march/MarchIntentScreen.tsx'
import { MarchFamilyScreen } from '../march/MarchFamilyScreen.tsx'
import './workspace.css'

const INITIAL_VIEW: View = { x: 0, y: 0, scale: 1 }

function windowContent(kind: WindowKind) {
  switch (kind) {
    case 'sound-source':
      return <SoundSourceScreen />
    case 'rhythmic-intent':
      return <RhythmicIntentScreen />
    case 'collection':
      return <CollectionPanel />
    case 'sound-intent':
      return <SoundIntentScreen />
    case 'sound-visual':
      return <SoundVisualScreen />
    case 'fx':
      return <FxScreen />
    case 'selector':
      return <SelectorScreen />
    case 'ripple':
      return <RippleScreen />
    case 'march-intent':
      return <MarchIntentScreen />
    case 'march-family':
      return <MarchFamilyScreen />
  }
}

/**
 * The demo ships without a zoom control, so the canvas has to arrive already
 * framed: fit the windows' bounding box into the surface and centre it. Capped
 * at 1 so a wide monitor shows the layout at its designed size rather than
 * blowing it up. Runs once — after that the view belongs to the visitor.
 */
function fitView(windows: WindowState[], width: number, height: number): View {
  if (windows.length === 0 || width === 0 || height === 0) return INITIAL_VIEW
  const pad = 40
  const minX = Math.min(...windows.map((w) => w.x))
  const minY = Math.min(...windows.map((w) => w.y))
  const contentW = Math.max(...windows.map((w) => w.x + w.w)) - minX
  const contentH = Math.max(...windows.map((w) => w.y + w.h)) - minY
  const scale = clampScale(
    Math.min(1, (width - pad * 2) / contentW, (height - pad * 2) / contentH),
  )
  return {
    scale,
    x: (width - contentW * scale) / 2 - minX * scale,
    y: (height - contentH * scale) / 2 - minY * scale,
  }
}

export function Workspace() {
  // No page menu in the demo, so the page never changes.
  const pageId: PageId = 'rhythmic-intent'
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [windowsByPage, setWindowsByPage] =
    useState<Record<PageId, WindowState[]>>(INITIAL_WINDOWS)

  const windows = windowsByPage[pageId]

  useLayoutEffect(() => {
    const rect = document.querySelector('.surface')?.getBoundingClientRect()
    if (rect) setView(fitView(INITIAL_WINDOWS[pageId], rect.width, rect.height))
    // Mount only: re-fitting later would yank the canvas out from under a
    // visitor who has panned or zoomed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateWindow = useCallback(
    (id: string, patch: Partial<WindowState>) => {
      setWindowsByPage((prev) => ({
        ...prev,
        [pageId]: prev[pageId].map((w) => (w.id === id ? { ...w, ...patch } : w)),
      }))
    },
    [pageId],
  )

  return (
    <div className="workspace">
      <CanvasSurface view={view} onViewChange={setView}>
        {windows.map((w) => (
          <DraggableWindow
            key={w.id}
            window={w}
            scale={view.scale}
            limits={WINDOW_LIMITS[w.kind]}
            onChange={(patch) => updateWindow(w.id, patch)}
          >
            {windowContent(w.kind)}
          </DraggableWindow>
        ))}
      </CanvasSurface>

      {windows.length === 0 && <div className="workspace-empty">This page is empty</div>}
    </div>
  )
}
