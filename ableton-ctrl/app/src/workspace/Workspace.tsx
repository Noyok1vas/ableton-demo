import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasSurface } from './CanvasSurface.tsx'
import { DraggableWindow } from './DraggableWindow.tsx'
import { ZoomControl } from './ZoomControl.tsx'
import { INITIAL_WINDOWS, WINDOW_LIMITS } from './pages.ts'
import type { PageId, View, WindowKind, WindowState } from './types.ts'
import { MAX_SCALE } from './types.ts'
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

/** Floor for a fit pass only — must stay below any real iPad Safari viewport
 *  so the four windows can always enter the screen. Free pinch uses MIN_SCALE. */
const FIT_SCALE_FLOOR = 0.05

/** Zoom control + home-indicator clearance reserved at the bottom of a fit. */
const FIT_BOTTOM_CHROME = 64

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
 * blowing it up. Never raises the scale above what fits — a MIN_SCALE floor
 * here used to leave the layout hanging off an iPad Safari viewport.
 */
function fitView(windows: WindowState[], width: number, height: number): View {
  if (windows.length === 0 || width === 0 || height === 0) return INITIAL_VIEW
  const padX = Math.max(12, Math.min(32, width * 0.02))
  const padY = Math.max(12, Math.min(24, height * 0.02))
  const minX = Math.min(...windows.map((w) => w.x))
  const minY = Math.min(...windows.map((w) => w.y))
  const contentW = Math.max(...windows.map((w) => w.x + w.w)) - minX
  const contentH = Math.max(...windows.map((w) => w.y + w.h)) - minY
  const availW = Math.max(1, width - padX * 2)
  // Never let the chrome reservation eat the whole height on a short Safari UI.
  const bottomChrome = Math.min(FIT_BOTTOM_CHROME, Math.max(0, height * 0.12))
  const availH = Math.max(1, height - padY * 2 - bottomChrome)
  const needed = Math.min(1, availW / contentW, availH / contentH)
  // Fit must succeed even when that means going under the interactive floor.
  const scale = Math.min(MAX_SCALE, Math.max(FIT_SCALE_FLOOR, needed))
  return {
    scale,
    x: (width - contentW * scale) / 2 - minX * scale,
    y: (height - contentH * scale - bottomChrome) / 2 + padY / 2 - minY * scale,
  }
}

function surfaceSize() {
  const rect = document.querySelector('.surface')?.getBoundingClientRect()
  if (!rect || rect.width < 32 || rect.height < 32) return null

  let { width, height } = rect
  const vv = window.visualViewport
  // iPad Safari can report a near-zero visualViewport during the first paint.
  // Fitting against that shrinks the layout into a speck on a white canvas —
  // which reads as a blank page. Only honour a plausible toolbar inset.
  if (
    vv &&
    vv.width >= Math.min(width * 0.6, 480) &&
    vv.height >= Math.min(height * 0.6, 320)
  ) {
    width = Math.min(width, vv.width)
    height = Math.min(height, vv.height)
  }
  return { width, height }
}

function subscribeMedia(mq: MediaQueryList, sync: () => void) {
  sync()
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }
  // Safari < 14
  mq.addListener(sync)
  return () => mq.removeListener(sync)
}

function usePortrait() {
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches,
  )
  useEffect(() => {
    return subscribeMedia(window.matchMedia('(orientation: portrait)'), () => {
      setPortrait(window.matchMedia('(orientation: portrait)').matches)
    })
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
    if (!size) return
    const next = fitView(windowsRef.current, size.width, size.height)
    setView((prev) =>
      prev.scale === next.scale && prev.x === next.x && prev.y === next.y ? prev : next,
    )
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
    // Safari often settles the toolbar / visualViewport a tick after first paint.
    const raf = window.requestAnimationFrame(() => {
      if (!userAdjusted.current) applyFit()
    })
    const delayed = window.setTimeout(onResize, 250)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    window.addEventListener('pageshow', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(delayed)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      window.removeEventListener('pageshow', onResize)
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
