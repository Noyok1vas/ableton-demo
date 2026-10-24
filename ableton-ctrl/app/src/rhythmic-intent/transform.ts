import type { RenderedTap, Tap, TransformParams } from './types.ts'

/** Wrap a normalized position into [0, 1). The captured unit is a loop, so
    every transform is circular. */
function wrap(pos: number): number {
  return ((pos % 1) + 1) % 1
}

/** Distance between two normalized positions measured around the loop. */
function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 1 - d)
}

/** Pull a position toward its nearest grid line (four to a beat) by `tightness` (0..1).
    The nearest line for a tap late in the loop can be the downbeat of the next
    pass, hence the wrap. `divisions` is how many grid steps the loop holds,
    which the meter decides. */
export function applyTightness(pos: number, tightness: number, divisions: number): number {
  const nearest = Math.round(pos * divisions) / divisions
  return wrap(pos + tightness * (nearest - pos))
}

export function applyPhase(pos: number, phaseSteps: number, divisions: number): number {
  return wrap(pos + phaseSteps / divisions)
}

/**
 * The raw loop position (0..1) that tightness and phase draw at `shown`, or
 * as close as the grid pull can land. A drag stores this, so letting go does
 * not throw the mark off the place the finger left it.
 *
 * Tightness cannot draw every position — between two grid lines there is a
 * gap the pull never reaches — so a shown position in that gap clamps to the
 * nearer edge of the cell.
 */
export function rawForShown(
  shown: number,
  tightness: number,
  phaseSteps: number,
  divisions: number,
): number {
  const d = Math.max(1, divisions)
  const t = Math.min(1, Math.max(0, tightness / 100))
  const unphased = wrap(shown - phaseSteps / d)
  const nearest = Math.round(unphased * d) / d
  if (t >= 0.999) return wrap(nearest)
  let raw = (unphased - t * nearest) / (1 - t)
  const half = 0.5 / d
  const lo = nearest - half + 1e-6
  const hi = nearest + half - 1e-6
  if (raw < lo) raw = lo
  else if (raw > hi) raw = hi
  return wrap(raw)
}

/* Velocities within this range of each other count as "similar", which lets
   spatial spread break the tie instead of raw velocity order. */
const VELOCITY_TIE_EPSILON = 0.1

/**
 * Choose which taps survive at a given density. Deterministic, no randomness:
 * greedily pick the strongest remaining tap; among taps of similar velocity,
 * prefer the one farthest (around the loop) from everything already kept, so
 * the survivors spread across the loop instead of clustering. Ties fall back to
 * earliest time, which keeps the result stable for identical inputs.
 */
export function selectByDensity(
  taps: readonly Tap[],
  loopDuration: number,
  density: number,
): Set<number> {
  const kept = new Set<number>()
  if (taps.length === 0) return kept

  // Circular distance needs positions on the 0..1 loop, not raw seconds.
  const pos = taps.map((tap) => wrap(tap.time / loopDuration))

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
  loopDuration: number,
  params: TransformParams,
  divisions: number,
): RenderedTap[] {
  const keptIndices = selectByDensity(taps, loopDuration, params.density)
  const tightness = params.tightness / 100

  return taps.map((tap, index) => {
    const rawPos = wrap(tap.time / loopDuration)
    const loosePos = applyPhase(rawPos, params.phase, divisions)
    const finalPos = applyPhase(applyTightness(rawPos, tightness, divisions), params.phase, divisions)
    return {
      id: tap.id,
      index,
      rawPos,
      loosePos,
      finalPos,
      velocity: tap.velocity,
      voice: tap.voice,
      character: tap.character,
      kept: keptIndices.has(index),
    }
  })
}
