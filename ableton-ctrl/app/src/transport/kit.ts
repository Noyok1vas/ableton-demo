/**
 * The built-in kit: 16 synthesized percussion voices, one per pad of the
 * PitchPad's 4×4 grid (MIDI 36..51, the same range an Ableton Drum Rack maps).
 *
 * Synthesized rather than sampled, for three reasons: the app ships no audio
 * files and stays the same size, every voice answers to ENERGY and LENGTH as a
 * *parameter* rather than as an effect bolted onto a finished sample, and the
 * timbres can be retuned by editing numbers here.
 *
 * Each voice is scheduled at an absolute AudioContext time so the loop can be
 * queued ahead of the clock — see webAudioEngine's scheduler.
 */

import type { DrumParams, MarchVoiceId, SoundVoiceId } from './engine.ts'
import { fxModes, snareModes } from '../selector/character.ts'
import { drumValue, orderSplit } from '../chladni2/params.ts'

/** One pad, as a recipe rather than a sound file. `decay` is the voice's
    natural length in seconds at LENGTH's midpoint; LENGTH scales it.

    The fields marked "Chladni 2" are only ever set by `resolveDrumVoice`, for
    the knobs that page adds; absent, every voice is exactly what it was. */
export type Voice = { label: string } & (
  // Chladni 2: `click` 0..1 is the attack's level (absent, ENERGY sets it) and
  // `saturation` the drive curve's amount (absent, the 909's own).
  | { kind: 'kick'; freq: number; snap: number; decay: number; click?: number; saturation?: number }
  // `sweep` is how far above its note the drum starts: a tom's 1.9 when absent,
  // a kick's 4 or so at the floor of TOM's range, where it is tuned into one.
  // Chladni 2: `kickBlend` pins how kick-like the drum is instead of reading it
  // off the sweep (so BEND can bend without turning the tom into a kick), and
  // `skin` 0..1 is the stick-on-head noise, dark and quiet to bright and loud.
  | {
      kind: 'tom'
      freq: number
      decay: number
      sweep?: number
      kickBlend?: number
      skin?: number
    }
  // `thump` 0..1 hands the tuned shell over to a slack head's thud — the kick's
  // body — which is all that is left at the bottom of SNAPPY.
  // Chladni 2: the rattle through one filter of DS Snare's three, at `noiseTone` Hz.
  | {
      kind: 'snare'
      tone: number
      noiseMix: number
      decay: number
      thump?: number
      noiseFilter?: 'lp' | 'bp' | 'hp'
      noiseTone?: number
    }
  // `band` and `q` place the clap's one band: lower and wider is a fuller clap,
  // higher and narrower a brighter one. Absent, they are the 909's own.
  // Chladni 2: `spacing` is the seconds between the bursts (SLOPPY), `tail`
  // the tail's level against the 909's, `spread` how far the bursts pan apart.
  | {
      kind: 'clap'
      decay: number
      band?: number
      q?: number
      spacing?: number
      tail?: number
      spread?: number
    }
  // `ring` 0..1 brings up the narrow metallic band an OPEN hat sustains — the
  // part that is not simply a longer closed hat. Chladni 2: `rate` replays the
  // metal faster or slower (TUNE).
  | { kind: 'hat'; cutoff: number; decay: number; ring?: number; rate?: number }
  // `tune` replays the metal faster or slower, as the 909's TUNE re-pitches its
  // cymbal samples: everything in it moves, and it shortens as it rises.
  // Chladni 2: `bell` 0..1 sets the ping directly instead of from the cutoff.
  | { kind: 'cymbal'; cutoff: number; decay: number; tune?: number; bell?: number }
  // Chladni 2: `modes` replaces the three fixed resonators with these
  // [Hz, share] pairs — the free bar's own partials.
  | { kind: 'rim'; decay: number; modes?: readonly (readonly [number, number])[] }
  | { kind: 'bell'; freqs: [number, number]; decay: number }
  | { kind: 'block'; freq: number; decay: number }
  | { kind: 'shaker'; decay: number }
  // A tom-like resonator under two frequency modulators: `ripple` and `lobes`
  // (0..1) are the depths of a fine, high one and a deep, inharmonic one — the
  // two modes of fxModes() in character.ts. Chladni 2: one modulator instead,
  // at integer `ratio` and peak `index`, and `noise` 0..1 of noise FM standing
  // in for DS FM's feedback.
  | {
      kind: 'fm'
      freq: number
      decay: number
      ripple: number
      lobes: number
      ratio?: number
      index?: number
      noise?: number
    }
)

/** Lowest pad — C1, bottom-left of the grid, matching PAD_BASE_PITCH. */
export const KIT_BASE_PITCH = 36

/** Pads in MIDI order, so the grid reads bottom-left first exactly as the
    PitchPad draws it: each row of four is a family, rows get brighter going
    up. Rough General MIDI neighbourhood, so the layout feels familiar. */
export const KIT: Voice[] = [
  // Row 1 — the backbone.
  { label: 'KICK', kind: 'kick', freq: 52, snap: 3.4, decay: 0.42 },
  { label: 'RIM', kind: 'rim', decay: 0.07 },
  { label: 'SNARE', kind: 'snare', tone: 185, noiseMix: 0.72, decay: 0.21 },
  { label: 'CLAP', kind: 'clap', decay: 0.28 },
  // Row 2 — second voices and the closed hat.
  { label: 'SNARE HI', kind: 'snare', tone: 245, noiseMix: 0.82, decay: 0.15 },
  { label: 'TOM LO', kind: 'tom', freq: 92, decay: 0.36 },
  { label: 'HAT', kind: 'hat', cutoff: 7800, decay: 0.055 },
  { label: 'TOM MID', kind: 'tom', freq: 128, decay: 0.3 },
  // Row 3 — the open end of the hat, higher toms, metal.
  { label: 'HAT PEDAL', kind: 'hat', cutoff: 6200, decay: 0.09 },
  { label: 'TOM HI', kind: 'tom', freq: 176, decay: 0.26 },
  { label: 'HAT OPEN', kind: 'hat', cutoff: 8600, decay: 0.42 },
  { label: 'COWBELL', kind: 'bell', freqs: [538, 802], decay: 0.32 },
  // Row 4 — colour.
  { label: 'BLOCK', kind: 'block', freq: 1180, decay: 0.06 },
  { label: 'CRASH', kind: 'cymbal', cutoff: 5200, decay: 1.35 },
  { label: 'SHAKER', kind: 'shaker', decay: 0.11 },
  { label: 'RIDE', kind: 'cymbal', cutoff: 9200, decay: 0.85 },
]

/**
 * The March instrument: three fixed percussion voices, separate from the 16
 * pads above.
 *
 * Separate because they are not selectable. The pads are an instrument the
 * performer plays; these three are parts of one machine, and the March module
 * addresses them by role — body, definition, motion — never by pad. Each hit's
 * colour is fixed here too: v0.2 has no velocity, so what balances the three
 * voices against each other is these numbers and nothing else.
 */
export type MarchVoiceSpec = { voice: Voice } & HitParams

export const MARCH_KIT: Record<MarchVoiceId, MarchVoiceSpec> = {
  // A short filtered tom: body, and the larger accents.
  low: {
    voice: { label: 'LOW PERC', kind: 'tom', freq: 104, decay: 0.3 },
    velocity: 0.95,
    energy: 0.4,
    lengthScale: 0.85,
  },
  // A rim/click: syncopation and definition against the Low.
  high: {
    voice: { label: 'HIGH PERC', kind: 'rim', decay: 0.075 },
    velocity: 0.72,
    energy: 0.62,
    lengthScale: 1,
  },
  // A dry shaker: the small subdivisions, continuity, forward motion.
  tick: {
    voice: { label: 'TICK', kind: 'shaker', decay: 0.08 },
    velocity: 0.46,
    energy: 0.5,
    lengthScale: 0.8,
  },
}

/**
 * The eight sound identities of the Selector: what KICK, TOM, SNARE, RIM,
 * CLAP, HAT, RIDE and FX actually sound like.
 *
 * Their own kit rather than eight of the 16 pads, for the same reason March
 * has one: the pads are an instrument the performer chooses from, while these
 * are fixed roles in one composition, each tuned to sit against the other
 * seven rather than to be a good general-purpose drum. They are still coloured
 * live by ENERGY and LENGTH, which is what separates them from March's fixed
 * voices: these ARE the instrument Sound Intent shapes.
 *
 * `level` trims one identity against the others *before* ENERGY and velocity;
 * the per-kind TRIM below still applies on top, since these use the same
 * synthesis the pads do.
 */
export type SoundVoiceSpec = { voice: Voice; level: number }

export const SOUND_TYPE_KIT: Record<SoundVoiceId, SoundVoiceSpec> = {
  // The 909 bass drum: low, solid, struck. The deep pitch drop is the punch and
  // the held body is the weight. This is the composition's rhythmic weight, so
  // it carries full level.
  kick: {
    voice: { label: 'KICK', kind: 'kick', freq: 50, snap: 3.8, decay: 0.5 },
    level: 1,
  },
  // A tom whose character is its tune — low floor tom to high rack tom.
  tom: {
    voice: { label: 'TOM', kind: 'tom', freq: 118, decay: 0.32 },
    level: 0.92,
  },
  // A snare: a tuned body under the rattle of the snares, which SNAPPY sets.
  snare: {
    voice: { label: 'SNARE', kind: 'snare', tone: 190, noiseMix: 0.72, decay: 0.24 },
    level: 0.9,
  },
  // A rimshot click: short, dry, cutting.
  rim: {
    voice: { label: 'RIM', kind: 'rim', decay: 0.07 },
    level: 0.8,
  },
  // The 909 hand clap: sharp, immediate and — because it is four fast bursts
  // and a tail rather than one envelope — expressive in a way a drum hit is
  // not. Loud enough to read as an accent, short enough not to become a second
  // backbone.
  clap: {
    voice: { label: 'CLAP', kind: 'clap', decay: 0.22 },
    level: 0.92,
  },
  // A hi-hat: short, high, and the light event against the kick's weight.
  hat: {
    voice: { label: 'HAT', kind: 'hat', cutoff: 8400, decay: 0.042 },
    level: 0.78,
  },
  // A ride: metal with a ping riding on its wash, left to ring.
  ride: {
    voice: { label: 'RIDE', kind: 'cymbal', cutoff: 8600, decay: 1.3 },
    level: 0.62,
  },
  // FX: a tom that frequency modulation turns metallic.
  fx: {
    voice: { label: 'FX', kind: 'fm', freq: 150, decay: 0.38, ripple: 0, lobes: 0 },
    level: 0.85,
  },
}

// ── Character → the voice that actually sounds ────────────────────────────
// One 0..1 axis per identity, resolved here rather than at the call site so
// that every path to a note — a live tap, a queued loop event, an audition on
// the pads — resolves it the same way. The values below ARE the axis: what
// SOFT and HARD mean is these numbers and nothing else. Each axis is drawn by
// the same identity's mark in patterns.ts, which moves the same way.

// KICK: no numbers of its own. SOFT←→HARD is the existing Energy parameter
// under a better name — it drives the same loudness-and-brightness pair that
// hitting something harder drives, which is exactly what `energy` already did.

// TOM: LOW ←→ HIGH. Tune is the tom's whole character; a higher tom is also a
// shorter one, the way a smaller drum is. The floor of the range is tuned
// right down into a kick: a kick's note, a kick's length and — over the
// bottom of the axis — a kick's wide pitch drop, so that is what it sounds
// like, as its mark goes solid. Pitch is spread evenly by ratio, not by Hz,
// so every stretch of the slider is the same musical distance.
const TOM_LOW_FREQ = 52
const TOM_HIGH_FREQ = 196
const TOM_LOW_DECAY = 0.5
const TOM_HIGH_DECAY = 0.22
const TOM_SWEEP = 1.9
const TOM_KICK_SWEEP = 4.2
// Where the kick's drop has fully narrowed into a tom's.
const TOM_KICK_UNTIL = 0.45

// SNARE: BODY ←→ SNAPPY, the 909's SNAPPY knob, as snareModes() shapes it. At
// BODY there is no rattle at all and the head is slack: what sounds is a thud
// with a kick's texture. Moving up, the rattle comes in from the first touch,
// the thud hands over to the tuned 909 shell by halfway, and at SNAPPY the
// rattle takes over and rings on a little past the shell.
const SNARE_SNAPPY_NOISE = 0.86
const SNARE_BODY_DECAY = 0.2
const SNARE_SNAPPY_DECAY = 0.3
const SNARE_BODY_TONE = 200
const SNARE_SNAPPY_TONE = 185
// The middle of the axis, where the shell and the rattle share the hit, peaks
// lower than either end, so it is lifted by up to this much to sit level.
const SNARE_MID_LIFT = 0.28

// CLAP: BRIGHT ←→ FULL. The band walks DOWN and WIDENS and the tail lengthens:
// a thin, crisp clap becomes a thick one with body — the shells of its mark
// thicken with it.
const CLAP_BRIGHT_BAND = 2100
const CLAP_FULL_BAND = 900
const CLAP_BRIGHT_Q = 2.4
const CLAP_FULL_Q = 0.8
const CLAP_BRIGHT_DECAY = 0.15
const CLAP_FULL_DECAY = 0.3
// A narrow band passes less of the noise, so the bright end is brought up to
// sit at the same weight.
const CLAP_BRIGHT_TRIM = 1.1

// HAT: CLOSED ←→ OPEN, one continuous move over the same hi-hat. Closed is
// short, dry, damped, gone almost as soon as it starts; open is longer, with
// the metallic band (`ring`) up underneath giving it wash and ring-out.
const HAT_CLOSED_DECAY = 0.03
const HAT_OPEN_DECAY = 0.32
const HAT_CLOSED_CUTOFF = 9900 // all edge, no body
const HAT_OPEN_CUTOFF = 6800 // more body under it
// The open end spreads the same gesture over ten times the time, so it needs
// trimming to sit at the same weight rather than reading as an accent.
const HAT_OPEN_TRIM = 0.84

// RIDE: LOW ←→ HIGH, the 909's cymbal TUNE: the metal replayed slower or
// faster, so it is lower and longer at one end, higher and shorter at the
// other. A slight change, as on the machine — it is still the same ride.
const RIDE_LOW_TUNE = 0.85
const RIDE_HIGH_TUNE = 1.2
const RIDE_LOW_DECAY = 1.45
const RIDE_HIGH_DECAY = 1.05

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** What one identity plus its character comes to: the voice to play, the trim
    to play it at, and — for KICK alone — the energy to play it with, which is
    what that identity's axis controls. */
export type ResolvedVoice = { voice: Voice; level: number; energy?: number }

/**
 * Resolve a sound identity and its recorded character into a voice.
 *
 * `character` is the value the EVENT carries, not the slider's current
 * position — every caller passes what was snapshotted at the moment of input,
 * which is what lets one bar hold a soft kick and a hard one.
 */
export function resolveSoundVoice(id: SoundVoiceId, character?: number): ResolvedVoice {
  const spec = SOUND_TYPE_KIT[id]
  if (character == null) return { voice: spec.voice, level: spec.level }
  const c = Math.min(1, Math.max(0, character))
  const voice = spec.voice

  switch (voice.kind) {
    case 'kick':
      return { voice, level: spec.level, energy: c }

    case 'tom':
      return {
        voice: {
          ...voice,
          freq: TOM_LOW_FREQ * Math.pow(TOM_HIGH_FREQ / TOM_LOW_FREQ, c),
          decay: lerp(TOM_LOW_DECAY, TOM_HIGH_DECAY, c),
          sweep: lerp(TOM_KICK_SWEEP, TOM_SWEEP, smoothstep(0, TOM_KICK_UNTIL, c)),
        },
        level: spec.level,
      }

    case 'snare': {
      const { head, snares } = snareModes(c)
      return {
        voice: {
          ...voice,
          decay: lerp(SNARE_BODY_DECAY, SNARE_SNAPPY_DECAY, c),
          noiseMix: SNARE_SNAPPY_NOISE * snares,
          tone: lerp(SNARE_BODY_TONE, SNARE_SNAPPY_TONE, c),
          thump: 1 - head,
        },
        level: spec.level * (1 + SNARE_MID_LIFT * 4 * c * (1 - c)),
      }
    }

    case 'clap':
      return {
        voice: {
          ...voice,
          band: lerp(CLAP_BRIGHT_BAND, CLAP_FULL_BAND, c),
          q: lerp(CLAP_BRIGHT_Q, CLAP_FULL_Q, c),
          decay: lerp(CLAP_BRIGHT_DECAY, CLAP_FULL_DECAY, c),
        },
        level: spec.level * lerp(CLAP_BRIGHT_TRIM, 1, c),
      }

    case 'hat':
      return {
        voice: {
          ...voice,
          decay: lerp(HAT_CLOSED_DECAY, HAT_OPEN_DECAY, c),
          cutoff: lerp(HAT_CLOSED_CUTOFF, HAT_OPEN_CUTOFF, c),
          // The wash belongs to the open end and is absent when closed.
          ring: c,
        },
        level: spec.level * lerp(1, HAT_OPEN_TRIM, c),
      }

    case 'cymbal':
      return {
        voice: {
          ...voice,
          tune: lerp(RIDE_LOW_TUNE, RIDE_HIGH_TUNE, c),
          decay: lerp(RIDE_LOW_DECAY, RIDE_HIGH_DECAY, c),
        },
        level: spec.level,
      }

    case 'fm':
      return { voice: { ...voice, ...fxModes(c) }, level: spec.level }

    // RIM: fixed by design, character ignored.
    default:
      return { voice, level: spec.level }
  }
}

// ── Chladni 2: the 909 / Drum Synth knobs → the voice ─────────────────────
// The same eight voices, read from several knobs instead of one character.
// Each range is the musical one for that knob on a 909 or a DS device; the
// figure each knob moves is drawn from the same values (chladni2/glyphs.ts).

/** A free-free bar's partials over its first: the β² of its first three
    modes, 4.730² : 7.853² : 10.996². RIM's figure draws these same modes. */
export const BAR_RATIOS = [1, 2.756, 5.404] as const
const RIM_BAR_BASE = 520
const SNARE_BAND_LIFT = 1.4

const expRange = (lo: number, hi: number, u: number) => lo * Math.pow(hi / lo, u)

/**
 * A Chladni 2 tap's knobs, resolved into a voice. Every value is the one the
 * tap carried, so a loop replays each hit as it was played.
 */
export function resolveDrumVoice(id: SoundVoiceId, params: DrumParams): ResolvedVoice {
  const v = (key: string) => drumValue(id, key, params)
  const level = SOUND_TYPE_KIT[id].level
  switch (id) {
    case 'kick':
      return {
        voice: {
          label: 'KICK',
          kind: 'kick',
          freq: expRange(46, 96, v('tune')),
          snap: 0.6 + 6 * v('sweep'),
          decay: expRange(0.16, 1.5, v('decay')),
          click: v('click'),
          saturation: 1 + 6 * v('drive'),
        },
        level,
      }

    case 'tom': {
      const tune = v('tune')
      return {
        voice: {
          label: 'TOM',
          kind: 'tom',
          freq: expRange(70, 260, tune),
          // A higher drum is a shorter one, whatever DECAY says.
          decay: lerp(0.12, 0.8, v('decay')) * lerp(1.15, 0.8, tune),
          sweep: 1 + 1.7 * v('bend'),
          kickBlend: 0,
          skin: v('tone'),
        },
        level,
      }
    }

    case 'snare':
      return {
        voice: {
          label: 'SNARE',
          kind: 'snare',
          tone: expRange(140, 300, v('tune')),
          noiseMix: 0.12 + 0.8 * v('snappy'),
          decay: lerp(0.1, 0.5, v('decay')),
          thump: 0,
          noiseFilter: (['lp', 'bp', 'hp'] as const)[v('filter')],
          noiseTone: expRange(1200, 12000, v('tone')),
        },
        // One filter band passes less of the noise than the 909's two-sided
        // one, so it is lifted to sit with the rest (measured, not taste).
        level: level * SNARE_BAND_LIFT,
      }

    case 'rim': {
      // TUNE walks the strike from the bar's first mode to its third, as the
      // figure's stripes do; the others stay underneath, quieter, as wood.
      const tune = v('tune')
      const { lo, f } = orderSplit(1 + 2 * tune)
      const base = RIM_BAR_BASE * lerp(0.9, 1.15, tune)
      const modes = BAR_RATIOS.map((ratio, k) => {
        const n = k + 1
        const share = n === lo ? 1 - f : n === lo + 1 ? f : 0
        return [base * ratio, 0.18 + 0.6 * share] as const
      })
      return {
        voice: { label: 'RIM', kind: 'rim', decay: lerp(0.025, 0.14, v('decay')), modes },
        level,
      }
    }

    case 'clap': {
      const tone = v('tone')
      const tail = v('tail')
      return {
        voice: {
          label: 'CLAP',
          kind: 'clap',
          band: expRange(750, 2600, tone),
          q: lerp(0.8, 2.2, tone),
          spacing: lerp(0.005, 0.024, v('sloppy')),
          tail: lerp(0.15, 1.1, tail),
          decay: lerp(0.08, 0.55, tail),
          spread: v('spread'),
        },
        level,
      }
    }

    case 'hat': {
      const decay = v('decay')
      return {
        voice: {
          label: 'HAT',
          kind: 'hat',
          cutoff: lerp(5200, 10500, v('tone')),
          decay: expRange(0.026, 0.55, decay),
          ring: smoothstep(0.35, 1, decay),
          rate: expRange(0.7, 1.45, v('tune')),
        },
        level: level * lerp(1, HAT_OPEN_TRIM, decay),
      }
    }

    case 'ride':
      return {
        voice: {
          label: 'RIDE',
          kind: 'cymbal',
          cutoff: lerp(6500, 10000, v('tone')),
          decay: expRange(0.6, 3, v('decay')),
          tune: expRange(0.8, 1.3, v('tune')),
          bell: v('bell'),
        },
        level,
      }

    case 'fx':
      return {
        voice: {
          label: 'FX',
          kind: 'fm',
          freq: expRange(70, 420, v('pitch')),
          decay: lerp(0.08, 1, v('decay')),
          ripple: 0,
          lobes: 0,
          ratio: v('mod') + 1,
          index: 9 * Math.pow(v('amnt'), 1.3),
          noise: v('feedback'),
        },
        level,
      }
  }
}

/** How a single hit is coloured by the live parameters. */
export type HitParams = {
  /** 0..1 from the tap. */
  velocity: number
  /** 0..1 — Sound Intent's ENERGY. Drives loudness and brightness together,
      the way hitting something harder does. */
  energy: number
  /** Multiplier on every voice's decay — Sound Intent's LENGTH. */
  lengthScale: number
}

// One noise buffer per context, shared by every noise-based voice. Two seconds
// covers every voice but a cymbal stretched by LENGTH, and a cymbal loops the
// buffer instead of running off its end (see `noiseSource`'s `loop`).
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

function noise(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx)
  if (cached) return cached
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffers.set(ctx, buffer)
  return buffer
}

/** The 909's own one-shot sounds: a bank of six square waves at inharmonic
    ratios (the 808 cymbal circuit's tuning), summed into one looping buffer
    per context. Played back high-passed it is metal rather than hiss — the
    difference between a 909 hat and a noise burst — and because it is a
    buffer, a hat costs one source rather than six oscillators. Naive squares
    alias, which is wanted here: it is the grit of the 909's 6-bit samples. */
const METAL_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800]
const metalBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

function metalBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = metalBuffers.get(ctx)
  if (cached) return cached
  const rate = ctx.sampleRate
  const buffer = ctx.createBuffer(1, Math.ceil(rate * 2), rate)
  const data = buffer.getChannelData(0)
  const phases = METAL_FREQS.map(() => Math.random())
  for (let i = 0; i < data.length; i++) {
    let sum = 0
    for (let k = 0; k < METAL_FREQS.length; k++) {
      sum += ((METAL_FREQS[k] * i) / rate + phases[k]) % 1 < 0.5 ? 1 : -1
    }
    data[i] = sum / METAL_FREQS.length
  }
  metalBuffers.set(ctx, buffer)
  return buffer
}

/** A soft-clip transfer curve: tanh, normalized so full scale stays full scale.
    The 909 bass drum and toms run their oscillators hot into the mixer, and
    that squared-off sine is a large part of why they sound like a 909. */
function driveCurve(k: number): Float32Array<ArrayBuffer> {
  const samples = 1024
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT))
  const norm = Math.tanh(k)
  for (let i = 0; i < samples; i++) curve[i] = Math.tanh(k * ((i / (samples - 1)) * 2 - 1)) / norm
  return curve
}

// Curves by amount, each built once: a hit picks its curve rather than
// building one of its own.
const driveCurves = new Map<number, Float32Array<ArrayBuffer>>()

function drive(k: number): Float32Array<ArrayBuffer> {
  const key = Math.round(k * 10) / 10
  let curve = driveCurves.get(key)
  if (!curve) {
    curve = driveCurve(key)
    driveCurves.set(key, curve)
  }
  return curve
}

const KICK_DRIVE = 2.2

/** The 909 rimshot's three resonators, [Hz, share]. */
const RIM_RESONATORS = [
  [455, 0.5],
  [1660, 0.38],
  [2840, 0.22],
] as const
const TOM_DRIVE = 1.4

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** A percussive gain envelope: near-instant attack, an optional hold at the
    peak, exponential fall. Returns the node to route the source through,
    already scheduled. */
function envelope(
  ctx: BaseAudioContext,
  when: number,
  peak: number,
  decay: number,
  attack = 0.002,
  hold = 0,
): GainNode {
  const gain = ctx.createGain()
  const top = Math.max(peak, 0.0002)
  const fall = when + attack + hold
  // exponentialRamp can't reach or start from zero, so the tail lands on a
  // silent-but-nonzero floor and is cut flat afterwards.
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(top, when + attack)
  if (hold > 0) gain.gain.setValueAtTime(top, fall)
  gain.gain.exponentialRampToValueAtTime(0.0001, fall + decay)
  gain.gain.setValueAtTime(0, fall + decay)
  return gain
}

/** Play `buffer` from a random offset — so repeated hits aren't bit-identical —
    at `rate`, looping when the sound may outlast it. */
function bufferSource(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  when: number,
  duration: number,
  rate: number,
  loop = false,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = rate
  const offset = Math.random() * 1.5
  if (loop) {
    source.loop = true
    source.start(when, offset)
    source.stop(when + duration)
  } else {
    source.start(when, offset, duration * rate)
  }
  return source
}

function noiseSource(
  ctx: BaseAudioContext,
  when: number,
  duration: number,
  loop = false,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource()
  source.buffer = noise(ctx)
  // Start at a random offset so repeated hits aren't bit-identical.
  const offset = Math.random() * 1.5
  if (loop) {
    // For anything longer than the buffer: wrap rather than fall silent.
    source.loop = true
    source.start(when, offset)
    source.stop(when + duration)
  } else {
    source.start(when, offset, duration)
  }
  return source
}

function tone(
  ctx: BaseAudioContext,
  type: OscillatorType,
  freq: number,
  when: number,
  duration: number,
): OscillatorNode {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, when)
  osc.start(when)
  osc.stop(when + duration)
  return osc
}

function bandpass(ctx: BaseAudioContext, freq: number, q: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = q
  return filter
}

function highpass(ctx: BaseAudioContext, freq: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = freq
  return filter
}

function lowpass(ctx: BaseAudioContext, freq: number): BiquadFilterNode {
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = freq
  return filter
}

/** ENERGY opens every voice's noise up: dull thud → bright crack. */
function brightness(energy: number): number {
  return 900 * Math.pow(2, 4.1 * energy) // ~0.9kHz .. ~15kHz
}

/** ENERGY also carries loudness, so the control reads as one gesture rather
    than as a tone knob. Never reaches silence at 0 — a quiet hit is still a
    hit. */
function loudness(velocity: number, energy: number): number {
  return velocity * (0.5 + 0.5 * energy)
}

/**
 * The 909 bass drum's body: a sine pushed into a soft clipper — the round,
 * slightly squared body that makes it thump rather than boom — under a
 * two-stage pitch sweep, with a click of noise on top. KICK is this and
 * nothing else; a slack SNARE turns into it.
 */
type ThudParams = {
  freq: number
  snap: number
  energy: number
  level: number
  decay: number
  click?: number
  saturation?: number
}

function thud(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  { freq, snap, energy, level, decay, click, saturation }: ThudParams,
  track: <T extends AudioScheduledSourceNode>(source: T) => T,
): void {
  const osc = track(ctx.createOscillator())
  osc.type = 'sine'
  // ENERGY deepens the drop, which is what makes a hard hit snap. The fast
  // first stage is the punch; the slow second one is the 909's long downward
  // bend into the note.
  const top = freq * (1 + snap * (0.55 + 0.45 * energy))
  osc.frequency.setValueAtTime(top, when)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.45, when + 0.022)
  osc.frequency.exponentialRampToValueAtTime(freq, when + 0.13)
  const shaper = ctx.createWaveShaper()
  shaper.curve = drive(saturation ?? KICK_DRIVE)
  // A short hold before the fall: the body sits at full level for a beat of
  // the pitch sweep, which is where the 909's weight comes from.
  const gain = envelope(ctx, when, level, decay, 0.001, 0.018)
  osc.connect(shaper).connect(gain).connect(dest)
  osc.start(when)
  osc.stop(when + decay + 0.07)

  // The attack: a click of filtered noise on top, ENERGY's share of it
  // growing the way the 909's ATTACK knob does — or, from Chladni 2, its own
  // CLICK knob, which also opens it up brighter.
  const tick = track(noiseSource(ctx, when, 0.012))
  const tickLevel = click === undefined ? 0.2 + 0.45 * energy : 0.03 + 1.1 * click
  const clickGain = envelope(ctx, when, level * tickLevel, 0.006, 0.0005)
  const tickTone = click === undefined ? 5200 : 2600 + 9000 * click
  tick.connect(lowpass(ctx, tickTone)).connect(clickGain).connect(dest)
}

// SNARE's thud: the kick's body pitched a little above the kick, so the two
// stay told apart, and let ring for twice the snare's own decay.
const SNARE_THUD_FREQ = 56
const SNARE_THUD_SNAP = 3.4
const SNARE_THUD_STRETCH = 2

// FX's two modulators, as ratios to the note and peak modulation indices. The
// fine mode's ratio is high and off the harmonic series, so a little of it is
// a shimmer over the drum; the deep mode's √2 is the classic metallic ratio,
// and at full depth it throws partials everywhere — the clang.
const FX_RIPPLE_RATIO = 7.13
const FX_RIPPLE_INDEX = 0.45
const FX_LOBE_RATIO = Math.SQRT2
const FX_LOBE_INDEX = 5.5
// Share of the note's decay over which the modulation dies away.
const FX_INDEX_FALL = 0.6

/**
 * Per-voice level trim. These are not taste: they were measured by rendering
 * each pad on its own and reading its peak, then set so no pad is more than
 * about half again as loud as another. Without them the narrow-band voices
 * (BLOCK, CLAP, RIM — most of whose energy the filter throws away) come out
 * five times quieter than the snare, and the snare itself lands close enough
 * to full scale to clip once the room and saturation are added.
 *
 * Re-measure after changing any voice's synthesis.
 */
const TRIM: Record<Voice['kind'], number> = {
  // The 909 kick and toms are driven, so they carry more RMS than their peak
  // suggests; these are trimmed a little under their peak match for that.
  kick: 0.8,
  tom: 0.85,
  snare: 0.8,
  clap: 3.4,
  hat: 2.6,
  cymbal: 2.4,
  rim: 1.55,
  bell: 2.2,
  block: 4,
  shaker: 1.5,
  fm: 0.85,
}

/**
 * Schedule one hit of `voice` into `dest` at AudioContext time `when`. Every
 * node is created per hit and stops on its own: hits overlap freely and no
 * bookkeeping outlives the sound.
 *
 * Returns the hit's sources so a caller can un-schedule it. Calling `.stop(t)`
 * on a source whose start is still ahead of `t` cancels it outright — that is
 * how the loop drops notes it has already queued when the pattern changes
 * under it.
 */
export function playVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  voice: Voice,
  when: number,
  { velocity, energy, lengthScale }: HitParams,
): AudioScheduledSourceNode[] {
  const decay = voice.decay * lengthScale
  const level = loudness(velocity, energy) * TRIM[voice.kind]
  const open = brightness(energy)
  const sources: AudioScheduledSourceNode[] = []
  const track = <T extends AudioScheduledSourceNode>(source: T): T => {
    sources.push(source)
    return source
  }

  switch (voice.kind) {
    case 'kick':
      thud(
        ctx,
        dest,
        when,
        {
          freq: voice.freq,
          snap: voice.snap,
          energy,
          level,
          decay,
          click: voice.click,
          saturation: voice.saturation,
        },
        track,
      )
      break

    case 'tom': {
      // 909 toms: a sine with a wide downward sweep, and a short burst of
      // filtered noise for the stick hitting the head. A wider sweep is a drum
      // tuned down toward a kick, so it takes on the rest of the kick's recipe
      // with it: a longer hold at the top and a harder drive.
      const sweep = voice.sweep ?? TOM_SWEEP
      const kick = voice.kickBlend ?? clamp01((sweep - TOM_SWEEP) / (TOM_KICK_SWEEP - TOM_SWEEP))
      const osc = track(ctx.createOscillator())
      osc.type = 'sine'
      // A tom glides into its note over most of its length; a kick punches
      // down fast and lands on it in a beat.
      osc.frequency.setValueAtTime(voice.freq * sweep, when)
      osc.frequency.exponentialRampToValueAtTime(
        voice.freq * (1 + (sweep - 1) * 0.15),
        when + lerp(0.04, 0.022, kick),
      )
      osc.frequency.exponentialRampToValueAtTime(voice.freq, when + lerp(decay * 0.8, 0.13, kick))
      const shaper = ctx.createWaveShaper()
      shaper.curve = drive(lerp(TOM_DRIVE, KICK_DRIVE, kick))
      const gain = envelope(ctx, when, level * 0.9, decay, 0.001, lerp(0.008, 0.018, kick))
      osc.connect(shaper).connect(gain).connect(dest)
      osc.start(when)
      osc.stop(when + decay + 0.05)

      // Chladni 2's TONE: the stick on the head, dark and soft to bright and hard.
      const skinTone = voice.skin === undefined ? 1 : lerp(0.35, 2.2, voice.skin)
      const skinBand = voice.skin === undefined ? 7 : lerp(4, 14, voice.skin)
      const skin = track(noiseSource(ctx, when, 0.06))
      const skinLevel = level * 0.22 * (0.5 + energy) * lerp(1, 0.5, kick) * skinTone
      const skinGain = envelope(ctx, when, skinLevel, 0.045, 0.001)
      skin.connect(bandpass(ctx, voice.freq * skinBand, 0.9)).connect(skinGain).connect(dest)
      break
    }

    case 'snare': {
      // The 909 snare: two tuned triangle oscillators about a sixth apart,
      // each bending down a little, under a bright, long noise — the SNAPPY
      // half, which is what the 909 snare is really known for. `thump` hands
      // the shell over to the thud of a slack head: the kick's own body, a
      // little higher and shorter.
      const thump = voice.thump ?? 0
      if (thump > 0) {
        thud(
          ctx,
          dest,
          when,
          {
            freq: SNARE_THUD_FREQ,
            snap: SNARE_THUD_SNAP,
            energy,
            level: level * thump,
            decay: decay * SNARE_THUD_STRETCH,
          },
          track,
        )
      }
      const shell = level * (1 - voice.noiseMix) * (1 - thump)
      for (const [ratio, share] of [
        [1, 0.62],
        [1.74, 0.38],
      ] as const) {
        if (shell <= 0) break
        const freq = voice.tone * ratio
        const body = track(ctx.createOscillator())
        body.type = 'triangle'
        body.frequency.setValueAtTime(freq * 1.5, when)
        body.frequency.exponentialRampToValueAtTime(freq, when + 0.025)
        body.start(when)
        body.stop(when + decay * 0.6 + 0.03)
        const bodyGain = envelope(
          ctx,
          when,
          shell * share * 1.6,
          decay * (ratio === 1 ? 0.5 : 0.35),
          0.001,
        )
        body.connect(bodyGain).connect(dest)
      }

      if (voice.noiseMix <= 0) break
      const rattle = track(noiseSource(ctx, when, decay + 0.05))
      const rattleGain = envelope(ctx, when, level * voice.noiseMix, decay, 0.001)
      if (voice.noiseFilter) {
        // DS Snare's noise filter, LP / BP / HP, at the TONE knob's frequency.
        const at = voice.noiseTone ?? 4000
        const shaped =
          voice.noiseFilter === 'lp'
            ? rattle.connect(lowpass(ctx, at))
            : voice.noiseFilter === 'bp'
              ? rattle.connect(bandpass(ctx, at, 1.1))
              : rattle.connect(highpass(ctx, at * 0.6))
        shaped.connect(rattleGain).connect(dest)
        break
      }
      rattle
        .connect(highpass(ctx, 1400))
        .connect(lowpass(ctx, Math.min(open * 1.6 + 3000, 16000)))
        .connect(rattleGain)
        .connect(dest)
      break
    }

    case 'clap': {
      // The 909 hand clap: noise through one band, retriggered four times by
      // a sawtooth — sharp attack, fast fall, ~10ms apart — then a diffuse
      // tail. The bursts are the many hands; the tail is the room.
      const band = voice.band ?? 1150
      const filter = bandpass(ctx, band, voice.q ?? 1.3)
      filter.connect(highpass(ctx, band * 0.56)).connect(dest)
      // Chladni 2: SLOPPY spaces the bursts out (each a little off the grid,
      // as hands are), and SPREAD pans them apart, left and right in turn.
      const spacing = voice.spacing ?? 0.0095
      const loose = voice.spacing === undefined ? 0 : 0.25
      const spread = voice.spread ?? 0
      const bursts = [0.8, 0.9, 0.85, 1]
      bursts.forEach((gainScale, k) => {
        const offset = k * spacing * (1 + loose * (Math.random() - 0.5))
        const burst = track(noiseSource(ctx, when + offset, 0.015))
        const shaped = burst.connect(
          envelope(ctx, when + offset, level * gainScale, 0.0085, 0.0003),
        )
        if (spread > 0) {
          const pan = ctx.createStereoPanner()
          pan.pan.value = (k % 2 === 0 ? -1 : 1) * spread * (0.6 + (0.4 * k) / 3)
          shaped.connect(pan).connect(filter)
        } else {
          shaped.connect(filter)
        }
      })
      const tailAt = when + (bursts.length - 1) * spacing + 0.0015
      const tail = track(noiseSource(ctx, tailAt, decay))
      tail
        .connect(envelope(ctx, tailAt, level * 0.5 * (voice.tail ?? 1), decay, 0.002))
        .connect(filter)
      break
    }

    case 'hat': {
      // 909 hats are recordings of real cymbals, crushed to 6 bits — metal,
      // not hiss. Here that is a bank of inharmonic square waves (`metal`)
      // high-passed to its top edge, with a little noise for the grit.
      const cutoff = Math.max(voice.cutoff, open)
      const out = highpass(ctx, cutoff)
      out.connect(dest)
      const rate = voice.rate ?? 1
      const metal = track(bufferSource(ctx, metalBuffer(ctx), when, decay + 0.03, rate))
      const metalGain = envelope(ctx, when, level * 0.5, decay, 0.0008)
      metal.connect(bandpass(ctx, 10500, 0.7)).connect(metalGain).connect(out)
      const air = track(noiseSource(ctx, when, decay + 0.03))
      air.connect(envelope(ctx, when, level * 0.3, decay * 0.8, 0.0008)).connect(out)
      // An open hat rings: the metal's own band carries on after the hiss
      // has gone, which is what separates it from a longer closed one.
      if (voice.ring) {
        const body = track(bufferSource(ctx, metalBuffer(ctx), when, decay + 0.05, rate))
        const bodyGain = envelope(ctx, when, level * 0.3 * voice.ring, decay * 1.1, 0.004)
        body.connect(bandpass(ctx, 8200, 3)).connect(bodyGain).connect(dest)
      }
      break
    }

    case 'cymbal': {
      // The 909's crash and ride, sampled metal like its hats but slowed down
      // and left to ring. The brighter `cutoff` is (the ride end) the more a
      // narrow ping sits on top of the wash — the bell of a ride. `tune` moves
      // all of it together, the way replaying a sample faster does.
      const ping = voice.bell ?? clamp01((voice.cutoff - 5000) / 4400)
      const tune = voice.tune ?? 1
      const cutoff = voice.cutoff * tune
      const span = decay + 0.05
      const metal = track(
        bufferSource(ctx, metalBuffer(ctx), when, span, (0.82 + 0.3 * ping) * tune, true),
      )
      const metalGain = envelope(ctx, when, level * 0.42, decay, 0.002)
      metal
        .connect(highpass(ctx, cutoff))
        .connect(bandpass(ctx, 7400 * tune, 0.5))
        .connect(metalGain)
        .connect(dest)
      const wash = track(noiseSource(ctx, when, span, true))
      const washGain = envelope(ctx, when, level * 0.3 * (1 - 0.5 * ping), decay * 0.75, 0.004)
      wash.connect(highpass(ctx, cutoff)).connect(washGain).connect(dest)
      if (ping > 0) {
        const bell = track(bufferSource(ctx, metalBuffer(ctx), when, span, 1.1 * tune, true))
        const bellGain = envelope(ctx, when, level * 0.35 * ping, decay * 0.7, 0.001)
        bell.connect(bandpass(ctx, 4300 * tune, 5)).connect(bellGain).connect(dest)
      }
      break
    }

    case 'rim': {
      // The 909 rimshot: a few tuned resonators struck at once and choked
      // almost immediately, high-passed into a hard, woody tick.
      const out = highpass(ctx, 320)
      out.connect(dest)
      for (const [freq, share] of voice.modes ?? RIM_RESONATORS) {
        const ring = track(tone(ctx, 'triangle', freq, when, decay + 0.01))
        ring.connect(envelope(ctx, when, level * share, decay * 0.32, 0.0005)).connect(out)
      }
      const click = track(noiseSource(ctx, when, 0.01))
      click
        .connect(bandpass(ctx, 4200, 1.5))
        .connect(envelope(ctx, when, level * 0.45, 0.004, 0.0003))
        .connect(out)
      break
    }
    case 'bell': {
      // Two detuned squares through a narrow band: the classic cowbell trick.
      const filter = bandpass(ctx, 2400, 1.4)
      const gain = envelope(ctx, when, level * 0.34, decay, 0.001)
      filter.connect(gain).connect(dest)
      for (const freq of voice.freqs) {
        track(tone(ctx, 'square', freq, when, decay + 0.02)).connect(filter)
      }
      break
    }

    case 'block': {
      const osc = track(tone(ctx, 'square', voice.freq, when, decay + 0.01))
      const gain = envelope(ctx, when, level * 0.3, decay, 0.001)
      osc.connect(bandpass(ctx, voice.freq, 6)).connect(gain).connect(dest)
      break
    }

    case 'shaker': {
      const source = track(noiseSource(ctx, when, decay + 0.02))
      // Slower attack than a hat: beads take a moment to hit the shell.
      const gain = envelope(ctx, when, level * 0.4, decay, 0.008)
      source.connect(highpass(ctx, Math.max(5600, open))).connect(gain).connect(dest)
      break
    }

    case 'fm': {
      // FX. With both modulators at rest this is the tom: a driven sine
      // bending down onto its note, a stick on the head. The modulators bend
      // that sine's frequency at audio rate, and every sideband they throw is
      // a new partial — the fine one high and shallow (a shimmer), the deep one
      // low and inharmonic (the clang). Their depth falls away faster than the
      // note does, so even the metallic end settles back toward the drum as it
      // rings, the way struck metal does.
      const freq = voice.freq
      const sweep = (param: AudioParam, scale: number) => {
        param.setValueAtTime(freq * 1.9 * scale, when)
        param.exponentialRampToValueAtTime(freq * 1.15 * scale, when + 0.04)
        param.exponentialRampToValueAtTime(freq * scale, when + decay * 0.8)
      }
      const carrier = track(ctx.createOscillator())
      carrier.type = 'sine'
      sweep(carrier.frequency, 1)
      // Chladni 2 plays DS FM's one modulator, at its integer MOD ratio.
      const modulators: readonly (readonly [number, number])[] =
        voice.ratio !== undefined
          ? [[voice.ratio, voice.index ?? 0]]
          : [
              [FX_RIPPLE_RATIO, FX_RIPPLE_INDEX * voice.ripple],
              [FX_LOBE_RATIO, FX_LOBE_INDEX * voice.lobes],
            ]
      for (const [ratio, index] of modulators) {
        if (index <= 0) continue
        const modulator = track(ctx.createOscillator())
        modulator.type = 'sine'
        // Tracks the carrier's bend, so the partials keep their ratios
        // through the attack instead of smearing.
        sweep(modulator.frequency, ratio)
        // Index → Hz of deviation: the index times the modulator's frequency.
        const depth = ctx.createGain()
        const peak = index * freq * ratio
        depth.gain.setValueAtTime(peak, when)
        depth.gain.exponentialRampToValueAtTime(peak * 0.04, when + decay * FX_INDEX_FALL)
        modulator.connect(depth).connect(carrier.frequency)
        modulator.start(when)
        modulator.stop(when + decay + 0.05)
      }
      // FEEDBACK: noise bending the carrier, the grit a feeding-back operator
      // throws — dying away with the modulation.
      if (voice.noise) {
        const grit = track(noiseSource(ctx, when, decay + 0.05))
        const gritDepth = ctx.createGain()
        const peak = voice.noise * freq * 2.5
        gritDepth.gain.setValueAtTime(peak, when)
        gritDepth.gain.exponentialRampToValueAtTime(peak * 0.1, when + decay * FX_INDEX_FALL)
        grit.connect(lowpass(ctx, 6000)).connect(gritDepth).connect(carrier.frequency)
      }
      const shaper = ctx.createWaveShaper()
      shaper.curve = drive(TOM_DRIVE)
      const gain = envelope(ctx, when, level * 0.9, decay, 0.001, 0.008)
      carrier.connect(shaper).connect(gain).connect(dest)
      carrier.start(when)
      carrier.stop(when + decay + 0.05)

      const skin = track(noiseSource(ctx, when, 0.06))
      const skinGain = envelope(ctx, when, level * 0.22 * (0.5 + energy), 0.045, 0.001)
      skin.connect(bandpass(ctx, freq * 7, 0.9)).connect(skinGain).connect(dest)
      break
    }
  }

  return sources
}
