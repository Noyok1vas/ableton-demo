/**
 * WebSocket client for the Rhythmic Intent bridge (see ableton-ctrl/bridge).
 *
 * Merges two connection layers into a single LinkState for the UI:
 *   - the WebSocket itself (is the bridge process reachable?), and
 *   - the bridge's reported AbletonOSC status (is Live connected, which track?).
 *
 * Auto-reconnects while the bridge is down so starting the bridge after the app
 * "just works".
 */

export type LinkState =
  | { link: 'bridge-offline' }
  | { link: 'live-offline'; reason: string; pad: boolean; midi: string | null; notePitch: number }
  | {
      link: 'connected'
      instrument: string | null
      pad: boolean
      midi: string | null
      notePitch: number
    }

/** One scheduled loop event: `pos` is 0..1 within the bar. */
export type LoopEvent = { pos: number; velocity: number }

/** Which tracks a macro write lands on. `'selected'` is an instrument property
    (Sound Intent); `'all'` is a property of the room (FX). */
export type MacroScope = 'selected' | 'all'

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

type Listener = (state: LinkState) => void
type TapListener = (velocity: number) => void

const DEFAULT_URL = 'ws://127.0.0.1:8722'
const RECONNECT_MS = 2000

export class BridgeClient {
  private readonly url: string
  private ws: WebSocket | null = null
  private readonly listeners = new Set<Listener>()
  private readonly tapListeners = new Set<TapListener>()
  private state: LinkState = { link: 'bridge-offline' }
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(url: string = DEFAULT_URL) {
    this.url = url
  }

  connect(): void {
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

  /** Fire one tap. `velocity` is 0..1. No-op if the bridge isn't connected. */
  sendTap(velocity = 1): void {
    this.send({ op: 'tap', velocity })
  }

  /** Start looping (or swap the looping pattern). The bridge owns the note
      scheduling — browser timers throttle when the tab is backgrounded. */
  sendLoop(events: readonly LoopEvent[], barDuration: number): void {
    this.send({ op: 'loop', events, barDuration })
  }

  sendStopLoop(): void {
    this.send({ op: 'stopLoop' })
  }

  /** Move the mapping: every future tap/loop note plays on this MIDI pitch. */
  sendSetPitch(pitch: number): void {
    this.send({ op: 'setPitch', pitch })
  }

  /** Turn the macro literally named `name` (e.g. "Energy") — the bridge
      resolves which device/parameter that is by scanning parameter names, so
      this doesn't assume a macro slot or device index. `value` is 0..127.
      `scope` is `'selected'` (the selected track only — an instrument
      property) or `'all'` (every track that carries the macro — a room
      property, used by FX). No-op if Live is offline or nothing matches. */
  sendMacro(name: string, value: number, scope: MacroScope = 'selected'): void {
    this.send({ op: 'setMacro', name, value, scope })
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  /** Subscribe; the listener is called immediately with the current state. */
  onState(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  /** Subscribe to physical-pad taps pushed by the bridge. `velocity` is 0..1. */
  onTap(listener: TapListener): () => void {
    this.tapListeners.add(listener)
    return () => this.tapListeners.delete(listener)
  }

  dispose(): void {
    this.disposed = true
    this.clearReconnect()
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
    this.tapListeners.clear()
  }

  private setState(next: LinkState): void {
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_MS)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
