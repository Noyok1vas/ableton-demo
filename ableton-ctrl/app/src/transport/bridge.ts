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
  | { link: 'live-offline'; reason: string }
  | { link: 'connected'; instrument: string | null }

/** Status frame pushed by the bridge over the socket. */
type StatusFrame =
  | { type: 'status'; connected: true; instrument: string | null; trackIndex: number | null }
  | { type: 'status'; connected: false; reason: string }

type Listener = (state: LinkState) => void

const DEFAULT_URL = 'ws://127.0.0.1:8722'
const RECONNECT_MS = 2000

export class BridgeClient {
  private readonly url: string
  private ws: WebSocket | null = null
  private readonly listeners = new Set<Listener>()
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
      let frame: StatusFrame
      try {
        frame = JSON.parse(e.data as string)
      } catch {
        return
      }
      if (frame.type !== 'status') return
      this.setState(
        frame.connected
          ? { link: 'connected', instrument: frame.instrument }
          : { link: 'live-offline', reason: frame.reason },
      )
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op: 'tap', velocity }))
    }
  }

  /** Subscribe; the listener is called immediately with the current state. */
  onState(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.disposed = true
    this.clearReconnect()
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
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
