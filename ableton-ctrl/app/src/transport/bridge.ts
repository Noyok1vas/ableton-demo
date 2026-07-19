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
  | { link: 'live-offline'; reason: string; pad: boolean; midi: string | null }
  | { link: 'connected'; instrument: string | null; pad: boolean; midi: string | null }

/** One scheduled loop event: `pos` is 0..1 within the bar. */
export type LoopEvent = { pos: number; velocity: number }

/** Frames pushed by the bridge over the socket. */
type StatusFrame =
  | {
      type: 'status'
      connected: true
      instrument: string | null
      trackIndex: number | null
      pad?: boolean
      midi?: string | null
    }
  | { type: 'status'; connected: false; reason: string; pad?: boolean; midi?: string | null }
type TapFrame = { type: 'tap'; velocity: number; source?: string }
type Frame = StatusFrame | TapFrame

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
        this.setState(
          frame.connected
            ? { link: 'connected', instrument: frame.instrument, pad, midi }
            : { link: 'live-offline', reason: frame.reason, pad, midi },
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
