import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { CSSProperties } from 'react'
import { SoundPreview } from './SoundPreview.tsx'
import { PATTERNS, type PatternId } from './patterns.ts'
import { useSelector } from './session.tsx'
import { useTap } from '../tap/session.tsx'
import { useMod } from '../mod/session.tsx'
import { useSession } from '../rhythmic-intent/session.tsx'
import { PAD_SCREEN_MM, padRect, u } from '../device/geometry.ts'
import { haptic } from '../device/haptics.ts'
import './selector.css'

const FLASH_MS = 90
/** How long a pad is held before it turns from a hit into an audition.
    Mirrored as --long-press in design/tokens.css. */
const LONG_PRESS_MS = 400
/** The pad's round screen, in device units, and how much of it a mark may
    fill: at full velocity a mark is drawn VELOCITY_MAX_SIZE (1.3) of its
    tile, so the tile is held to 1/1.3 of the circle and the mark's widest
    reaches the edge of the glass and no further. */
const PAD_SCREEN = u(PAD_SCREEN_MM)
const PAD_SCREEN_FIT = 1 / 1.3

/** One finger on one pad. `holding` once it counts as held for audition. */
type Press = { timer: ReturnType<typeof setTimeout> | null; holding: boolean }

/**
 * The deck — the eight pads, 4×2, the hardware half of the device. They are
 * the pads in the rendered hardware: each button sits exactly over its pad in
 * the picture (geometry.ts), invisible itself, and draws its mark on the
 * round screen set into the pad. Only the screens change.
 *
 * A press selects the pad and plays it, in one of two ways:
 *
 *   tap           it records: the sound goes into the loop, on the press
 *   long press    it auditions: the note it just played is taken back out of
 *                 the loop, and the screen shows the sound large between a
 *                 velocity strip and a character strip, so the other hand can
 *                 shape it. While that view is up every pad auditions.
 *
 * Each pad shows its sound as it is now: its mark redraws at its own
 * character and scales with the velocity.
 */
export function SelectorScreen() {
  const { fireTap, recording } = useTap()
  const { gesture, setGesture, character, currentVelocity } = useSelector()
  const { removeTap } = useSession()
  const velocity = currentVelocity()
  const mod = useMod()
  const modRef = useRef(mod)
  modRef.current = mod
  const auditioning = mod.active
  const [flashing, setFlashing] = useState<PatternId | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Several pads can be held at once, one entry per finger.
  const presses = useRef(new Map<number, Press>())

  useEffect(() => {
    const held = presses.current
    return () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
      held.forEach((press) => {
        if (press.timer !== null) clearTimeout(press.timer)
        if (press.holding) modRef.current.endTouch()
      })
      held.clear()
    }
  }, [])

  const flash = (id: PatternId) => {
    setFlashing(id)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashing(null), FLASH_MS)
  }

  // pointerdown, not click: a tap has to land at press time, not on release.
  const handlePointerDown = (id: PatternId) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer — nothing to capture */
    }
    // Pass `id` explicitly: setGesture hasn't re-rendered yet, so the session's
    // own view of the selection is still the previous mark.
    setGesture(id)
    flash(id)
    haptic()

    // Already auditioning: this press auditions too, and holding it keeps
    // the view up.
    if (modRef.current.isActive()) {
      fireTap(id)
      modRef.current.beginTouch()
      presses.current.set(e.pointerId, { timer: null, holding: true })
      return
    }

    // Otherwise it records now, on the press, so a tap is never late — and
    // if the finger stays down, the note is taken back and the pad auditions.
    const tapId = fireTap(id)
    const press: Press = { timer: null, holding: false }
    press.timer = setTimeout(() => {
      press.timer = null
      press.holding = true
      if (tapId) removeTap(tapId)
      modRef.current.beginTouch()
      modRef.current.present(id)
    }, LONG_PRESS_MS)
    presses.current.set(e.pointerId, press)
  }

  const release = (e: React.PointerEvent<HTMLButtonElement>) => {
    const press = presses.current.get(e.pointerId)
    if (!press) return
    presses.current.delete(e.pointerId)
    if (press.timer !== null) clearTimeout(press.timer)
    if (press.holding) modRef.current.endTouch()
  }

  return (
    <div className={`sel-screen${auditioning ? ' sel-screen--audition' : ''}`}>
      {PATTERNS.map((pattern, index) => {
          const isSelected = gesture === pattern.id
          const rect = padRect(index)
          return (
            <button
              key={pattern.id}
              type="button"
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.size,
                height: rect.size,
                '--pad-screen': `${PAD_SCREEN}px`,
              } as CSSProperties}
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
              onPointerUp={release}
              onPointerCancel={release}
              // A long press must not open the system's context menu.
              onContextMenu={(e) => e.preventDefault()}
              // Space is the global tap key and Enter would double-report it.
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
              }}
              data-hint={
                auditioning
                  ? `${pattern.label.toUpperCase()} — audition: heard and shown large, not recorded`
                  : `${pattern.label.toUpperCase()} — tap to play it into the loop. Hold to audition and shape it`
              }
            >
              {/* The sound as it is now: its own character, at the strips'
                  velocity — so moving a strip is seen on the pads too. */}
              <span className="sel-icon">
                <SoundPreview
                  pattern={pattern}
                  character={character[pattern.id]}
                  velocity={velocity}
                  fit={PAD_SCREEN_FIT}
                />
              </span>
            </button>
          )
        })}
    </div>
  )
}
