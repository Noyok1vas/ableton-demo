import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasSurface } from './CanvasSurface.tsx'
import { DraggableWindow } from './DraggableWindow.tsx'
import { ZoomControl } from './ZoomControl.tsx'
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

/** Breathing room around the four windows so two fingers can land on the
 *  canvas instead of a title bar. Still capped at scale 1 on a wide monitor. */
const FIT_PAD = 96

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
 * Fit the windows' bounding box into the surface and centre it. Capped at 1
 * so a wide monitor shows the layout at its designed size rather than
 * blowing it up.
 */
function fitView(windows: WindowState[], width: number, height: number): View {
  if (windows.length === 0 || width === 0 || height === 0) return INITIAL_VIEW
  const pad = FIT_PAD
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

function surfaceSize() {
  const rect = document.querySelector('.surface')?.getBoundingClientRect()
  return rect ? { width: rect.width, height: rect.height } : null
}

function usePortrait() {
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const sync = () => setPortrait(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return portrait
}

export function Workspace() {
  // No page menu in the demo, so the page never changes.
  const pageId: PageId = 'rhythmic-intent'
  const portrait = usePortrait()
  const [view, setView] = useState<View>(INITIAL_VIEW)
  const [windowsByPage, setWindowsByPage] =
    useState<Record<PageId, WindowState[]>>(INITIAL_WINDOWS)

  const windows = windowsByPage[pageId]
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  // Once the visitor pinches, pans, or uses the zoom control, the view is
  // theirs. Resize still re-fits until that happens so split-view / rotate
  // back to landscape does not leave the canvas stranded.
  const userAdjusted = useRef(false)

  const applyFit = useCallback(() => {
    const size = surfaceSize()
    if (size) setView(fitView(windowsRef.current, size.width, size.height))
  }, [])

  const onViewChange = useCallback((next: View) => {
    userAdjusted.current = true
    setView(next)
  }, [])

  const onReset = useCallback(() => {
    userAdjusted.current = false
    applyFit()
  }, [applyFit])

  useLayoutEffect(() => {
    applyFit()
  }, [applyFit])

  useEffect(() => {
    const onResize = () => {
      if (!userAdjusted.current) applyFit()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  }, [applyFit])

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
      <CanvasSurface view={view} onViewChange={onViewChange}>
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

      <ZoomControl view={view} onViewChange={onViewChange} onReset={onReset} />

      {windows.length === 0 && <div className="workspace-empty">This page is empty</div>}

      {portrait && (
        <div className="workspace-rotate" role="status">
          请将 iPad 横过来
        </div>
      )}
    </div>
  )
}
