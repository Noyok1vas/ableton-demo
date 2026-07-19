/** One captured tap. `time` is seconds from the first tap of the bar. */
export type Tap = {
  time: number
  /** 0..1. GUI taps are uniform (1.0); a hardware pad will supply real values later. */
  velocity: number
}

export type CaptureState = 'ready' | 'recording' | 'complete'

export type TransformParams = {
  /** 0..100 — 0 preserves raw timing, 100 snaps fully to the 1/16 grid. */
  tightness: number
  /** 0..15 — discrete 1/16-step rotation of the whole pattern. */
  phase: number
  /** 0..100 — 100 keeps every tap; lower values remove taps (never adds). */
  density: number
}

export const DEFAULT_PARAMS: TransformParams = {
  tightness: 45,
  phase: 0,
  density: 100,
}

export const BPM = 120
export const BEATS_PER_BAR = 4
export const BAR_DURATION = (BEATS_PER_BAR * 60) / BPM // seconds
export const GRID_DIVISIONS = 16 // 1/16-note grid

/** One captured bar stored in the Collection. Holds the raw taps — the
    current knob settings are applied whenever the entry is (re)loaded. */
export type CollectionEntry = {
  id: string
  taps: readonly Tap[]
}

/** A tap prepared for rendering, with every transform stage resolved. */
export type RenderedTap = {
  index: number
  /** Raw normalized position in the bar, 0..1. */
  rawPos: number
  /** Position after phase rotation but before tightness — start of the displacement hint. */
  loosePos: number
  /** Final position after tightness + phase, 0..1. */
  finalPos: number
  velocity: number
  /** False when removed by the density control. */
  kept: boolean
}
