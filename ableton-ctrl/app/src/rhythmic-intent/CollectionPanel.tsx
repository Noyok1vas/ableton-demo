import { memo, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSession } from './session.tsx'
import type { CollectionEntry, CollectionKind, SavedPattern, Tap } from './types.ts'
import { IconRemove, IconSave } from '../main-screen/icons.tsx'
import './rhythmic-intent.css'

// Mini pattern strip: a thin line threading through the tap dots. ViewBox
// units; scales uniformly to the row width.
const W = 320
const H = 20
const PAD = 8
const LINE_Y = H / 2
const TRACK_W = W - PAD * 2

/** How long DELETE waits for its second press before standing down. */
const CONFIRM_MS = 3000

/** Space is the tap key everywhere; a focused row button must not also be
    pressed by it. Enter still works. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const MiniPattern = memo(function MiniPattern({
  taps,
  loopDuration,
}: {
  taps: readonly Tap[]
  loopDuration: number
}) {
  return (
    <svg className="collection-mini" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1={PAD} y1={LINE_Y} x2={W - PAD} y2={LINE_Y} className="collection-line" />
      {taps.map((tap, i) => (
        <circle
          key={i}
          cx={PAD + (tap.time / loopDuration) * TRACK_W}
          cy={LINE_Y}
          // Velocity reads as size here too: an accent is the biggest dot.
          r={2.6 + 1.4 * Math.min(1, Math.max(0, tap.velocity))}
          className="collection-dot"
        />
      ))}
    </svg>
  )
})

function EntryRow({
  kind,
  entry,
  selected,
  onLoad,
  action,
}: {
  kind: CollectionKind
  entry: CollectionEntry | SavedPattern
  selected: boolean
  onLoad: () => void
  action: ReactNode
}) {
  const title = 'name' in entry ? entry.name : clockTime(entry.createdAt)
  return (
    <li className={`collection-item${selected ? ' collection-item--selected' : ''}`}>
      <button
        type="button"
        className="collection-row"
        aria-pressed={selected}
        aria-label={`Load ${kind === 'saved' ? 'saved pattern' : 'pattern from'} ${title}`}
        onClick={onLoad}
        onKeyUp={swallowSpace}
        data-hint="Load this pattern — it plays in place of the current one"
      >
        <span className="collection-name num">{title}</span>
        <MiniPattern taps={entry.taps} loopDuration={entry.duration} />
      </button>
      {action}
    </li>
  )
}

/**
 * The Collection, in two halves.
 *
 * TOP — saved: patterns kept on purpose, named with the date and time they
 * were saved. Black, because they are the record.
 *
 * BOTTOM — temporary: every tapped loop, recorded on its own when its first
 * pass closes and kept following your edits while it is the one playing. Grey,
 * because it is provisional: the whole half is cleared when the page reloads,
 * and SAVE is how one moves up. DELETE on a saved pattern moves it back down
 * here rather than destroying it.
 *
 * Clicking any row makes it the working pattern. Editing a saved pattern never
 * changes it — the edit starts a new temporary entry instead.
 */
export function CollectionPanel() {
  const { temporary, saved, selection, loadEntry, savePattern, deleteSaved } = useSession()

  // DELETE takes two presses: the first arms it, the second moves the pattern
  // back to temporary — where the next reload would clear it.
  const [confirming, setConfirming] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
    },
    [],
  )
  const pressDelete = (id: string) => {
    if (confirmTimer.current !== null) clearTimeout(confirmTimer.current)
    if (confirming === id) {
      setConfirming(null)
      deleteSaved(id)
      return
    }
    setConfirming(id)
    confirmTimer.current = setTimeout(() => setConfirming(null), CONFIRM_MS)
  }

  const isSelected = (kind: CollectionKind, id: string) =>
    selection?.kind === kind && selection.id === id

  return (
    <div className="collection">
      <section className="collection-half collection-half--saved" aria-label="Saved patterns">
        <span
          className="collection-badge"
          data-hint="Saved — patterns you kept, named with the date and time you saved them"
        >
          SAVED
        </span>
        <ul className="collection-list">
          {saved.map((entry) => {
            const armed = confirming === entry.id
            return (
              <EntryRow
                key={entry.id}
                kind="saved"
                entry={entry}
                selected={isSelected('saved', entry.id)}
                onLoad={() => loadEntry('saved', entry.id)}
                action={
                  <button
                    type="button"
                    className={`collection-action${armed ? ' collection-action--armed' : ''}`}
                    aria-label={armed ? 'Press again to delete' : 'Delete'}
                    onClick={() => pressDelete(entry.id)}
                    onKeyUp={swallowSpace}
                    data-hint={
                      armed
                        ? 'Press again to delete — it goes back to Temporary'
                        : 'Delete — moves it back to Temporary (press twice)'
                    }
                  >
                    <IconRemove />
                  </button>
                }
              />
            )
          })}
        </ul>
      </section>

      <section className="collection-half collection-half--temporary" aria-label="Temporary patterns">
        <span
          className="collection-badge"
          data-hint="Temporary — every loop you tap lands here; cleared when the page reloads"
        >
          TEMPORARY
        </span>
        <ul className="collection-list">
          {temporary.map((entry) => (
            <EntryRow
              key={entry.id}
              kind="temporary"
              entry={entry}
              selected={isSelected('temporary', entry.id)}
              onLoad={() => loadEntry('temporary', entry.id)}
              action={
                <button
                  type="button"
                  className="collection-action"
                  aria-label="Save"
                  onClick={() => savePattern(entry.id)}
                  onKeyUp={swallowSpace}
                  data-hint="Save — moves it up to Saved, named with the date and time"
                >
                  <IconSave />
                </button>
              }
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
