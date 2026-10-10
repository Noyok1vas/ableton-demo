/**
 * Rhythm extraction — what goes in, what comes out.
 *
 * The goal is NOT to recover the song or its sounds. It is to find the
 * rhythmic skeleton under a short piece of music — where the kick, snare, hats,
 * toms and cymbals land on a 1/16 grid — so it can be played on this
 * instrument's own kit and then edited. Everything below is phrased in steps
 * and beats rather than in audio, which is what lets the result drop straight
 * onto the ring.
 */

import type { SoundVoiceId } from '../transport/engine.ts'

/** The five drum categories the first prototype listens for. */
export type DrumType = 'kick' | 'snare' | 'hihat' | 'tom' | 'cymbal'

export const DRUM_TYPES: readonly DrumType[] = ['kick', 'snare', 'hihat', 'tom', 'cymbal']

export const DRUM_LABEL: Record<DrumType, string> = {
  kick: 'KICK',
  snare: 'SNARE',
  hihat: 'HI-HAT',
  tom: 'TOM',
  cymbal: 'CYMBAL',
}

/** Which of the instrument's own eight sounds plays each category. The point
    is the substitution: the song's kick becomes OUR kick. */
export const DRUM_TO_VOICE: Record<DrumType, SoundVoiceId> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hat',
  tom: 'tom',
  cymbal: 'ride',
}

/** Mono audio, as the analysis reads it. */
export type MonoClip = { samples: Float32Array; sampleRate: number }

/** One hit as it was heard, before folding into the loop. */
export type DetectedHit = {
  drum: DrumType
  /** Seconds from the start of the analysed selection. */
  time: number
  /** Sixteenth-note index counted from the first downbeat; may be negative
      for a pickup before it. */
  absStep: number
  /** How far the hit sat from that grid line, in steps (-0.5..0.5). */
  offset: number
  /** 0..1, relative to the strongest hit of the same category. */
  strength: number
  /** 0..1 — how sure the classifier was that this is that drum. */
  confidence: number
  /** Hi-hat only: how long the metal rang, which tells closed from open. */
  open?: boolean
}

/** One step of the extracted pattern: what the sequencer will hold. */
export type PatternHit = {
  drum: DrumType
  /** 0..steps-1 across the loop. */
  step: number
  /** Musical address of the step, all from 1: bar, beat in bar, sixteenth in beat. */
  bar: number
  beat: number
  sixteenth: number
  /** "bar.beat.sixteenth", as a drum machine prints it. */
  position: string
  /** 0..1. */
  velocity: number
  /** 0..1 — detection confidence times how consistently the hit recurs on this
      step in every repeat of the loop the clip covered. */
  confidence: number
  open?: boolean
}

export type ExtractionResult = {
  /** Detected tempo, unrounded — the backing clip is cut at exactly this. */
  bpm: number
  /** 0..1 — how clearly one tempo stood out over the others. */
  tempoConfidence: number
  meter: { beats: 4; unit: 4 }
  /** Bars in the loop, and its 1/16 steps. */
  bars: number
  steps: number
  /** Seconds into the selection at which the first downbeat falls. */
  downbeat: number
  /** How many whole loops of the clip the pattern was voted across. */
  loopsAnalysed: number
  /** The skeleton: what the sequencer is given. */
  pattern: PatternHit[]
  /** Every hit heard, before voting — kept for inspection. */
  hits: DetectedHit[]
  /** How the drums were taken out of the mix: harmonic/percussive separation
      of the spectrogram. */
  separation: 'hpss'
  /** Milliseconds the analysis took. */
  elapsedMs: number
}

/**
 * Anything that can turn audio into a rhythm. The prototype ships one
 * implementation — signal processing and a small trained classifier, in a
 * worker in this page (analyze.ts) — and keeps the seam so a heavier one (a
 * source-separation network plus a drum transcription model on a server, say)
 * can be dropped in without the UI noticing.
 */
export interface RhythmExtractor {
  /** `bpm` skips tempo estimation and fits the grid around that tempo — the
      HALF / DOUBLE correction. */
  extract(clip: MonoClip, options: { bars: number; bpm?: number }): Promise<ExtractionResult>
}
