import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { SoundPreview } from './SoundPreview.tsx'
import { PATTERNS, type PatternId } from './patterns.ts'
import { useSelector } from './session.tsx'
import { useTap } from '../tap/session.tsx'
import { useMod } from '../mod/session.tsx'
import { useSoundEngine } from '../transport/session.tsx'
import './selector.css'

const FLASH_MS = 90

/**
 * Sound Selector — the pads. Eight fixed marks, one per sound, 4×2 — the same
 * rack the Main Screen shows while a mod strip is held, cell for cell.
 *
 * A press selects the pad and plays it, in one of two modes:
 *
 *   on its own          it records: the sound goes into the loop
 *   with a strip held   it auditions: heard and shown large on the Main
 *                       Screen, never recorded
 *
 * What the sound is LIKE — velocity and character — is set on the mod strips
 * beside the pads, and each pad shows it: its mark redraws at its own
 * character and scales with the velocity.
 */
export function SelectorScreen() {
  const { fireTap, recording } = useTap()
  const { gesture, setGesture, character, currentVelocity } = useSelector()
  const velocity = currentVelocity()
  const { active: auditioning } = useMod()
  const { status, source } = useSoundEngine()
  const [flashing, setFlashing] = useState<PatternId | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const needsUnlock = source === 'builtin' && !status.ready

  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    },
    [],
  )

  const flash = (id: PatternId) => {
    setFlashing(id)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashing(null), FLASH_MS)
  }

  // pointerdown, not click: a tap has to land at press time, not on release.
  const handlePointerDown = (id: PatternId) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setGesture(id)
    // Pass `id` explicitly: setGesture hasn't re-rendered yet, so the session's
    // own view of the selection is still the previous mark. fireTap itself
    // decides between recording and auditioning.
    fireTap(id)
    flash(id)
  }

  return (
    // Two fingers here (a pad and a strip) are playing, not a canvas pinch.
    <div className={`sel-screen${auditioning ? ' sel-screen--audition' : ''}`} data-no-pinch>
      {needsUnlock && (
        <p className="sel-audio-unlock" role="status">
          Tap any pad once to start sound
        </p>
      )}
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
              aria-pressed={isSelected}
              aria-label={pattern.label}
              onPointerDown={handlePointerDown(pattern.id)}
              // Space is the global tap key and Enter would double-report it.
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
              }}
              data-hint={
                auditioning
                  ? `${pattern.label.toUpperCase()} — audition: heard and shown large, not recorded`
                  : `${pattern.label.toUpperCase()} — tap to play it into the loop. Hold a mod strip to audition instead`
              }
            >
              {/* The sound as it is now: its own character, at the strips'
                  velocity — so moving a strip is seen on the pads too. */}
              <span className="sel-icon">
                <SoundPreview
                  pattern={pattern}
                  character={character[pattern.id]}
                  velocity={velocity}
                />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
