import { useMemo, useRef } from 'react'
import { useSize } from './Controls.tsx'
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
 * Fill strength is confidence: a hit the analysis was sure of is solid black,
 * a guess is grey; an open hat is drawn as an outline. Steps added by hand are always solid.
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

  // One hairline square per step, the same square the transport's buttons
  // are; a gap after every beat so the bar reads in fours.
  const box = (s: number, row: number) => {
    const gap = 3
    const beatGap = 6
    const unit = (cw * steps - beatGap * (steps / 4 - 1)) / steps
    const x = LABEL_W + s * unit + Math.floor(s / 4) * beatGap
    const y = HEAD_H + row * ROW_H + (ROW_H - Math.min(ROW_H - 10, unit - gap)) / 2
    const size = Math.min(ROW_H - 10, unit - gap)
    return { x: x + (unit - gap - size) / 2, y, size }
  }

  const hits = useMemo(() => {
    if (cw === 0) return []
    const out: { key: string; x: number; y: number; size: number; open: boolean; opacity: number }[] = []
    DRUM_TYPES.forEach((drum, row) => {
      for (let s = 0; s < steps; s++) {
        const key = `${drum}:${s}`
        const cell = cells.get(key)
        if (!cell) continue
        out.push({ key, ...box(s, row), open: cell.open, opacity: 0.25 + 0.75 * (confidence.get(key) ?? 1) })
      }
    })
    return out
    // `box` is derived from cw and steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            {DRUM_TYPES.map((_, row) =>
              Array.from({ length: steps }, (_, s) => {
                const b = box(s, row)
                return (
                  <rect
                    key={`${row}:${s}`}
                    className={`xp-step${s === nowStep ? ' xp-step--now' : ''}${s % 16 === 0 ? ' xp-step--bar' : ''}`}
                    x={b.x + 0.5}
                    y={b.y + 0.5}
                    width={b.size - 1}
                    height={b.size - 1}
                  />
                )
              }),
            )}
            {Array.from({ length: steps / 4 }, (_, beat) => (
              <text key={beat} className="xp-lanes-beat num" x={box(beat * 4, 0).x} y={HEAD_H - 9}>
                {beat % 4 === 0 ? `${beat / 4 + 1}.1` : `${(beat % 4) + 1}`}
              </text>
            ))}
            {hits.map((h) =>
              h.open ? (
                <rect
                  key={h.key}
                  className="xp-hit xp-hit--open"
                  x={h.x + 2}
                  y={h.y + 2}
                  width={h.size - 4}
                  height={h.size - 4}
                  style={{ opacity: h.opacity }}
                />
              ) : (
                <rect key={h.key} className="xp-hit" x={h.x} y={h.y} width={h.size} height={h.size} style={{ opacity: h.opacity }} />
              ),
            )}
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
                  style={{ left: box(s, row).x, width: box(s, row).size }}
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
