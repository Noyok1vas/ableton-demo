import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useSession } from '../rhythmic-intent/session.tsx'
import { TransportBar } from '../transport/TransportBar.tsx'
import { IconPlus, IconUndo } from '../main-screen/icons.tsx'
import { resolveDrumVoice } from '../transport/kit.ts'
import type { DrumParams, SoundVoiceId } from '../transport/engine.ts'
import { completeDrum } from './params.ts'
import { RING_SCALE, figureOf } from './glyphs.ts'
import { GRAIN_PX, makeRng, pour, printSand, type Sand } from './sand.ts'
import { useDrum, useDrumPage } from './session.tsx'
import '../main-screen/main-screen.css'
import './chladni2.css'

/** One tap as the ring draws it: when, how hard, and every knob it carried. */
type Mark = {
  id: string
  pos: number
  velocity: number
  voice: SoundVoiceId
  drum: DrumParams
}

// ── The ring ─────────────────────────────────────────────────────────────
// One loop is one circle: 12 o'clock is its top, time runs clockwise, and a
// tap lands at the moment it was played — the Main Screen's own ring.
const RING_RADIUS = 0.3 // of the canvas's smaller side
const GRID_ALPHA = 0.08
const PLAYHEAD_ALPHA = 0.05
const PLAYHEAD_SWEEP = 0.62

// ── Marks ────────────────────────────────────────────────────────────────
/** One body unit of a figure, as a share of the canvas's smaller side, at
    velocity 1 — before VELOCITY's size (channel 10) and RIM's ring scale. */
const MARK_UNIT = 0.058
const VELOCITY_MIN_SIZE = 0.45
const VELOCITY_MAX_SIZE = 1.3
/** Px per body unit marks are poured at; printing rescales from there, so a
    resize reprints and never re-pours. */
const POUR_PX = 110

// ── DECAY → the tail ─────────────────────────────────────────────────────
// Channel 4 on the ring: a sound's tail runs clockwise from its mark for as
// long as the sound actually rings — its decay, from the same resolver the
// engine plays it with, as a share of the loop. Capped so a long ride does
// not wrap a third of the ring.
const TAIL_AUDIBLE = 0.6 // of the envelope's full length that is heard
const TAIL_MAX = 0.3 // of the loop
const TAIL_GRAINS_PER_PX = 1.4
/** Share of a tail's grains showing at rest. The rest come in as the
    playhead passes the mark — the tail lights up — and fade with it. */
const TAIL_REST = 0.4
const TAIL_FADE = 2.6
const HIT_SCALE = 1.1

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const wrapPos = (p: number) => ((p % 1) + 1) % 1
const shortestStep = (d: number) => {
  const w = wrapPos(d)
  return w > 0.5 ? w - 1 : w
}
const velSize = (v: number) => lerp(VELOCITY_MIN_SIZE, VELOCITY_MAX_SIZE, Math.min(1, Math.max(0, v)))

function seedOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return h >>> 0
}

function gaussian(rand: () => number): number {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Swallow Space on a focused button: it is the tap key. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** A tail's grains, in px from the canvas centre. */
type Tail = {
  pos: number
  reach: number
  xs: Float32Array
  ys: Float32Array
  at: Float32Array
  needs: Float32Array
}

/**
 * The Chladni 2 ring — the Main Screen's loop, drawn with this page's
 * figures. Every mark is its tap's own snapshot, so moving a knob changes the
 * next tap and nothing already on the ring. Drag a mark to move it round the
 * loop; double-click it to take it out.
 */
export function Chladni2Ring() {
  useDrumPage()
  const { fill } = useDrum()
  const {
    rendered,
    playhead,
    beatsPerLoop,
    loopDuration,
    removeTap,
    moveTap,
    clearPattern,
    undoTap,
    canUndo,
    hasPattern,
  } = useSession()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const marks = useMemo<Mark[]>(
    () =>
      rendered
        .filter((t) => t.kept)
        .map((t) => {
          // A tap played anywhere else carries no knobs: it is drawn at the
          // 909 setting of its sound (a hardware pad's, as a kick).
          const voice = t.voice ?? 'kick'
          return { id: t.id, pos: t.finalPos, velocity: t.velocity, voice, drum: completeDrum(voice, t.drum) }
        }),
    [rendered],
  )
  const marksRef = useRef(marks)
  marksRef.current = marks
  const renderedRef = useRef(rendered)
  renderedRef.current = rendered
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead
  const playing = playhead !== null

  // Bridges into the canvas's own loop.
  const updateRef = useRef<(() => void) | null>(null)
  const settings = useRef({ fill, beats: beatsPerLoop, loop: loopDuration })
  settings.current = { fill, beats: beatsPerLoop, loop: loopDuration }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ink = document.createElement('canvas')
    const inkCtx = ink.getContext('2d')
    if (!inkCtx) return

    let width = 0
    let height = 0
    let dirty = true
    let raf = 0
    let tails: Tail[] = []
    const sands = new Map<string, { key: string; sand: Sand }>()

    const sandOf = (mark: Mark): Sand => {
      const key = `${mark.voice}|${JSON.stringify(mark.drum)}|${settings.current.fill}`
      const kept = sands.get(mark.id)
      if (kept && kept.key === key) return kept.sand
      const sand = pour(figureOf(mark.voice, mark.drum), {
        seed: seedOf(mark.id),
        px: POUR_PX,
        fill: settings.current.fill,
      })
      sands.set(mark.id, { key, sand })
      return sand
    }

    const geometry = () => {
      const dim = Math.min(width, height)
      return { cx: width / 2, cy: height / 2, dim, ring: RING_RADIUS * dim }
    }

    /** Px per body unit of a mark, and where its centre is. */
    const place = (mark: Mark) => {
      const { dim, ring } = geometry()
      const theta = mark.pos * Math.PI * 2 - Math.PI / 2
      const unit = MARK_UNIT * dim * velSize(mark.velocity) * (RING_SCALE[mark.voice] ?? 1)
      return { theta, unit, x: Math.cos(theta) * ring, y: Math.sin(theta) * ring }
    }

    const buildTail = (mark: Mark, sand: Sand): Tail | null => {
      const seconds = resolveDrumVoice(mark.voice, mark.drum).voice.decay * TAIL_AUDIBLE
      const reach = Math.min(TAIL_MAX, seconds / settings.current.loop)
      const { ring } = geometry()
      const { theta, unit } = place(mark)
      // Leave from the mark's edge, not its middle.
      let extent = 0
      for (let i = 0; i < sand.count; i += 7) {
        extent = Math.max(extent, Math.hypot(sand.xs[i], sand.ys[i]))
      }
      const gap = (extent * unit * 0.85) / ring
      const arc = reach * Math.PI * 2
      if (arc <= gap * 0.25) return null
      const count = Math.round(arc * ring * TAIL_GRAINS_PER_PX)
      const rand = makeRng(seedOf(mark.id) ^ 0x9e3779b9)
      const xs = new Float32Array(count)
      const ys = new Float32Array(count)
      const at = new Float32Array(count)
      const needs = new Float32Array(count)
      const width = extent * unit * 0.4
      let n = 0
      for (let i = 0; i < count; i++) {
        // Heavier near the mark, thinning as the sound dies away.
        const s = Math.pow(rand(), 1.7)
        const turn = gap + s * arc
        const off = gaussian(rand) * width * (0.15 + 0.85 * s)
        const r = ring + off
        xs[n] = Math.cos(theta + turn) * r
        ys[n] = Math.sin(theta + turn) * r
        at[n] = turn / (Math.PI * 2)
        needs[n] = rand() * (1 + 1.5 * s)
        n++
      }
      return {
        pos: mark.pos,
        reach: (gap + arc) / (Math.PI * 2),
        xs: xs.subarray(0, n),
        ys: ys.subarray(0, n),
        at: at.subarray(0, n),
        needs: needs.subarray(0, n),
      }
    }

    const paintInk = () => {
      const { cx, cy, ring } = geometry()
      inkCtx.clearRect(0, 0, width, height)
      // The beat grid and the ring itself, hairline and nearly white.
      const reach = Math.hypot(width, height) / 2
      inkCtx.strokeStyle = `rgba(0, 0, 0, ${GRID_ALPHA})`
      inkCtx.lineWidth = Math.max(1, Math.round(window.devicePixelRatio || 1))
      inkCtx.beginPath()
      const beats = settings.current.beats
      for (let b = 0; b < beats; b++) {
        const t = (b / beats) * Math.PI * 2 - Math.PI / 2
        inkCtx.moveTo(cx, cy)
        inkCtx.lineTo(cx + Math.cos(t) * reach, cy + Math.sin(t) * reach)
      }
      inkCtx.stroke()
      inkCtx.beginPath()
      inkCtx.arc(cx, cy, ring, 0, Math.PI * 2)
      inkCtx.stroke()

      const live = new Set<string>()
      tails = []
      for (const mark of marksRef.current) {
        live.add(mark.id)
        const sand = sandOf(mark)
        const { unit, x, y } = place(mark)
        printSand(inkCtx, sand, cx + x, cy + y, unit, GRAIN_PX * Math.max(0.7, unit / POUR_PX))
        const tail = buildTail(mark, sand)
        if (tail) tails.push(tail)
      }
      for (const id of sands.keys()) if (!live.has(id)) sands.delete(id)

      // Each tail at rest.
      inkCtx.fillStyle = '#000000'
      inkCtx.globalAlpha = 0.4
      const g = GRAIN_PX * Math.max(1, (window.devicePixelRatio || 1) * 0.6)
      for (const tail of tails) {
        for (let i = 0; i < tail.xs.length; i++) {
          if (tail.needs[i] < TAIL_REST) inkCtx.fillRect(cx + tail.xs[i], cy + tail.ys[i], g, g)
        }
      }
      inkCtx.globalAlpha = 1
    }

    const frame = () => {
      raf = 0
      if (dirty) {
        paintInk()
        dirty = false
      }
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(ink, 0, 0)
      const head = playheadRef.current
      const { cx, cy } = geometry()
      if (head !== null) {
        // The playhead lights each tail up as it passes the mark, and the
        // light dies back along the tail as the sound does.
        ctx.fillStyle = '#000000'
        ctx.globalAlpha = 0.4
        const g = GRAIN_PX * Math.max(1, (window.devicePixelRatio || 1) * 0.6)
        for (const tail of tails) {
          const since = wrapPos(head - tail.pos)
          if (since > tail.reach * 1.5) continue
          for (let i = 0; i < tail.xs.length; i++) {
            const need = tail.needs[i]
            if (need < TAIL_REST || since < tail.at[i]) continue
            const level =
              TAIL_REST + (1.5 - TAIL_REST) * Math.exp(((tail.at[i] - since) / tail.reach) * TAIL_FADE)
            if (need < level) ctx.fillRect(cx + tail.xs[i], cy + tail.ys[i], g, g)
          }
        }
        ctx.globalAlpha = 1
        // The same turning shadow as the Main Screen's playhead.
        const theta0 = head * Math.PI * 2 - Math.PI / 2
        const grad = ctx.createConicGradient(theta0, cx, cy)
        const back = 1 - PLAYHEAD_SWEEP
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
        grad.addColorStop(back, 'rgba(0, 0, 0, 0)')
        grad.addColorStop(lerp(back, 1, 0.6), `rgba(0, 0, 0, ${PLAYHEAD_ALPHA * 0.3})`)
        grad.addColorStop(1, `rgba(0, 0, 0, ${PLAYHEAD_ALPHA})`)
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, width, height)
        raf = requestAnimationFrame(frame)
      }
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame)
    }
    updateRef.current = () => {
      dirty = true
      schedule()
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width * dpr))
      height = Math.max(1, Math.round(rect.height * dpr))
      canvas.width = width
      canvas.height = height
      ink.width = width
      ink.height = height
      dirty = true
      schedule()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
      updateRef.current = null
    }
  }, [])

  useEffect(() => {
    updateRef.current?.()
  }, [marks, fill, beatsPerLoop, loopDuration, playing])

  // ── Pointer: drag a mark round the loop, double-click to remove it ─────
  const pointerAt = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const scale = canvas.width / rect.width
    return {
      x: (event.clientX - rect.left) * scale - canvas.width / 2,
      y: (event.clientY - rect.top) * scale - canvas.height / 2,
      dim: Math.min(canvas.width, canvas.height),
    }
  }

  const markAt = ({ x, y, dim }: { x: number; y: number; dim: number }) => {
    let hit: string | null = null
    let best = Infinity
    for (const mark of marksRef.current) {
      const theta = mark.pos * Math.PI * 2 - Math.PI / 2
      const d = Math.hypot(x - Math.cos(theta) * RING_RADIUS * dim, y - Math.sin(theta) * RING_RADIUS * dim)
      const reach =
        MARK_UNIT * dim * velSize(mark.velocity) * (RING_SCALE[mark.voice] ?? 1) * HIT_SCALE
      if (d < reach && d < best) {
        best = d
        hit = mark.id
      }
    }
    return hit
  }

  const loopPosAt = ({ x, y }: { x: number; y: number }) => wrapPos(Math.atan2(y, x) / (Math.PI * 2) + 0.25)

  const dragRef = useRef<{ pointerId: number; id: string; pos: number; cursor: number } | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  const [hovering, setHovering] = useState(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = pointerAt(event)
    if (!point) return
    const id = markAt(point)
    const tap = id ? renderedRef.current.find((t) => t.id === id) : undefined
    if (!id || !tap) return
    dragRef.current = { pointerId: event.pointerId, id, pos: tap.rawPos, cursor: loopPosAt(point) }
    setGrabbing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointerAt(event)
    if (!point) return
    const drag = dragRef.current
    if (!drag) {
      setHovering(markAt(point) !== null)
      return
    }
    if (event.pointerId !== drag.pointerId) return
    const cursor = loopPosAt(point)
    drag.pos = wrapPos(drag.pos + shortestStep(cursor - drag.cursor))
    drag.cursor = cursor
    moveTap(drag.id, drag.pos)
  }

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setGrabbing(false)
  }

  const onDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const point = pointerAt(event)
    const hit = point ? markAt(point) : null
    if (hit) removeTap(hit)
  }

  return (
    <div className="ms-screen c2-ring">
      <canvas
        ref={canvasRef}
        className={`c2-ring-canvas${grabbing ? ' c2-ring-canvas--grabbing' : hovering ? ' c2-ring-canvas--grab' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHovering(false)}
        onDoubleClick={onDoubleClick}
      />
      <div className="ms-overlay">
        <div className="ms-row ms-row--top">
          <button
            type="button"
            className="ms-circle"
            aria-label="New pattern"
            disabled={!hasPattern}
            onClick={clearPattern}
            onKeyUp={swallowSpace}
            data-hint="New pattern — clears the ring. The loop you had stays in the Collection"
          >
            <IconPlus />
          </button>
          <TransportBar />
          <button
            type="button"
            className="ms-circle"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={undoTap}
            onKeyUp={swallowSpace}
            data-hint="Undo — takes back the last tap"
          >
            <IconUndo />
          </button>
        </div>
      </div>
    </div>
  )
}
