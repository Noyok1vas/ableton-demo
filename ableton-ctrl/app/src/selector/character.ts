/**
 * Sound character — the second level of the Selector.
 *
 * Level one is identity: WHICH of the eight sounds this is, chosen on the pads
 * and never edited. Level two is character: what that sound is currently LIKE,
 * one continuous 0..1 axis per identity, edited on the character mod strip.
 *
 * One axis each, deliberately. The value of a prototype like this comes from
 * finding out whether a single number per sound is enough to carry perceptual
 * character through a recording — which it can only answer if there is exactly
 * one number to follow.
 *
 * Every axis is one move made twice: once in the sound (kit.ts) and once in
 * the mark (patterns.ts), each picturing the other — a tom tuned up is a
 * hollower drum, an opening hat is a ring letting go of its energy. RIM has no
 * axis at all: a click that is always the same click gives the other seven
 * something fixed to be measured against.
 */

import type { SoundVoiceId } from '../transport/engine.ts'

/** What one sound's character axis is, or null for a sound that has none. */
export type CharacterAxis = {
  /** Axis ends, low (0) then high (1). */
  ends: [string, string]
  /** Where the axis rests before anyone touches it. */
  initial: number
}

export const CHARACTER: Record<SoundVoiceId, CharacterAxis | null> = {
  // KICK's axis IS the existing Energy parameter, relabelled: soft/hard drives
  // the same loudness-and-brightness that ENERGY has always driven, which is
  // exactly what striking something heavier does. The mass gathers and its
  // edge firms up as it hardens. See `resolveSoundVoice` in kit.ts.
  kick: { ends: ['SOFT', 'HARD'], initial: 0.55 },
  // Tuned up, a drum is a smaller, tighter shell: struck solid wall to struck
  // hollow wall. The disc empties from the centre as the pitch rises.
  tom: { ends: ['LOW', 'HIGH'], initial: 0.4 },
  // The 909's SNAPPY knob: how much rattle rides on the head. At BODY the
  // snares are off and the drum is all shell — it closes in on the tom; at
  // SNAPPY the grains around the head swell and the noise takes over.
  snare: { ends: ['BODY', 'SNAPPY'], initial: 0.6 },
  // Fixed: a click is a click.
  rim: null,
  // How much of the hands meets: a thin, light, bright clap at one end, a
  // thick, full one at the other. The shells either side thicken with it.
  clap: { ends: ['BRIGHT', 'FULL'], initial: 0.6 },
  // Closed to open, one continuous move: the decay lengthens and the metal
  // starts to ring. The ring of marks grows outward into rays — contained,
  // then released.
  hat: { ends: ['CLOSED', 'OPEN'], initial: 0.2 },
  // The ride's tune: the metal plays higher and a little shorter. Its body
  // hollows the way the tom's does; the trace of the strike stays.
  ride: { ends: ['LOW', 'HIGH'], initial: 0.4 },
  // From a plain tom-like resonator to a metallic, electronic one — see
  // `fxModes` below, which both the sound and the mark are built from.
  fx: { ends: ['DRUM', 'ELECTRIC'], initial: 0.25 },
}

/** Every identity's starting character, and the shape the session holds. */
export type CharacterState = Record<SoundVoiceId, number>

export const DEFAULT_CHARACTER = Object.fromEntries(
  (Object.keys(CHARACTER) as SoundVoiceId[]).map((id) => [id, CHARACTER[id]?.initial ?? 0.5]),
) as CharacterState

/**
 * The character an event fired right now would carry — `null` for an identity
 * with no axis, which is what gets recorded for a RIM.
 */
export function characterOf(id: SoundVoiceId, state: CharacterState): number | null {
  return CHARACTER[id] === null ? null : state[id]
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * FX's two vibration modes, each 0..1, at character `c`.
 *
 * FX is a resonator acquiring vibration modes, so its axis is two of them
 * rather than one amount. `ripple` is a fine, fast mode that arrives first and
 * goes again; `lobes` is a coarse, slow one that arrives late and grows to the
 * end. The mark draws them as ripples and as lobes on its ring; the sound
 * plays them as two frequency modulators — a high ratio at low depth (a fine
 * shimmer), then a low inharmonic ratio at high depth (the clang). Reading both
 * from here is what makes the shape and the timbre the same change.
 */
export function fxModes(c: number): { ripple: number; lobes: number } {
  const x = Math.min(1, Math.max(0, c))
  return {
    ripple: Math.pow(Math.sin(Math.PI * Math.min(1, x / 0.72)), 1.2),
    lobes: Math.pow(smoothstep(0.3, 1, x), 1.2),
  }
}

/** One line under each panel, saying what the axis actually does to the sound.
    Written per identity rather than generically, because "what moves when you
    move this" is different in kind for each of the eight. */
export const CHARACTER_NOTE: Record<SoundVoiceId, string> = {
  kick: 'Soft to hard is how hard the kick is struck — quieter and duller at one end, louder and brighter with a deeper pitch drop at the other. The mass gathers and its edge firms up as it hardens.',
  tom: 'Low to high is the tom\'s tune, from floor tom to rack tom, and a higher drum is a shorter one. The drum empties from the centre as it rises: a struck solid wall becomes a struck hollow one.',
  snare:
    'Body to snappy is how much rattle rides on the head. At body the snares are off and it closes in on the tom; toward snappy the grains around the head swell as the noise takes over.',
  rim: 'Rim is fixed: one short, hard click with almost no body — all of it at one point.',
  clap: 'Bright to full is how much of the hands meets: a thin, crisp clap at one end, a thick, solid one at the other. The shells either side thicken with it.',
  hat: 'Closed to open lengthens the hat and lets the metal ring. The ring of marks grows out into rays as it opens — contained, then released.',
  ride: 'Low to high is the ride\'s tune: the metal sounds higher and a little shorter. The body hollows as it rises; the trace of the strike stays, because the ringing does.',
  fx: 'Drum to electric adds vibration modes to a plain resonator — a fine shimmer first, then a metallic clang. The ring ripples, then breaks into lobes, as the timbre turns.',
}
