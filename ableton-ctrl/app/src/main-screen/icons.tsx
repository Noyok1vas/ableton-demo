/**
 * The Main Screen's icons. The screen carries no written labels, so these are
 * the whole of what a control says about itself — guiding mode fills in the
 * words (see guide/HintLayer).
 *
 * Drawn on a 24-unit grid in currentColor, strokes at 1.5, so each sits in a
 * button of any size and takes the button's colour, inverted states included.
 */

type IconProps = { size?: number }

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export function IconPlus({ size = 24 }: IconProps) {
  return (
    <svg {...svg(size)}>
      <path d="M12 4v16M4 12h16" />
    </svg>
  )
}

export function IconUndo({ size = 24 }: IconProps) {
  return (
    <svg {...svg(size)}>
      <path d="M9 13 4.5 8.5 9 4" />
      <path d="M4.5 8.5H15a5 5 0 0 1 0 10h-4" />
    </svg>
  )
}

/** Collection: a list, each line with its dot. */
export function IconList({ size = 24 }: IconProps) {
  return (
    <svg {...svg(size)}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.5" cy="6.5" r="0.9" fill="currentColor" />
      <circle cx="4.5" cy="12" r="0.9" fill="currentColor" />
      <circle cx="4.5" cy="17.5" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** A four-point star with a small one beside it — the agent and the guide. */
export function IconSparkle({ size = 24, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...svg(size)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M13 3c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5C10.1 9.8 12.3 7.6 13 3Z" />
      <path d="M5.5 15.5c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3Z" />
    </svg>
  )
}

/** Solid glyphs for the transport — they read at a glance where outlines don't. */
export function IconPlay({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M7 4.5v15L19.5 12 7 4.5Z" fill="currentColor" />
    </svg>
  )
}

export function IconStop({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="6" y="6" width="12" height="12" fill="currentColor" />
    </svg>
  )
}

export function IconChevron({ size = 18, dir }: IconProps & { dir: 'left' | 'right' }) {
  return (
    <svg {...svg(size)}>
      <path d={dir === 'left' ? 'M14.5 5 7.5 12l7 7' : 'M9.5 5l7 7-7 7'} />
    </svg>
  )
}

export function IconMinus({ size = 18 }: IconProps) {
  return (
    <svg {...svg(size)}>
      <path d="M5 12h14" />
    </svg>
  )
}

/** The metronome: two dots, one struck. `lit` says which (0 left, 1 right);
    the transport swaps it on every beat while the metronome is on. */
export function IconMetronome({ size = 24, lit }: IconProps & { lit: 0 | 1 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="icon-metronome">
      <circle
        cx="7"
        cy="12"
        r="4"
        className="icon-metronome-dot icon-metronome-dot--a"
        fill={lit === 0 ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle
        cx="17"
        cy="12"
        r="4"
        className="icon-metronome-dot icon-metronome-dot--b"
        fill={lit === 1 ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/** Delete: a solid disc with the cross knocked out of it. */
export function IconRemove({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="M8.5 8.5l7 7M15.5 8.5l-7 7"
        stroke="var(--surface)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Save: into the tray — a solid tile with the arrow knocked out of it. */
export function IconSave({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" />
      <path
        d="M12 6v8M8.5 10.5 12 14l3.5-3.5M7 14.5v3h10v-3"
        fill="none"
        stroke="var(--surface)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
