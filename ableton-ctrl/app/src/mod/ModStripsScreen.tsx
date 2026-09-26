import {
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useMod } from './session.tsx'
import { VELOCITY_MAX, VELOCITY_MIN, useSelector } from '../selector/session.tsx'
import { CHARACTER, CHARACTER_NOTE } from '../selector/character.ts'
import { PATTERNS } from '../selector/patterns.ts'
import './mod.css'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** Arrow-key step, as a share of the strip. */
const KEY_STEP = 0.025

type StripProps = {
  /** 0..1, bottom to top. */
  value: number
  onChange: (value: number) => void
  label: string
  hint: string
  disabled?: boolean
}

/**
 * One mod strip: a tall touch strip, value from the bottom up, set by where
 * the finger is (absolute, like a physical strip — not dragged relative).
 * Touching it is also what switches the pads into audition mode, so every
 * press and release is reported to the mod session.
 */
function Strip({ value, onChange, label, hint, disabled = false }: StripProps) {
  const { beginTouch, endTouch, poke } = useMod()
  const trackRef = useRef<HTMLDivElement>(null)
  const held = useRef<number | null>(null)

  const valueAt = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.height === 0) return value
    return clamp01(1 - (clientY - rect.top) / rect.height)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (held.current !== null) return
    e.preventDefault()
    held.current = e.pointerId
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer — nothing to capture */
    }
    beginTouch()
    if (!disabled) onChange(valueAt(e.clientY))
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (held.current !== e.pointerId) return
    if (!disabled) onChange(valueAt(e.clientY))
    poke()
  }
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (held.current !== e.pointerId) return
    held.current = null
    endTouch()
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    let next: number | null = null
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + KEY_STEP
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - KEY_STEP
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 1
    if (next === null) return
    e.preventDefault()
    onChange(clamp01(next))
    poke()
  }

  const pct = `${clamp01(value) * 100}%`
  return (
    <div className={`mod-strip${disabled ? ' mod-strip--disabled' : ''}`} data-hint={hint}>
      <div
        ref={trackRef}
        className="mod-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={onKeyDown}
      >
        <div className="mod-fill" style={{ height: pct }} />
        <div className="mod-level" style={{ bottom: pct }} />
      </div>
    </div>
  )
}

/**
 * The Mod Strip section: two strips beside the pads, unlabelled like the pads
 * (guiding mode names them, and the Main Screen names the sound up close).
 *
 *   left   velocity — how hard every pad plays, recorded or auditioned
 *   right  character — the selected sound's one axis (SOFT↔HARD for HIT,
 *          ROUNDED↔CRISPY for TICK, …); sounds without one leave it idle
 *
 * Hold either strip and press a pad: the pad auditions instead of recording,
 * and the Main Screen shows that sound large, changing as the strips move.
 * Let go and, a moment later, the pads record again.
 */
export function ModStripsScreen() {
  const { gesture, character, setSelectedCharacter, velocity, setVelocity } = useSelector()
  const selected = PATTERNS.find((p) => p.id === gesture) ?? PATTERNS[0]
  const axis = CHARACTER[gesture]
  const name = selected.label.toUpperCase()
  const velocityValue = (velocity - VELOCITY_MIN) / (VELOCITY_MAX - VELOCITY_MIN)

  return (
    // Instrument controls: two fingers here (strip + pad) are playing, not a
    // pinch of the canvas.
    <div className="mod-screen" data-no-pinch>
      <Strip
        value={velocityValue}
        onChange={(v) => setVelocity(VELOCITY_MIN + v * (VELOCITY_MAX - VELOCITY_MIN))}
        label="Velocity"
        hint="Velocity — how hard the pads play. Hold it and press a pad to audition without recording"
      />
      <Strip
        value={axis ? character[gesture] : 0}
        onChange={setSelectedCharacter}
        label={`${name} character`}
        hint={`${name}: ${CHARACTER_NOTE[gesture]} Hold it and press a pad to audition.`}
        disabled={!axis}
      />
    </div>
  )
}
