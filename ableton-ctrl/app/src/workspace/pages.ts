import type {
  Page,
  PageId,
  WindowKind,
  WindowLimits,
  WindowState,
  WindowTier,
} from './types.ts'

export const PAGES: Page[] = [
  { id: 'hardware', name: 'Hardware' },
  { id: 'chladni', name: 'Chladni 1' },
  { id: 'chladni-2', name: 'Chladni 2' },
  { id: 'chladni-editor', name: 'Chladni Editor' },
]

/** Each page owns its windows. */
export const INITIAL_WINDOWS: Record<PageId, WindowState[]> = {
  // The instrument itself: the rendered hardware with the UI on its screens
  // (device/DeviceShell), drawn full-screen rather than as windows on the
  // canvas. Nothing here to drag.
  hardware: [],
  // The Chladni marks beside the hand-drawn ones, for comparison only — not
  // part of the instrument, so nothing on this page records.
  chladni: [
    { id: 'ch-1', kind: 'chladni', title: 'Chladni Marks', x: 64, y: 64, w: 2000, h: 1120 },
  ],
  // Chladni 2: the figures rebuilt from the 909 / Drum Synth knobs. Unlike
  // Chladni 1 this page plays into the loop — the ring is the Main Screen's,
  // drawn with these figures, and the pads record with every knob copied on.
  'chladni-2': [
    { id: 'c2-ring', kind: 'chladni2-ring', title: 'Chladni 2 Ring', x: 64, y: 64, w: 1470, h: 1360 },
    { id: 'c2-pads', kind: 'chladni2-pads', title: 'Chladni 2 Pads', x: 1570, y: 64, w: 1300, h: 1360 },
    { id: 'c2-key', kind: 'chladni2-key', title: 'Chladni 2 Key', x: 64, y: 1460, w: 2806, h: 400 },
  ],
  // The Chladni Editor: find a figure by hand on every control the renderer
  // has, tap the sound against it, and keep it in that sound's rack slot.
  // Auditions only — nothing here records into the loop.
  'chladni-editor': [
    { id: 'ce-view', kind: 'shape-view', title: 'Figure', x: 64, y: 64, w: 1300, h: 1240 },
    { id: 'ce-controls', kind: 'shape-controls', title: 'Figure Controls', x: 1400, y: 64, w: 820, h: 1900 },
    { id: 'ce-sound', kind: 'sound-controls', title: 'Sound Controls', x: 2256, y: 64, w: 560, h: 900 },
    { id: 'ce-rack', kind: 'shape-rack', title: 'Drum Rack', x: 64, y: 1340, w: 1300, h: 624 },
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
  'chladni2-ring': 'software',
  'chladni2-pads': 'hardware',
  'chladni2-key': 'software',
  'shape-view': 'software',
  'shape-controls': 'hardware',
  'shape-rack': 'hardware',
  'sound-controls': 'hardware',
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
  'chladni2-ring': { minW: 600, minH: 600, maxW: 2400, maxH: 2400 },
  'chladni2-pads': { minW: 900, minH: 800, maxW: 2800, maxH: 2000 },
  'chladni2-key': { minW: 800, minH: 300, maxW: 2800, maxH: 1200 },
  'shape-view': { minW: 600, minH: 600, maxW: 2400, maxH: 2400 },
  'shape-controls': { minW: 500, minH: 600, maxW: 1600, maxH: 2400 },
  'shape-rack': { minW: 600, minH: 400, maxW: 2400, maxH: 1600 },
  'sound-controls': { minW: 400, minH: 400, maxW: 1200, maxH: 2400 },
}
