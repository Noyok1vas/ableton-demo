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

import type { MarchVoiceId, SoundVoiceId } from './engine.ts'

/** One pad, as a recipe rather than a sound file. `decay` is the voice's
    natural length in seconds at LENGTH's midpoint; LENGTH scales it. */
export type Voice = { label: string } & (
  | { kind: 'kick'; freq: number; snap: number; decay: number }
  | { kind: 'tom'; freq: number; decay: number }
  | { kind: 'snare'; tone: number; noiseMix: number; decay: number }
  | { kind: 'clap'; decay: number }
  // `ring` 0..1 brings up the narrow metallic band an OPEN hat sustains — the
  // part that is not simply a longer closed hat.
  | { kind: 'hat'; cutoff: number; decay: number; ring?: number }
  | { kind: 'cymbal'; cutoff: number; decay: number }
  | { kind: 'rim'; decay: number }
  | { kind: 'bell'; freqs: [number, number]; decay: number }
  | { kind: 'block'; freq: number; decay: number }
  | { kind: 'shaker'; decay: number }
  // Not a hit at all: a bed of filtered noise that swells in and rustles away.
  // `cutoff` is where its band sits, `q` how narrow it is (low = full and wide,
  // high = thin), `wobble` how fast the grain stirs (Hz).
  | { kind: 'texture'; cutoff: number; q: number; wobble: number; decay: number }
)

/** Lowest pad — C1, bottom-left of the grid, matching PAD_BASE_PITCH. */
export const KIT_BASE_PITCH = 36

/** Pads in MIDI order, so the grid reads bottom-left first exactly as the
    PitchPad draws it: each row of four is a family, rows get brighter going
    up. Rough General MIDI neighbourhood, so the layout feels familiar. */
export const KIT: Voice[] = [
  // Row 1 — the backbone.
  { label: 'KICK', kind: 'kick', freq: 48, snap: 3.2, decay: 0.42 },
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
 * The four sound identities of the Selector: what HIT, TAP, SPLASH and SCATTER
 * actually sound like.
 *
 * Their own kit rather than four of the 16 pads, for the same reason March has
 * one: the pads are an instrument the performer chooses from, while these four
 * are fixed roles in one composition — weight, lighter pulse, accent,
 * atmosphere — and each is tuned to sit against the other three rather than to
 * be a good general-purpose drum. They are still coloured live by ENERGY and
 * LENGTH, which is what separates them from March's fixed voices: these ARE
 * the instrument Sound Intent shapes.
 *
 * `level` trims one identity against the others *before* ENERGY and velocity;
 * the per-kind TRIM below still applies on top, since these use the same
 * synthesis the pads do.
 */
export type SoundVoiceSpec = { voice: Voice; level: number }

export const SOUND_TYPE_KIT: Record<SoundVoiceId, SoundVoiceSpec> = {
  // A classic electronic kick: low, solid, punchy. The deep pitch drop is the
  // punch, and the long-ish body is what makes it feel grounded rather than
  // clicky. This is the composition's rhythmic weight, so it carries full level.
  hit: {
    voice: { label: 'HIT', kind: 'kick', freq: 45, snap: 3.6, decay: 0.5 },
    level: 1,
  },
  // A hi-hat: short, high, and the light event against HIT's weight. Its
  // character runs from a rounder hat with some wash in it to a crisp one that
  // is over almost before it registers — see resolveSoundVoice.
  tick: {
    voice: { label: 'TICK', kind: 'hat', cutoff: 8400, decay: 0.042 },
    level: 0.78,
  },
  // A clap: sharp, immediate, brighter than HIT, and — because it is three
  // fast bursts and a tail rather than one envelope — expressive in a way a
  // drum hit is not. Loud enough to read as an accent, short enough not to
  // become a second backbone.
  splash: {
    voice: { label: 'SPLASH', kind: 'clap', decay: 0.22 },
    level: 0.92,
  },
  // Not a hit: filtered noise that swells in and rustles away, well under the
  // others in level. The decay is long enough that one SCATTER covers most of
  // a two-bar loop on its own, so the loop repeating it produces a continuous
  // bed rather than a pulse — which is the point. SCATTER is the air the other
  // three happen in.
  scatter: {
    voice: { label: 'SCATTER', kind: 'texture', cutoff: 2600, q: 0.6, wobble: 7.5, decay: 2.4 },
    level: 0.42,
  },
}

// ── Character → the voice that actually sounds ────────────────────────────
// One 0..1 axis per identity, resolved here rather than at the call site so
// that every path to a note — a live tap, a queued loop event, an audition in
// the Selector — resolves it the same way. The values below ARE the axis: what
// SOFT and HARD mean is these numbers and nothing else.

// HIT: no numbers of its own. SOFT←→HARD is the existing Energy parameter under
// a better name — it drives the same loudness-and-brightness pair that hitting
// something harder drives, which is exactly what `energy` already did.

// TICK: ROUNDED ←→ CRISPY, one continuous move over the same hi-hat.
//
// Rounded is the closed end of a hat: short, dry, damped, gone almost as soon
// as it starts. Crispy is the open end: longer, brighter, with the metallic
// band (`ring`) up underneath giving it wash and ring-out — an open hat is what
// "crisp" (all transient, no dampening) actually sounds like, not what "round"
// does. The axis runs FROM the short closed one TO the long open one, which is
// why every pair below is ordered that way.
const TICK_ROUNDED_DECAY = 0.026
const TICK_CRISPY_DECAY = 0.3
const TICK_ROUNDED_CUTOFF = 9900 // all edge, no body
const TICK_CRISPY_CUTOFF = 6800 // more body under it
// The crispy end spreads the same gesture over ten times the time, so it needs
// trimming to sit at the same weight rather than reading as an accent.
const TICK_CRISPY_TRIM = 0.84

// SCATTER: airy to dense, both ends noise. The band walks DOWN and WIDENS —
// thin and high becomes full and occupied. Nothing pitched is introduced at any
// point of the travel; a wide low band is still a band of noise.
const SCATTER_AIRY_CUTOFF = 5600
const SCATTER_DENSE_CUTOFF = 1250
const SCATTER_AIRY_Q = 1.15 // narrow → thin, breathable
const SCATTER_DENSE_Q = 0.32 // wide → full, saturated
const SCATTER_AIRY_WOBBLE = 11 // a fast flutter reads as air moving
const SCATTER_DENSE_WOBBLE = 4.5 // a slow stir reads as mass
const SCATTER_AIRY_LEVEL = 0.6
const SCATTER_DENSE_LEVEL = 1.35

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/** What one identity plus its character comes to: the voice to play, the trim
    to play it at, and — for HIT alone — the energy to play it with, which is
    what that identity's axis controls. */
export type ResolvedVoice = { voice: Voice; level: number; energy?: number }

/**
 * Resolve a sound identity and its recorded character into a voice.
 *
 * `character` is the value the EVENT carries, not the slider's current
 * position — every caller passes what was snapshotted at the moment of input,
 * which is what lets one bar hold a soft hit and a hard one.
 */
export function resolveSoundVoice(id: SoundVoiceId, character?: number): ResolvedVoice {
  const spec = SOUND_TYPE_KIT[id]
  if (character == null) return { voice: spec.voice, level: spec.level }
  const c = Math.min(1, Math.max(0, character))

  switch (spec.voice.kind) {
    case 'kick':
      return { voice: spec.voice, level: spec.level, energy: c }

    case 'hat':
      return {
        voice: {
          ...spec.voice,
          decay: lerp(TICK_ROUNDED_DECAY, TICK_CRISPY_DECAY, c),
          cutoff: lerp(TICK_ROUNDED_CUTOFF, TICK_CRISPY_CUTOFF, c),
          // The wash belongs to the crispy/open end and is absent at rounded.
          ring: c,
        },
        level: spec.level * lerp(1, TICK_CRISPY_TRIM, c),
      }

    case 'texture':
      return {
        voice: {
          ...spec.voice,
          cutoff: lerp(SCATTER_AIRY_CUTOFF, SCATTER_DENSE_CUTOFF, c),
          q: lerp(SCATTER_AIRY_Q, SCATTER_DENSE_Q, c),
          wobble: lerp(SCATTER_AIRY_WOBBLE, SCATTER_DENSE_WOBBLE, c),
        },
        level: spec.level * lerp(SCATTER_AIRY_LEVEL, SCATTER_DENSE_LEVEL, c),
      }

    // SPLASH and anything else: fixed by design, character ignored.
    default:
      return { voice: spec.voice, level: spec.level }
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

// One noise buffer per context, shared by every noise-based voice: two seconds
// covers the longest cymbal even fully stretched by LENGTH. SCATTER's texture
// outlasts it, so that one voice loops the buffer instead of running off its
// end (see `noiseSource`'s `loop`).
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

/** A percussive gain envelope: near-instant attack, exponential fall. Returns
    the node to route the source through, already scheduled. */
function envelope(
  ctx: BaseAudioContext,
  when: number,
  peak: number,
  decay: number,
  attack = 0.002,
): GainNode {
  const gain = ctx.createGain()
  // exponentialRamp can't reach or start from zero, so the tail lands on a
  // silent-but-nonzero floor and is cut flat afterwards.
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay)
  gain.gain.setValueAtTime(0, when + attack + decay)
  return gain
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
  kick: 1,
  tom: 1,
  snare: 0.72,
  clap: 3.2,
  hat: 1.4,
  cymbal: 1.7,
  rim: 3,
  bell: 2.2,
  block: 4,
  shaker: 1.5,
  // Set by the same measurement as the rest, but read as RMS rather than peak:
  // this voice has no transient, so its peak says nothing about how loud it is.
  // At 1.5 it renders about 19dB under HIT's RMS — present as air under a loop,
  // gone the moment you listen for it as a drum.
  texture: 1.5,
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
    case 'kick': {
      const osc = track(ctx.createOscillator())
      osc.type = 'sine'
      // The pitch drop *is* the kick: start high, fall onto the body note.
      // ENERGY deepens the drop, which is what makes a hard hit snap.
      const top = voice.freq * (1 + voice.snap * (0.55 + 0.45 * energy))
      osc.frequency.setValueAtTime(top, when)
      osc.frequency.exponentialRampToValueAtTime(voice.freq, when + 0.055)
      const gain = envelope(ctx, when, level, decay)
      osc.connect(gain).connect(dest)
      osc.start(when)
      osc.stop(when + decay + 0.05)

      // A trace of click on top, so it still reads on small speakers.
      const click = track(noiseSource(ctx, when, 0.02))
      const clickGain = envelope(ctx, when, level * 0.28 * energy, 0.015, 0.001)
      click.connect(highpass(ctx, 1600)).connect(clickGain).connect(dest)
      break
    }

    case 'tom': {
      const osc = track(ctx.createOscillator())
      osc.type = 'sine'
      osc.frequency.setValueAtTime(voice.freq * 1.7, when)
      osc.frequency.exponentialRampToValueAtTime(voice.freq, when + 0.08)
      const gain = envelope(ctx, when, level * 0.9, decay)
      osc.connect(gain).connect(dest)
      osc.start(when)
      osc.stop(when + decay + 0.05)
      break
    }

    case 'snare': {
      // Two halves: a short pitched body and the rattle of the snares.
      const body = track(tone(ctx, 'triangle', voice.tone, when, decay * 0.6 + 0.02))
      const bodyGain = envelope(ctx, when, level * (1 - voice.noiseMix), decay * 0.5)
      body.connect(bodyGain).connect(dest)

      const rattle = track(noiseSource(ctx, when, decay + 0.05))
      const rattleGain = envelope(ctx, when, level * voice.noiseMix, decay)
      rattle.connect(highpass(ctx, Math.min(open, 3200))).connect(rattleGain).connect(dest)
      break
    }

    case 'clap': {
      // Three fast bursts then a tail — the reason a clap sounds like hands
      // rather than a noise gate.
      const filter = bandpass(ctx, 1100, 1.1)
      filter.connect(dest)
      for (const [offset, gainScale] of [
        [0, 0.75],
        [0.011, 0.95],
        [0.023, 0.7],
      ] as const) {
        const burst = track(noiseSource(ctx, when + offset, 0.02))
        burst.connect(envelope(ctx, when + offset, level * gainScale, 0.014, 0.001)).connect(filter)
      }
      const tail = track(noiseSource(ctx, when + 0.03, decay))
      tail.connect(envelope(ctx, when + 0.03, level * 0.45, decay, 0.004)).connect(filter)
      break
    }

    case 'hat': {
      const source = track(noiseSource(ctx, when, decay + 0.02))
      const gain = envelope(ctx, when, level * 0.55, decay, 0.001)
      source
        .connect(highpass(ctx, Math.max(voice.cutoff, open)))
        .connect(gain)
        .connect(dest)
      // What you actually hear when a hat opens is not just more of the same
      // hiss but a narrow band ringing under it, so an open hat gets that band
      // layered in rather than only a longer envelope. Without it the far end
      // of CLOSED→OPEN reads as a hat someone forgot to stop.
      if (voice.ring) {
        const body = track(noiseSource(ctx, when, decay + 0.05))
        const bodyGain = envelope(ctx, when, level * 0.34 * voice.ring, decay * 0.95, 0.005)
        body.connect(bandpass(ctx, 9200, 8)).connect(bodyGain).connect(dest)
      }
      break
    }

    case 'cymbal': {
      const source = track(noiseSource(ctx, when, decay + 0.05))
      const gain = envelope(ctx, when, level * 0.4, decay, 0.004)
      const shimmer = bandpass(ctx, 7400, 0.6)
      source.connect(highpass(ctx, voice.cutoff)).connect(shimmer).connect(gain).connect(dest)
      break
    }

    case 'rim': {
      const source = track(noiseSource(ctx, when, decay + 0.01))
      const gain = envelope(ctx, when, level * 0.7, decay, 0.001)
      source.connect(bandpass(ctx, 1750, 5)).connect(gain).connect(dest)
      const click = track(tone(ctx, 'triangle', 420, when, decay))
      click.connect(envelope(ctx, when, level * 0.35, decay * 0.4, 0.001)).connect(dest)
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

    case 'texture': {
      // The one voice with no transient. Noise through a wide band — soft
      // static rather than a hiss — swelling in over a long attack instead of
      // snapping on, and stirred by a slow LFO so it rustles like sand rather
      // than sitting there as a flat tone. Everything here is the opposite of
      // the percussive envelope above, which is the point: SCATTER has to read
      // as air, not as a fourth drum.
      const attack = decay * 0.28
      const span = attack + decay + 0.05
      const source = track(noiseSource(ctx, when, span, true))
      // ENERGY opens the band upward, the way it brightens every other voice;
      // the character has already set where the band sits and how wide it is.
      const band = bandpass(ctx, voice.cutoff * (0.55 + 0.9 * energy), voice.q)
      // Amplitude stir: the LFO adds to a standing gain, so the bed breathes
      // between roughly 0.45 and 1 instead of pulsing to silence.
      const stir = ctx.createGain()
      stir.gain.value = 0.72
      const depth = ctx.createGain()
      depth.gain.value = 0.28
      track(tone(ctx, 'sine', voice.wobble, when, span)).connect(depth).connect(stir.gain)
      const gain = envelope(ctx, when, level * 0.5, decay, attack)
      source.connect(band).connect(stir).connect(gain).connect(dest)
      break
    }
  }

  return sources
}
