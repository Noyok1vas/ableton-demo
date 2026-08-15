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

/**
 * The four sound identities a tap can carry — the Selector's marks, named here
 * for the same reason MarchVoiceId is: the *engine* resolves an identity to a
 * sound. Everything above only says which of the four a tap was.
 *
 *   hit     — the rhythmic weight: a kick
 *   tick    — the lighter rhythmic event: a hi-hat
 *   splash  — the accent: a clap
 *   scatter — the atmosphere: a soft noise texture, not a drum hit
 *
 * A note with no identity plays the pad the PITCH mapping selects, which is
 * what a hardware pad's own taps do.
 */
export type SoundVoiceId = 'hit' | 'tick' | 'splash' | 'scatter'

/**
 * One scheduled loop event: `pos` is 0..1 within the bar. `voice` is the sound
 * identity the tap was played with (absent means the selected pad), and
 * `character` is that identity's one axis at the moment of input, 0..1 —
 * absent for an identity that has none (SPLASH) and for a hardware pad's taps.
 *
 * Character travels WITH the event rather than being read from the Selector at
 * play time. That is the whole of the v0.3 model: an event is a snapshot, so a
 * loop can hold a soft hit and a hard one, and moving the slider afterwards
 * changes neither.
 */
export type LoopEvent = {
  pos: number
  velocity: number
  voice?: SoundVoiceId
  character?: number
}

/** The three fixed voices of the March instrument. They are named here rather
    than in the March module because the *engine* is what resolves a voice to a
    sound — March only says which of the three a step belongs to. */
export type MarchVoiceId = 'low' | 'high' | 'tick'

/** One scheduled March note: `pos` is 0..1 within the whole phrase, not within
    a bar, so a five-bar phrase is one loop rather than five. */
export type MarchEvent = { voice: MarchVoiceId; pos: number }

/** The two tracks the mixer knows about. `'main'` is everything a tap plays —
    Rhythmic Intent's loop and the instrument Sound Intent shapes; `'march'` is
    the March layer, which is why it can sit under the other one. */
export type TrackId = 'main' | 'march'

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

  /** Play one note now. `velocity` is 0..1; `voice` is the sound identity it
      was played with (or absent for the selected pad) and `character` that
      identity's axis at the moment of input. */
  noteOn(velocity: number, voice?: SoundVoiceId, character?: number): void

  /** Start looping, or swap the pattern of a running loop. The *engine* owns
      the scheduling: browser timers throttle when the tab is backgrounded, so
      a source must not depend on React to keep time. */
  startLoop(events: readonly LoopEvent[], barDuration: number): void

  stopLoop(): void

  /** Start looping the March phrase, or swap the phrase of a running one.
   *
   * Two loops run side by side rather than one, because March is a second
   * track: it has its own length (a phrase is one to five bars, the tapped loop
   * is always two) and its own level. What they share is the grid — the engine
   * launches March on the next `barDuration` boundary of the loop that is
   * already running, so the two tracks agree about where the downbeat is
   * instead of merely agreeing about tempo. */
  startMarchLoop(
    events: readonly MarchEvent[],
    phraseDuration: number,
    barDuration: number,
  ): void

  stopMarchLoop(): void

  /** 0..1 through the March phrase; null when March is stopped, and null while
      it is queued and waiting for its downbeat. The windows draw their playhead
      from this, so what is drawn is what is scheduled. */
  marchPhase(): number | null

  /** Level of one track, 0..1. Two tracks, two faders — the reason March can be
      the rhythm *behind* the rhythm rather than a second one competing with it. */
  setTrackGain(track: TrackId, gain: number): void

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
