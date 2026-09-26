import { useLayoutEffect, useRef } from 'react'
import { useMod } from '../mod/session.tsx'
import { useSelector } from '../selector/session.tsx'
import { PATTERNS, type PatternId } from '../selector/patterns.ts'
import { SoundPreview } from '../selector/SoundPreview.tsx'
import './rack-preview.css'

/** How long a sound takes to grow out of its cell into the large preview. */
const GROW_MS = 420

/**
 * What the Main Screen shows while a mod strip is in use, in place of the
 * circular sequencer:
 *
 *   strip only        the whole rack at half strength, cell for cell the pads
 *                     below — the hint that a pad is the other half of the move
 *   strip + a pad     that pad's sound, grown out of its cell to fill the
 *                     screen, solid, named, and redrawn live as velocity and
 *                     character move on the strips
 *
 * Nothing here records; it is the audition's picture. It fades out with
 * audition mode, and the sequencer is there again underneath.
 */
export function RackPreview() {
  const { active, focus } = useMod()
  const { gesture, character, currentVelocity } = useSelector()
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
              <SoundPreview pattern={pattern} character={character[pattern.id]} />
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
              velocity={currentVelocity()}
            />
            {/* The one place a sound is named: when it is up close to be
                shaped. The rack and the pads show marks only. */}
            <span className="rp-focus-label">{focused.label.toUpperCase()}</span>
          </div>
        </div>
      )}
    </div>
  )
}
