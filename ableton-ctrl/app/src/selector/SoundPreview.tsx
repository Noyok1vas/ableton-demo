import { useEffect, useRef } from 'react'
import { TILE_SIZE, renderPatternTile, renderPatternTileSliced, type Pattern } from './patterns.ts'
import { canRenderInParallel, renderTileParallel } from './tilePool.ts'

// Velocity reads as size alone: a softer hit is a smaller mark, the same ink,
// and a full one draws the mark past its resting size. Same range as the Sound
// Visual's ring, so the two agree on scale. The top is as far as the widest
// marks (an open hat, a snappy snare's grains) go before the pad cuts them off.
const VELOCITY_MIN_SIZE = 0.45
const VELOCITY_MAX_SIZE = 1.3
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
/** How long the character has to stay put before the full-resolution tile is
    rasterized. */
const REFINE_MS = 140
/** The tile a large preview is redrawn at while its character moves: at or
    above the pixels the large view actually covers on an iPad (≈800–950), so
    a drag stays sharp, and a quarter of the 2000² work, so it keeps up. */
const LIVE_RESOLUTION = 1024
/** A slower device draws the live tile smaller rather than later: past
    LIVE_SLOW_MS a tile the next one shrinks, under LIVE_FAST_MS it grows back,
    never below LIVE_FLOOR. Frames over resolution, as a drag should be. */
const LIVE_FLOOR = 640
const LIVE_SLOW_MS = 40
const LIVE_FAST_MS = 22

/**
 * A sound's mark at its current STATE. Used everywhere a sound is shown: the
 * pads, the Main Screen's rack preview, and the one sound brought up large.
 *
 * Same field, same rasterizer, same printed look; the difference is that this
 * one is redrawn whenever the character moves, and drawn smaller as the
 * velocity drops.
 *
 * Rasterizing is per-pixel work, and a dragged strip asks for it far faster
 * than the screen can show it — so a move only records the wanted value and
 * the work happens once, in the next animation frame.
 *
 * `resolution` fixes both the tile and the canvas at that many pixels square
 * (CSS scales it to fit) — the large audition view asks for 2000. That is far
 * too much work for one thread at drag speed, so a large preview is drawn by
 * the worker pool (tilePool): while the character moves it chases the strip
 * at LIVE_RESOLUTION, always drawing the latest value as soon as the last
 * tile lands, and once the strip rests it is drawn again at full resolution.
 * Without workers it falls back to the quick TILE_SIZE tile while moving and
 * a sliced full-resolution one after.
 */
export function SoundPreview({
  pattern,
  character,
  velocity = 1,
  resolution,
}: {
  pattern: Pattern
  character: number
  velocity?: number
  resolution?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The latest requested values, read at paint time rather than closed over,
  // so several moves inside one frame collapse into the last one.
  const wantedRef = useRef(character)
  wantedRef.current = character
  const velocityRef = useRef(velocity)
  velocityRef.current = velocity
  // The painter's own "something changed", published out of the effect so a
  // change can wake it without tearing it down.
  const changedRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId = 0
    // What is currently rasterized, so a resize or a velocity move repaints
    // without rasterizing again.
    let tile: HTMLCanvasElement | null = null
    let tileAt = Number.NaN
    let refineTimer: ReturnType<typeof setTimeout> | null = null
    let cancelRender: (() => void) | null = null
    // A large preview drawn by the pool: one tile in flight at a time, and
    // whatever the strip says when it lands is drawn next.
    const parallel = !!resolution && resolution > TILE_SIZE && canRenderInParallel()
    let busy = false
    let live = LIVE_RESOLUTION

    const clearRefine = () => {
      if (refineTimer !== null) clearTimeout(refineTimer)
      refineTimer = null
    }

    const renderLarge = (size: number) => {
      busy = true
      const at = wantedRef.current
      const started = performance.now()
      cancelRender = renderTileParallel(pattern, at, size, (full) => {
        busy = false
        cancelRender = null
        tile = full
        tileAt = at
        schedule()
        if (size === live) {
          const took = performance.now() - started
          const next =
            took > LIVE_SLOW_MS ? live * 0.8 : took < LIVE_FAST_MS ? live * 1.15 : live
          live = Math.round(Math.min(LIVE_RESOLUTION, Math.max(LIVE_FLOOR, next)) / 16) * 16
        }
        if (wantedRef.current !== at) {
          renderLarge(live)
        } else if (resolution && size < resolution) {
          refineTimer = setTimeout(() => {
            refineTimer = null
            if (!busy && wantedRef.current === tileAt) renderLarge(resolution)
          }, REFINE_MS)
        }
      })
    }

    const paint = () => {
      rafId = 0
      if (parallel) {
        // Only before the pool's first tile: something to show at once.
        if (!tile) {
          tileAt = wantedRef.current
          tile = renderPatternTile(pattern, tileAt)
        }
      } else if (tileAt !== wantedRef.current || !tile) {
        tileAt = wantedRef.current
        tile = renderPatternTile(pattern, tileAt)
        if (resolution && resolution > TILE_SIZE) {
          clearRefine()
          cancelRender?.()
          cancelRender = null
          const at = tileAt
          refineTimer = setTimeout(() => {
            refineTimer = null
            cancelRender = renderPatternTileSliced(pattern, at, resolution, (full) => {
              cancelRender = null
              // A move landed while it was being drawn: that one wins.
              if (at !== tileAt) return
              tile = full
              schedule()
            })
          }, REFINE_MS)
        }
      }
      let w: number
      let h: number
      if (resolution) {
        w = resolution
        h = resolution
      } else {
        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        w = Math.max(1, Math.round(rect.width * dpr))
        h = Math.max(1, Math.round(rect.height * dpr))
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const v = Math.min(1, Math.max(0, velocityRef.current))
      const size = lerp(VELOCITY_MIN_SIZE, VELOCITY_MAX_SIZE, v)
      const dw = w * size
      const dh = h * size
      ctx.clearRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tile, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }

    function schedule() {
      if (!rafId) rafId = requestAnimationFrame(paint)
    }

    changedRef.current = () => {
      if (parallel && wantedRef.current !== tileAt) {
        clearRefine()
        // In flight: its landing picks up the latest value.
        if (!busy) renderLarge(live)
      }
      schedule()
    }

    paint()
    if (parallel) renderLarge(live)
    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      clearRefine()
      cancelRender?.()
      changedRef.current = null
    }
    // `character` and `velocity` are fed through refs; only a change of
    // identity rebuilds the painter, which keeps a drag from re-creating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, resolution])

  useEffect(() => {
    changedRef.current?.()
  }, [character, velocity])

  return <canvas ref={canvasRef} className="sound-preview" />
}
