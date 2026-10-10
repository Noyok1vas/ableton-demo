import { useMemo, useRef } from 'react'
import { useSize } from './SketchParts.tsx'
import { blot, hatch, line2, loop, seedOf } from './sketch.ts'
import { DRUM_LABEL, DRUM_TO_VOICE, DRUM_TYPES, type DrumType, type ExtractionResult } from './types.ts'
import { SoundPreview } from '../selector/SoundPreview.tsx'
import { PATTERNS } from '../selector/patterns.ts'
import { useSelector } from '../selector/session.tsx'
import { useSession } from '../rhythmic-intent/session.tsx'
import type { SoundVoiceId } from '../transport/engine.ts'

const LABEL_W = 132
const ROW_H = 54
const HEAD_H = 26

const VOICE_TO_DRUM: Partial<Record<SoundVoiceId, DrumType>> = Object.fromEntries(
  DRUM_TYPES.map((d) => [DRUM_TO_VOICE[d], d]),
)

/** A hat at this character or above is drawn — and heard — open. */
const OPEN_HAT = 0.6

type Cell = { ids: string[]; velocity: number; open: boolean }

/**
 * The ring unrolled: one lane per drum category, one column per sixteenth,
 * so what was extracted can be read as a drum machine would show it. It is a
 * second view of the SAME pattern, not a copy — a step set here appears on the
 * ring, a mark dragged on the ring moves here.
 *
 * Ink density is confidence: a hit the analysis was sure of is solid, a guess
 * is faint. Steps added by hand are always solid.
 */
export function StepLanes({ result }: { result: ExtractionResult | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useSize(ref)
  const { rendered, gridDivisions, playhead, placeTap, removeTap } = useSession()
  const { character } = useSelector()
  const steps = gridDivisions
  const w = size?.w ?? 0
  const cw = w > LABEL_W ? (w - LABEL_W) / steps : 0
  const height = HEAD_H + ROW_H * DRUM_TYPES.length

  // What the pattern holds, by lane and step.
  const { cells, others } = useMemo(() => {
    const cells = new Map<string, Cell>()
    let others = 0
    for (const tap of rendered) {
      if (!tap.kept) continue
      const drum = tap.voice ? VOICE_TO_DRUM[tap.voice] : undefined
      if (!drum) {
        others++
        continue
      }
      const step = Math.round(tap.finalPos * steps) % steps
      const key = `${drum}:${step}`
      const cell = cells.get(key) ?? { ids: [], velocity: 0, open: false }
      cell.ids.push(tap.id)
      cell.velocity = Math.max(cell.velocity, tap.velocity)
      cell.open ||= drum === 'hihat' && (tap.character ?? 0) >= OPEN_HAT
      cells.set(key, cell)
    }
    return { cells, others }
  }, [rendered, steps])

  const confidence = useMemo(() => {
    const out = new Map<string, number>()
    if (result && result.steps === steps) {
      for (const hit of result.pattern) out.set(`${hit.drum}:${hit.step}`, hit.confidence)
    }
    return out
  }, [result, steps])

  // The ruled grid: bar lines, beat lines and a dot on every step.
  const grid = useMemo(() => {
    if (cw === 0) return { bold: '', thin: '', dots: '' }
    let bold = ''
    let thin = ''
    let dots = ''
    for (let s = 0; s <= steps; s++) {
      const x = LABEL_W + s * cw
      if (s % 16 === 0) bold += line2(x, 2, x, height - 2, 100 + s, 0.9)
      else if (s % 4 === 0) thin += line2(x, HEAD_H - 4, x, height - 4, 200 + s, 0.7)
    }
    DRUM_TYPES.forEach((_, row) => {
      const y = HEAD_H + row * ROW_H
      thin += line2(LABEL_W - 6, y, w - 2, y, 300 + row, 0.8)
      for (let s = 0; s < steps; s++) {
        dots += blot(LABEL_W + (s + 0.5) * cw, y + ROW_H / 2, s % 4 === 0 ? 1.8 : 1.1, 400 + row * 64 + s)
      }
    })
    thin += line2(LABEL_W - 6, height - 1, w - 2, height - 1, 399, 0.8)
    return { bold, thin, dots }
  }, [cw, steps, height, w])

  const hits = useMemo(() => {
    if (cw === 0) return []
    const out: { key: string; d: string; ring: string; opacity: number }[] = []
    DRUM_TYPES.forEach((drum, row) => {
      for (let s = 0; s < steps; s++) {
        const key = `${drum}:${s}`
        const cell = cells.get(key)
        if (!cell) continue
        const cx = LABEL_W + (s + 0.5) * cw
        const cy = HEAD_H + row * ROW_H + ROW_H / 2
        const r = Math.min(cw * 0.46, 5 + 9 * cell.velocity)
        const seed = seedOf(key)
        out.push({
          key,
          d: blot(cx, cy, cell.open ? r * 0.45 : r, seed),
          ring: cell.open ? loop(cx, cy, r, r, seed + 1) : '',
          opacity: 0.3 + 0.7 * (confidence.get(key) ?? 1),
        })
      }
    })
    return out
  }, [cells, confidence, cw, steps])

  const toggle = (drum: DrumType, step: number) => {
    const cell = cells.get(`${drum}:${step}`)
    if (cell) {
      for (const id of cell.ids) removeTap(id)
      return
    }
    const voice = DRUM_TO_VOICE[drum]
    placeTap(step / steps, voice, character[voice], 0.8)
  }

  const nowStep = playhead === null ? null : Math.floor(playhead * steps) % steps

  return (
    <div className="xp-lanes">
      <div ref={ref} className="xp-lanes-grid" style={{ height }} data-no-pinch>
        {cw > 0 && (
          <svg width={w} height={height} className="xp-lanes-svg">
            {nowStep !== null && (
              <path
                className="xp-ink-hatch xp-lanes-now"
                d={hatch(LABEL_W + nowStep * cw + 1, HEAD_H, cw - 2, height - HEAD_H, 5, nowStep + 1)}
              />
            )}
            <path className="xp-ink-bold" d={grid.bold} />
            <path className="xp-ink-thin" d={grid.thin} />
            <path className="xp-ink-fill xp-ink-faint" d={grid.dots} />
            {Array.from({ length: steps / 4 }, (_, beat) => (
              <text
                key={beat}
                className="xp-lanes-beat num"
                x={LABEL_W + beat * 4 * cw + 5}
                y={HEAD_H - 9}
              >
                {beat % 4 === 0 ? `${beat / 4 + 1}.1` : `${(beat % 4) + 1}`}
              </text>
            ))}
            {hits.map((h) => (
              <g key={h.key} style={{ opacity: h.opacity }}>
                <path className="xp-ink-blot" d={h.d} />
                {h.ring && <path className="xp-ink-bold" d={h.ring} />}
              </g>
            ))}
          </svg>
        )}
        {cw > 0 &&
          DRUM_TYPES.map((drum, row) => (
            <div key={drum} className="xp-lane" style={{ top: HEAD_H + row * ROW_H, height: ROW_H }}>
              <div className="xp-lane-label" style={{ width: LABEL_W - 10 }}>
                <span className="xp-lane-mark">
                  <SoundPreview
                    pattern={PATTERNS.find((p) => p.id === DRUM_TO_VOICE[drum])!}
                    character={character[DRUM_TO_VOICE[drum]]}
                    velocity={0.8}
                  />
                </span>
                {DRUM_LABEL[drum]}
              </div>
              {Array.from({ length: steps }, (_, s) => (
                <button
                  key={s}
                  type="button"
                  className="xp-cell"
                  style={{ left: LABEL_W + s * cw, width: cw }}
                  aria-label={`${DRUM_LABEL[drum]} step ${s + 1}`}
                  aria-pressed={cells.has(`${drum}:${s}`)}
                  onClick={() => toggle(drum, s)}
                  onKeyUp={(e) => {
                    if (e.key === ' ') e.preventDefault()
                  }}
                />
              ))}
            </div>
          ))}
      </div>
      {others > 0 && (
        <p className="xp-note">
          {others} {others === 1 ? 'hit' : 'hits'} on the ring use sounds outside these five lanes (rim, clap, FX).
        </p>
      )}
    </div>
  )
}
