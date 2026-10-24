import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

/** One sheet's size and the step between sheets, in device units — one and
    a half times the design's frame, the outline left at its weight — in the
    design's proportions: a sheet about 1.85 times as tall as it is wide,
    each next one a little over two-thirds of a sheet along. */
const SHEET_W = 30
const SHEET_H = 55.5
const STEP = 21
/** How far a sheet's right edge stands above its left: the design's frames
    rise about 0.6 of their width. Every sheet is sheared on its own, so the
    stack stays level rather than climbing. */
const RISE = 18

/**
 * The song's sections as a stack of sheets, one per pass of the loop: upright
 * frames, each sheared so it rises to the right, standing side by side on
 * one level and overlapping the one behind.
 * The section on screen is filled; sliding a finger across the stack lights
 * the sheet it is over (and the same section on the visual above), and
 * lifting it there opens that section in CREATE.
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
  const ref = useRef<HTMLDivElement>(null)
  const width = STEP * (count - 1) + SHEET_W

  /** Which sheet a pointer is over, by how far along the stack it is. The
      shear moves the sheets only up and down, so x alone decides. */
  const sectionAt = (event: { clientX: number }) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const x = ((event.clientX - rect.left) / rect.width) * width
    return Math.max(0, Math.min(count - 1, Math.floor(x / STEP)))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    onHighlight(sectionAt(event))
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const section = sectionAt(event)
    if (section !== null) onSelect(section)
    onHighlight(null)
  }

  return (
    <div
      ref={ref}
      className="ms-stack"
      role="group"
      aria-label="Sections"
      style={
        {
          width,
          height: SHEET_H + RISE,
          '--sheet-skew': `${-Math.atan(RISE / SHEET_W)}rad`,
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={(event) => onHighlight(sectionAt(event))}
      onPointerUp={onPointerUp}
      onPointerCancel={() => onHighlight(null)}
      onPointerLeave={() => onHighlight(null)}
      data-hint="Sections — slide across to find one, lift to open it"
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`ms-sheet${i === current ? ' ms-sheet--current' : i === highlight ? ' ms-sheet--lit' : ''}`}
          style={{ left: i * STEP, top: RISE / 2, width: SHEET_W, height: SHEET_H }}
        />
      ))}
    </div>
  )
}
