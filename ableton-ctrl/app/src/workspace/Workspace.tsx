import { useCallback, useState } from 'react'
import { CanvasSurface } from './CanvasSurface.tsx'
import { DraggableWindow } from './DraggableWindow.tsx'
import { PageMenu } from './PageMenu.tsx'
import { ZoomControl } from './ZoomControl.tsx'
import { INITIAL_WINDOWS, PAGES, WINDOW_LIMITS } from './pages.ts'
import type { PageId, View, WindowKind, WindowState } from './types.ts'
import { RhythmicIntentScreen } from '../rhythmic-intent/RhythmicIntentScreen.tsx'
import './workspace.css'

const INITIAL_VIEW: View = { x: 0, y: 0, scale: 1 }

function windowContent(kind: WindowKind) {
  if (kind === 'rhythmic-intent') return <RhythmicIntentScreen />
  return null
}

export function Workspace() {
  const [pageId, setPageId] = useState<PageId>('rhythmic-intent')
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [windowsByPage, setWindowsByPage] =
    useState<Record<PageId, WindowState[]>>(INITIAL_WINDOWS)

  const windows = windowsByPage[pageId]

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
            limits={WINDOW_LIMITS}
            onChange={(patch) => updateWindow(w.id, patch)}
          >
            {windowContent(w.kind)}
          </DraggableWindow>
        ))}
      </CanvasSurface>

      {windows.length === 0 && <div className="workspace-empty">This page is empty</div>}

      <PageMenu pages={PAGES} currentId={pageId} onSelect={setPageId} />
      <ZoomControl view={view} onViewChange={setView} onReset={() => setView(INITIAL_VIEW)} />
    </div>
  )
}
