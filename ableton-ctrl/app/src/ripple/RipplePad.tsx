import { useEffect, useRef } from 'react'
import type React from 'react'
import { REPEAT_INTERVAL_MS, RING_LIFE_MS, RIPPLE_MAX } from './types.ts'
import { useSoundIntent } from '../sound-intent/session.tsx'

type RipplePadProps = {
  /** Repeats per tap, 1..RIPPLE_MAX — one ring each. */
  count: number
}

/** One speck of ink on a ring. `angle` places it around the circle; `jitter` is
    its offset off the ring in band-width units, so the ring can widen as it
    travels without re-rolling the randomness. */
type Speck = { angle: number; jitter: number }

/** One repeat, in flight. `firesAt` is when its note sounds — the ring is not
    drawn at all before then, which is what makes the stagger visible. */
type Ring = { firesAt: number; specks: Speck[] }

const SPECKS_PER_RING = 900
/** Rim radius, as a fraction of the pad's smaller dimension. */
const MAX_RADIUS = 0.44
/** Ring band width at birth and at the rim, same units. The wave spreads as it
    loses definition. */
const BAND_MIN = 0.006
const BAND_MAX = 0.03
const BASE_ALPHA = 0.72
/** Travel curve: slightly faster off the centre, easing as it dissipates. */
const TRAVEL_EASE = 0.85
/** Alpha falloff along the travel. >1 keeps the ring solid early, then drops. */
const FADE_POWER = 1.4

/** The resting rings that show the current count. Slots are fixed to
    RIPPLE_MAX, so raising the count adds a ring outward instead of re-spacing
    the ones already there. */
const PREVIEW_ALPHA = 0.2

/** Standard-normal sample (Box–Muller), for the ring's soft edge. */
function gaussian(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function makeSpecks(): Speck[] {
  const specks: Speck[] = new Array(SPECKS_PER_RING)
  for (let i = 0; i < SPECKS_PER_RING; i++) {
    specks[i] = { angle: Math.random() * Math.PI * 2, jitter: gaussian() }
  }
  return specks
}

/**
 * The ripple pad: press it and the gesture plays — `count` notes, one ring per
 * note, each ring travelling out from the centre and staggered by the ratchet
 * interval, so mid-gesture the pad shows exactly `count` concentric rings. It
 * also plays back any RIPPLE tap fired elsewhere, with that tap's own repeat
 * count, so this window mirrors the gesture wherever it was triggered.
 *
 * Here the wave passes and is gone: this pad is the gesture in motion. The Sound
 * Visual draws the same gesture as a mark that settles and stays, because that
 * canvas is the bar's pattern, not a live animation.
 *
 * React owns the count; the canvas owns every frame of the animation. The
 * resting state draws the same rings parked at fixed radii, so dragging the
 * slider reads immediately without pressing anything.
 */
export function RipplePad({ count }: RipplePadProps) {
  const { onTap } = useSoundIntent()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Bridge out of the canvas effect: React presses, the sim animates.
  const fireRef = useRef<((repeats?: number) => void) | null>(null)
  const setCountRef = useRef<((n: number) => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rings: Ring[] = []
    let previewCount = count
    let width = 0
    let height = 0
    let dpr = 1
    let rafId = 0

    const minDim = () => Math.min(width, height)

    const scheduleDraw = () => {
      if (!rafId) rafId = requestAnimationFrame(frame)
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width * dpr))
      height = Math.max(1, Math.round(rect.height * dpr))
      canvas.width = width
      canvas.height = height
      scheduleDraw()
    }

    /** One tap → `repeats` rings, spaced by the ratchet interval. A tap fired
        elsewhere passes its own snapshotted count; a press here uses the
        current one. */
    const fire = (repeats = previewCount) => {
      const now = performance.now()
      for (let i = 0; i < repeats; i++) {
        rings.push({ firesAt: now + i * REPEAT_INTERVAL_MS, specks: makeSpecks() })
      }
      scheduleDraw()
    }

    // ── Drawing ─────────────────────────────────────────────────────────

    /** Specks of one ring at radius `r`, band width `band`, in device px. */
    const drawRing = (r: number, band: number, alpha: number, specks: Speck[]) => {
      const cx = width / 2
      const cy = height / 2
      const dot = Math.max(1, Math.round(dpr))
      ctx.globalAlpha = alpha
      for (const s of specks) {
        const radius = r + s.jitter * band
        if (radius <= 0) continue
        ctx.fillRect(cx + Math.cos(s.angle) * radius, cy + Math.sin(s.angle) * radius, dot, dot)
      }
    }

    // The resting rings are re-rolled only on resize/count change, not per
    // frame — a preview that shimmered would read as motion that isn't there.
    let previewSpecks: Speck[][] = []
    const rebuildPreview = () => {
      previewSpecks = Array.from({ length: previewCount }, makeSpecks)
    }
    rebuildPreview()

    const frame = (now: number) => {
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#000000'

      const dim = minDim()
      const maxR = MAX_RADIUS * dim

      // Resting rings: slot i sits at (i+1)/RIPPLE_MAX of the way out.
      for (let i = 0; i < previewCount; i++) {
        const r = (maxR * (i + 1)) / RIPPLE_MAX
        drawRing(r, BAND_MIN * dim, PREVIEW_ALPHA, previewSpecks[i])
      }

      // Live repeats, oldest first.
      for (let i = rings.length - 1; i >= 0; i--) {
        const ring = rings[i]
        const u = (now - ring.firesAt) / RING_LIFE_MS
        if (u >= 1) {
          rings.splice(i, 1) // reached the rim and dissipated
          continue
        }
        if (u < 0) continue // this repeat hasn't sounded yet
        const r = maxR * Math.pow(u, TRAVEL_EASE)
        const band = (BAND_MIN + (BAND_MAX - BAND_MIN) * u) * dim
        drawRing(r, band, BASE_ALPHA * Math.pow(1 - u, FADE_POWER), ring.specks)
      }
      ctx.globalAlpha = 1

      // Keep animating only while repeats are in flight (or still pending);
      // otherwise the resting frame stays on screen untouched.
      rafId = rings.length > 0 ? requestAnimationFrame(frame) : 0
    }

    fireRef.current = fire
    setCountRef.current = (n: number) => {
      previewCount = n
      rebuildPreview()
      scheduleDraw()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      fireRef.current = null
      setCountRef.current = null
    }
    // Mount-only: the count reaches the sim through setCountRef, so moving the
    // slider never tears the canvas down mid-gesture.
  }, [])

  useEffect(() => {
    setCountRef.current?.(count)
  }, [count])

  // Any TICK-identity tap — the Selector's mark, the TAP button, Space — plays
  // here too, with the repeat count that tap was fired with. This window keeps
  // its ratchet: the Sound Visual's TICK mark is a single ring now, so the
  // repeats live here alone until the gesture is taken further.
  useEffect(
    () =>
      onTap((tap) => {
        if (tap.gesture !== 'tick') return
        fireRef.current?.(tap.repeats)
      }),
    [onTap],
  )

  // pointerdown, not click: the gesture has to start at press time.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    fireRef.current?.()
  }

  return (
    <button
      type="button"
      className="rp-pad"
      aria-label={`Play ripple, ${count} repeats`}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        // Space is the global tap key and belongs to TapSession; Enter is this
        // pad's own keyboard trigger.
        if (e.key === ' ') e.preventDefault()
        if (e.key === 'Enter') {
          e.preventDefault()
          fireRef.current?.()
        }
      }}
    >
      <canvas ref={canvasRef} className="rp-canvas" />
      <span className="rp-count num">×{count}</span>
    </button>
  )
}
