import type { WindowKind, WindowLimits, WindowState, WindowTier } from './types.ts'

/** The Chladni Editor: find a figure by hand on every control the renderer
    has, tap the sound against it, and keep it in that sound's rack slot.
    Auditions only — nothing here records into the loop. Brought over from
    the ChladniPattern branch as the one canvas page beside the device. */
export const EDITOR_WINDOWS: WindowState[] = [
  { id: 'ce-view', kind: 'shape-view', title: 'Figure', x: 64, y: 64, w: 1300, h: 1240 },
  { id: 'ce-controls', kind: 'shape-controls', title: 'Figure Controls', x: 1400, y: 64, w: 820, h: 1900 },
  { id: 'ce-sound', kind: 'sound-controls', title: 'Sound Controls', x: 2256, y: 64, w: 560, h: 900 },
  { id: 'ce-rack', kind: 'shape-rack', title: 'Drum Rack', x: 64, y: 1340, w: 1300, h: 624 },
]

/** See WindowTier. */
export const WINDOW_TIER: Record<WindowKind, WindowTier> = {
  'shape-view': 'software',
  'shape-controls': 'hardware',
  'shape-rack': 'hardware',
  'sound-controls': 'hardware',
}

export const WINDOW_LIMITS: Record<WindowKind, WindowLimits> = {
  'shape-view': { minW: 600, minH: 600, maxW: 2400, maxH: 2400 },
  'shape-controls': { minW: 500, minH: 600, maxW: 1600, maxH: 2400 },
  'shape-rack': { minW: 600, minH: 400, maxW: 2400, maxH: 1600 },
  'sound-controls': { minW: 400, minH: 400, maxW: 1200, maxH: 2400 },
}
