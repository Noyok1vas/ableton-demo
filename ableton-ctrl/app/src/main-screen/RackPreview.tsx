import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useMod } from '../mod/session.tsx'
import { useSelector } from '../selector/session.tsx'
import { characterOf } from '../selector/character.ts'
import { PATTERNS } from '../selector/patterns.ts'
import { SoundPreview } from '../selector/SoundPreview.tsx'
import { useSoundEngine } from '../transport/session.tsx'
import { ModStripsScreen } from '../mod/ModStripsScreen.tsx'
import './rack-preview.css'

/** The large view's mark is rasterized at this many pixels square. */
const FOCUS_RESOLUTION = 2000

/**
 * What the screen shows in audition mode, in place of the circular sequencer:
 * the held pad's sound, grown from the middle of the glass to fill it, solid,
 * and redrawn live as velocity and character move on the two strips either
 * side of it. With no sound in focus the whole rack shows at half strength,
 * cell for cell the pads below.
 *
 * A tap anywhere on this glass hears the sound being shaped, and records
 * nothing. The view leaves with the finger that opened it.
 */
export function RackPreview() {
  const { active, focus } = useMod()
  const { gesture, character, currentVelocity } = useSelector()
  const { noteOn } = useSoundEngine()
  const velocity = currentVelocity()
  const lastTouch = useRef(0)

  const focused = focus ? PATTERNS.find((p) => p.id === focus) : undefined

  // The whole glass is a pad for the sound on it: the strips, the mark, the
  // empty glass. A pad below still plays its own sound; this plays the one
  // being shaped, at the velocity and character the strips have now.
  const hear = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || !focus || e.button !== 0) return
    const now = performance.now()
    // A touch already played this. The compatibility click that follows it
    // must not play it again.
    if (e.pointerType === 'mouse' && now - lastTouch.current < 500) return
    if (e.pointerType !== 'mouse') lastTouch.current = now
    const onStrip = (e.target as HTMLElement).closest?.('.mod-strip')
    if (!onStrip) e.preventDefault()
    noteOn(velocity, focus, characterOf(focus, character) ?? undefined)
  }

  return (
    <div
      className={`rp${active ? ' rp--on' : ''}${focused ? ' rp--focus' : ''}`}
      aria-hidden={!active}
      onPointerDown={hear}
    >
      <div className="rp-grid">
        {PATTERNS.map((pattern) => (
          <div
            key={pattern.id}
            className={`rp-cell${pattern.id === gesture ? ' rp-cell--selected' : ''}`}
          >
            <div className="rp-art">
              <SoundPreview
                pattern={pattern}
                character={character[pattern.id]}
                velocity={velocity}
              />
            </div>
          </div>
        ))}
      </div>

      {focused && (
        <div className="rp-focus-wrap">
          <div key={focused.id} className="rp-focus">
            <SoundPreview
              pattern={focused}
              character={character[focused.id]}
              velocity={velocity}
              resolution={FOCUS_RESOLUTION}
            />
          </div>
        </div>
      )}

      <ModStripsScreen />
    </div>
  )
}
