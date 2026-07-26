/**
 * Sound Intent — the "what does the sound sound like" module, parallel to
 * Rhythmic Intent's "when does it happen". Five continuous Sound Dimensions
 * form one shared Semantic State that will drive BOTH the Ableton sound
 * parameters and the Sound Visual canvas. In this first pass the dimensions are
 * UI only — the concrete Ableton mapping comes later.
 */

/** One continuous sound dimension, 0..100. Ids are stable; labels are
    provisional placeholders until the sonic mapping is decided. */
export type SoundDimensionId = 'd1' | 'd2' | 'd3' | 'd4' | 'd5'

export type SoundParams = Record<SoundDimensionId, number>

/** `macroName`, when set, is the exact name of an Ableton Instrument Rack
    macro this dimension drives — the bridge finds whichever device parameter
    on the selected track is actually labelled this (not a hardcoded slot), so
    moving the slider turns that macro knob in Live regardless of macro count,
    order, or which device the rack is. */
export type SoundDimension = { id: SoundDimensionId; label: string; macroName?: string }

/** The five dimensions, in display order. Renamed once each is mapped to a
    real sound behaviour. `d1` is the first mapped one: it drives the rack's
    "Energy" macro and also sizes the Sound Visual's tap blots. */
export const SOUND_DIMENSIONS: SoundDimension[] = [
  { id: 'd1', label: 'ENERGY', macroName: 'Energy' },
  { id: 'd2', label: 'DIMENSION 2' },
  { id: 'd3', label: 'DIMENSION 3' },
  { id: 'd4', label: 'DIMENSION 4' },
  { id: 'd5', label: 'DIMENSION 5' },
]

export const SOUND_MIN = 0
export const SOUND_MAX = 100

export const DEFAULT_SOUND_PARAMS: SoundParams = {
  d1: 50,
  d2: 50,
  d3: 50,
  d4: 50,
  d5: 50,
}
