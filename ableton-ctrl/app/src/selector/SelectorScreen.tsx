import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { SelectorIcon } from './SelectorIcon.tsx'
import { SoundPreview } from './SoundPreview.tsx'
import { CharacterSlider } from './CharacterSlider.tsx'
import { CHARACTER, CHARACTER_NOTE } from './character.ts'
import { PATTERNS, type PatternId } from './patterns.ts'
import { VELOCITY_MAX, VELOCITY_MIN, useSelector } from './session.tsx'
import { useTap } from '../tap/session.tsx'
import { useSoundEngine } from '../transport/session.tsx'
import { Slider } from '../sound-intent/Slider.tsx'
import '../sound-intent/sound-intent.css'
import './selector.css'

const FLASH_MS = 90

/**
 * Selector — the two levels of what a tap is, in one window.
 *
 * The GRID on top is identity: eight fixed pads, one per sound, answering
 * "which of these is it". Pressing one selects it and fires the shared tap, so
 * the sound and its mark arrive in the same press.
 *
 * Under the grid, how hard: VELOCITY sets every ordinary tap and ACCENT,
 * latched, plays them all at full strength (Shift+Space accents a single one).
 *
 * The PANEL underneath is character: the selected sound's one axis, with a live
 * preview of what it currently sounds like. Only ever one panel — the selected
 * one — because the question it answers is about the sound you are about to
 * play, and there is only ever one of those.
 *
 * The split is the point. The grid's marks never move, so the four stay a
 * stable set of things to choose between; the panel's preview moves constantly,
 * so the current state is always visible. Identity above, state below.
 */
export function SelectorScreen() {
  const { fireTap, recording } = useTap()
  const {
    gesture,
    setGesture,
    character,
    setCharacter,
    velocity,
    setVelocity,
    accent,
    setAccent,
    currentVelocity,
  } = useSelector()
  const { noteOn, status, source } = useSoundEngine()
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
    // own view of the selection is still the previous mark.
    fireTap(id)
    flash(id)
  }

  const selected = PATTERNS.find((p) => p.id === gesture) ?? PATTERNS[0]
  const axis = CHARACTER[selected.id]

  /**
   * Audition: hear the current character without writing an event.
   *
   * The two are separate on purpose. Tuning an axis by ear takes a dozen
   * presses, and if each one recorded, the only way to hear a sound would be to
   * fill the bar with it — so this goes straight to the engine and never near
   * the capture. Pressing a mark in the grid above is still the way to record.
   */
  const audition = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault()
    noteOn(currentVelocity(), selected.id, character[selected.id])
    flash(selected.id)
  }

  return (
    <div className="sel-screen">
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
              onPointerDown={handlePointerDown(pattern.id)}
              data-hint={`${pattern.label.toUpperCase()} — tap to play it into the loop. Space plays the selected one`}
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

      <div className="sel-dynamics">
        <button
          type="button"
          className={`sel-accent${accent ? ' sel-accent--on' : ''}`}
          aria-pressed={accent}
          onClick={() => setAccent(!accent)}
          onKeyUp={(e) => {
            if (e.key === ' ') e.preventDefault()
          }}
          data-hint="Accent — while on, every tap plays at full velocity. Shift+Space accents a single tap"
        >
          ACCENT
        </button>
        <div
          className={`sel-velocity${accent ? ' sel-velocity--overridden' : ''}`}
          data-hint="Velocity — how hard an ordinary tap plays"
        >
          <Slider
            label="VELOCITY"
            value={velocity}
            min={VELOCITY_MIN}
            max={VELOCITY_MAX}
            onChange={setVelocity}
          />
        </div>
      </div>

      <section className="sel-panel" aria-label={`${selected.label} sound`}>
        <div className="sel-panel-head">
          <span className="sel-panel-title">{selected.label.toUpperCase()}</span>
          <span className="sel-panel-hint">
            {axis ? 'Press the preview to hear it' : 'No editable character'}
          </span>
        </div>

        <div className="sel-preview-box">
          <button
            type="button"
            className="sel-preview"
            aria-label={`Hear ${selected.label}`}
            data-hint="Hear this sound as it is now — nothing is recorded"
            onPointerDown={audition}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
            }}
          >
            <SoundPreview pattern={selected} character={character[selected.id]} />
          </button>
        </div>

        {axis && (
          <div data-hint="Character — what this sound is like. Each tap keeps the value it was played with">
          <CharacterSlider
            ends={axis.ends}
            value={character[selected.id]}
            name={selected.label.toUpperCase()}
            onChange={(v) => setCharacter(selected.id, v)}
          />
          </div>
        )}

        <p className="sel-panel-note">{CHARACTER_NOTE[selected.id]}</p>
      </section>
    </div>
  )
}
