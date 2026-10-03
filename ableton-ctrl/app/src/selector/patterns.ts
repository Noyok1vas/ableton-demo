/**
 * The eight sound marks, defined as continuous ink fields rather than art
 * assets: each is a function of position (and of the sound's character),
 * rasterized with grain so it reads like the printed/plotted references — soft
 * greys, edges that break up into particles, no hard vector line anywhere. The
 * same black/white/grey palette as the rest of the GUI.
 *
 * One graphic system, built from one object — the drum body, a disc — and what
 * happens to it:
 *
 *   KICK   ●   a large solid mass, its edge just diffusing   heavy, low, solid
 *   TOM    ◉   the same body emptying from the centre        tuned up = hollower
 *   SNARE  ⊙·  a head ringed with grains                     the snares, swelling
 *   RIM    ·   one small point, nothing spreading            all of it at one spot
 *   CLAP   (•) an impact between two closing shells          two surfaces meeting
 *   HAT    ⁘   a broken ring opening out into rays           contained → released
 *   RIDE   ☄   a struck body with the trace of the strike    ringing on
 *   FX     ⚙   a ring rippling, then setting into teeth      drum → electric
 *
 * Every character axis moves the mark the way it moves the sound (see
 * character.ts), so the picture of a sound is also the picture of its setting.
 *
 * The Sound Visual draws these same fields, sampled into specks — it does not
 * keep shapes of its own, so a change here is a change there.
 */

import { fxModes, snareModes } from './character.ts'
import type { SoundVoiceId } from '../transport/engine.ts'

/** The Selector's marks and the engine's sound identities are the same eight
    things, so they are one id: choosing a mark chooses a sound. */
export type PatternId = SoundVoiceId

/** An axis-aligned box in field units. */
export type Bounds = { x0: number; y0: number; x1: number; y1: number }

/** How a ringing mark is split for the Sound Visual: the mark without its
    tail, and the tail as a field of its own. */
export type Ringing = {
  /** The mark alone, and the box its ink lies in. */
  field: (x: number, y: number, c: number) => number
  bounds: (c: number) => Bounds
  /** The tail laid along its own axis: `along` runs out from the mark's
      origin, `across` either side of it, both in field units, and `reach` is
      how far past `start` it runs. */
  tail: (along: number, across: number, reach: number) => number
  /** Where the tail begins along that axis, and its half-width at most: its
      ink lies within along [start, start + reach], across ±width. */
  start: number
  width: number
}

export type Pattern = {
  id: PatternId
  label: string
  /**
   * Ink density 0..1 at field coords (x right, y down). The origin is the
   * mark's point of impact — on the Sound Visual it sits on the ring at the
   * moment the tap fell — and a pad shows ±1 around `anchor`.
   *
   * `c` is the sound's character, 0..1 — the character mod strip. Every view
   * of a sound draws it at its live value and redraws on every move.
   * Identities with no axis (RIM) ignore `c` entirely.
   */
  field: (x: number, y: number, c: number) => number
  /** Where the mark's ink lies at character `c`: the box the Sound Visual
      scatters its specks through. Tight, because the specks it rejects there
      are wasted work. */
  bounds: (c: number) => Bounds
  /** How far from its origin a mark has to be left alone for its shape to
      read — its hollow, or for a mark made of separate parts its whole reach.
      The Sound Visual keeps LENGTH's tail out of it. 0 for a solid mark. */
  clear: (c: number) => number
  /** The field point drawn at a pad's centre. The origin for a mark that is
      symmetric about its impact; elsewhere for one that is not (RIDE's trace
      runs up from it), so the mark as a whole sits centred on its pad. */
  anchor: { x: number; y: number }
  /** How much larger the Sound Visual draws this mark than the field's own
      units, for a mark too small to read on the ring at the size its pad shows
      it. 1 when absent. */
  ringScale?: number
  /** A direction in the field, in radians (0 points right, −π/2 up), that
      the Sound Visual turns to face outward along the ring's normal wherever
      the mark lands — for a mark whose meaning has a direction relative to
      the moment it marks. Absent, the mark keeps its pad's orientation. */
  radial?: number
  /** For a mark that rings on after it is struck (RIDE): on the Sound Visual
      the ringing is not part of the mark but a tail grown along the ring, the
      way LENGTH's tail is — only heavier, and alive. */
  ringing?: Ringing
  /** Darkest tone the field maps to (1 = pure black). */
  maxInk: number
  /** Grain strength; the noise is concentrated in mid tones, where a printed
      halftone actually breaks up. */
  grain: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Deterministic 0..1 from a pair of integers — the grain field's randomness,
    which has to be a *function* of position because the field is sampled per
    pixel with no memory between samples. */
function hash2(i: number, j: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/**
 * Ink at signed distance `d` from an edge — negative inside, positive out —
 * with `soft` setting how wide the transition is. A logistic rather than a
 * hard step: the transition band is mid-grey, which is exactly where the
 * rasterizer's grain bites, so every edge breaks up into particles instead of
 * being cut.
 */
function edge(d: number, soft: number): number {
  return 1 / (1 + Math.exp(d / soft))
}

// A hole in a disc reaches full depth once it is this wide: smaller than that
// it fades in, so a hole of radius 0 is no hole rather than a grey dimple.
const HOLE_FADE = 0.03

/** The share of a disc's ink left by a hole of radius `h` at its centre. */
function hole(r: number, h: number, soft: number): number {
  return 1 - clamp01(h / HOLE_FADE) * edge(r - h, soft)
}

const square = (half: number): Bounds => ({ x0: -half, y0: -half, x1: half, y1: half })

// ── 1. KICK — a large solid mass ●, SOFT ←→ HARD ─────────────────────────
// The heaviest, plainest mark: a disc of ink with its edge just giving way to
// grain. The character moves its weight and its edge — soft is a little
// smaller, lighter and bleeds outward; hard is the full mass, and stops where
// it stops. The shape never changes: a harder hit is the same thing landing
// heavier.
const KICK_SOFT_RADIUS = 0.3
const KICK_HARD_RADIUS = 0.4
const KICK_SOFT_EDGE = 0.042
const KICK_HARD_EDGE = 0.022
const KICK_SOFT_INK = 1.02
const KICK_HARD_INK = 1.08

const kickRadius = (c: number) => lerp(KICK_SOFT_RADIUS, KICK_HARD_RADIUS, c)
const kickEdge = (c: number) => lerp(KICK_SOFT_EDGE, KICK_HARD_EDGE, c)

function kickField(x: number, y: number, c: number): number {
  const r = Math.hypot(x, y)
  return clamp01(lerp(KICK_SOFT_INK, KICK_HARD_INK, c) * edge(r - kickRadius(c), kickEdge(c)))
}

// ── 2. TOM — the drum body ◉, LOW ←→ HIGH ────────────────────────────────
// Struck solid wall against struck hollow wall: the lower the drum the more
// solid the body, and tuning it up empties it from the centre. All the way
// down it is solid — the sound is a kick by then too — and all the way up a
// thick ring. Smaller than the kick: it is the lighter drum.
const TOM_RADIUS = 0.28
const TOM_HIGH_HOLE = 0.15
const TOM_EDGE = 0.02

const tomHole = (c: number) => TOM_HIGH_HOLE * clamp01(c)

function tomField(x: number, y: number, c: number): number {
  const r = Math.hypot(x, y)
  return clamp01(1.05 * edge(r - TOM_RADIUS, TOM_EDGE) * hole(r, tomHole(c), TOM_EDGE))
}

// ── 3. SNARE — a head ringed with grains, BODY ←→ SNAPPY ─────────────────
// The tom's body, a little smaller and hollowed to a head — the resonance —
// with the snares drawn around it as two staggered rings of grains: six larger
// on the inside, six smaller between them further out. SNAPPY swells the
// grains from nothing.
// Below halfway the head also goes slack: its ring fills in, and at BODY the
// mark is a solid, bare disc — the kick-like thud the sound has become. Both
// moves are snareModes(), the same two curves the sound is built from.
const SNARE_OUTER = 0.24
const SNARE_INNER = 0.163
const SNARE_EDGE = 0.018
const SNARE_NEAR = 0.5 // radius of the six larger grains…
const SNARE_FAR = 0.595 // …and of the six smaller ones
const SNARE_NEAR_SIZE = 0.065 // grain radius at fully SNAPPY
const SNARE_FAR_SIZE = 0.033
const SNARE_GRAIN_EDGE = 0.014
// Below this size a grain fades rather than shrinking past what will print.
const SNARE_GRAIN_FADE = 0.02
const SIXTH = Math.PI / 3

/** Ink of the nearest grain of a ring of six at `radius`, the first at
    `offset` radians clockwise from straight up. */
function grainRing(x: number, y: number, radius: number, offset: number, size: number): number {
  if (size <= 0) return 0
  const a = Math.atan2(y, x) + Math.PI / 2 - offset
  const k = Math.round(a / SIXTH)
  const at = k * SIXTH + offset - Math.PI / 2
  const d = Math.hypot(x - Math.cos(at) * radius, y - Math.sin(at) * radius)
  return clamp01(size / SNARE_GRAIN_FADE) * edge(d - size, SNARE_GRAIN_EDGE)
}

const snareGrowth = (c: number) => snareModes(c).snares
const snareHollow = (c: number) => SNARE_INNER * snareModes(c).head

function snareField(x: number, y: number, c: number): number {
  const r = Math.hypot(x, y)
  const head = edge(r - SNARE_OUTER, SNARE_EDGE) * hole(r, snareHollow(c), SNARE_EDGE)
  const g = snareGrowth(c)
  const near = grainRing(x, y, SNARE_NEAR, 0, SNARE_NEAR_SIZE * g)
  const far = grainRing(x, y, SNARE_FAR, SIXTH / 2, SNARE_FAR_SIZE * g)
  return clamp01(1.05 * Math.max(head, near, far))
}

// ── 4. RIM — one small point ·, fixed ─────────────────────────────────────
// All of the energy at one contact point: the smallest mark, the hardest edge,
// almost nothing spreading from it. Drawn larger on the Sound Visual's ring,
// where at its pad size it would be lost among the other marks.
const RIM_RADIUS = 0.065
const RIM_EDGE = 0.012

function rimField(x: number, y: number): number {
  return clamp01(1.1 * edge(Math.hypot(x, y) - RIM_RADIUS, RIM_EDGE))
}

// ── 5. CLAP — an impact between two shells (•), BRIGHT ←→ FULL ───────────
// Two surfaces closing on one point: a solid centre with an arc either side of
// it, the gaps above and below where the hands have not quite met. On the
// Sound Visual the shells face along the ring's normal, one inside the ring
// and one out, closing on the moment from both sides of the line. The arcs'
// weight IS the character: thin, even shells are a light, crisp clap; at FULL
// they thicken into crescents — heavy in the middle, tapering to their tips —
// and the clap has a body.
const CLAP_DOT = 0.13
const CLAP_EDGE = 0.02
const CLAP_BRIGHT_MID = 0.495 // shell centreline radius
const CLAP_FULL_MID = 0.456
const CLAP_BRIGHT_THICK = 0.036 // shell thickness at its middle
const CLAP_FULL_THICK = 0.18
// How far round each shell reaches from its middle, either way. The two leave
// a gap at the top and the bottom.
const CLAP_SPAN = (78 * Math.PI) / 180
// Thickness along the shell: cos^taper. Low holds the width nearly to the tip
// (a drawn line); high swells in the middle (a crescent).
const CLAP_BRIGHT_TAPER = 0.3
const CLAP_FULL_TAPER = 0.85
// Below this thickness a shell's tip fades instead of thinning past printing.
const CLAP_TIP_FADE = 0.025

const clapMid = (c: number) => lerp(CLAP_BRIGHT_MID, CLAP_FULL_MID, c)
const clapThick = (c: number) => lerp(CLAP_BRIGHT_THICK, CLAP_FULL_THICK, c)

function clapField(x: number, y: number, c: number): number {
  const r = Math.hypot(x, y)
  const dot = edge(r - CLAP_DOT, CLAP_EDGE)
  // Angle off the horizontal: both shells, mirrored, in one measure.
  const off = Math.atan2(Math.abs(y), Math.abs(x))
  let shell = 0
  if (off < CLAP_SPAN) {
    const taper = lerp(CLAP_BRIGHT_TAPER, CLAP_FULL_TAPER, c)
    const t = clapThick(c) * Math.pow(Math.cos((off / CLAP_SPAN) * (Math.PI / 2)), taper)
    shell = edge(Math.abs(r - clapMid(c)) - t / 2, CLAP_EDGE) * clamp01(t / CLAP_TIP_FADE)
  }
  return clamp01(1.05 * Math.max(dot, shell))
}

// ── 6. HAT — a broken ring opening into rays, CLOSED ←→ OPEN ─────────────
// A vibrating body held in check and then let go. Closed is a small, tight
// ring of separate beads; opening, each bead draws out into a ray, and the
// whole ring widens — not the same mark made larger, but contained energy
// being released outward.
const HAT_RAYS = 16
const HAT_CLOSED_IN = 0.25 // where a ray starts…
const HAT_OPEN_IN = 0.31
const HAT_CLOSED_OUT = 0.255 // …and where it ends: closed, they are beads
const HAT_OPEN_OUT = 0.68
const HAT_CLOSED_WIDTH = 0.03 // ray half-width
const HAT_OPEN_WIDTH = 0.026
const HAT_EDGE = 0.014

const hatIn = (c: number) => lerp(HAT_CLOSED_IN, HAT_OPEN_IN, c)
const hatOut = (c: number) => lerp(HAT_CLOSED_OUT, HAT_OPEN_OUT, Math.pow(clamp01(c), 1.15))
const hatWidth = (c: number) => lerp(HAT_CLOSED_WIDTH, HAT_OPEN_WIDTH, c)

function hatField(x: number, y: number, c: number): number {
  const r = Math.hypot(x, y)
  const step = (2 * Math.PI) / HAT_RAYS
  // One ray straight up; the nearest one decides.
  const a = Math.atan2(y, x) + Math.PI / 2
  const delta = a - Math.round(a / step) * step
  const along = r * Math.cos(delta)
  const across = r * Math.sin(delta)
  const t = Math.min(hatOut(c), Math.max(hatIn(c), along))
  const d = Math.hypot(along - t, across)
  return clamp01(1.05 * edge(d - hatWidth(c), HAT_EDGE))
}

// ── 7. RIDE — a struck body and its trace ☄, LOW ←→ HIGH ─────────────────
// A metal that keeps on ringing after it is hit: the body, and above it the
// trace of the strike still hanging in the air — dense grains where it met
// the body, thinning and shrinking out to a point. The tune works as it does
// on the tom: the body hollows as it rises.
//
// The pad draws the trace straight up from the body, at one fixed length. The
// Sound Visual draws the body alone and grows the same trace along the ring
// instead — the ringing carried forward in time, as long as the sound rings
// (see `ringing` on the Pattern).
const RIDE_RADIUS = 0.24
const RIDE_LOW_HOLE = 0
const RIDE_HIGH_HOLE = 0.13
const RIDE_EDGE = 0.02
const RIDE_TRACE_FROM = 0.4 * RIDE_RADIUS // where it leaves, past the centre
const RIDE_TRACE_LENGTH = 0.74 // how far it reaches past that, on the pad
const RIDE_TRACE_WIDTH = 1.05 * RIDE_RADIUS // half-width where it leaves, on the pad
// On the ring it leaves narrower than the body: a wisp off it, not a band as
// wide as it.
const RIDE_RING_WIDTH = 0.6 * RIDE_RADIUS
const RIDE_TRACE_CELL = 0.045 // grain grid pitch
const RIDE_NEAR_KEEP = 0.92 // share of cells holding a grain at the body…
const RIDE_TIP_KEEP = 0.22 // …and at the tip
const RIDE_NEAR_GRAIN = 0.034 // grain radius at the body…
const RIDE_TIP_GRAIN = 0.008 // …and at the tip
const RIDE_GRAIN_EDGE = 0.009

const rideHole = (c: number) => lerp(RIDE_LOW_HOLE, RIDE_HIGH_HOLE, c)

/**
 * The ride's trace as a field of its own, laid along its own axis: `along`
 * runs out from the body's centre and `across` either side of it, both in
 * field units; `reach` is how far past RIDE_TRACE_FROM it runs and `width` its
 * half-width where it leaves. Grains thin and shrink over that reach, however
 * long it is, so a longer trace is the same trace drawn out rather than more
 * of it.
 */
function rideTrail(along: number, across: number, reach: number, width: number): number {
  const at = (a: number) => (a - RIDE_TRACE_FROM) / reach
  if (at(along - RIDE_TRACE_CELL * 1.5) > 1 || at(along + RIDE_TRACE_CELL * 1.5) < -0.1) return 0
  const ci = Math.floor(across / RIDE_TRACE_CELL)
  const cj = Math.floor(along / RIDE_TRACE_CELL)
  let v = 0
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di
      const j = cj + dj
      // A grain somewhere in its own cell, never past its edge, so a 3×3
      // search is enough to find every grain that can touch this point.
      const gx = (i + 0.2 + 0.6 * hash2(i + 7919, j)) * RIDE_TRACE_CELL
      const ga = (j + 0.2 + 0.6 * hash2(i, j - 104729)) * RIDE_TRACE_CELL
      const t = at(ga)
      if (t < 0 || t > 1) continue
      if (Math.abs(gx) > width * Math.pow(1 - t, 0.85)) continue
      if (hash2(i, j) > lerp(RIDE_NEAR_KEEP, RIDE_TIP_KEEP, t)) continue
      const size = lerp(RIDE_NEAR_GRAIN, RIDE_TIP_GRAIN, t) * (0.55 + 0.9 * hash2(i - 31, j + 57))
      v = Math.max(v, edge(Math.hypot(across - gx, along - ga) - size, RIDE_GRAIN_EDGE))
    }
  }
  return v
}

function rideBody(x: number, y: number, c: number): number {
  const r = Math.hypot(x, y)
  return clamp01(1.05 * edge(r - RIDE_RADIUS, RIDE_EDGE) * hole(r, rideHole(c), RIDE_EDGE))
}

function rideField(x: number, y: number, c: number): number {
  // On the pad the trace runs straight up: `along` is up, `across` is x.
  const trace = rideTrail(-y, x, RIDE_TRACE_LENGTH, RIDE_TRACE_WIDTH)
  return Math.max(rideBody(x, y, c), clamp01(1.05 * trace))
}

// ── 8. FX — a ring setting into teeth ⚙, DRUM ←→ ELECTRIC ────────────────
// A simple resonator acquiring more and more complex modes. At DRUM it is a
// plain ring, the hollow tom it starts from. Moving toward ELECTRIC a fine,
// fast ripple runs round it first, then dies away as a slow mode takes over,
// and the ring ends as a gear of ten rounded teeth — never deeper than that,
// so it stays a ring under strain rather than becoming a flower. Regular at
// every step: interference, not distortion. The two modes are fxModes(), the
// same two curves that drive the sound's two modulators.
const FX_RIPPLES = 26
const FX_RIPPLE_DEPTH = 0.04
const FX_LOBES = 10
const FX_LOBE_DEPTH = 0.085
// How square the slow mode is: tanh(k·cos). Between a sine and a square, so
// the teeth come out rounded at both their tips and their roots.
const FX_SQUARE = 1.8
const FX_STROKE = 0.024 // half-width of the line
const FX_EDGE = 0.012
const FX_SQUARE_NORM = Math.tanh(FX_SQUARE)
// The line, traced as a closed polyline of this many points. Half a degree
// apart: fine enough that the steep side of a lobe is still one stroke.
const FX_POINTS = 720
// Past this distance from the line there is no ink worth computing.
const FX_REACH = FX_STROKE + 6 * FX_EDGE

/** The ring's radius before either mode: it opens out as the modes arrive. */
const fxRadius = (c: number) => 0.21 + 0.115 * smoothstep(0, 0.45, c)

/** The line's radius at angle `a` (0 = straight up, clockwise), at `c`. */
function fxRho(a: number, c: number, ripple: number, lobes: number): number {
  const sq = Math.tanh(FX_SQUARE * Math.cos(FX_LOBES * a)) / FX_SQUARE_NORM
  return (
    fxRadius(c) +
    FX_RIPPLE_DEPTH * ripple * Math.sin(FX_RIPPLES * a) +
    FX_LOBE_DEPTH * lobes * sq
  )
}

/** Furthest the line reaches from the centre at character `c`. */
function fxReach(c: number): number {
  const { ripple, lobes } = fxModes(c)
  return fxRadius(c) + FX_RIPPLE_DEPTH * ripple + FX_LOBE_DEPTH * lobes + FX_STROKE
}

// The traced line for the last character asked about. A field is sampled at
// one character thousands of times in a row — a whole tile, a whole mark — so
// tracing once per character, not once per sample, is what makes an exact
// distance affordable.
const fxXs = new Float64Array(FX_POINTS)
const fxYs = new Float64Array(FX_POINTS)
let fxTracedAt = Number.NaN
let fxInner = 0
let fxOuter = 0

function traceFx(c: number): void {
  if (c === fxTracedAt) return
  fxTracedAt = c
  const { ripple, lobes } = fxModes(c)
  fxInner = Infinity
  fxOuter = 0
  for (let k = 0; k < FX_POINTS; k++) {
    const a = (k / FX_POINTS) * Math.PI * 2
    const rho = fxRho(a, c, ripple, lobes)
    // Measured clockwise from straight up, as everywhere on this canvas.
    fxXs[k] = Math.sin(a) * rho
    fxYs[k] = -Math.cos(a) * rho
    fxInner = Math.min(fxInner, rho)
    fxOuter = Math.max(fxOuter, rho)
  }
}

function fxField(x: number, y: number, c: number): number {
  traceFx(c)
  const r = Math.hypot(x, y)
  if (r < fxInner - FX_REACH || r > fxOuter + FX_REACH) return 0
  // Only the stretch of line within reach can be nearest: at radius r, that
  // is the angles within asin(reach / r) of this point's own.
  const a = Math.atan2(x, -y)
  const window = r > FX_REACH ? Math.asin(FX_REACH / r) : Math.PI
  const span = Math.min(FX_POINTS / 2, Math.ceil((window / (Math.PI * 2)) * FX_POINTS) + 1)
  const at = Math.round((a / (Math.PI * 2)) * FX_POINTS)
  let best = Infinity
  for (let k = at - span; k < at + span; k++) {
    const i = ((k % FX_POINTS) + FX_POINTS) % FX_POINTS
    const j = (i + 1) % FX_POINTS
    // Distance to the segment i→j, squared.
    const sx = fxXs[j] - fxXs[i]
    const sy = fxYs[j] - fxYs[i]
    const px = x - fxXs[i]
    const py = y - fxYs[i]
    const t = Math.min(1, Math.max(0, (px * sx + py * sy) / (sx * sx + sy * sy || 1)))
    const dx = px - t * sx
    const dy = py - t * sy
    best = Math.min(best, dx * dx + dy * dy)
  }
  return clamp01(1.05 * edge(Math.sqrt(best) - FX_STROKE, FX_EDGE))
}

// ── The set ───────────────────────────────────────────────────────────────

const ORIGIN = { x: 0, y: 0 }

export const PATTERNS: Pattern[] = [
  // Same order as SOUND_VOICES: the drum bodies across the top, the rest under.
  {
    id: 'kick',
    label: 'Kick',
    field: kickField,
    bounds: (c) => square(kickRadius(c) + 5 * kickEdge(c)),
    clear: () => 0,
    anchor: ORIGIN,
    maxInk: 0.96,
    grain: 1.0,
  },
  {
    id: 'tom',
    label: 'Tom',
    field: tomField,
    bounds: () => square(TOM_RADIUS + 5 * TOM_EDGE),
    clear: (c) => tomHole(c) + 2 * TOM_EDGE,
    anchor: ORIGIN,
    maxInk: 0.95,
    grain: 1.0,
  },
  {
    id: 'snare',
    label: 'Snare',
    field: snareField,
    bounds: (c) => {
      const grains = SNARE_FAR + SNARE_FAR_SIZE * snareGrowth(c) + 5 * SNARE_GRAIN_EDGE
      return square(Math.max(SNARE_OUTER + 5 * SNARE_EDGE, grains))
    },
    clear: (c) =>
      snareGrowth(c) > 0 ? SNARE_FAR + SNARE_FAR_SIZE : snareHollow(c) + 2 * SNARE_EDGE,
    anchor: ORIGIN,
    maxInk: 0.95,
    grain: 1.1,
  },
  {
    id: 'rim',
    label: 'Rim',
    field: rimField,
    bounds: () => square(RIM_RADIUS + 5 * RIM_EDGE),
    clear: () => 0,
    anchor: ORIGIN,
    ringScale: 1.55,
    maxInk: 0.96,
    grain: 0.6,
  },
  {
    id: 'clap',
    label: 'Clap',
    field: clapField,
    bounds: (c) => square(clapMid(c) + clapThick(c) / 2 + 5 * CLAP_EDGE),
    clear: (c) => clapMid(c) + clapThick(c) / 2,
    anchor: ORIGIN,
    // The axis through both shells.
    radial: 0,
    maxInk: 0.95,
    grain: 1.0,
  },
  {
    id: 'hat',
    label: 'Hat',
    field: hatField,
    bounds: (c) => square(hatOut(c) + hatWidth(c) + 5 * HAT_EDGE),
    clear: (c) => hatOut(c) + hatWidth(c),
    anchor: ORIGIN,
    maxInk: 0.93,
    grain: 1.0,
  },
  {
    id: 'ride',
    label: 'Ride',
    field: rideField,
    bounds: () => ({
      x0: -(RIDE_RADIUS + 5 * RIDE_EDGE),
      x1: RIDE_RADIUS + 5 * RIDE_EDGE,
      y0: -(RIDE_TRACE_FROM + RIDE_TRACE_LENGTH + RIDE_NEAR_GRAIN * 1.5),
      y1: RIDE_RADIUS + 5 * RIDE_EDGE,
    }),
    clear: (c) => rideHole(c) + 2 * RIDE_EDGE,
    // The body sits low on the pad so the body and its trace, together, are
    // centred.
    anchor: { x: 0, y: -0.3 },
    ringing: {
      field: rideBody,
      bounds: () => square(RIDE_RADIUS + 5 * RIDE_EDGE),
      tail: (along, across, reach) => rideTrail(along, across, reach, RIDE_RING_WIDTH),
      start: RIDE_TRACE_FROM,
      width: RIDE_RING_WIDTH + 1.5 * RIDE_NEAR_GRAIN,
    },
    maxInk: 0.95,
    grain: 1.2,
  },
  {
    id: 'fx',
    label: 'FX',
    field: fxField,
    bounds: (c) => square(fxReach(c) + 5 * FX_EDGE),
    clear: (c) => fxReach(c),
    anchor: ORIGIN,
    maxInk: 0.93,
    grain: 0.9,
  },
]

/** Rasterization size of a mark. Deliberately low: the tile is drawn scaled up
    with smoothing, which both blurs the field and gives the grain a chunkier,
    printed feel than per-device-pixel noise would. */
export const TILE_SIZE = 180

/**
 * Rasterize one pattern at character `c` into an offscreen canvas of
 * TILE_SIZE². The grain is a per-pixel jitter weighted by ink*(1-ink), so flat
 * white and the solid core stay clean and the transitions break up.
 *
 * Called by SoundPreview whenever a sound's character changes — one function
 * for the pads, the rack and the large view, so they never drift apart.
 */
export function renderPatternTile(pattern: Pattern, c: number): HTMLCanvasElement {
  const size = TILE_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const { x: ax, y: ay } = pattern.anchor
  const image = ctx.createImageData(size, size)
  const data = image.data
  for (let py = 0; py < size; py++) {
    // +0.5 samples pixel centres; the *2-1 maps the tile to [-1,1].
    const ny = ((py + 0.5) / size) * 2 - 1 + ay
    for (let px = 0; px < size; px++) {
      const nx = ((px + 0.5) / size) * 2 - 1 + ax
      const v = pattern.field(nx, ny, c)
      const noise = (Math.random() - 0.5) * pattern.grain * (v * (1 - v) * 4)
      const ink = clamp01(v + noise) * pattern.maxInk
      // Black ink at `ink` opacity rather than an opaque grey: identical on a
      // white ground, and on any other ground (a grey pad) it shows the mark
      // and nothing of the tile around it.
      const i = (py * size + px) * 4
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = Math.round(255 * ink)
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
