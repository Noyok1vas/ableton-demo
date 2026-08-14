import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { SelectorIcon } from './SelectorIcon.tsx'
import { PATTERNS, type PatternId } from './patterns.ts'
import { useSelector } from './session.tsx'
import { useTap } from '../tap/session.tsx'
import './selector.css'

/** The marks that are built: pressing one selects it AND fires the shared tap,
    so the gesture sounds and draws in the same press. SPLASH and SCATTER are UI
    placeholders — they select, nothing else. */
const LIVE_PATTERNS: readonly PatternId[] = ['bloom', 'ripple']

const FLASH_MS = 90

/**
 * Selector — four marks, one per gesture. The selection is not this window's
 * private state: it says what a tap IS, wherever the tap comes from (this
 * window, the TAP button, Space), which mark the Sound Visual draws, and — for
 * ROLL — that the tap carries its repeats.
 */
export function SelectorScreen() {
  const { fireTap, recording } = useTap()
  const { gesture, setGesture } = useSelector()
  const [flashing, setFlashing] = useState<PatternId | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    },
    [],
  )

  // pointerdown, not click: a tap has to land at press time, not on release.
  const handlePointerDown = (id: PatternId) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setGesture(id)
    if (!LIVE_PATTERNS.includes(id)) return
    // Pass `id` explicitly: setGesture hasn't re-rendered yet, so the session's
    // own view of the selection is still the previous mark.
    fireTap(id)
    setFlashing(id)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashing(null), FLASH_MS)
  }

  return (
    <div className="sel-screen">
      <div className="sel-grid">
        {PATTERNS.map((pattern) => {
          const isSelected = gesture === pattern.id
          return (
            <button
              key={pattern.id}
              type="button"
              className={[
                'sel-button',
                isSelected ? 'sel-button--selected' : '',
                flashing === pattern.id ? 'sel-button--flash' : '',
                isSelected && recording ? 'sel-button--recording' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerDown={handlePointerDown(pattern.id)}
              // Space is the global tap key and Enter would double-report it.
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
              }}
            >
              <SelectorIcon pattern={pattern} />
              <span className="sel-label">{pattern.label.toUpperCase()}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
