/**
 * The Ableton sound source: a SoundEngine that plays through the local bridge
 * process (see ableton-ctrl/bridge), which owns the MIDI and OSC sides.
 *
 * Merges two connection layers into a single status for the UI:
 *   - the WebSocket itself (is the bridge process reachable?), and
 *   - the bridge's reported AbletonOSC status (is Live connected, which track?).
 *
 * Auto-reconnects while the bridge is down so starting the bridge after the app
 * "just works".
 */

import type {
  EngineStatus,
  LoopEvent,
  MacroScope,
  MarchEvent,
  SoundEngine,
  StatusTag,
  TrackId,
} from './engine.ts'
import { WebAudioEngine } from './webAudioEngine.ts'

/** The bridge's own two-layer view of the link, before it is flattened into
    the EngineStatus the screens render. */
type LinkState =
  | { link: 'bridge-offline' }
  | { link: 'live-offline'; reason: string; pad: boolean; midi: string | null; notePitch: number }
  | {
      link: 'connected'
      instrument: string | null
      pad: boolean
      midi: string | null
      notePitch: number
    }

/** Frames pushed by the bridge over the socket. */
type StatusFrame =
  | {
      type: 'status'
      connected: true
      instrument: string | null
      trackIndex: number | null
      pad?: boolean
      midi?: string | null
      notePitch?: number
    }
  | {
      type: 'status'
      connected: false
      reason: string
      pad?: boolean
      midi?: string | null
      notePitch?: number
    }
type TapFrame = { type: 'tap'; velocity: number; source?: string }
type Frame = StatusFrame | TapFrame

const DEFAULT_NOTE_PITCH = 36 // C1 — matches the bridge's default before any setPitch

type StatusListener = (status: EngineStatus) => void
type TapListener = (velocity: number) => void

/** The bridge always runs on the same machine as Live, so this is a loopback
    address rather than a setting. */
export const BRIDGE_URL = 'ws://127.0.0.1:8722'

const RECONNECT_MS = 2000

/**
 * Whether reaching for the bridge makes sense from where this page is served.
 *
 * From a deployed page it never does: the bridge is on the visitor's own
 * machine, not the server's, and an https page reaching ws://127.0.0.1 is
 * blocked as mixed content by some browsers anyway. Without this check every
 * visitor's browser would retry a doomed connection every couple of seconds
 * for as long as the page stayed open.
 */
export function isBridgeAddressable(): boolean {
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === ''
}

/**
 * One shot: is a bridge process listening right now? Used to choose a source
 * before committing an engine to it, so nothing has to be torn down to find
 * out. Resolves false rather than rejecting — "no bridge" is an answer.
 */
export function probeBridge(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isBridgeAddressable()) {
      resolve(false)
      return
    }
    let socket: WebSocket
    try {
      socket = new WebSocket(BRIDGE_URL)
    } catch {
      resolve(false)
      return
    }
    const settle = (reachable: boolean) => {
      clearTimeout(timer)
      // Detach first: closing the probe would otherwise re-enter through
      // onclose and settle a second time.
      socket.onopen = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
      resolve(reachable)
    }
    const timer = setTimeout(() => settle(false), timeoutMs)
    socket.onopen = () => settle(true)
    socket.onerror = () => settle(false)
    socket.onclose = () => settle(false)
  })
}

/** A MIDI controller named like Move gets a MOVE tag, else a generic MIDI tag. */
function midiTagLabel(name: string): string {
  return /move/i.test(name) ? 'MOVE' : 'MIDI'
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'live_down':
      return 'Live not running'
    case 'not_installed':
      return 'AbletonOSC not installed'
    default:
      return 'Live not responding'
  }
}

/** Flatten the two link layers into the one line the status bar shows. With
    the bridge process itself down the hardware tags disappear too: they
    describe what that process can see, so without it we know nothing. */
function statusFor(state: LinkState): EngineStatus {
  if (state.link === 'bridge-offline') {
    return {
      source: 'ableton',
      connected: false,
      ready: false,
      label: 'Bridge offline',
      labelTitle: null,
      tags: [],
    }
  }

  const tags: StatusTag[] = []
  if (state.pad) tags.push({ label: 'PAD', title: 'Physical tap pad connected' })
  if (state.midi != null) {
    tags.push({ label: midiTagLabel(state.midi), title: `MIDI tap controller: ${state.midi}` })
  }

  // Either way the socket is open, so the bridge process is up: `connected` is
  // true even when Live is not.
  return state.link === 'connected'
    ? {
        source: 'ableton',
        connected: true,
        ready: true,
        label: state.instrument ?? 'No instrument selected',
        labelTitle: 'Selected instrument',
        tags,
      }
    : {
        source: 'ableton',
        connected: true,
        ready: false,
        label: reasonLabel(state.reason),
        labelTitle: null,
        tags,
      }
}

export class BridgeEngine implements SoundEngine {
  private readonly url: string
  private ws: WebSocket | null = null
  private readonly listeners = new Set<StatusListener>()
  private readonly tapListeners = new Set<TapListener>()
  private status: EngineStatus = statusFor({ link: 'bridge-offline' })
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  /** The built-in engine that carries the March track — see startMarchLoop.
      Built on first use, so a session that never generates a March never opens
      an audio context. */
  private march: WebAudioEngine | null = null
  private mainRunning = false
  private gains: Record<TrackId, number> = { main: 1, march: 0.6 }

  constructor(url: string = BRIDGE_URL) {
    this.url = url
  }

  start(): void {
    if (this.disposed) return
    this.clearReconnect()

    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onmessage = (e) => {
      let frame: Frame
      try {
        frame = JSON.parse(e.data as string)
      } catch {
        return
      }
      if (frame.type === 'tap') {
        for (const listener of this.tapListeners) listener(frame.velocity)
        return
      }
      if (frame.type === 'status') {
        const pad = frame.pad ?? false
        const midi = frame.midi ?? null
        const notePitch = frame.notePitch ?? DEFAULT_NOTE_PITCH
        this.setState(
          frame.connected
            ? { link: 'connected', instrument: frame.instrument, pad, midi, notePitch }
            : { link: 'live-offline', reason: frame.reason, pad, midi, notePitch },
        )
      }
    }

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      this.setState({ link: 'bridge-offline' })
      this.scheduleReconnect()
    }

    // onerror is followed by onclose; let onclose drive the reconnect.
    ws.onerror = () => ws.close()
  }

  /**
   * Fire one tap. `velocity` is 0..1. No-op if the bridge isn't connected.
   *
   * The sound identity is deliberately dropped here. Under this source what a
   * note sounds like is the performer's own rack, selected with the PITCH pad —
   * the app has no business overriding it, and nothing in the protocol carries
   * a per-note pitch yet. So HIT/TICK/SPLASH/SCATTER differ visually under
   * Ableton and sound the same; under the built-in source they differ in both.
   * Giving each identity its own drum-rack pitch is the obvious next step, and
   * needs a bridge-side change to go with it.
   */
  noteOn(velocity = 1): void {
    this.send({ op: 'tap', velocity })
  }

  /** Start looping (or swap the looping pattern). The bridge owns the note
      scheduling — browser timers throttle when the tab is backgrounded. */
  startLoop(events: readonly LoopEvent[], barDuration: number): void {
    this.send({ op: 'loop', events, barDuration })
    // Only the transition matters: Rhythmic Intent re-sends the loop on every
    // knob turn and every added tap, and re-aligning the grid each time would
    // restart March under it.
    if (!this.mainRunning) {
      this.mainRunning = true
      this.march?.alignGrid()
    }
  }

  stopLoop(): void {
    this.mainRunning = false
    this.send({ op: 'stopLoop' })
  }

  /**
   * March, sounding in this tab even when everything else goes to Live.
   *
   * The bridge protocol speaks in one note at a time on one selected
   * instrument; a March bar is three voices at once on a track of its own,
   * which Live would need a second MIDI track and a rack to receive. Until
   * that exists, March plays through a built-in engine held here.
   *
   * The cost is honest and worth stating: this track and Live's are two clocks.
   * `alignGrid` pins March's downbeat to the instant the loop was handed to the
   * bridge, which is as close as the browser can get without knowing Live's own
   * output latency. Under BUILT-IN the two tracks share one context and one
   * grid, and the alignment is exact.
   */
  startMarchLoop(
    events: readonly MarchEvent[],
    phraseDuration: number,
    barDuration: number,
  ): void {
    this.marchTrack().startMarchLoop(events, phraseDuration, barDuration)
  }

  stopMarchLoop(): void {
    this.march?.stopMarchLoop()
  }

  marchPhase(): number | null {
    return this.march?.marchPhase() ?? null
  }

  /** MAIN is Live's own track and its level belongs to Live's mixer, so only
      MARCH is answered here. Held either way, so a fader moved before March
      first sounds is not forgotten. */
  setTrackGain(track: TrackId, gain: number): void {
    this.gains[track] = gain
    if (track === 'march') this.march?.setTrackGain('march', gain)
  }

  /** Move the mapping: every future tap/loop note plays on this MIDI pitch. */
  setPitch(pitch: number): void {
    this.send({ op: 'setPitch', pitch })
  }

  /** Turn the macro literally named `name` (e.g. "Energy") — the bridge
      resolves which device/parameter that is by scanning parameter names, so
      this doesn't assume a macro slot or device index. `value` is 0..127.
      `scope` is `'selected'` (the selected track only — an instrument
      property) or `'all'` (every track that carries the macro — a room
      property, used by FX). No-op if Live is offline or nothing matches. */
  setMacro(name: string, value: number, scope: MacroScope = 'selected'): void {
    this.send({ op: 'setMacro', name, value, scope })
  }

  private marchTrack(): WebAudioEngine {
    if (!this.march) {
      const march = new WebAudioEngine()
      march.start()
      march.setTrackGain('march', this.gains.march)
      // Live's loop is already running by now in the usual case, so give March
      // the best downbeat available rather than none.
      if (this.mainRunning) march.alignGrid()
      this.march = march
    }
    return this.march
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  /** Subscribe; the listener is called immediately with the current status. */
  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  /** Subscribe to physical-pad taps pushed by the bridge. `velocity` is 0..1. */
  onExternalTap(listener: TapListener): () => void {
    this.tapListeners.add(listener)
    return () => this.tapListeners.delete(listener)
  }

  dispose(): void {
    // Stop the loop explicitly rather than leaving it to the bridge's
    // "last client left" cleanup. That cleanup only fires when *no* client
    // remains, so a second browser tab — or the auto-detect probe, which
    // connects as a client every few seconds — is enough to keep Live looping
    // after this engine is gone, with nothing left on screen to stop it.
    this.stopLoop()
    this.disposed = true
    this.march?.dispose()
    this.march = null
    this.clearReconnect()
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
    this.tapListeners.clear()
  }

  private setState(next: LinkState): void {
    this.status = statusFor(next)
    for (const listener of this.listeners) listener(this.status)
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.start()
    }, RECONNECT_MS)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
