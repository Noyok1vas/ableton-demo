import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useSession } from '../rhythmic-intent/session.tsx'
import { BAR_DURATION } from '../rhythmic-intent/types.ts'
import { useSoundIntent } from '../sound-intent/session.tsx'
import { useSelector } from '../selector/session.tsx'
import { useRipple } from '../ripple/session.tsx'
import type { PatternId } from '../selector/patterns.ts'

export type TapSessionValue = {
  /** Fire one combined tap: records the rhythm + live MIDI note (Rhythmic
      Intent) and emits the sound event that blooms the visual (Sound Intent).
      `gesture` overrides the selected one for this tap — the Selector needs it
      because pressing a mark selects and fires in the same press, before React
      has re-rendered with the new selection. */
  fireTap: (gesture?: PatternId) => void
  /** True while Rhythmic Intent is capturing a bar. */
  recording: boolean
}

const TapContext = createContext<TapSessionValue | null>(null)

export function useTap(): TapSessionValue {
  const value = useContext(TapContext)
  if (!value) throw new Error('useTap must be used inside <TapSession>')
  return value
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

/**
 * The one tap trigger, shared by every surface that can fire it (the TAP window
 * and the Selector's BLOOM mark) so they all land on the same bar clock — two
 * independent trackers would disagree about where in the bar a tap fell.
 * Global Space taps too, registered once here rather than per surface.
 */
export function TapSession({ children }: { children: ReactNode }) {
  const { handleTap, capture } = useSession()
  const { emitTap } = useSoundIntent()
  // What the tap *is* — read through refs so choosing a gesture or moving the
  // repeat slider never re-creates fireTap (and with it the Space listener).
  const { gesture: selectedGesture } = useSelector()
  const { count: repeats } = useRipple()
  const gestureRef = useRef(selectedGesture)
  gestureRef.current = selectedGesture
  const repeatsRef = useRef(repeats)
  repeatsRef.current = repeats

  // Mirror of useTapCapture's bar window, tracked here synchronously so the
  // sound event carries the tap's 0..1 position within the bar: the first tap
  // opens the window (pos 0), later taps read elapsed/BAR_DURATION, and a tap
  // past the window starts a fresh bar.
  const barStartRef = useRef<number | null>(null)

  // Rhythmic RESET returns the capture to 'ready' — the next tap must count as
  // a new bar even if the old window's 2s haven't elapsed.
  useEffect(() => {
    if (capture.state === 'ready') barStartRef.current = null
  }, [capture.state])

  const fireTap = useCallback((gesture?: PatternId) => {
    const now = performance.now()
    const elapsed =
      barStartRef.current === null ? Infinity : (now - barStartRef.current) / 1000
    const newBar = elapsed >= BAR_DURATION
    if (newBar) barStartRef.current = now
    handleTap()
    // One MIDI note either way for now: RIPPLE's repeats are drawn, not sounded
    // — the note-per-repeat send is the next step.
    emitTap(
      newBar ? 0 : elapsed / BAR_DURATION,
      newBar,
      gesture ?? gestureRef.current,
      repeatsRef.current,
    )
  }, [handleTap, emitTap])

  // Global Space → combined tap, unless focus is in a text input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (isTextInput(document.activeElement)) return
      e.preventDefault()
      fireTap()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fireTap])

  const value = useMemo<TapSessionValue>(
    () => ({ fireTap, recording: capture.state === 'recording' }),
    [fireTap, capture.state],
  )

  return <TapContext.Provider value={value}>{children}</TapContext.Provider>
}
