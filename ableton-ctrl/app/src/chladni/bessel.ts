/**
 * The circular membrane's modes, as far as the Chladni marks need them.
 *
 * A membrane fixed at its edge vibrates in modes
 *
 *   ψ_mn(r, θ) = J_m(j_mn · r) · cos(m(θ − θ0)),   r ∈ [0, 1]
 *
 * where j_mn is the n-th zero of J_m, so the edge (r = 1) never moves. The
 * frequency of a mode over the fundamental's is j_mn / j_01.
 *
 * The marks only ever need the radial part squared, J_m(j_mn·r)², and a
 * slider only moves the weights between modes, never a mode's shape — so each
 * radial profile is computed once into a lookup table and read from then on.
 */

/** Terms of the power series: enough for x up to ~25 at m ≤ 24 in float64. */
const SERIES_TERMS = 60

/**
 * J_m(x) by its power series, Σ_k (−1)^k (x/2)^(2k+m) / (k! (k+m)!), each
 * term built from the last so nothing overflows on the way.
 */
export function besselJ(m: number, x: number): number {
  const half = x / 2
  let term = 1
  for (let i = 1; i <= m; i++) term *= half / i
  let sum = term
  const q = -half * half
  for (let k = 0; k < SERIES_TERMS; k++) {
    term *= q / ((k + 1) * (k + 1 + m))
    sum += term
  }
  return sum
}

const zeroCache = new Map<string, number>()

/** j_mn, the n-th positive zero of J_m (n from 1), found by scan + bisection. */
export function besselZero(m: number, n: number): number {
  const key = `${m},${n}`
  const cached = zeroCache.get(key)
  if (cached !== undefined) return cached
  const step = 0.05
  let found = 0
  let a = 0.5
  let fa = besselJ(m, a)
  for (;;) {
    const b = a + step
    const fb = besselJ(m, b)
    if (fa === 0 || fa * fb < 0) {
      found++
      if (found === n) {
        let lo = a
        let hi = b
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2
          if (besselJ(m, lo) * besselJ(m, mid) <= 0) hi = mid
          else lo = mid
        }
        const zero = (lo + hi) / 2
        zeroCache.set(key, zero)
        return zero
      }
    }
    a = b
    fa = fb
  }
}

/** Samples per radial profile, over r ∈ [0, 1]. */
const LUT_SIZE = 256

const lutCache = new Map<string, Float32Array>()

/** J_m(j_mn · r)² over r ∈ [0, 1], scaled so its own peak is 1. */
function profile(m: number, n: number): Float32Array {
  const key = `${m},${n}`
  const cached = lutCache.get(key)
  if (cached) return cached
  const j = besselZero(m, n)
  const lut = new Float32Array(LUT_SIZE)
  let peak = 0
  for (let i = 0; i < LUT_SIZE; i++) {
    const v = besselJ(m, (j * i) / (LUT_SIZE - 1))
    lut[i] = v * v
    peak = Math.max(peak, lut[i])
  }
  for (let i = 0; i < LUT_SIZE; i++) lut[i] /= peak
  lutCache.set(key, lut)
  return lut
}

/**
 * The radial energy of mode (m, n) at radius r, 0..1 — 0 past the fixed edge.
 * On its own this is also the degenerate pair (the cos and sin orientations
 * at equal weight): an axisymmetric ring.
 */
export function radial(m: number, n: number, r: number): number {
  if (r >= 1) return 0
  const lut = profile(m, n)
  const t = r * (LUT_SIZE - 1)
  const i = Math.floor(t)
  const f = t - i
  return i + 1 < LUT_SIZE ? lut[i] * (1 - f) + lut[i + 1] * f : lut[i]
}

/**
 * One orientation of mode (m, n) alone: the ring broken into 2m lobes, the
 * first centred on angle θ0.
 */
export function lobed(m: number, n: number, r: number, theta: number, theta0 = 0): number {
  const c = Math.cos(m * (theta - theta0))
  return radial(m, n, r) * c * c
}
