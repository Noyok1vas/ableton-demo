import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useSoundIntent } from '../sound-intent/session.tsx'
import { useSession as useRhythmicIntent } from '../rhythmic-intent/session.tsx'
import { useFx } from '../fx/session.tsx'
import { FX_MAX, FX_MIN } from '../fx/types.ts'
import { seedFromId, shortestStep, wrapPos, type MarkTap } from './marks.ts'
import { SpiralScene, type Mode } from './scene.ts'
import './sound-visual.css'

export type { Mode } from './scene.ts'

/** What a tap sounded like, kept here and keyed by the tap's id. Rhythmic
    Intent owns when; this owns what — the snapshot of Sound Intent's dimensions
    and the sound's identity at the instant it fired. */
type Snapshot = Omit<MarkTap, 'id' | 'pos' | 'velocity'>

/** Caps for the device; beyond this the specks only get finer. */
const MAX_DPR = 2
const MAX_TAPS = 64

/**
 * The Sound Visual: the three.js scene (scene.ts) under React. React owns the
 * pattern, the snapshots and the pointer; the scene owns every frame.
 *
 * `mode` is CREATE — the ring, where marks are made and moved — or ARRANGE,
 * the whole song as a helix, for looking at. The scene animates between them.
 */
export function SoundVisual3D({ mode }: { mode: Mode }) {
  const { onTap, params: soundParams } = useSoundIntent()
  const { params: fx } = useFx()
  const { rendered, playhead, removeTap, moveTap, beatsPerLoop } = useRhythmicIntent()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<SpiralScene | null>(null)
  const rafRef = useRef(0)

  // ── What each tap sounded like ──────────────────────────────────────
  const snapshotsRef = useRef(new Map<string, Snapshot>())
  const soundParamsRef = useRef(soundParams)
  soundParamsRef.current = soundParams

  useEffect(
    () =>
      onTap((tap) => {
        snapshotsRef.current.set(tap.id, {
          energy: tap.params.d1,
          length: tap.params.d2,
          seed: (Math.random() * 0xffffffff) >>> 0,
          gesture: tap.gesture,
          character: tap.character,
        })
      }),
    [onTap],
  )

  // The field the scene draws: Rhythmic Intent's transformed pattern, joined
  // with the snapshots, so the marks move with the knobs and DENSITY drops the
  // ones it silences.
  const marks = useMemo<MarkTap[]>(
    () =>
      rendered
        .filter((t) => t.kept)
        .slice(-MAX_TAPS)
        .map((t) => {
          let snapshot = snapshotsRef.current.get(t.id)
          if (!snapshot) {
            const p = soundParamsRef.current
            snapshot = {
              energy: p.d1,
              length: p.d2,
              seed: seedFromId(t.id),
              gesture: t.voice ?? 'kick',
              character: t.character ?? null,
            }
            snapshotsRef.current.set(t.id, snapshot)
          }
          return { id: t.id, pos: t.finalPos, velocity: t.velocity, ...snapshot }
        }),
    [rendered],
  )
  const renderedRef = useRef(rendered)
  renderedRef.current = rendered

  const playheadRef = useRef(playhead)
  playheadRef.current = playhead
  const playheadOn = playhead !== null

  // ── The scene ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new SpiralScene(canvas, () => playheadRef.current)
    sceneRef.current = scene

    const resize = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      scene.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr), dpr)
      schedule()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    return () => {
      observer.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      scene.dispose()
      sceneRef.current = null
    }
    // Built once; everything after reaches it through sceneRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Draw a frame, and keep drawing while the loop runs or the camera moves. */
  const schedule = () => {
    if (rafRef.current) return
    const tick = (now: number) => {
      rafRef.current = 0
      const scene = sceneRef.current
      if (!scene) return
      scene.frame(now)
      if (playheadRef.current !== null || scene.isAnimating(now)) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    sceneRef.current?.setMarks(marks)
    schedule()
  }, [marks])

  useEffect(() => {
    sceneRef.current?.setBeats(beatsPerLoop)
    schedule()
  }, [beatsPerLoop])

  useEffect(() => {
    sceneRef.current?.setScatter((fx.reverb - FX_MIN) / (FX_MAX - FX_MIN))
    schedule()
  }, [fx.reverb])

  useEffect(() => {
    sceneRef.current?.setMode(mode, performance.now())
    schedule()
  }, [mode])

  // Wake when the playhead starts (it keeps itself running from there) and
  // once more when it stops, so the last light is wiped off.
  useEffect(() => {
    schedule()
  }, [playheadOn])

  // An empty loop has nothing left to remember.
  const empty = rendered.length === 0
  useEffect(() => {
    if (empty) snapshotsRef.current.clear()
  }, [empty])

  // ── Pointer: drag a mark round the ring, double-click to remove ──────
  const pointerAt = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const scale = canvas.width / rect.width
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale }
  }

  const dragRef = useRef<{ pointerId: number; id: string; pos: number; cursor: number } | null>(
    null,
  )
  const [grabbing, setGrabbing] = useState(false)
  const [hovering, setHovering] = useState(false)

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || mode !== 'create') return
    const scene = sceneRef.current
    const point = pointerAt(event)
    if (!scene || !point) return
    const id = scene.markAt(point.x, point.y)
    if (!id) return
    const tap = renderedRef.current.find((t) => t.id === id)
    if (!tap) return
    dragRef.current = {
      pointerId: event.pointerId,
      id,
      pos: tap.rawPos,
      cursor: scene.loopPosAt(point.x, point.y),
    }
    setGrabbing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current
    const point = pointerAt(event)
    if (!scene || !point) return
    const drag = dragRef.current
    if (!drag) {
      setHovering(mode === 'create' && scene.markAt(point.x, point.y) !== null)
      return
    }
    if (event.pointerId !== drag.pointerId) return
    const cursor = scene.loopPosAt(point.x, point.y)
    drag.pos = wrapPos(drag.pos + shortestStep(cursor - drag.cursor))
    drag.cursor = cursor
    moveTap(drag.id, drag.pos)
  }

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setGrabbing(false)
  }

  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'create') return
    const scene = sceneRef.current
    const point = pointerAt(event)
    if (!scene || !point) return
    const hit = scene.markAt(point.x, point.y)
    if (hit) removeTap(hit)
  }

  return (
    <div className="sv3-screen">
      <canvas
        ref={canvasRef}
        className={`sv3-canvas${grabbing ? ' sv3-canvas--grabbing' : hovering ? ' sv3-canvas--grab' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHovering(false)}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  )
}
