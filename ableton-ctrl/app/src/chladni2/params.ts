/**
 * Chladni 2's parameters — the eight sounds with the knobs a 909 panel and
 * Ableton's Drum Synths (DS Kick, DS Tom, DS Snare, DS Clap, DS HH, DS Cymbal,
 * DS FM) give them, two to five each, in place of Chladni 1's one character.
 *
 * Every parameter belongs to one of ten CHANNELS: audio features every drum
 * shares, each drawn the same way on every sound (see glyphs.ts). A TUNE is
 * channel 1 whether it is on the kick or the hat, so learning what channel 1
 * looks like once is enough to read it everywhere. A parameter lists more than
 * one channel when it moves more than one feature at once (CLAP's TAIL is
 * both noise and decay).
 *
 * Values are 0..1 for a slider, or a step index for a choice (`steps`). The
 * `initial` of each is where the 909's classic sound sits, so the figure a
 * sound opens with is its most representative one.
 */

import type { DrumParams, SoundVoiceId } from '../transport/engine.ts'

export type ChannelId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type DrumParamDef = {
  id: string
  label: string
  /** Empty for a parameter only one sound has, drawn its own way (FX's FM). */
  channels: readonly ChannelId[]
  initial: number
  /** A discrete choice: the value is the index into these labels. */
  steps?: readonly string[]
}

export const DRUM_PARAMS: Record<SoundVoiceId, readonly DrumParamDef[]> = {
  // 909 BD: Tune / Attack / Decay. DS Kick: Pitch / Env / Attack / Click /
  // Drive / Decay. TUNE stays low by default, where the head is a clean
  // (0,1): one circle and the beater's mark.
  kick: [
    { id: 'tune', label: 'TUNE', channels: [1], initial: 0.1 },
    { id: 'sweep', label: 'SWEEP', channels: [5], initial: 0.35 },
    { id: 'click', label: 'CLICK', channels: [6], initial: 0.5 },
    { id: 'decay', label: 'DECAY', channels: [4], initial: 0.45 },
    { id: 'drive', label: 'DRIVE', channels: [7], initial: 0.25 },
  ],
  // 909 Tom: Tune / Decay. DS Tom: Pitch / Bend / Tone / Decay.
  tom: [
    { id: 'tune', label: 'TUNE', channels: [1], initial: 0.5 },
    { id: 'bend', label: 'BEND', channels: [5], initial: 0.25 },
    { id: 'tone', label: 'TONE', channels: [2], initial: 0.35 },
    { id: 'decay', label: 'DECAY', channels: [4], initial: 0.45 },
  ],
  // 909 SD: Tune / Tone / Snappy. DS Snare: Tune / Tone / noise filter
  // LP-BP-HP / Decay.
  snare: [
    { id: 'tune', label: 'TUNE', channels: [1], initial: 0.5 },
    { id: 'tone', label: 'TONE', channels: [2], initial: 0.45 },
    { id: 'snappy', label: 'SNAPPY', channels: [3], initial: 0.5 },
    { id: 'decay', label: 'DECAY', channels: [4], initial: 0.4 },
    { id: 'filter', label: 'FILTER', channels: [3], initial: 1, steps: ['LP', 'BP', 'HP'] },
  ],
  // 909 RS has only a level; DS Clang's clave mode is the nearest: Pitch /
  // Decay, the decay kept very short.
  rim: [
    { id: 'tune', label: 'TUNE', channels: [1], initial: 0.5 },
    { id: 'decay', label: 'DECAY', channels: [4], initial: 0.3 },
  ],
  // 909 CP has only a level. DS Clap: Sloppy / Tail / Spread / Tone.
  clap: [
    { id: 'tone', label: 'TONE', channels: [2], initial: 0.5 },
    { id: 'sloppy', label: 'SLOPPY', channels: [8], initial: 0.35 },
    { id: 'tail', label: 'TAIL', channels: [3, 4], initial: 0.4 },
    { id: 'spread', label: 'SPREAD', channels: [9], initial: 0.2 },
  ],
  // 909 CH/OH decays. DS HH: Pitch / Tone / Decay. One DECAY from closed to
  // open, closed by default.
  hat: [
    { id: 'tune', label: 'TUNE', channels: [1], initial: 0.5 },
    { id: 'tone', label: 'TONE', channels: [2], initial: 0.55 },
    { id: 'decay', label: 'DECAY', channels: [4], initial: 0.12 },
  ],
  // 909 Ride: Tune. DS Cymbal: Pitch / Tone / Decay, and the bell.
  ride: [
    { id: 'tune', label: 'TUNE', channels: [1], initial: 0.5 },
    { id: 'tone', label: 'TONE', channels: [2], initial: 0.5 },
    { id: 'decay', label: 'DECAY', channels: [4], initial: 0.7 },
    { id: 'bell', label: 'BELL', channels: [6], initial: 0.45 },
  ],
  // DS FM: Pitch / Amount / Mod ratio / Feedback / Decay.
  fx: [
    { id: 'pitch', label: 'PITCH', channels: [1], initial: 0.5 },
    { id: 'amnt', label: 'AMNT', channels: [], initial: 0.4 },
    { id: 'mod', label: 'MOD', channels: [], initial: 1, steps: ['1', '2', '3', '4', '5'] },
    { id: 'feedback', label: 'FEEDB', channels: [3], initial: 0.12 },
    { id: 'decay', label: 'DECAY', channels: [4], initial: 0.45 },
  ],
}

/** What each channel is, for the key and the slider labels. `literal` marks a
    mapping the physics actually gives (or very nearly); the rest are
    metaphors, chosen to read rather than to be true. */
export type ChannelInfo = { id: ChannelId; name: string; figure: string; literal: boolean }

export const CHANNELS: readonly ChannelInfo[] = [
  { id: 1, name: 'PITCH / TUNE', figure: 'Mode order: more nodal lines, a denser figure', literal: true },
  { id: 2, name: 'TONE / COLOR', figure: 'A higher overtone mode drawn faint: finer texture', literal: true },
  { id: 3, name: 'NOISE', figure: 'Sand leaves the lines; at full it is a cloud', literal: true },
  { id: 4, name: 'DECAY', figure: 'Afterglow outside the edge; the tail on the ring', literal: false },
  { id: 5, name: 'PITCH ENV / FM', figure: 'Twist: circles to a spiral, spokes to a vortex', literal: false },
  { id: 6, name: 'CLICK / ATTACK', figure: 'A solid point at the centre; the ride\'s bell is one too', literal: false },
  { id: 7, name: 'DRIVE', figure: 'Ink bleed: thicker, saturated lines', literal: false },
  { id: 8, name: 'REPEATS', figure: 'Ghosting: the figure drawn several times, offset', literal: false },
  { id: 9, name: 'SPREAD', figure: 'Stretched sideways', literal: false },
  { id: 10, name: 'VELOCITY', figure: 'Overall size, the same for every sound', literal: false },
]

/** Every sound's parameters at their 909 position. */
export const DEFAULT_DRUM = Object.fromEntries(
  (Object.keys(DRUM_PARAMS) as SoundVoiceId[]).map((id) => [
    id,
    Object.fromEntries(DRUM_PARAMS[id].map((p) => [p.id, p.initial])),
  ]),
) as Record<SoundVoiceId, DrumParams>

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** One parameter of a snapshot, clamped to its range — the initial value when
    the snapshot has none (an older tap, a hand-edited save). */
export function drumValue(id: SoundVoiceId, key: string, params: DrumParams | undefined): number {
  const def = DRUM_PARAMS[id].find((p) => p.id === key)
  if (!def) return 0
  const raw = params?.[key]
  const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : def.initial
  return def.steps ? Math.round(clamp(v, 0, def.steps.length - 1)) : clamp(v, 0, 1)
}

/** A snapshot with every parameter of `id` present and in range. */
export function completeDrum(id: SoundVoiceId, params: DrumParams | undefined): DrumParams {
  return Object.fromEntries(DRUM_PARAMS[id].map((p) => [p.id, drumValue(id, p.id, params)]))
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * A continuous mode order `p` as two neighbouring integer modes and the share
 * of the upper one. The hand-over happens in the middle of each step, with a
 * short rest on each pure mode either side — so a slider is continuous, and
 * still lands on a clean figure across a stretch of its travel.
 *
 * The sound uses the same split where it has modes of its own (RIM's bar),
 * which is what keeps the stripes and the partials the same change.
 */
export function orderSplit(p: number): { lo: number; f: number } {
  const lo = Math.floor(p)
  return { lo, f: smoothstep(0.2, 0.8, p - lo) }
}
