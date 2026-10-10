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
  { id: 'chladni', name: 'Chladni' },
]

/** Each page owns its windows. */
export const INITIAL_WINDOWS: Record<PageId, WindowState[]> = {
  // Demo build, laid out as the drum synth it is becoming. The two SOFTWARE
  // windows are the screens — Sound Source (the small system display) and the
  // Main Screen, which carries the transport, the Collection and the Sound
  // Visual. Everything else is HARDWARE: Master Control and FX down the left,
  // and along the bottom the two mod strips beside the pads, the pads exactly
  // as wide as the Main Screen above them. The Mixer is left out of this
  // beginner-level layout (the window still exists), as are March / Rhythmic
  // intent / Sound Intent / Ripple / March Family — their sessions still mount.
  'rhythmic-intent': [
    { id: 'src-1', kind: 'sound-source', title: 'Sound Source', x: 64, y: 64, w: 700, h: 420 },
    { id: 'mk-1', kind: 'master', title: 'Master Control', x: 64, y: 500, w: 700, h: 508 },
    { id: 'fx-1', kind: 'fx', title: 'FX', x: 64, y: 1024, w: 700, h: 480 },
    { id: 'ms-1', kind: 'main-screen', title: 'Main Screen', x: 800, y: 64, w: 1470, h: 1440 },
    { id: 'mod-1', kind: 'mod-strips', title: 'Mod Strip', x: 64, y: 1520, w: 700, h: 836 },
    { id: 'sel-1', kind: 'selector', title: 'Sound Selector', x: 800, y: 1520, w: 1470, h: 836 },
  ],
  // The Chladni marks beside the hand-drawn ones, for comparison only — not
  // part of the instrument, so nothing on this page records.
  chladni: [
    { id: 'ch-1', kind: 'chladni', title: 'Chladni Marks', x: 64, y: 64, w: 2000, h: 1120 },
  ],
}

/** See WindowTier. Only the two displays stay software. */
export const WINDOW_TIER: Record<WindowKind, WindowTier> = {
  'sound-source': 'software',
  'main-screen': 'software',
  'sound-visual': 'software',
  master: 'hardware',
  'mod-strips': 'hardware',
  mixer: 'hardware',
  'rhythmic-intent': 'hardware',
  collection: 'hardware',
  'sound-intent': 'hardware',
  fx: 'hardware',
  selector: 'hardware',
  ripple: 'hardware',
  'march-intent': 'hardware',
  'march-family': 'hardware',
  chladni: 'software',
}

export const WINDOW_LIMITS: Record<WindowKind, WindowLimits> = {
  'sound-source': { minW: 420, minH: 260, maxW: 1200, maxH: 720 },
  'main-screen': { minW: 720, minH: 480, maxW: 2400, maxH: 2400 },
  master: { minW: 320, minH: 320, maxW: 1200, maxH: 1200 },
  'mod-strips': { minW: 320, minH: 320, maxW: 1200, maxH: 1200 },
  mixer: { minW: 420, minH: 440, maxW: 1200, maxH: 1200 },
  'rhythmic-intent': { minW: 720, minH: 600, maxW: 1600, maxH: 1040 },
  collection: { minW: 300, minH: 280, maxW: 720, maxH: 1600 },
  'sound-intent': { minW: 360, minH: 420, maxW: 900, maxH: 1040 },
  'sound-visual': { minW: 320, minH: 320, maxW: 2400, maxH: 2400 },
  fx: { minW: 360, minH: 380, maxW: 900, maxH: 800 },
  // Tall enough for the grid plus a legible preview; the grid alone survives
  // being squeezed to the minimum, with the panel scrolling under it.
  selector: { minW: 220, minH: 320, maxW: 2400, maxH: 1400 },
  ripple: { minW: 300, minH: 380, maxW: 1000, maxH: 1100 },
  'march-intent': { minW: 420, minH: 420, maxW: 1400, maxH: 900 },
  'march-family': { minW: 520, minH: 400, maxW: 1400, maxH: 2000 },
  chladni: { minW: 800, minH: 600, maxW: 2800, maxH: 2000 },
}
