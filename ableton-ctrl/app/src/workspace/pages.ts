import type {
  Page,
  PageId,
  WindowKind,
  WindowLimits,
  WindowState,
  WindowTier,
} from './types.ts'

export const PAGES: Page[] = [
  { id: 'rhythmic-intent', name: 'Rhythmic intent' },
  { id: 'untitled-2', name: 'Untitled 2' },
  { id: 'untitled-3', name: 'Untitled 3' },
  { id: 'untitled-4', name: 'Untitled 4' },
  { id: 'untitled-5', name: 'Untitled 5' },
]

/** Each page owns its windows. Only the first page has content in this pass. */
export const INITIAL_WINDOWS: Record<PageId, WindowState[]> = {
  // Demo build, laid out as the drum synth it is becoming. The two SOFTWARE
  // windows are the screens — Sound Source (the small system display) and the
  // Main Screen (centre), which carries the transport bar and the Collection
  // drawer along with the Sound Visual. Everything else is HARDWARE: the
  // Master Control knob and FX down the left, the pads and the Mixer down the
  // right. March / Rhythmic intent / Sound Intent / Ripple / March Family stay
  // omitted — their sessions still mount.
  'rhythmic-intent': [
    { id: 'src-1', kind: 'sound-source', title: 'Sound Source', x: 64, y: 64, w: 700, h: 420 },
    { id: 'mk-1', kind: 'master', title: 'Master Control', x: 64, y: 500, w: 700, h: 508 },
    { id: 'fx-1', kind: 'fx', title: 'FX', x: 64, y: 1024, w: 700, h: 480 },
    { id: 'ms-1', kind: 'main-screen', title: 'Main Screen', x: 800, y: 64, w: 1470, h: 1440 },
    { id: 'sel-1', kind: 'selector', title: 'Sound Selector', x: 2306, y: 64, w: 540, h: 900 },
    { id: 'mx-1', kind: 'mixer', title: 'Mixer', x: 2306, y: 980, w: 540, h: 524 },
  ],
  'untitled-2': [],
  'untitled-3': [],
  'untitled-4': [],
  'untitled-5': [],
}

/** See WindowTier. Only the two displays stay software. */
export const WINDOW_TIER: Record<WindowKind, WindowTier> = {
  'sound-source': 'software',
  'main-screen': 'software',
  'sound-visual': 'software',
  master: 'hardware',
  mixer: 'hardware',
  'rhythmic-intent': 'hardware',
  collection: 'hardware',
  'sound-intent': 'hardware',
  fx: 'hardware',
  selector: 'hardware',
  ripple: 'hardware',
  'march-intent': 'hardware',
  'march-family': 'hardware',
}

export const WINDOW_LIMITS: Record<WindowKind, WindowLimits> = {
  'sound-source': { minW: 420, minH: 260, maxW: 1200, maxH: 720 },
  'main-screen': { minW: 720, minH: 480, maxW: 2400, maxH: 2400 },
  master: { minW: 320, minH: 320, maxW: 1200, maxH: 1200 },
  mixer: { minW: 420, minH: 440, maxW: 1200, maxH: 1200 },
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
