import { useCallback } from 'react'
import { useSoundEngine } from '../transport/session.tsx'
import type { SoundVoiceId } from '../transport/engine.ts'

/** Every editor tap is played at this velocity: the sounds are fixed here,
    so the only thing that changes between taps is the figure. */
export const EDITOR_VELOCITY = 0.85

/** Play one of the eight sounds as it is — its own base voice, no character,
    no knobs — and nothing else: the editor never records into the loop. */
export function usePlaySound(): (id: SoundVoiceId) => void {
  const { noteOn } = useSoundEngine()
  return useCallback((id: SoundVoiceId) => noteOn(EDITOR_VELOCITY, id), [noteOn])
}
