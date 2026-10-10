import {
  useLayoutEffect,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'

/** Space is the tap key everywhere; a focused control must not also be
    pressed by it. */
export const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Selected / pressed: filled black, like the transport's chosen division. */
  on?: boolean
  children: ReactNode
}

/** The instrument's hairline square button — the transport bar's, word-sized. */
export function Button({ on = false, className = '', children, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={`xp-btn${on ? ' xp-btn--on' : ''} ${className}`}
      aria-pressed={on || undefined}
      onKeyUp={swallowSpace}
      {...props}
    >
      {children}
    </button>
  )
}

/** A level fader: a hairline track filled black up to the value, with a real
    range input over it so it drags, steps and reads out like any slider. */
export function Fader({
  label,
  value,
  onChange,
  hint,
  disabled = false,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  hint: string
  disabled?: boolean
}) {
  return (
    <label className={`xp-fader${disabled ? ' xp-fader--off' : ''}`} data-hint={hint}>
      <span className="xp-fader-label">{label}</span>
      <div className="xp-fader-track">
        <div className="xp-fader-fill" style={{ width: `${value}%` }} />
        <div className="xp-fader-handle" style={{ left: `${value}%` }} />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={swallowSpace}
        />
      </div>
      <span className="xp-fader-value num">{Math.round(value)}</span>
    </label>
  )
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
