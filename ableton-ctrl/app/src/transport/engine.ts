/**
 * What a sound source has to be able to do, so the rest of the app can play a
 * note without knowing where it sounds.
 *
 * Two sources are planned: Ableton over the local bridge (BridgeEngine, the
 * original and only one today) and a Web Audio engine that sounds inside this
 * tab, so the prototype can be opened by someone who has no Live set. Because
 * every module already speaks in the bridge's vocabulary — a note at a MIDI
 * pitch, a bar of scheduled events, a macro addressed by *name* — that same
 * vocabulary is the interface, and the Web Audio engine will implement it by
 * resolving those names to its own nodes rather than to Live's parameters.
 */

/** One scheduled loop event: `pos` is 0..1 within the bar. */
export type LoopEvent = { pos: number; velocity: number }

/** Which tracks a macro write lands on. `'selected'` is an instrument property
    (Sound Intent); `'all'` is a property of the room (FX). */
export type MacroScope = 'selected' | 'all'

/** Which source is producing the sound: Live over the local bridge, or the
    Web Audio kit synthesized in this tab. */
export type SoundSourceId = 'ableton' | 'builtin'

/** A badge the status bar shows beside the source label — an extra input the
    source offers, like a hardware pad or a MIDI controller. */
export type StatusTag = { label: string; title: string }

/** Everything the UI needs to say about the source, with no source-specific
    vocabulary left in it: the screens render this, they don't interpret it. */
export type EngineStatus = {
  source: SoundSourceId
  /** True when the source's transport is up, even if it still can't sound: the
      bridge process is reachable but Live isn't open, say. `ready` implies
      this. Auto-selection keys off it — a running bridge means the performer
      wants Ableton, whether or not Live has finished loading. */
  connected: boolean
  /** True when a note fired right now would actually sound. Sessions watch
      this edge to resend their parameters — a source that just came up knows
      nothing about where the sliders are. */
  ready: boolean
  /** One line naming the source, or naming the fault that stops it. */
  label: string
  /** Tooltip explaining what `label` is, when that isn't self-evident. */
  labelTitle: string | null
  tags: StatusTag[]
}

export interface SoundEngine {
  /** Begin whatever the source needs to become ready (connect, open an audio
      context, …). Status arrives through `onStatus`. */
  start(): void

  /** Play one note now. `velocity` is 0..1. */
  noteOn(velocity: number): void

  /** Start looping, or swap the pattern of a running loop. The *engine* owns
      the scheduling: browser timers throttle when the tab is backgrounded, so
      a source must not depend on React to keep time. */
  startLoop(events: readonly LoopEvent[], barDuration: number): void

  stopLoop(): void

  /** Move the mapping: every future note plays on this MIDI pitch. */
  setPitch(pitch: number): void

  /** Set the macro literally named `name` (e.g. "Energy") to `value` (0..127).
      Addressed by name rather than by index so each source can resolve it its
      own way. No-op when the source has nothing by that name. */
  setMacro(name: string, value: number, scope: MacroScope): void

  /** Subscribe; the listener is called immediately with the current status. */
  onStatus(listener: (status: EngineStatus) => void): () => void

  /** Subscribe to taps the source originates itself — a hardware pad played
      into the bridge. Sources with no hardware behind them never fire this. */
  onExternalTap(listener: (velocity: number) => void): () => void

  dispose(): void
}
