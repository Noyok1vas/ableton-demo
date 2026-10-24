import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

/** One sheet of the stack, in SVG units: a parallelogram leaning right. */
const SHEET_W = 22
const SHEET_H = 48
const LEAN = 12
const STEP = 24
const PAD = 2

/**
 * The song's sections as a stack of sheets, one per pass of the loop, seen
 * edge-on the way ARRANGE sees them. The current section is filled; sliding a
 * finger across the stack lights the sheet it is over (and the same section
 * on the visual above), and lifting it there opens that section in CREATE.
 */
export function SectionStack({
  count,
  current,
  highlight,
  onHighlight,
  onSelect,
}: {
  count: number
  current: number
  highlight: number | null
  onHighlight: (section: number | null) => void
  onSelect: (section: number) => void
}) {
  const ref = useRef<SVGSVGElement>(null)
  const width = PAD * 2 + STEP * (count - 1) + SHEET_W + LEAN
  const height = PAD * 2 + SHEET_H

  /** Which sheet a pointer is over, by where it is along the stack. */
  const sectionAt = (event: { clientX: number }) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const x = ((event.clientX - rect.left) / rect.width) * width
    const i = Math.floor((x - PAD - LEAN / 2) / STEP)
    return Math.max(0, Math.min(count - 1, i))
  }

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    onHighlight(sectionAt(event))
  }
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    onHighlight(sectionAt(event))
  }
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const section = sectionAt(event)
    if (section !== null) onSelect(section)
    onHighlight(null)
  }

  return (
    <svg
      ref={ref}
      className="ms-stack"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label="Sections"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => onHighlight(null)}
      onPointerLeave={() => onHighlight(null)}
    >
      {Array.from({ length: count }, (_, i) => {
        const x = PAD + i * STEP
        const d = `M${x} ${PAD + SHEET_H} l${LEAN} ${-SHEET_H} h${SHEET_W} l${-LEAN} ${SHEET_H} Z`
        const state = i === current ? ' ms-sheet--current' : i === highlight ? ' ms-sheet--lit' : ''
        return <path key={i} className={`ms-sheet${state}`} d={d} />
      })}
    </svg>
  )
}
