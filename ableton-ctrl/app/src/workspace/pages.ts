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
  // Two columns: the controls on the left, read top to bottom, and the Sound
  // Visual to their right as the stage, vertically centred on the column and
  // sized so the whole ring is legible without filling the canvas. There is no
  // Tap window — a tap comes from Space or from a Selector mark.
  'rhythmic-intent': [
    // Sound Source heads the control column: it decides where every other
    // window's sound comes out, so it is read before any of them.
    { id: 'src-1', kind: 'sound-source', title: 'Sound Source', x: 64, y: 64, w: 1000, h: 424 },
    { id: 'ri-1', kind: 'rhythmic-intent', title: 'Rhythmic intent', x: 64, y: 520, w: 1000, h: 656 },
    { id: 'col-1', kind: 'collection', title: 'Collection', x: 1094, y: 520, w: 372, h: 656 },
    // Selector — four gesture marks; HIT and ROLL fire the shared tap.
    { id: 'sel-1', kind: 'selector', title: 'Selector', x: 64, y: 1208, w: 564, h: 244 },
    // Sound Intent under the Selector: what a tap sounds like, below what it is.
    { id: 'si-1', kind: 'sound-intent', title: 'Sound Intent', x: 64, y: 1484, w: 564, h: 520 },
    // Ripple — the Selector's ROLL mark as a playable gesture. Standalone for
    // now: its own pad, no shared tap, nothing sent to Live.
    { id: 'rip-1', kind: 'ripple', title: 'Ripple', x: 660, y: 1208, w: 484, h: 796 },
    // FX — the room, not the instrument. Applies to the whole field at once.
    { id: 'fx-1', kind: 'fx', title: 'FX', x: 1188, y: 1208, w: 560, h: 796 },
    { id: 'sv-1', kind: 'sound-visual', title: 'Sound Visual', x: 2020, y: 344, w: 1400, h: 1380 },
  ],
  'untitled-2': [],
  'untitled-3': [],
  'untitled-4': [],
  'untitled-5': [],
}

export const WINDOW_LIMITS: Record<WindowKind, WindowLimits> = {
  'sound-source': { minW: 420, minH: 260, maxW: 1200, maxH: 720 },
  'rhythmic-intent': { minW: 720, minH: 600, maxW: 1600, maxH: 1040 },
  collection: { minW: 300, minH: 280, maxW: 720, maxH: 1200 },
  'sound-intent': { minW: 360, minH: 420, maxW: 900, maxH: 1040 },
  'sound-visual': { minW: 320, minH: 320, maxW: 2400, maxH: 2400 },
  fx: { minW: 360, minH: 380, maxW: 900, maxH: 800 },
  selector: { minW: 180, minH: 160, maxW: 1400, maxH: 900 },
  ripple: { minW: 300, minH: 380, maxW: 1000, maxH: 1100 },
}
