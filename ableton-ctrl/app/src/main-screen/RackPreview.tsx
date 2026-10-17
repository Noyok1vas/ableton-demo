import { useLayoutEffect, useRef } from 'react'
import { useMod } from '../mod/session.tsx'
import { useSelector } from '../selector/session.tsx'
import { PATTERNS, type PatternId } from '../selector/patterns.ts'
import { SoundPreview } from '../selector/SoundPreview.tsx'
import { ModStripsScreen } from '../mod/ModStripsScreen.tsx'
import './rack-preview.css'

/** How long a sound takes to grow out of its cell into the large preview. */
const GROW_MS = 420
/** The large view's mark is rasterized at this many pixels square. */
const FOCUS_RESOLUTION = 2000

/**
 * What the screen shows in audition mode, in place of the circular sequencer:
 * the held pad's sound, grown out of its cell in the rack to fill the screen,
 * solid, and redrawn live as velocity and character move on the two
 * strips either side of it. With no sound in focus the whole rack shows at
 * half strength, cell for cell the pads below.
 *
 * Nothing here records; it is the audition's picture. It fades out with
 * audition mode, and the sequencer is there again underneath.
 */
export function RackPreview() {
  const { active, focus } = useMod()
  const { gesture, character, currentVelocity } = useSelector()
  const velocity = currentVelocity()
  const cells = useRef(new Map<PatternId, HTMLDivElement>())
  const big = useRef<HTMLDivElement>(null)

  // The grow: measure where the large preview ends up and where its cell is,
  // then play it from the cell to its place (the FLIP technique). Measured in
  // screen pixels, so the offset is divided back by the canvas zoom.
  useLayoutEffect(() => {
    if (!focus) return
    const target = big.current
    const cell = cells.current.get(focus)?.querySelector('.rp-art')
    if (!target || !cell || typeof target.animate !== 'function') return
    const to = target.getBoundingClientRect()
    const from = cell.getBoundingClientRect()
    if (to.width === 0 || from.width === 0) return
    const zoom = to.width / target.offsetWidth || 1
    const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / zoom
    const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / zoom
    target.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})`, opacity: 0.5 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: GROW_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
  }, [focus])

  const focused = focus ? PATTERNS.find((p) => p.id === focus) : undefined

  return (
    <div
      className={`rp${active ? ' rp--on' : ''}${focused ? ' rp--focus' : ''}`}
      aria-hidden={!active}
    >
      <div className="rp-grid">
        {PATTERNS.map((pattern) => (
          <div
            key={pattern.id}
            ref={(el) => {
              if (el) cells.current.set(pattern.id, el)
              else cells.current.delete(pattern.id)
            }}
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
          <div ref={big} className="rp-focus">
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
