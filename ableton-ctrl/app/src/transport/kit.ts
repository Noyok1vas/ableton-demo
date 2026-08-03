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

/** One pad, as a recipe rather than a sound file. `decay` is the voice's
    natural length in seconds at LENGTH's midpoint; LENGTH scales it. */
export type Voice = { label: string } & (
  | { kind: 'kick'; freq: number; snap: number; decay: number }
  | { kind: 'tom'; freq: number; decay: number }
  | { kind: 'snare'; tone: number; noiseMix: number; decay: number }
  | { kind: 'clap'; decay: number }
  | { kind: 'hat'; cutoff: number; decay: number }
  | { kind: 'cymbal'; cutoff: number; decay: number }
  | { kind: 'rim'; decay: number }
  | { kind: 'bell'; freqs: [number, number]; decay: number }
  | { kind: 'block'; freq: number; decay: number }
  | { kind: 'shaker'; decay: number }
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
// covers the longest cymbal even fully stretched by LENGTH.
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

function noiseSource(ctx: BaseAudioContext, when: number, duration: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource()
  source.buffer = noise(ctx)
  // Start at a random offset so repeated hits aren't bit-identical.
  source.start(when, Math.random() * 1.5, duration)
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
  }

  return sources
}
