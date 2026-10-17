/**
 * Rasterizes a band of rows of one pattern's tile off the main thread, so a
 * large tile can be drawn in parallel (see tilePool) without stalling the
 * pads. The same fillRows as everywhere else — one definition of a mark.
 */
import { PATTERNS, fillRows } from './patterns.ts'

export type TileJob = {
  job: number
  id: string
  c: number
  size: number
  from: number
  to: number
}

export type TileBand = { job: number; from: number; pixels: Uint8ClampedArray }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<TileJob>) => void) | null
  postMessage: (message: TileBand, transfer: Transferable[]) => void
}

scope.onmessage = (e) => {
  const { job, id, c, size, from, to } = e.data
  const pattern = PATTERNS.find((p) => p.id === id)
  const pixels = new Uint8ClampedArray(size * (to - from) * 4)
  if (pattern) fillRows(pattern, c, size, pixels, from, to)
  scope.postMessage({ job, from, pixels }, [pixels.buffer])
}
