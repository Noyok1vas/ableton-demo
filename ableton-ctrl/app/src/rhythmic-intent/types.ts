/** One captured tap. `time` is seconds from the first tap of the loop. `id` is
    stable for the life of the tap: it is what a later edit (the Sound Visual's
    UNDO, a double-click on a mark) names, and what the Sound Visual keys its
    own per-tap snapshot on, so both survive the pattern being re-transformed. */
export type Tap = {
  id: string
  time: number
  /** 0..1. GUI taps are uniform (1.0); a hardware pad will supply real values later. */
  velocity: number
}

export type CaptureState = 'ready' | 'recording' | 'complete'

export type TransformParams = {
  /** 0..100 — 0 preserves raw timing, 100 snaps fully to the 1/16 grid. */
  tightness: number
  /** 0..GRID_DIVISIONS-1 — discrete 1/16-step rotation of the whole pattern. */
  phase: number
  /** 0..100 — 100 keeps every tap; lower values remove taps (never adds). */
  density: number
}

export const DEFAULT_PARAMS: TransformParams = {
  tightness: 45,
  phase: 0,
  density: 100,
}

export const BEATS_PER_BAR = 4
/** The capture/loop unit spans two bars, so a tapped phrase has room to
    develop instead of repeating every four beats. */
export const BARS_PER_LOOP = 2
export const BEATS_PER_LOOP = BEATS_PER_BAR * BARS_PER_LOOP // 8
/** Seconds the loop takes at `bpm`. Tempo lives with the transport (the Sound
    Source window types it), so the length is derived per render rather than
    frozen into a constant — and a tap's `time`, which is in seconds, is
    re-timed with it so the pattern keeps its shape when the tempo moves. */
export const loopDurationFor = (bpm: number) => (BEATS_PER_LOOP * 60) / bpm
export const GRID_DIVISIONS = 16 * BARS_PER_LOOP // 1/16-note grid across the loop

/** MIDI note every tap/loop hit plays on. Adjustable via the PITCH pad so
    the mapping isn't nailed to one key. Constrained to the 16 notes of a
    standard Ableton Drum Rack's 4×4 pad grid (C1..D#2), selected bottom-left
    first like the rack itself. */
export const PAD_BASE_PITCH = 36 // C1 — bottom-left pad
export const PAD_GRID_SIZE = 4
export const DEFAULT_PITCH = PAD_BASE_PITCH

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Render a MIDI pitch as a note name using Ableton's octave convention
    (note 60 → "C3"). */
export function noteName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 2
  return `${NOTE_NAMES[pitch % 12]}${octave}`
}

/** One captured loop stored in the Collection. Holds the raw taps — the
    current knob settings are applied whenever the entry is (re)loaded. */
export type CollectionEntry = {
  id: string
  taps: readonly Tap[]
}

/** A tap prepared for rendering, with every transform stage resolved. */
export type RenderedTap = {
  id: string
  index: number
  /** Raw normalized position in the loop, 0..1. */
  rawPos: number
  /** Position after phase rotation but before tightness — start of the displacement hint. */
  loosePos: number
  /** Final position after tightness + phase, 0..1. */
  finalPos: number
  velocity: number
  /** False when removed by the density control. */
  kept: boolean
}
