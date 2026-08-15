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
 * Two tracks play through it. MAIN is every tap: the four Selector identities
 * (see SOUND_TYPE_KIT), or the selected pad for a tap that carries none, both
 * shaped by Sound Intent and held in Rhythmic Intent's loop. MARCH is the
 * generated percussion layer,
 * with its own length and its own fader, which is what lets it sit *behind* the
 * other one. They meet at the room, so FX describes both, and — the part that
 * matters musically — they count from one shared downbeat, `gridTop`.
 *
 *   main ──▶ mainGain ──┐
 *                       ├─▶ voices ─┬──────────────────┬─▶ sat ─▶ HP ─▶ out
 *   march ─▶ marchGain ─┘           └─▶ send ─▶ room ──┘
 */

import type {
  EngineStatus,
  LoopEvent,
  MacroScope,
  MarchEvent,
  SoundEngine,
  SoundVoiceId,
  TrackId,
} from './engine.ts'
import { KIT, KIT_BASE_PITCH, MARCH_KIT, playVoice, resolveSoundVoice } from './kit.ts'

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
 * turned mid-loop take that long to be heard. `cancel` buys that back by
 * un-scheduling the notes a swap invalidates.
 */
const LOOKAHEAD_S = 1.5
const TICK_MS = 25

/** Cap matching the bridge's MAX_LOOP_EVENTS, so a pattern that plays under
    one source can't be denser under the other. */
const MAX_LOOP_EVENTS = 128

/** A five-bar March at a 1/16 grid across three voices. */
const MAX_MARCH_EVENTS = 5 * 16 * 3

/** A hair of head start when a track defines the grid itself, so its own first
    note isn't scheduled at exactly `currentTime` — which is to say, dropped. */
const LAUNCH_LEAD = 0.05

const MACRO_MAX = 127

/** Sound Intent and FX both send 0..127; everything here works in 0..1. */
const unit = (value: number) => Math.min(1, Math.max(0, value / MACRO_MAX))

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

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

type QueuedHit = { at: number; sources: AudioScheduledSourceNode[] }

/**
 * One looping track: a sorted event list, how long a pass takes, when pass zero
 * began, and a cursor into the next event to queue.
 *
 * There are two of these because MAIN and MARCH genuinely differ — different
 * lengths, different voices, started and stopped independently — while the
 * machinery of queueing ahead of the clock and taking queued notes back is
 * identical for both.
 */
class LoopTrack<E extends { pos: number }> {
  events: E[] = []
  /** Seconds one pass takes. */
  period = 2
  /** Context time at which pass zero begins. May be in the future: that is a
      track waiting for its downbeat. */
  top = 0
  running = false

  private cursor = { cycle: 0, index: 0 }
  private queued: QueuedHit[] = []

  /** Point the cursor at the first event strictly after `from`. */
  seek(from: number): void {
    if (this.events.length === 0) return
    let cycle = Math.max(0, Math.floor((from - this.top) / this.period))
    let index = 0
    while (
      index < this.events.length &&
      this.top + (cycle + this.events[index].pos) * this.period <= from
    ) {
      index++
    }
    if (index >= this.events.length) {
      cycle++
      index = 0
    }
    this.cursor = { cycle, index }
  }

  /** Hand every event up to `horizon` to `fire`, which schedules it and returns
      the sources so they can be taken back later. */
  pump(
    now: number,
    horizon: number,
    fire: (event: E, at: number) => AudioScheduledSourceNode[],
  ): void {
    if (this.events.length === 0) return
    // Bounded by the horizon, but guard anyway: a pathological period/pos
    // combination must not spin here forever.
    for (let guard = 0; guard < MAX_MARCH_EVENTS * 4; guard++) {
      const { cycle, index } = this.cursor
      const event = this.events[index]
      const at = this.top + (cycle + event.pos) * this.period
      if (at > horizon) break
      if (at >= now) this.queued.push({ at, sources: fire(event, at) })
      const next = index + 1
      this.cursor =
        next >= this.events.length ? { cycle: cycle + 1, index: 0 } : { cycle, index: next }
    }
    // Notes that have started are no longer ours to cancel.
    this.queued = this.queued.filter((hit) => hit.at > now)
  }

  /** Un-schedule every queued note that hasn't started. Stopping a source
      before its start time cancels it outright, so nothing is heard. */
  cancel(now: number): void {
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

  /** 0..1 through the current pass, or null before pass zero begins. */
  phase(now: number): number | null {
    if (now < this.top) return null
    return ((now - this.top) % this.period) / this.period
  }
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
  // The shared bus the two faders feed is built and wired in `start()` and
  // never touched again, so it is a local there rather than a field.
  private mainGain: GainNode | null = null
  private marchGain: GainNode | null = null
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
  /** Fader positions, held here as well as on the nodes so they survive being
      set before the context exists. */
  private gains: Record<TrackId, number> = { main: 1, march: 0.6 }

  // ── Loop state ────────────────────────────────────────────────────
  private readonly main = new LoopTrack<LoopEvent>()
  private readonly march = new LoopTrack<MarchEvent>()
  /** Context time of the downbeat both tracks count from. Preserved across
      pattern swaps so a knob turned mid-loop doesn't restart the bar. */
  private gridTop = 0
  /** One March bar, kept so a phrase can be launched on a bar line of the
      grid rather than wherever the gesture happened to end. */
  private marchBar = 1
  private ticker: ReturnType<typeof setInterval> | null = null

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

    // The two faders. Both feed the same bus, so the room and the master chain
    // are shared — a mixer, not two separate outputs.
    const mainGain = ctx.createGain()
    mainGain.gain.value = this.gains.main
    mainGain.connect(voiceBus)
    this.mainGain = mainGain

    const marchGain = ctx.createGain()
    marchGain.gain.value = this.gains.march
    marchGain.connect(voiceBus)
    this.marchGain = marchGain

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

  noteOn(velocity = 1, voice?: SoundVoiceId, character?: number): void {
    const ctx = this.ctx
    if (!ctx) return
    // A tap *is* a gesture, so this is the moment a suspended context can
    // legally start; the note itself lands a few ms later.
    if (ctx.state !== 'running') void ctx.resume()
    this.fire(ctx.currentTime, velocity, voice, character)
  }

  startLoop(events: readonly LoopEvent[], barDuration: number): void {
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state !== 'running') void ctx.resume()

    const wasRunning = this.main.running
    this.main.events = [...events].sort((a, b) => a.pos - b.pos).slice(0, MAX_LOOP_EVENTS)
    this.main.period = clamp(barDuration, 0.25, 30)
    this.main.running = true

    // A loop starting from nothing lays down the grid — and a March already
    // running re-phases onto it, because two tracks with two downbeats is the
    // one thing this must never be. A swap keeps the grid, so turning a knob
    // doesn't restart the bar.
    //
    // No launch lead here, unlike March: the first tap sounds its own note
    // immediately, and a grid pushed 50ms into the future would make the loop's
    // opening note flam against it.
    if (!wasRunning) this.setGrid(ctx.currentTime)
    this.main.top = this.gridTop

    // Take back everything still queued and re-queue from now, so the new
    // pattern is heard at once rather than after the lookahead drains.
    this.main.cancel(ctx.currentTime)
    this.main.seek(ctx.currentTime)
    this.ensureTicker()
  }

  stopLoop(): void {
    // Without this the loop would keep sounding for a lookahead's worth of
    // notes after PAUSE. Notes already ringing are left alone — stopping the
    // loop silences what comes next, not what is decaying.
    this.main.cancel(this.ctx?.currentTime ?? 0)
    this.main.events = []
    this.main.running = false
    this.stopTickerIfIdle()
  }

  startMarchLoop(
    events: readonly MarchEvent[],
    phraseDuration: number,
    barDuration: number,
  ): void {
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state !== 'running') void ctx.resume()

    this.march.events = [...events].sort((a, b) => a.pos - b.pos).slice(0, MAX_MARCH_EVENTS)
    this.march.period = clamp(phraseDuration, 0.25, 60)
    this.march.running = true
    this.marchBar = clamp(barDuration, 0.125, 30)

    const from = ctx.currentTime + LAUNCH_LEAD
    // With nothing else playing, March is what defines the grid. With the tapped
    // loop already running it joins on that loop's next bar line, so the phrase
    // opens on a downbeat the listener can already feel.
    if (!this.main.running) this.gridTop = from
    this.march.top = this.nextBar(from)

    this.march.cancel(ctx.currentTime)
    this.march.seek(ctx.currentTime)
    this.ensureTicker()
  }

  stopMarchLoop(): void {
    this.march.cancel(this.ctx?.currentTime ?? 0)
    this.march.events = []
    this.march.running = false
    this.stopTickerIfIdle()
  }

  marchPhase(): number | null {
    const ctx = this.ctx
    if (!ctx || !this.march.running) return null
    return this.march.phase(ctx.currentTime)
  }

  setTrackGain(track: TrackId, gain: number): void {
    const value = clamp(gain, 0, 1)
    this.gains[track] = value
    this.setRamp((track === 'march' ? this.marchGain : this.mainGain)?.gain, value)
  }

  /**
   * Put the shared downbeat at this instant.
   *
   * For the bridge engine, which plays its own loop in Live and borrows this
   * one only for March: it can say *when* Live's loop started even though it
   * cannot hand over the loop itself.
   */
  alignGrid(): void {
    const ctx = this.ctx
    if (ctx) this.setGrid(ctx.currentTime)
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
    this.stopMarchLoop()
    this.detachGesture?.()
    this.listeners.clear()
    void this.ctx?.close()
    this.ctx = null
    this.mainGain = null
    this.marchGain = null
    this.reverbSend = null
    this.saturator = null
    this.highpass = null
  }

  // ── Internals ─────────────────────────────────────────────────────

  /** Move the grid, taking whatever is already running with it. */
  private setGrid(at: number): void {
    this.gridTop = at
    this.main.top = at
    if (this.march.running && this.ctx) {
      this.march.top = this.nextBar(at)
      this.march.cancel(this.ctx.currentTime)
      this.march.seek(this.ctx.currentTime)
    }
  }

  /** The first bar line of the grid at or after `after`. */
  private nextBar(after: number): number {
    const offset = Math.max(0, after - this.gridTop)
    return this.gridTop + Math.ceil(offset / this.marchBar) * this.marchBar
  }

  /**
   * Schedule one note. A note that carries a sound identity plays that
   * identity's voice — HIT is a kick wherever it is played from, which is what
   * makes the four Selector marks four sounds rather than four pictures of the
   * same one. A note without one falls back to the pad the PITCH mapping
   * selects, which is how a hardware pad's own taps still play what is under
   * the finger.
   *
   * `character` is the identity's axis as the event recorded it, so a loop
   * replays each note at the hardness or openness it was played with rather
   * than at whatever the Selector says now. HIT's axis IS energy, which is why
   * the resolver can hand one back and override the live macro for that note.
   *
   * Returns the hit's sources so a queued loop note can be taken back; a live
   * tap discards them.
   */
  private fire(
    when: number,
    velocity: number,
    sound?: SoundVoiceId,
    character?: number,
  ): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    const bus = this.mainGain
    if (!ctx || !bus) return []
    const identity = sound ? resolveSoundVoice(sound, character) : undefined
    const voice = identity?.voice ?? KIT[this.pitch - KIT_BASE_PITCH]
    if (!voice) return [] // a pitch outside the pad grid has no sound here
    return playVoice(ctx, bus, voice, when, {
      velocity: Math.min(1, Math.max(0, velocity)) * (identity?.level ?? 1),
      energy: identity?.energy ?? this.energy,
      // LENGTH's midpoint is a voice's natural decay; the ends roughly halve
      // and double it.
      lengthScale: 0.45 + this.length * 1.7,
    })
  }

  /** Schedule one March note. Its colour is fixed in the kit rather than taken
      from ENERGY and LENGTH: March is a second instrument, not the one Sound
      Intent is shaping. */
  private fireMarch(event: MarchEvent, when: number): AudioScheduledSourceNode[] {
    const ctx = this.ctx
    const bus = this.marchGain
    if (!ctx || !bus) return []
    const { voice, ...params } = MARCH_KIT[event.voice]
    return playVoice(ctx, bus, voice, when, params)
  }

  private ensureTicker(): void {
    if (this.ticker !== null) return
    this.tick()
    this.ticker = setInterval(() => this.tick(), TICK_MS)
  }

  private stopTickerIfIdle(): void {
    if (this.ticker === null || this.main.running || this.march.running) return
    clearInterval(this.ticker)
    this.ticker = null
  }

  private tick(): void {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const horizon = now + LOOKAHEAD_S
    this.main.pump(now, horizon, (event, at) =>
      this.fire(at, event.velocity, event.voice, event.character),
    )
    this.march.pump(now, horizon, (event, at) => this.fireMarch(event, at))
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
