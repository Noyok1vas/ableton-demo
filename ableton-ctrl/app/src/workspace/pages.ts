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
  // Demo build: the four visitor windows, plus Sound Source so an iPad
  // visitor can see which kit is live, the mix, and whether the browser
  // has actually unlocked audio. March / Rhythmic intent / Sound Intent /
  // Ripple / March Family stay omitted — their sessions still mount.
  //
  // Left column is Sound Source over Collection; centre is the stage;
  // the right column is 540 so the Selector's four identities stay one row.
  'rhythmic-intent': [
    { id: 'src-1', kind: 'sound-source', title: 'Sound Source', x: 64, y: 64, w: 700, h: 340 },
    { id: 'col-1', kind: 'collection', title: 'Collection', x: 64, y: 420, w: 700, h: 1084 },
    { id: 'sv-1', kind: 'sound-visual', title: 'Sound Visual', x: 800, y: 64, w: 1470, h: 1440 },
    { id: 'sel-1', kind: 'selector', title: 'Sound Selector', x: 2306, y: 64, w: 540, h: 702 },
    { id: 'fx-1', kind: 'fx', title: 'FX', x: 2306, y: 802, w: 540, h: 702 },
  ],
  'untitled-2': [],
  'untitled-3': [],
  'untitled-4': [],
  'untitled-5': [],
}

export const WINDOW_LIMITS: Record<WindowKind, WindowLimits> = {
  'sound-source': { minW: 420, minH: 260, maxW: 1200, maxH: 720 },
  'rhythmic-intent': { minW: 720, minH: 600, maxW: 1600, maxH: 1040 },
  collection: { minW: 300, minH: 280, maxW: 720, maxH: 1600 },
  'sound-intent': { minW: 360, minH: 420, maxW: 900, maxH: 1040 },
  'sound-visual': { minW: 320, minH: 320, maxW: 2400, maxH: 2400 },
  fx: { minW: 360, minH: 380, maxW: 900, maxH: 800 },
  // Tall enough for the grid plus a legible preview; the grid alone survives
  // being squeezed to the minimum, with the panel scrolling under it.
  selector: { minW: 220, minH: 320, maxW: 1400, maxH: 1400 },
  ripple: { minW: 300, minH: 380, maxW: 1000, maxH: 1100 },
  'march-intent': { minW: 420, minH: 420, maxW: 1400, maxH: 900 },
  'march-family': { minW: 520, minH: 400, maxW: 1400, maxH: 2000 },
}
