/**
 * The vibrating bodies Chladni 2 draws, as signed amplitude fields ψ. Sand
 * gathers where ψ = 0, so every figure is ψ's zero set.
 *
 *   membrane (fixed edge)  ψ = J_m(j_mn·r)·cos(mθ),   J_m(j_mn) = 0
 *   plate    (free edge)   ψ = J_m(j'_mn·r)·cos(mθ),  J'_m(j'_mn) = 0
 *   bar      (free-free)   ψ = the Euler–Bernoulli beam's mode along its length
 *
 * The membrane is the textbook drum head: its edge cannot move, so the edge
 * itself is a nodal line. The plate is an APPROXIMATION of a cymbal: a real
 * free plate is a fourth-order problem (Kirchhoff, J and I Bessel functions
 * together); here the same Bessel modes are borrowed with the edge made an
 * antinode instead of a node (the zeros of J'_m), which is the one property
 * that matters for the figure — a free edge moves, so no sand collects there
 * and no outline is drawn.
 *
 * J_m itself and its zeros come from Chladni 1 (../chladni/bessel.ts). What is
 * new here is that ψ is kept SIGNED — Chladni 1 drew energy, ψ², and never
 * needed to know where it crossed zero — and reaches past the edge, so the
 * fixed edge is a real sign change the contour can find.
 */

import { besselJ, besselZero } from '../chladni/bessel.ts'

/** Samples per profile, and how far past the edge (r = 1) each reaches. */
const LUT_SIZE = 640
const LUT_REACH = 1.4

/** J'_m(x), from the recurrence J'_m = (J_{m−1} − J_{m+1}) / 2. */
function besselJPrime(m: number, x: number): number {
  if (m === 0) return -besselJ(1, x)
  return (besselJ(m - 1, x) - besselJ(m + 1, x)) / 2
}

const primeZeros = new Map<string, number>()

/**
 * j'_mn, the n-th positive zero of J'_m (n from 1), found by scan + bisection.
 * For m = 0 the trivial zero at x = 0 is skipped, as is conventional — it is
 * the plate moving as one piece, not a mode.
 */
export function besselPrimeZero(m: number, n: number): number {
  const key = `${m},${n}`
  const cached = primeZeros.get(key)
  if (cached !== undefined) return cached
  const step = 0.02
  let found = 0
  let a = 0.05
  let fa = besselJPrime(m, a)
  for (;;) {
    const b = a + step
    const fb = besselJPrime(m, b)
    if (fa * fb < 0) {
      found++
      if (found === n) {
        let lo = a
        let hi = b
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2
          if (besselJPrime(m, lo) * besselJPrime(m, mid) <= 0) hi = mid
          else lo = mid
        }
        const zero = (lo + hi) / 2
        primeZeros.set(key, zero)
        return zero
      }
    }
    a = b
    fa = fb
  }
}

export type Edge = 'fixed' | 'free'

/** Where mode (m, n)'s profile is scaled to: the edge a node, or an antinode. */
export const modeZero = (edge: Edge, m: number, n: number) =>
  edge === 'fixed' ? besselZero(m, n) : besselPrimeZero(m, n)

const lutCache = new Map<string, Float32Array>()

/** J_m(k·r) over r ∈ [0, LUT_REACH], scaled so its peak inside the body is 1. */
function signedProfile(m: number, k: number): Float32Array {
  const key = `${m},${k}`
  const cached = lutCache.get(key)
  if (cached) return cached
  const lut = new Float32Array(LUT_SIZE)
  let peak = 0
  for (let i = 0; i < LUT_SIZE; i++) {
    const r = (LUT_REACH * i) / (LUT_SIZE - 1)
    lut[i] = besselJ(m, k * r)
    if (r <= 1) peak = Math.max(peak, Math.abs(lut[i]))
  }
  for (let i = 0; i < LUT_SIZE; i++) lut[i] /= peak
  lutCache.set(key, lut)
  return lut
}

function sample(lut: Float32Array, r: number): number {
  const t = (Math.min(r, LUT_REACH) / LUT_REACH) * (LUT_SIZE - 1)
  const i = Math.floor(t)
  const f = t - i
  return i + 1 < LUT_SIZE ? lut[i] * (1 - f) + lut[i + 1] * f : lut[i]
}

/** One circular mode, ready to evaluate. */
export type CircleMode = { m: number; n: number; edge: Edge; lut: Float32Array }

export function circleMode(edge: Edge, m: number, n: number): CircleMode {
  return { m, n, edge, lut: signedProfile(m, modeZero(edge, m, n)) }
}

/** The mode's radial part at r — signed, past the edge too. */
export const radialPart = (mode: CircleMode, r: number) => sample(mode.lut, r)

/**
 * Every mode up to the orders a figure can use, in order of frequency — the
 * order the overtones of that body actually come in. TONE reads up this list,
 * so a brighter sound is literally a higher partial.
 */
function overtoneList(edge: Edge): { m: number; n: number; k: number }[] {
  // Bounded by where the power series in bessel.ts stays accurate (x ≲ 25).
  const list: { m: number; n: number; k: number }[] = []
  for (let m = 0; m <= 10; m++) {
    for (let n = 1; n <= 3; n++) list.push({ m, n, k: modeZero(edge, m, n) })
  }
  return list.sort((a, b) => a.k - b.k)
}

const overtoneCache = new Map<Edge, { m: number; n: number; k: number }[]>()

/** The i-th mode of the body, counting up in frequency from the lowest. */
export function overtone(edge: Edge, i: number): { m: number; n: number } {
  let list = overtoneCache.get(edge)
  if (!list) {
    list = overtoneList(edge)
    overtoneCache.set(edge, list)
  }
  return list[Math.max(0, Math.min(list.length - 1, i))]
}

// ── The bar ──────────────────────────────────────────────────────────────

/** βL of a free-free bar's first five modes. Frequencies go as β², so the
    first three stand 1 : 2.756 : 5.404. */
const BAR_BETA = [4.730041, 7.853205, 10.995608, 14.137165, 17.278760]

const barCache = new Map<number, Float32Array>()
const BAR_LUT = 512

/**
 * The k-th free-free mode (k from 1) along u ∈ [0, 1] of the bar's length,
 * scaled to peak 1:
 *
 *   w(u) = cosh βu + cos βu − σ (sinh βu + sin βu),  σ = (cosh β − cos β)/(sinh β − sin β)
 *
 * Its zeros are where the sand lies across the bar: 0.224 and 0.776 for the
 * first mode, 0.132 / 0.5 / 0.868 for the second, 0.094 / 0.356 / 0.644 /
 * 0.906 for the third.
 */
function barProfile(k: number): Float32Array {
  const cached = barCache.get(k)
  if (cached) return cached
  const beta = BAR_BETA[Math.max(0, Math.min(BAR_BETA.length - 1, k - 1))]
  const sigma = (Math.cosh(beta) - Math.cos(beta)) / (Math.sinh(beta) - Math.sin(beta))
  const lut = new Float32Array(BAR_LUT)
  let peak = 0
  for (let i = 0; i < BAR_LUT; i++) {
    const x = (beta * i) / (BAR_LUT - 1)
    lut[i] = Math.cosh(x) + Math.cos(x) - sigma * (Math.sinh(x) + Math.sin(x))
    peak = Math.max(peak, Math.abs(lut[i]))
  }
  for (let i = 0; i < BAR_LUT; i++) lut[i] /= peak
  barCache.set(k, lut)
  return lut
}

/** Mode k of the bar at u along its length (clamped to the bar). */
export function barMode(k: number, u: number): number {
  const lut = barProfile(k)
  const t = Math.min(1, Math.max(0, u)) * (BAR_LUT - 1)
  const i = Math.floor(t)
  const f = t - i
  return i + 1 < BAR_LUT ? lut[i] * (1 - f) + lut[i + 1] * f : lut[i]
}
