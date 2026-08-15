/**
 * Sound character — the second level of the Selector.
 *
 * Level one is identity: WHICH of the four sounds this is, chosen in the grid
 * and never edited. Level two is character: what that sound is currently LIKE,
 * one continuous 0..1 axis per identity, edited in the panel underneath.
 *
 * One axis each, deliberately. The value of a prototype like this comes from
 * finding out whether a single number per sound is enough to carry perceptual
 * character through a recording — which it can only answer if there is exactly
 * one number to follow.
 *
 * SPLASH has no axis at all (the spec's `characterValue: null`): an accent that
 * is always the same accent is a useful control, because it gives the other
 * three something fixed to be measured against.
 */

import type { SoundVoiceId } from '../transport/engine.ts'

/** What one sound's character axis is, or null for a sound that has none. */
export type CharacterAxis = {
  /** Slider ends, low (0) then high (1). Shown verbatim in the panel. */
  ends: [string, string]
  /** Where the axis rests before anyone touches it. */
  initial: number
}

export const CHARACTER: Record<SoundVoiceId, CharacterAxis | null> = {
  // HIT's axis IS the existing Energy parameter, relabelled. Nothing new is
  // synthesized for it: soft/hard drives the same loudness-and-brightness that
  // ENERGY has always driven, which is exactly what hitting something harder
  // does. See `resolveSoundVoice` in kit.ts.
  hit: { ends: ['SOFT', 'HARD'], initial: 0.55 },
  // Rounded hat → crisp hat, as one continuous move rather than two samples.
  // Sonically it is the closed end of a hat travelling to the open end: the
  // decay lengthens, the band darkens and a metallic wash rises underneath —
  // an open hat is what "crisp" (all transient, ringing on) actually is.
  // Visually the ring widens and breaks from a solid contour into separate
  // marks — round becoming granular is the same idea seen instead of heard.
  tick: { ends: ['ROUNDED', 'CRISPY'], initial: 0.75 },
  // No axis in v0.3 — see the note above.
  splash: null,
  // Thin high noise → full wide noise. Still noise at every point of the
  // travel: the band moves and widens, nothing pitched is ever introduced.
  scatter: { ends: ['AIRY', 'DENSE'], initial: 0.45 },
}

/** Every identity's starting character, and the shape the session holds. */
export type CharacterState = Record<SoundVoiceId, number>

export const DEFAULT_CHARACTER: CharacterState = {
  hit: CHARACTER.hit?.initial ?? 0.5,
  tick: CHARACTER.tick?.initial ?? 0.5,
  splash: 0.5,
  scatter: CHARACTER.scatter?.initial ?? 0.5,
}

/**
 * The character an event fired right now would carry — `null` for an identity
 * with no axis, which is what gets recorded for a SPLASH.
 */
export function characterOf(id: SoundVoiceId, state: CharacterState): number | null {
  return CHARACTER[id] === null ? null : state[id]
}

/** What the Selector icons are drawn at. Fixed on purpose: the icon answers
    "which sound is this", and an icon that moved with the slider would be
    answering the panel's question instead. */
export const IDENTITY_CHARACTER = 0.5

/** One line under each panel, saying what the axis actually does to the sound.
    Written per identity rather than generically, because "what moves when you
    move this" is different in kind for each of the four. */
export const CHARACTER_NOTE: Record<SoundVoiceId, string> = {
  hit: 'Soft to hard is how hard the kick is struck — quieter and duller at one end, louder and brighter with a deeper pitch drop at the other. It is the Energy parameter, under the name it deserves.',
  tick: 'Rounded to crispy lengthens the hat and brings a metallic wash up underneath it — the closed end of a hat travelling to the open end. The ring widens as it goes and breaks from one contour into separate marks.',
  splash:
    'Splash is fixed in this version. An accent that is always the same accent gives the other three something to be measured against — its editable character comes later.',
  scatter:
    'Airy to dense moves the noise band down and widens it: thin and high at one end, full and occupied at the other. It stays noise the whole way — nothing pitched is introduced.',
}
