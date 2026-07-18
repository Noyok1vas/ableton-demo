import { useEffect, useRef, useState } from 'react'
import type { Page, PageId } from './types.ts'

type PageMenuProps = {
  pages: Page[]
  currentId: PageId
  onSelect: (id: PageId) => void
}

/** Top-left dropdown that switches the visible page. */
export function PageMenu({ pages, currentId, onSelect }: PageMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = pages.find((p) => p.id === currentId) ?? pages[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="pagemenu" ref={ref}>
      <button
        type="button"
        className="pagemenu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pagemenu-name">{current.name}</span>
        <span className={`pagemenu-chevron${open ? ' pagemenu-chevron--open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="pagemenu-list" role="listbox" aria-label="Pages">
          {pages.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === currentId}>
              <button
                type="button"
                className={`pagemenu-item${p.id === currentId ? ' pagemenu-item--active' : ''}`}
                onClick={() => {
                  onSelect(p.id)
                  setOpen(false)
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
