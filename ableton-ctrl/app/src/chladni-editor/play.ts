import { useCallback } from 'react'
import { useSoundEngine } from '../transport/session.tsx'
import type { SoundVoiceId } from '../transport/engine.ts'
import { useDrum } from '../chladni2/session.tsx'

/** Every editor tap is played at this velocity, so what changes between
    taps is only the figure and the knobs. */
export const EDITOR_VELOCITY = 0.85

/** Play one of the eight sounds at its knobs (the Sound Controls, shared
    with Chladni 2) and nothing else: the editor never records into the loop. */
export function usePlaySound(): (id: SoundVoiceId) => void {
  const { noteOn } = useSoundEngine()
  const { snapshot } = useDrum()
  return useCallback(
    (id: SoundVoiceId) => noteOn(EDITOR_VELOCITY, id, undefined, snapshot(id)),
    [noteOn, snapshot],
  )
}
