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
    // Shared TAP trigger — one press drives both Rhythmic Intent and Sound Intent.
    { id: 'tap-1', kind: 'tap', title: 'Tap', x: 1440, y: 96, w: 300, h: 640 },
    // Sound Intent — peers with Rhythmic Intent, placed on the row below.
    { id: 'si-1', kind: 'sound-intent', title: 'Sound Intent', x: 64, y: 784, w: 560, h: 520 },
    { id: 'sv-1', kind: 'sound-visual', title: 'Sound Visual', x: 648, y: 784, w: 560, h: 520 },
    // Selector — four gesture marks; BLOOM shares the TAP trigger.
    { id: 'sel-1', kind: 'selector', title: 'Selector', x: 1248, y: 784, w: 560, h: 248 },
    // FX — the room, not the instrument. Applies to the whole field at once.
    { id: 'fx-1', kind: 'fx', title: 'FX', x: 1248, y: 1064, w: 560, h: 456 },
    // Ripple — the Selector's RIPPLE mark as a playable gesture. Standalone for
    // now: its own pad, no shared tap, nothing sent to Live.
    { id: 'rip-1', kind: 'ripple', title: 'Ripple', x: 1848, y: 784, w: 480, h: 640 },
  ],
  'untitled-2': [],
  'untitled-3': [],
  'untitled-4': [],
  'untitled-5': [],
}

export const WINDOW_LIMITS: Record<WindowKind, WindowLimits> = {
  'rhythmic-intent': { minW: 720, minH: 600, maxW: 1600, maxH: 1040 },
  collection: { minW: 300, minH: 280, maxW: 720, maxH: 1200 },
  'sound-intent': { minW: 360, minH: 420, maxW: 900, maxH: 1040 },
  'sound-visual': { minW: 320, minH: 320, maxW: 2400, maxH: 2400 },
  fx: { minW: 360, minH: 380, maxW: 900, maxH: 800 },
  tap: { minW: 200, minH: 220, maxW: 700, maxH: 900 },
  selector: { minW: 180, minH: 160, maxW: 1400, maxH: 900 },
  ripple: { minW: 300, minH: 380, maxW: 1000, maxH: 1100 },
}
