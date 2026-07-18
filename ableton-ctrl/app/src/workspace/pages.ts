import type { Page, PageId, WindowLimits, WindowState } from './types.ts'

export const PAGES: Page[] = [
  { id: 'rhythmic-intent', name: 'Rhythmic intent' },
  { id: 'untitled-2', name: 'Untitled 2' },
  { id: 'untitled-3', name: 'Untitled 3' },
  { id: 'untitled-4', name: 'Untitled 4' },
  { id: 'untitled-5', name: 'Untitled 5' },
]

/** Each page owns its windows. Only the first page has content in this pass. */
export const INITIAL_WINDOWS: Record<PageId, WindowState[]> = {
  'rhythmic-intent': [
    { id: 'ri-1', kind: 'rhythmic-intent', title: 'Rhythmic intent', x: 96, y: 96, w: 1060, h: 640 },
  ],
  'untitled-2': [],
  'untitled-3': [],
  'untitled-4': [],
  'untitled-5': [],
}

export const WINDOW_LIMITS: WindowLimits = {
  minW: 720,
  minH: 600,
  maxW: 1600,
  maxH: 1040,
}
