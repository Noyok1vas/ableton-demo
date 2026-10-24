import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useDrum } from '../chladni2/session.tsx'
import { SOUND_VOICES } from '../transport/engine.ts'
import { ARTIST_KITS, CLASSIC_KITS, type CatalogKit } from './library.ts'
import { useShapeEditor } from './session.tsx'

export type LibraryCategory = 'classic' | 'artist' | 'mine'

const CATS: { id: LibraryCategory; label: string }[] = [
  { id: 'classic', label: 'CLASSIC' },
  { id: 'artist', label: 'ARTIST' },
  { id: 'mine', label: 'MINE' },
]

const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

function stamp(at: number) {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`
}

function Card({
  name,
  meta,
  detail,
  on,
  onPick,
}: {
  name: string
  meta?: string
  /** A sentence under an artist pack. Classic packs have none. */
  detail?: string
  on: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      className={`lab-card${on ? ' lab-card--on' : ''}`}
      aria-pressed={on}
      onClick={onPick}
      onKeyUp={swallowSpace}
    >
      <span className="lab-card-name">{name}</span>
      {meta && <span className="lab-card-meta">{meta}</span>}
      {detail && <span className="lab-card-desc">{detail}</span>}
    </button>
  )
}

/**
 * The library: a search, three catalogues, and text cards. Choosing one
 * fills the eight slots. Nothing here plays a sample.
 */
export function LibraryPane({
  category,
  onCategory,
}: {
  category: LibraryCategory
  onCategory: (category: LibraryCategory) => void
}) {
  const { kitId, mine, loadCatalog, loadKept } = useShapeEditor()
  const { setParam } = useDrum()
  const [query, setQuery] = useState('')

  useEffect(() => setQuery(''), [category])

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hit = (parts: string[]) => !q || parts.join(' ').toLowerCase().includes(q)
    if (category === 'mine') {
      return mine
        .filter((kit) => hit([kit.name, ...SOUND_VOICES.map((id) => kit.labels[id])]))
        .map((kit) => ({
          id: kit.id,
          name: kit.name,
          meta: stamp(kit.savedAt),
          detail: undefined,
          pick: () => {
            loadKept(kit)
            for (const id of SOUND_VOICES) {
              for (const [key, value] of Object.entries(kit.drums[id])) setParam(id, key, value)
            }
          },
        }))
    }
    const source: readonly CatalogKit[] = category === 'classic' ? CLASSIC_KITS : ARTIST_KITS
    return source
      .filter((kit) => hit([kit.name, kit.maker, kit.year, kit.description ?? '']))
      .map((kit) => ({
        id: kit.id,
        name: kit.name,
        meta: category === 'artist' ? undefined : `${kit.maker.toUpperCase()}  ·  ${kit.year}`,
        detail: category === 'artist' ? kit.description : undefined,
        pick: () => loadCatalog(kit),
      }))
  }, [category, query, mine, loadCatalog, loadKept, setParam])

  return (
    <aside className="lab-library" data-no-pinch>
      <div className="lab-library-head">
        <span className="lab-kicker">LIBRARY</span>
        <label className="lab-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SEARCH"
            aria-label="Search the library"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="lab-cats" role="tablist" aria-label="Library">
        {CATS.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            className={`lab-cat${category === cat.id ? ' lab-cat--on' : ''}`}
            aria-selected={category === cat.id}
            onClick={() => onCategory(cat.id)}
            onKeyUp={swallowSpace}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="lab-cards">
        {cards.length === 0 ? (
          <p className="lab-empty">{category === 'mine' && !query ? 'NOTHING KEPT' : 'NOTHING MATCHES'}</p>
        ) : (
          cards.map((card) => (
            <Card
              key={card.id}
              name={card.name}
              meta={card.meta}
              detail={card.detail}
              on={card.id === kitId}
              onPick={card.pick}
            />
          ))
        )}
      </div>
    </aside>
  )
}
