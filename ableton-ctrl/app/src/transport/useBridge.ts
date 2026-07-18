import { useCallback, useEffect, useRef, useState } from 'react'
import { BridgeClient, type LinkState } from './bridge.ts'

export type Bridge = {
  state: LinkState
  /** Fire one live MIDI tap on the bridge. `velocity` is 0..1. */
  sendTap: (velocity?: number) => void
}

/** Owns a single BridgeClient for the component's lifetime. */
export function useBridge(): Bridge {
  const [state, setState] = useState<LinkState>({ link: 'bridge-offline' })
  const clientRef = useRef<BridgeClient | null>(null)

  useEffect(() => {
    const client = new BridgeClient()
    clientRef.current = client
    const unsubscribe = client.onState(setState)
    client.connect()
    return () => {
      unsubscribe()
      client.dispose()
      clientRef.current = null
    }
  }, [])

  const sendTap = useCallback((velocity = 1) => {
    clientRef.current?.sendTap(velocity)
  }, [])

  return { state, sendTap }
}
