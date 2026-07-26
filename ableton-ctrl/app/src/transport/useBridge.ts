import { useCallback, useEffect, useRef, useState } from 'react'
import { BridgeClient, type LinkState, type LoopEvent, type MacroScope } from './bridge.ts'

export type Bridge = {
  state: LinkState
  /** Fire one live MIDI tap on the bridge. `velocity` is 0..1. */
  sendTap: (velocity?: number) => void
  /** Start or update the bridge-side loop with the given bar of events. */
  sendLoop: (events: readonly LoopEvent[], barDuration: number) => void
  sendStopLoop: () => void
  /** Move the mapping: every future tap/loop note plays on this MIDI pitch. */
  sendSetPitch: (pitch: number) => void
  /** Turn the macro literally named `name` (e.g. "Energy") to `value`
      (0..127) — resolved by name, not a slot number. `scope` picks the
      selected track (default) or every track carrying the macro. */
  sendMacro: (name: string, value: number, scope?: MacroScope) => void
  /** Subscribe to physical-pad taps; returns an unsubscribe. Stable identity. */
  onTap: (listener: (velocity: number) => void) => () => void
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

  const sendLoop = useCallback((events: readonly LoopEvent[], barDuration: number) => {
    clientRef.current?.sendLoop(events, barDuration)
  }, [])

  const sendStopLoop = useCallback(() => {
    clientRef.current?.sendStopLoop()
  }, [])

  const sendSetPitch = useCallback((pitch: number) => {
    clientRef.current?.sendSetPitch(pitch)
  }, [])

  const sendMacro = useCallback((name: string, value: number, scope?: MacroScope) => {
    clientRef.current?.sendMacro(name, value, scope)
  }, [])

  const onTap = useCallback((listener: (velocity: number) => void) => {
    // Bridge outlives individual renders; guard in case it's mid-teardown.
    return clientRef.current?.onTap(listener) ?? (() => {})
  }, [])

  return { state, sendTap, sendLoop, sendStopLoop, sendSetPitch, sendMacro, onTap }
}
