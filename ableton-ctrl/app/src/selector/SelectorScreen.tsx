import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { SelectorIcon } from './SelectorIcon.tsx'
import { PATTERNS, type PatternId } from './patterns.ts'
import { useTap } from '../tap/session.tsx'
import './selector.css'

/** The one live mark: pressing it fires the shared tap, exactly like the TAP
    button. The other three are UI placeholders — they select, nothing else. */
const LIVE_PATTERN: PatternId = 'bloom'

const FLASH_MS = 90

/**
 * Selector — four marks, one per gesture. BLOOM is wired to the shared tap
 * trigger (same bar clock, same MIDI note, same sound event as the TAP window);
 * BURST, RIPPLE and LATTICE are placeholders for gestures not built yet.
 */
export function SelectorScreen() {
  const { fireTap, recording } = useTap()
  const [selected, setSelected] = useState<PatternId>(LIVE_PATTERN)
  const [flash, setFlash] = useState(false)
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
    setSelected(id)
    if (id !== LIVE_PATTERN) return
    fireTap()
    setFlash(true)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS)
  }

  return (
    <div className="sel-screen">
      <div className="sel-grid">
        {PATTERNS.map((pattern) => {
          const isLive = pattern.id === LIVE_PATTERN
          return (
            <button
              key={pattern.id}
              type="button"
              className={[
                'sel-button',
                selected === pattern.id ? 'sel-button--selected' : '',
                isLive && flash ? 'sel-button--flash' : '',
                isLive && recording ? 'sel-button--recording' : '',
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
