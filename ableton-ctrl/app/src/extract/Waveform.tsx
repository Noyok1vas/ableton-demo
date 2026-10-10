import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useSize } from './SketchParts.tsx'
import { hatch, line, line2, scribble, seeded, seedOf } from './sketch.ts'
import { RECORD_MAX_S } from './audio.ts'
import type { Selection, SourceAudio } from './session.tsx'

const HEIGHT = 168
const RULER = 22
const WAVE_TOP = 10
const WAVE_H = HEIGHT - RULER - WAVE_TOP - 8

type Drag =
  | { kind: 'start' | 'end' | 'move'; x0: number; sel: Selection; pxPerSecond: number }
  | null

/**
 * The source, drawn as one pen scribble, with the part being studied hatched
 * in and bracketed. Drag a bracket to resize, the hatching to move, or press
 * anywhere else to put the selection there. While a take is being recorded it
 * draws the input as it arrives instead.
 *
 * `cursor` is where in the source the sound is right now — the preview, or
 * the backing track under the loop — in seconds.
 */
export function Waveform({
  source,
  selection,
  onSelect,
  recording,
  cursor,
  extracted,
}: {
  source: SourceAudio | null
  selection: Selection
  onSelect: (next: Selection) => void
  recording: { elapsed: number; levels: number[] } | null
  cursor: number | null
  /** The span the backing clip was cut from, marked on the scribble. */
  extracted: { start: number; end: number } | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useSize(ref)
  const w = size?.w ?? 0
  const duration = source?.duration ?? 1
  const x = (t: number) => (t / duration) * w
  const [drag, setDrag] = useState<Drag>(null)

  const wave = useMemo(
    () => (source && w > 0 ? scribble(source.peaks, 0, WAVE_TOP, w, WAVE_H, seedOf(source.name)) : ''),
    [source, w],
  )

  // Ruler ticks: every second, a longer one every five (every ten past a minute).
  const ruler = useMemo(() => {
    if (!source || w === 0) return { d: '', labels: [] as { x: number; t: number }[] }
    const rand = seeded(7)
    const major = duration > 60 ? 10 : 5
    const minor = duration > 120 ? 5 : 1
    let d = ''
    const labels: { x: number; t: number }[] = []
    for (let t = 0; t <= duration + 1e-6; t += minor) {
      const isMajor = Math.round(t) % major === 0
      const px = (t / duration) * w
      d += line(px, HEIGHT - RULER, px, HEIGHT - RULER + (isMajor ? 8 : 4), rand, 0.4)
      if (isMajor) labels.push({ x: px, t: Math.round(t) })
    }
    return { d, labels }
  }, [source, w, duration])

  const live = useMemo(() => {
    if (!recording || w === 0) return ''
    const n = recording.levels.length
    if (n === 0) return ''
    // The take fills the width over the full fifteen seconds.
    const span = (recording.elapsed / RECORD_MAX_S) * w
    const buckets = Math.max(1, Math.min(n, Math.round(span / 3)))
    const peaks = new Float32Array(buckets)
    for (let i = 0; i < n; i++) {
      const b = Math.min(buckets - 1, Math.floor((i / n) * buckets))
      peaks[b] = Math.max(peaks[b], recording.levels[i])
    }
    return scribble(peaks, 0, WAVE_TOP, span, WAVE_H, 11)
  }, [recording, w])

  const pxPerSecond = () => {
    const rect = ref.current?.getBoundingClientRect()
    // The on-screen width, so a drag tracks the finger at any canvas zoom.
    return rect && rect.width > 0 ? rect.width / duration : 1
  }

  const begin = (kind: 'start' | 'end' | 'move') => (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind, x0: e.clientX, sel: selection, pxPerSecond: pxPerSecond() })
  }
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return
    const dt = (e.clientX - drag.x0) / drag.pxPerSecond
    const { start, end } = drag.sel
    if (drag.kind === 'start') onSelect({ start: Math.min(start + dt, end - 0.1), end })
    else if (drag.kind === 'end') onSelect({ start, end: Math.max(end + dt, start + 0.1) })
    else {
      const len = end - start
      const s = Math.min(Math.max(0, start + dt), duration - len)
      onSelect({ start: s, end: s + len })
    }
  }
  const onUp = () => setDrag(null)

  // A press on open ground centres the selection there.
  const onBackground = (e: ReactPointerEvent) => {
    if (!source) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const t = ((e.clientX - rect.left) / rect.width) * duration
    const len = selection.end - selection.start
    const s = Math.min(Math.max(0, t - len / 2), duration - len)
    onSelect({ start: s, end: s + len })
  }

  // Nudging with the arrow keys, for anyone not dragging.
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1
    const len = selection.end - selection.start
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const s = Math.min(Math.max(0, selection.start + (e.key === 'ArrowLeft' ? -step : step)), duration - len)
      onSelect({ start: s, end: s + len })
    }
  }

  const sx = x(selection.start)
  const ex = x(selection.end)
  const seed = seedOf(source?.name ?? 'empty')

  useEffect(() => {
    if (!drag) return
    const cancel = () => setDrag(null)
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [drag])

  return (
    <div
      ref={ref}
      className={`xp-wave${source ? '' : ' xp-wave--empty'}`}
      style={{ height: HEIGHT }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      data-no-pinch
    >
      {w > 0 && (
        <svg width={w} height={HEIGHT} className="xp-wave-svg">
          <defs>
            <clipPath id="xp-sel-clip">
              <rect x={sx} y={0} width={Math.max(0, ex - sx)} height={HEIGHT} />
            </clipPath>
          </defs>
          {/* The baseline the scribble swings about. */}
          <path className="xp-ink-faint" d={line2(0, WAVE_TOP + WAVE_H / 2, w, WAVE_TOP + WAVE_H / 2, 3, 0.6)} />
          {recording ? (
            <path className="xp-ink-wave" d={live} />
          ) : source ? (
            <>
              <path
                className="xp-ink-wave xp-ink-wave--out"
                d={wave}
                onPointerDown={onBackground}
              />
              <rect
                className="xp-wave-hit"
                x={0}
                y={0}
                width={w}
                height={HEIGHT - RULER}
                onPointerDown={onBackground}
              />
              <path className="xp-ink-hatch xp-sel-hatch" d={hatch(sx, WAVE_TOP - 4, ex - sx, WAVE_H + 8, 9, seed)} />
              <path className="xp-ink-wave" d={wave} clipPath="url(#xp-sel-clip)" />
              {extracted && (
                <path
                  className="xp-ink-mark"
                  d={line2(x(extracted.start), HEIGHT - RULER - 4, x(extracted.end), HEIGHT - RULER - 4, seed + 3, 0.8)}
                />
              )}
              {/* Brackets: an upright with a short foot top and bottom. */}
              {[
                { at: sx, dir: 1, kind: 'start' as const },
                { at: ex, dir: -1, kind: 'end' as const },
              ].map(({ at, dir, kind }) => (
                <g key={kind}>
                  <path
                    className="xp-ink-bold"
                    d={
                      line2(at, WAVE_TOP - 6, at, WAVE_TOP + WAVE_H + 6, seed + (dir > 0 ? 1 : 2), 0.8) +
                      line2(at, WAVE_TOP - 6, at + 9 * dir, WAVE_TOP - 6, seed + 5, 0.5) +
                      line2(at, WAVE_TOP + WAVE_H + 6, at + 9 * dir, WAVE_TOP + WAVE_H + 6, seed + 6, 0.5)
                    }
                  />
                  <rect
                    className="xp-wave-handle"
                    x={at - 12}
                    y={0}
                    width={24}
                    height={HEIGHT - RULER}
                    onPointerDown={begin(kind)}
                  />
                </g>
              ))}
              <rect
                className="xp-wave-body"
                x={sx + 12}
                y={0}
                width={Math.max(0, ex - sx - 24)}
                height={HEIGHT - RULER}
                onPointerDown={begin('move')}
              />
              {cursor !== null && (
                <path
                  className="xp-ink-cursor"
                  d={line2(x(cursor), WAVE_TOP - 8, x(cursor), WAVE_TOP + WAVE_H + 8, 21, 0.4)}
                />
              )}
              <path className="xp-ink-thin" d={ruler.d} />
              {ruler.labels.map((l) => (
                <text key={l.t} x={l.x + 3} y={HEIGHT - 3} className="xp-wave-label num">
                  {l.t}s
                </text>
              ))}
            </>
          ) : null}
        </svg>
      )}
      {source && !recording && (
        <div
          className="xp-wave-focus"
          tabIndex={0}
          role="slider"
          aria-label="Selection position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(selection.start * 10) / 10}
          aria-valuetext={`${selection.start.toFixed(1)} to ${selection.end.toFixed(1)} seconds`}
          onKeyDown={onKey}
        />
      )}
    </div>
  )
}
