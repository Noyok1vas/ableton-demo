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
import { useSoundIntent } from '../sound-intent/session.tsx'
import { useSelector } from '../selector/session.tsx'
import { characterOf } from '../selector/character.ts'
import { useRipple } from '../ripple/session.tsx'
import { useMod } from '../mod/session.tsx'
import type { PatternId } from '../selector/patterns.ts'

export type TapSessionValue = {
  /** Fire one combined tap: records the rhythm + live MIDI note (Rhythmic
      Intent) and emits the sound event that blooms the visual (Sound Intent).
      `gesture` overrides the selected one for this tap — the Selector needs it
      because pressing a mark selects and fires in the same press, before React
      has re-rendered with the new selection. `accented` plays this one tap at
      full velocity whatever the Selector's velocity says — Shift+Space.
      While a mod strip is in use (see mod/session) the press auditions
      instead: heard and shown, never recorded. */
  fireTap: (gesture?: PatternId, accented?: boolean) => void
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

/** Controls that act on Enter themselves, so the global PLAY/STOP must not. */
function isPressable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'BUTTON' || tag === 'A' || el.getAttribute('role') === 'slider'
}

/**
 * The one tap trigger, shared by every surface that can fire it (the TAP window
 * and the Selector's pads) so they all land on the same bar clock — two
 * independent trackers would disagree about where in the bar a tap fell.
 * Global keys too, registered once here rather than per surface: Space taps
 * (Shift+Space taps accented) and Enter is PLAY/STOP.
 */
export function TapSession({ children }: { children: ReactNode }) {
  const { handleTap, capture, togglePlay } = useSession()
  const { emitTap } = useSoundIntent()
  // What the tap *is* — read through refs so choosing a gesture or moving the
  // repeat slider never re-creates fireTap (and with it the Space listener).
  const {
    gesture: selectedGesture,
    character,
    currentCharacter,
    currentVelocity,
  } = useSelector()
  const currentVelocityRef = useRef(currentVelocity)
  currentVelocityRef.current = currentVelocity
  // While a mod strip is in use a press auditions instead of recording — read
  // through a ref so the Space listener sees the mode at the moment of the key.
  const mod = useMod()
  const modRef = useRef(mod)
  modRef.current = mod
  const { count: repeats } = useRipple()
  const gestureRef = useRef(selectedGesture)
  gestureRef.current = selectedGesture
  const repeatsRef = useRef(repeats)
  repeatsRef.current = repeats
  // The selected identity's live character, and a lookup for any identity —
  // the Selector fires a mark in the same press that selects it, so it needs
  // the character of a mark the session has not been told about yet.
  const currentCharacterRef = useRef(currentCharacter)
  currentCharacterRef.current = currentCharacter
  const characterRef = useRef((id: PatternId) => characterOf(id, character))
  characterRef.current = (id: PatternId) => characterOf(id, character)

  // Where in the loop a tap falls is the capture's business alone now — it owns
  // the one loop clock, and hands back the id of the tap it filed. The sound
  // event carries that id instead of a position: the Sound Visual looks the
  // position up in the transformed pattern, so a knob move or an edit moves the
  // mark it drew for that tap.
  const fireTap = useCallback((gesture?: PatternId, accented = false) => {
    const sound = gesture ?? gestureRef.current
    if (modRef.current.isActive()) {
      modRef.current.audition(sound, accented)
      return
    }
    // The character is read HERE, once, at the instant of the press — this is
    // the "capture" step of the model. Everything downstream receives a copy.
    // `gesture` overriding means the Selector's own press has to look the
    // character up for the mark it just chose, not the one that was selected.
    const character = gesture ? characterRef.current(gesture) : currentCharacterRef.current()
    // The identity and character go to the capture as well as to the visual:
    // they are what the tap WAS, so the loop has to replay it as that sound and
    // not as whatever is selected by the time the loop comes round again.
    // Velocity is read at the same instant, for the same reason.
    const velocity = currentVelocityRef.current(accented)
    const id = handleTap(sound, character ?? undefined, velocity)
    emitTap(id, sound, repeatsRef.current, character)
  }, [handleTap, emitTap])

  // Global keys, unless focus is in a text input: Space taps (Shift accents
  // it), Enter starts and stops the loop.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTextInput(document.activeElement)) return
      if (e.code === 'Space') {
        e.preventDefault()
        fireTap(undefined, e.shiftKey)
      } else if (e.key === 'Enter' && !isPressable(document.activeElement)) {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fireTap, togglePlay])

  const value = useMemo<TapSessionValue>(
    () => ({ fireTap, recording: capture.state === 'recording' }),
    [fireTap, capture.state],
  )

  return <TapContext.Provider value={value}>{children}</TapContext.Provider>
}
