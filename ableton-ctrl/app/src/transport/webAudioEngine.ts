/**
 * The built-in sound source: the same gestures, sounding in this tab instead of
 * in Live. It exists so the prototype can be opened by someone who has no Live
 * set and no bridge running.
 *
 * It answers to the same macro *names* the Ableton rack uses, so no module
 * above it knows which source it is talking to:
 *
 *   Energy          → per-hit loudness and brightness (see kit.ts)
 *   Length          → per-hit decay; the tail Sound Intent draws, made audible
 *   Reverb          → wet send into a synthesized room
 *   Hi Pass Filter  → master high-pass
 *   Saturate        → master waveshaper
 *
 * Energy and Length colour each hit as it is scheduled; the other three are
 * properties of the room, so they hang on the master chain and change what is
 * already sounding — exactly the split FX and Sound Intent describe.
 *
 *   voices ─┬─────────────────────────┬─▶ saturate ─▶ high-pass ─▶ master ─▶ out
 *           └─▶ send ─▶ room reverb ──┘
 */

import type { EngineStatus, LoopEvent, MacroScope, SoundEngine } from './engine.ts'
import { KIT, KIT_BASE_PITCH, playVoice } from './kit.ts'

/**
 * How far ahead of the clock notes are queued.
 *
 * This has to clear one full second: a browser throttles a hidden tab's timers
 * to roughly 1Hz, so the 25ms ticker below fires about once a second whenever
 * the listener is looking at another tab. Web Audio's own scheduling is
 * unaffected by that — a note handed to it lands exactly on time — so queueing
 * well past the throttle interval is what keeps the loop steady. Queue less
 * than the ticker's worst-case gap and the scheduler silently drops every note
 * that falls between two horizons.
 *
 * The cost is that notes sit queued for over a second, which would make a knob
 * turned mid-loop take that long to be heard. `cancelQueued` buys that back by
 * un-scheduling the notes a swap invalidates.
 */
const LOOKAHEAD_S = 1.5
const TICK_MS = 25

/** Cap matching the bridge's MAX_LOOP_EVENTS, so a pattern that plays under
    one source can't be denser under the other. */
const MAX_LOOP_EVENTS = 128

const MACRO_MAX = 127

/** Sound Intent and FX both send 0..127; everything here works in 0..1. */
const unit = (value: number) => Math.min(1, Math.max(0, value / MACRO_MAX))

// Nothing to reach for, so `connected` tracks `ready`: this source is up
// exactly when the browser has let its audio context start.
const STATUS_READY: EngineStatus = {
  source: 'builtin',
  connected: true,
  ready: true,
  label: 'Built-in sound',
  labelTitle: 'Synthesized in this tab — Ableton not required',
  tags: [],
}

const STATUS_WAITING: EngineStatus = {
  source: 'builtin',
  connected: false,
  ready: false,
  label: 'Built-in sound — tap to start',
  labelTitle: 'Browsers only allow audio to start from a click or key press',
  tags: [],
}

/** A room, built rather than loaded: exponentially decaying noise is a
    serviceable impulse response and costs no download. */
function buildRoom(ctx: AudioContext): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * 1.9)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      // A short build-up before the decay stops it sounding like a gated noise
      // burst; the two channels are independent, which is what makes it wide.
      const t = i / length
      const swell = Math.min(1, t * 40)
      data[i] = (Math.random() * 2 - 1) * swell * Math.pow(1 - t, 2.6)
    }
  }
  return buffer
}

/** Saturation curve: tanh normalized so full scale still maps to full scale —
    the control adds grit without also adding level. `drive` 0..1. */
// The explicit ArrayBuffer in the type is what WaveShaper.curve asks for: it
// won't take a Float32Array that might be sitting on a SharedArrayBuffer.
function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 1024
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT))
  const k = 1 + drive * 24
  const norm = Math.tanh(k)
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

export class WebAudioEngine implements SoundEngine {
  private ctx: AudioContext | null = null
  private voiceBus: GainNode | null = null
  private reverbSend: GainNode | null = null
  private saturator: WaveShaperNode | null = null
  private highpass: BiquadFilterNode | null = null

  private readonly listeners = new Set<(status: EngineStatus) => void>()
  private status: EngineStatus = STATUS_WAITING

  private pitch = KIT_BASE_PITCH
  // Live macro values, kept as 0..1 and read at the moment each hit is
  // scheduled — including hits the loop queues ahead of the clock.
  private energy = 0.5
  private length = 0.5

  // ── Loop state ────────────────────────────────────────────────────
  private events: LoopEvent[] = []
  private barDuration = 2
  /** Context time of the top of bar 0. Preserved across pattern swaps so a
      knob turned mid-loop doesn't restart the bar (matching the bridge). */
  private barTop = 0
  private cursor = { cycle: 0, index: 0 }
  private ticker: ReturnType<typeof setInterval> | null = null
  /** Loop notes handed to Web Audio but not yet sounded, newest last, so a
      pattern swap or a stop can take back the ones that haven't happened. */
  private queued: { at: number; sources: AudioScheduledSourceNode[] }[] = []

  private disposed = false
  private detachGesture: (() => void) | null = null

  start(): void {
    if (this.disposed || this.ctx) return

    const ctx = new AudioContext()
    this.ctx = ctx

    // Master chain, built once and left running.
    const master = ctx.createGain()
    // Leaves headroom for the first transient of a stack, which slips past the
    // limiter's attack: at 0.85 a dense bar still crossed full scale.
    master.gain.value = 0.8
    master.connect(ctx.destination)

    // A safety limiter, not an effect. Hits overlap freely — a dense bar with
    // LENGTH and REVERB up measures around 1.7 at the output without this, and
    // everything past 1.0 comes back as clipping. Threshold sits just under
    // full scale so a single hit passes through untouched and only stacked
    // ones are held down.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -2
    limiter.knee.value = 6
    limiter.ratio.value = 10
    limiter.attack.value = 0.002
    limiter.release.value = 0.12
    limiter.connect(master)

    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 20 // a no-op until FX raises it
    highpass.connect(limiter)
    this.highpass = highpass

    const saturator = ctx.createWaveShaper()
    saturator.curve = saturationCurve(0)
    saturator.oversample = '2x'
    saturator.connect(highpass)
    this.saturator = saturator

    const voiceBus = ctx.createGain()
    voiceBus.connect(saturator)
    this.voiceBus = voiceBus

    const reverb = ctx.createConvolver()
    reverb.buffer = buildRoom(ctx)
    reverb.connect(saturator)

    const reverbSend = ctx.createGain()
    reverbSend.gain.value = 0 // FX's REVERB rests at 0 — a dry room
    voiceBus.connect(reverbSend).connect(reverb)
    this.reverbSend = reverbSend

    // A context created outside a user gesture starts suspended. Resume on the
    // first interaction anywhere, so the pad is live by the time it is pressed.
    if (ctx.state === 'running') {
      this.setStatus(STATUS_READY)
    } else {
      const resume = () => {
        void ctx.resume().then(() => {
          if (ctx.state === 'running') {
            this.detachGesture?.()
            this.setStatus(STATUS_READY)
          }
        })
      }
      window.addEventListener('pointerdown', resume)
      window.addEventListener('keydown', resume)
      this.detachGesture = () => {
        window.removeEventListener('pointerdown', resume)
        window.removeEventListener('keydown', resume)
        this.detachGesture = null
      }
    }
  }

  noteOn(velocity = 1): void {
    const ctx = this.ctx
    if (!ctx) return
    // A tap *is* a gesture, so this is the moment a suspended context can
    // legally start; the note itself lands a few ms later.
    if (ctx.state !== 'running') void ctx.resume()
    this.fire(ctx.currentTime, velocity)
  }

  startLoop(events: readonly LoopEvent[], barDuration: number): void {
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state !== 'running') void ctx.resume()

    const wasPlaying = this.ticker !== null
    this.events = [...events].sort((a, b) => a.pos - b.pos).slice(0, MAX_LOOP_EVENTS)
    this.barDuration = Math.min(30, Math.max(0.25, barDuration))

    if (!wasPlaying) {
      // A fresh loop starts at the bar top, like the bridge's. A swap keeps
      // barTop, so turning a knob doesn't restart the bar.
      this.barTop = ctx.currentTime
    }
    // Take back everything still queued and re-queue from now, so the new
    // pattern is heard at once rather than after the lookahead drains.
    this.cancelQueued()
    this.seekCursor(ctx.currentTime)

    if (!wasPlaying) {
      this.tick()
      this.ticker = setInterval(() => this.tick(), TICK_MS)
    }
  }

  stopLoop(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker)
      this.ticker = null
    }
    // Without this the loop would keep sounding for a lookahead's worth of
    // notes after PAUSE. Notes already ringing are left alone — stopping the
    // loop silences what comes next, not what is decaying.
    this.cancelQueued()
    this.events = []
  }

  setPitch(pitch: number): void {
    this.pitch = Math.max(0, Math.min(127, Math.round(pitch)))
  }

  /** Macros are addressed by the same names the Live rack uses. `scope` is
      meaningless here — there is one instrument and one room — so it is
      accepted and ignored. Unknown names are ignored too, the way the bridge
      ignores a name that resolves to nothing in the set. */
  setMacro(name: string, value: number, _scope: MacroScope = 'selected'): void {
    const amount = unit(value)
    switch (name) {
      case 'Energy':
        this.energy = amount
        break
      case 'Length':
        this.length = amount
        break
      case 'Reverb':
        // Sends into the room; 0 leaves it completely dry.
        this.setRamp(this.reverbSend?.gain, amount * 0.75)
        break
      case 'Hi Pass Filter':
        // 20Hz (inaudible, a no-op) up to 2kHz, exponentially — pitch, not Hz,
        // is what the ear reads as an even sweep.
        this.setRamp(this.highpass?.frequency, 20 * Math.pow(100, amount))
        break
      case 'Saturate':
        if (this.saturator) this.saturator.curve = saturationCurve(amount)
        break
    }
  }

  onStatus(listener: (status: EngineStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  /** No hardware behind this source, so this never fires. */
  onExternalTap(): () => void {
    return () => {}
  }

  dispose(): void {
    this.disposed = true
    this.stopLoop()
    this.detachGesture?.()
    this.listeners.clear()
    void this.ctx?.close()
    this.ctx = null
    this.voiceBus = null
    this.reverbSend = null
    this.saturator = null
    this.highpass = null
  }

  // ── Internals ─────────────────────────────────────────────────────

  /** Schedule one hit of the selected pad. Returns the hit's sources so a
      queued loop note can be taken back; a live tap discards them. */
  private fire(when: number, velocity: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    const bus = this.voiceBus
    if (!ctx || !bus) return []
    const voice = KIT[this.pitch - KIT_BASE_PITCH]
    if (!voice) return [] // a pitch outside the pad grid has no sound here
    return playVoice(ctx, bus, voice, when, {
      velocity: Math.min(1, Math.max(0, velocity)),
      energy: this.energy,
      // LENGTH's midpoint is a voice's natural decay; the ends roughly halve
      // and double it.
      lengthScale: 0.45 + this.length * 1.7,
    })
  }

  /** Point the cursor at the first event strictly after `from`. */
  private seekCursor(from: number): void {
    if (this.events.length === 0) return
    const bar = this.barDuration
    let cycle = Math.max(0, Math.floor((from - this.barTop) / bar))
    let index = 0
    while (index < this.events.length && this.barTop + (cycle + this.events[index].pos) * bar <= from) {
      index++
    }
    if (index >= this.events.length) {
      cycle++
      index = 0
    }
    this.cursor = { cycle, index }
  }

  private tick(): void {
    const ctx = this.ctx
    if (!ctx || this.events.length === 0) return
    const horizon = ctx.currentTime + LOOKAHEAD_S
    const bar = this.barDuration

    // Bounded by the horizon, but guard anyway: a pathological bar/pos
    // combination must not spin here forever.
    for (let guard = 0; guard < MAX_LOOP_EVENTS * 4; guard++) {
      const { cycle, index } = this.cursor
      const event = this.events[index]
      const at = this.barTop + (cycle + event.pos) * bar
      if (at > horizon) break
      if (at >= ctx.currentTime) {
        this.queued.push({ at, sources: this.fire(at, event.velocity) })
      }
      const nextIndex = index + 1
      this.cursor =
        nextIndex >= this.events.length
          ? { cycle: cycle + 1, index: 0 }
          : { cycle, index: nextIndex }
    }
    // Notes that have started are no longer ours to cancel.
    this.queued = this.queued.filter((hit) => hit.at > ctx.currentTime)
  }

  /** Un-schedule every queued note that hasn't started. Stopping a source
      before its start time cancels it outright, so nothing is heard. */
  private cancelQueued(): void {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    for (const hit of this.queued) {
      if (hit.at <= now) continue
      for (const source of hit.sources) {
        // A source already stopped throws on a second stop; nothing to undo.
        try {
          source.stop(now)
        } catch {
          /* already finished */
        }
      }
    }
    this.queued = []
  }

  /** Move a parameter over a few milliseconds rather than in one step: an
      instant jump on a live signal clicks. */
  private setRamp(param: AudioParam | undefined, value: number): void {
    const ctx = this.ctx
    if (!param || !ctx) return
    param.setTargetAtTime(value, ctx.currentTime, 0.01)
  }

  private setStatus(next: EngineStatus): void {
    this.status = next
    for (const listener of this.listeners) listener(next)
  }
}
