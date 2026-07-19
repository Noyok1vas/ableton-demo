import type { Page, PageId, WindowKind, WindowLimits, WindowState } from './types.ts'

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
    { id: 'ri-1', kind: 'rhythmic-intent', title: 'Rhythmic intent', x: 64, y: 96, w: 980, h: 640 },
    { id: 'col-1', kind: 'collection', title: 'Collection', x: 1068, y: 96, w: 356, h: 640 },
  ],
  'untitled-2': [],
  'untitled-3': [],
  'untitled-4': [],
  'untitled-5': [],
}

export const WINDOW_LIMITS: Record<WindowKind, WindowLimits> = {
  'rhythmic-intent': { minW: 720, minH: 600, maxW: 1600, maxH: 1040 },
  collection: { minW: 300, minH: 280, maxW: 720, maxH: 1200 },
}
