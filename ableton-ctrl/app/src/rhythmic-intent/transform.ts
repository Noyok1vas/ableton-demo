import {
  GRID_DIVISIONS,
  type RenderedTap,
  type Tap,
  type TransformParams,
} from './types.ts'

/** Wrap a normalized position into [0, 1). The bar is a loop, so every
    transform is circular. */
function wrap(pos: number): number {
  return ((pos % 1) + 1) % 1
}

/** Distance between two normalized positions measured around the loop. */
function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 1 - d)
}

/** Pull a position toward its nearest 1/16 grid line by `tightness` (0..1).
    The nearest line for a tap late in the bar can be the downbeat of the next
    loop, hence the wrap. */
export function applyTightness(pos: number, tightness: number): number {
  const nearest = Math.round(pos * GRID_DIVISIONS) / GRID_DIVISIONS
  return wrap(pos + tightness * (nearest - pos))
}

export function applyPhase(pos: number, phaseSteps: number): number {
  return wrap(pos + phaseSteps / GRID_DIVISIONS)
}

/* Velocities within this range of each other count as "similar", which lets
   spatial spread break the tie instead of raw velocity order. */
const VELOCITY_TIE_EPSILON = 0.1

/**
 * Choose which taps survive at a given density. Deterministic, no randomness:
 * greedily pick the strongest remaining tap; among taps of similar velocity,
 * prefer the one farthest (around the loop) from everything already kept, so
 * the survivors spread across the bar instead of clustering. Ties fall back to
 * earliest time, which keeps the result stable for identical inputs.
 */
export function selectByDensity(
  taps: readonly Tap[],
  barDuration: number,
  density: number,
): Set<number> {
  const kept = new Set<number>()
  if (taps.length === 0) return kept

  // Circular distance needs positions on the 0..1 loop, not raw seconds.
  const pos = taps.map((tap) => wrap(tap.time / barDuration))

  // 100% keeps all; anything else keeps at least one tap.
  const keepCount = Math.max(1, Math.round((taps.length * density) / 100))
  if (keepCount >= taps.length) {
    taps.forEach((_, i) => kept.add(i))
    return kept
  }

  const remaining = taps.map((_, i) => i)
  while (kept.size < keepCount) {
    const maxVelocity = Math.max(...remaining.map((i) => taps[i].velocity))
    const candidates = remaining.filter(
      (i) => taps[i].velocity >= maxVelocity - VELOCITY_TIE_EPSILON,
    )

    let best = candidates[0]
    let bestSpread = -1
    for (const i of candidates) {
      const spread =
        kept.size === 0
          ? 0
          : Math.min(...[...kept].map((k) => circularDistance(pos[i], pos[k])))
      if (spread > bestSpread) {
        bestSpread = spread
        best = i
      }
    }

    kept.add(best)
    remaining.splice(remaining.indexOf(best), 1)
  }
  return kept
}

/** Resolve every tap through density → tightness → phase for rendering.
    Removed taps are still returned (kept=false) so the UI can ghost them. */
export function transformPattern(
  taps: readonly Tap[],
  barDuration: number,
  params: TransformParams,
): RenderedTap[] {
  const keptIndices = selectByDensity(taps, barDuration, params.density)
  const tightness = params.tightness / 100

  return taps.map((tap, index) => {
    const rawPos = wrap(tap.time / barDuration)
    const loosePos = applyPhase(rawPos, params.phase)
    const finalPos = applyPhase(applyTightness(rawPos, tightness), params.phase)
    return {
      index,
      rawPos,
      loosePos,
      finalPos,
      velocity: tap.velocity,
      kept: keptIndices.has(index),
    }
  })
}
