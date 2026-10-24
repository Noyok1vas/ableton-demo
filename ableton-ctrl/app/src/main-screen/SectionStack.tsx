import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

/** One sheet's size and the step between sheets, in device units. */
const SHEET_W = 20
const SHEET_H = 44
const STEP = 13

/**
 * The song's sections as a stack of sheets, one per pass of the loop, seen
 * at an angle the way ARRANGE sees the turns of the helix: upright frames
 * sheared so they rise to the right, each overlapping the one behind it.
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
      style={{ width, height: SHEET_H }}
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
          style={{ left: i * STEP, width: SHEET_W, height: SHEET_H }}
        />
      ))}
    </div>
  )
}
