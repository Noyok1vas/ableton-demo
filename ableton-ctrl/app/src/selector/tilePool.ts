import type { Pattern } from './patterns.ts'
import type { TileBand, TileJob } from './tileWorker.ts'

/**
 * A few workers that rasterize one tile together, each a band of its rows.
 * A large tile is too much per-pixel work for one thread at drag speed; split
 * across the device's cores it keeps up. Started on first use, shared by every
 * preview that asks.
 */
let workers: Worker[] | null = null
let nextJob = 0
const waiting = new Map<number, (band: TileBand) => void>()

function pool(): Worker[] | null {
  if (workers) return workers
  if (typeof Worker === 'undefined') return null
  const cores = navigator.hardwareConcurrency || 4
  // Leave one core for the page and the audio.
  const count = Math.max(2, Math.min(6, cores - 1))
  workers = Array.from({ length: count }, () => {
    const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<TileBand>) => waiting.get(e.data.job)?.(e.data)
    return w
  })
  return workers
}

/** True when tiles can be drawn off the main thread here. */
export function canRenderInParallel(): boolean {
  return pool() !== null
}

/**
 * Rasterize `pattern` at character `c` into a `size`² canvas, in parallel.
 * Calls `done` with the finished tile; the returned function drops the result
 * (the bands already started still run, but nothing is drawn from them).
 */
export function renderTileParallel(
  pattern: Pattern,
  c: number,
  size: number,
  done: (tile: HTMLCanvasElement) => void,
): () => void {
  const ws = pool()
  if (!ws) return () => {}
  const job = ++nextJob
  const image = new ImageData(size, size)
  // Smaller bands than workers, so a worker that finishes early takes more of
  // the expensive rows — the ink sits mid-tile, the edges are cheap.
  const bands = ws.length * 3
  const per = Math.ceil(size / bands)
  let left = 0
  for (let b = 0; b < bands; b++) {
    const from = b * per
    const to = Math.min(size, from + per)
    if (from >= to) break
    left += 1
    const msg: TileJob = { job, id: pattern.id, c, size, from, to }
    ws[b % ws.length].postMessage(msg)
  }
  waiting.set(job, (band) => {
    image.data.set(band.pixels, band.from * size * 4)
    left -= 1
    if (left > 0) return
    waiting.delete(job)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d')?.putImageData(image, 0, 0)
    done(canvas)
  })
  return () => {
    waiting.delete(job)
  }
}
