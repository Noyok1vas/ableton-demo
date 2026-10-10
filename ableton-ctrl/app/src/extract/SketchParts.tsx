import {
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { blot, box, hatch, line2, loop, seedOf } from './sketch.ts'

/** Space is the tap key everywhere; a focused control must not also be
    pressed by it. */
export const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** An element's layout size — before the canvas zoom, which is what the
    drawing inside it is measured in. */
export function useSize<T extends HTMLElement>(ref: RefObject<T>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

type SketchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Names the stroke, so each button wobbles its own way. */
  ink: string
  /** Selected / pressed: hatched in, like a box someone shaded. */
  on?: boolean
  children: ReactNode
}

/** A button drawn as a pen box, hatched when it is on. */
export function SketchButton({ ink, on = false, className = '', children, ...props }: SketchButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const size = useSize(ref)
  const seed = seedOf(ink)
  return (
    <button
      ref={ref}
      type="button"
      className={`xp-btn${on ? ' xp-btn--on' : ''} ${className}`}
      aria-pressed={on || undefined}
      onKeyUp={swallowSpace}
      {...props}
    >
      {size && (
        <svg className="xp-ink" width={size.w} height={size.h} aria-hidden>
          {on && <path className="xp-ink-hatch" d={hatch(4, 4, size.w - 8, size.h - 8, 5, seed + 1)} />}
          <path d={box(2.5, 2.5, size.w - 5, size.h - 5, seed)} />
        </svg>
      )}
      <span className="xp-btn-label">{children}</span>
    </button>
  )
}

/** A panel's hand-drawn frame, sized to whatever it surrounds. */
export function SketchFrame({ ink, dashed = false }: { ink: string; dashed?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const size = useSize(ref)
  return (
    <span ref={ref} className="xp-frame" aria-hidden>
      {size && (
        <svg width={size.w} height={size.h}>
          <path
            className={dashed ? 'xp-ink-dashed' : undefined}
            d={box(2, 2, size.w - 4, size.h - 4, seedOf(ink), 1.8)}
          />
        </svg>
      )}
    </span>
  )
}

/**
 * A fader drawn in pen: a ruled track, ticks at the quarters, and a knob that
 * is a loop with a blot of ink in it. A real range input sits over the
 * drawing, so it drags, steps and reads out like any slider.
 */
export function SketchFader({
  ink,
  label,
  value,
  onChange,
  hint,
  disabled = false,
}: {
  ink: string
  label: string
  value: number
  onChange: (value: number) => void
  hint: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useSize(ref)
  const seed = seedOf(ink)
  const h = 44
  const pad = 14
  return (
    <label className={`xp-fader${disabled ? ' xp-fader--off' : ''}`} data-hint={hint}>
      <span className="xp-fader-label">{label}</span>
      <div ref={ref} className="xp-fader-track">
        {size && (
          <svg width={size.w} height={h} aria-hidden>
            <path d={line2(pad, h / 2, size.w - pad, h / 2, seed, 1)} />
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
              const x = pad + t * (size.w - 2 * pad)
              return <path key={i} className="xp-ink-thin" d={line2(x, h / 2 - 6, x, h / 2 + 6, seed + i, 0.6)} />
            })}
            {(() => {
              const x = pad + (value / 100) * (size.w - 2 * pad)
              return (
                <g>
                  <path className="xp-ink-fill" d={blot(x, h / 2, 7, seed + 7)} />
                  <path d={loop(x, h / 2, 12, 12, seed + 9)} />
                </g>
              )
            })()}
          </svg>
        )}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === ' ') e.preventDefault()
          }}
        />
      </div>
      <span className="xp-fader-value num">{Math.round(value)}</span>
    </label>
  )
}
