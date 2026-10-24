/**
 * How a tap becomes a mark: the sampling the 2D Sound Visual did inside its
 * canvas, lifted out as pure functions so the three.js scene (scene.ts) prints
 * the same specks. Nothing here knows about pixels: a mark is sampled in its
 * field's own units, and every size comes out as a fraction of the ring's
 * radius, which the scene makes one world unit.
 *
 * The numbers are the 2D canvas's, kept to the digit, so a mark here is the
 * mark it was.
 */

import { PATTERNS, type Pattern, type PatternId } from '../selector/patterns.ts'
import { SOUND_MAX, SOUND_MIN } from '../sound-intent/types.ts'

/** What a tap sounded like, keyed by the tap's id — the Sound Visual's own
    snapshot, taken the moment the tap fired. */
export type MarkTap = {
  id: string
  /** Where in the loop it falls, 0..1 from 12 o'clock, clockwise. */
  pos: number
  velocity: number
  energy: number
  length: number
  seed: number
  gesture: PatternId
  character: number | null
}

/** Radius of the ring as a fraction of the canvas's shorter side. */
export const CIRCLE_RADIUS = 0.29
/** Every mark is drawn at this share of the size its field says. */
export const MARK_SCALE = 0.62
/** One field unit, as a fraction of the shorter side, before any scaling. */
export const MARK_UNIT = 0.11
/** Candidate draws per unit area of a mark's field, at full energy. */
const SPECK_DENSITY = 8000
/** A resting mark is printed on this many cells across its 2-unit field. */
const MARK_GRAIN = 200
/** How close to a mark's centre a press has to land to take hold of it, as a
    fraction of the shorter side. */
export const HIT_RADIUS = 0.075
/** REVERB at 100 strays every speck by a gaussian of this sigma, as a
    fraction of the shorter side. */
export const REVERB_MAX_SCATTER = 0.045

const ENERGY_MIN_RADIUS = 0.55
const ENERGY_MAX_RADIUS = 1.4
const ENERGY_MIN_DENSITY = 0.12
const ENERGY_MAX_DENSITY = 1
const VELOCITY_MIN_SIZE = 0.45
const VELOCITY_MAX_SIZE = 1.3
const VELOCITY_MIN_DENSITY = 0.75
const VELOCITY_MIN_INK = 0.35

export const lerp = (a: number, b: number, u: number) => a + (b - a) * u
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Fold a position into one turn of the loop, [0, 1). */
export const wrapPos = (p: number) => ((p % 1) + 1) % 1
/** The shorter of the two ways round from one position to another, signed. */
export const shortestStep = (d: number) => {
  const w = wrapPos(d)
  return w > 0.5 ? w - 1 : w
}

/** mulberry32 — a small seeded PRNG. Every tap carries a seed so its mark
    comes out the same every time it is placed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard-normal sample (Box–Muller) drawn from `rand`. */
export function gaussianFrom(rand: () => number): number {
  let u = 0
  while (u === 0) u = rand()
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** A seed for a tap that arrived without one — a pattern loaded from the
    Collection — so it still draws the same way every time. */
export function seedFromId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

const PATTERN_BY_ID = new Map(PATTERNS.map((pattern) => [pattern.id, pattern]))

export const patternOf = (tap: MarkTap): Pattern => PATTERN_BY_ID.get(tap.gesture) ?? PATTERNS[0]

/** The tap's ENERGY as 0..1. A kick's character IS its energy (see kit.ts),
    so a kick that carries one is sized by that instead. */
export const energyOf = (tap: MarkTap) =>
  tap.gesture === 'kick' && tap.character !== null
    ? clamp01(tap.character)
    : clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))

/** How much of a mark a tap's velocity leaves: `size` scales its extent and
    `density` how solidly it prints. */
export const velocityOf = (tap: MarkTap) => {
  const v = clamp01(tap.velocity)
  return {
    size: lerp(VELOCITY_MIN_SIZE, VELOCITY_MAX_SIZE, v),
    density: lerp(VELOCITY_MIN_DENSITY, 1, v),
  }
}

/** How much tail a tap's velocity leaves. */
const inkOf = (tap: MarkTap) => lerp(VELOCITY_MIN_INK, 1, clamp01(tap.velocity))

/** The tap's character as 0..1, or 0.5 for an identity that has none. */
export const characterOf = (tap: MarkTap) =>
  tap.character === null ? 0.5 : clamp01(tap.character)

/** How many times its field's own size the tap's mark is drawn. */
export const scaleOf = (tap: MarkTap) =>
  lerp(ENERGY_MIN_RADIUS, ENERGY_MAX_RADIUS, energyOf(tap)) *
  velocityOf(tap).size *
  (patternOf(tap).ringScale ?? 1)

/** One of the tap's field units, in ring radii. */
export const unitOf = (tap: MarkTap) => (MARK_UNIT * scaleOf(tap) * MARK_SCALE) / CIRCLE_RADIUS

/** A speck's side, in ring radii: one cell of a resting mark's grain. */
export const SPECK_SIZE = (2 * MARK_UNIT * MARK_SCALE) / MARK_GRAIN / CIRCLE_RADIUS

/** The angle a mark is turned by, so one whose meaning has a direction faces
    out along the ring's normal where it lands. Screen convention: y down. */
export const turnOf = (tap: MarkTap) => {
  const radial = patternOf(tap).radial
  return radial === undefined ? 0 : tap.pos * Math.PI * 2 - Math.PI / 2 - radial
}

/** A mark's specks in field units, with each one's gaussian stray for REVERB. */
export type Specks = {
  count: number
  xs: Float32Array
  ys: Float32Array
  jxs: Float32Array
  jys: Float32Array
}

const cache = new Map<string, Specks>()
const CACHE_MAX = 512

/**
 * The tap's specks, sampled from its pattern at its character: draws through
 * the field's box, each kept with the probability the field gives that point.
 * Depends only on the sound, its character, its seed and how many draws its
 * energy and velocity buy — never on where it sits — so the same tap re-placed
 * is the same specks. `inkScale` buys more draws on a larger canvas.
 */
export function sampleSpecks(tap: MarkTap, inkScale = 1): Specks {
  const pattern = patternOf(tap)
  const shape = pattern.ringing ?? pattern
  const c = characterOf(tap)
  const vel = velocityOf(tap)
  const { x0, y0, x1, y1 } = shape.bounds(c)
  const grown = vel.size * (pattern.ringScale ?? 1)
  const candidates = Math.round(
    SPECK_DENSITY *
      (x1 - x0) *
      (y1 - y0) *
      lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, energyOf(tap)) *
      vel.density *
      grown *
      grown *
      inkScale,
  )
  const key = `${tap.gesture}|${c}|${tap.seed}|${candidates}`
  const kept = cache.get(key)
  if (kept) return kept

  const rand = makeRng(tap.seed)
  const w = x1 - x0
  const h = y1 - y0
  const xs: number[] = []
  const ys: number[] = []
  const jxs: number[] = []
  const jys: number[] = []
  for (let i = 0; i < candidates; i++) {
    const x = x0 + rand() * w
    const y = y0 + rand() * h
    const keep = rand()
    if (keep >= shape.field(x, y, c)) continue
    xs.push(x)
    ys.push(y)
    jxs.push(gaussianFrom(rand))
    jys.push(gaussianFrom(rand))
  }
  const specks: Specks = {
    count: xs.length,
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    jxs: Float32Array.from(jxs),
    jys: Float32Array.from(jys),
  }
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, specks)
  return specks
}

// ── Length → ink tail, and the ride's ringing ─────────────────────────────
// The canvas's numbers, to the digit (see sound-intent/SoundVisualScreen for
// the reasoning behind each). Time is the angle around the ring, so a sound's
// length is drawn as an arc of it, clockwise from the mark.

export const BASE_ALPHA = 0.7
const TAIL_PER_TAP = 4000
const LENGTH_MIN_ARC = 0
const LENGTH_MAX_ARC = 1.2
const LENGTH_MAX_SPREAD = 0.03
const TAIL_HEAD_WIDTH = 0.2
const LENGTH_MAX_BODY = 0.9
const TAIL_HEAD_ALPHA = 0.55
const LENGTH_DECAY_STEEP = 7
const LENGTH_DECAY_GENTLE = 1.6
const TAIL_BIAS = 1.6
/** How long a fresh tail takes to sweep out, and the shape of that sweep. */
export const TAIL_GROWTH_S = 0.9
const TAIL_SWEEP_EASE = 0.75
const RING_ARC = 0.85
const RING_MAX_ARC = 2
const RING_INK = 0.55
const LENGTH_STRETCH_MIN = 0.45
const LENGTH_STRETCH_RANGE = 1.7
const RING_HIGH_TUNE_REACH = 0.72
/** Share of a ride's tail showing between strikes, and while stopped. */
export const RING_REST = 0.32
/** How fast the ringing thins again behind the playhead, per tail length. */
export const RING_FADE = 2.5

/**
 * A tap's trail: LENGTH's tail, or a ride's ringing tail. Positions are in
 * ring radii from the axis, screen convention (x right, y down). `alpha` is a
 * tail speck's ink; `reveal` is how many seconds after the tap a fresh one
 * first shows. A ringing speck also has `at` (how far round the loop past the
 * strike it lies, in turns) and `needs` (the ringing level it takes to show).
 */
export type Trail = {
  count: number
  xs: Float32Array
  ys: Float32Array
  jxs: Float32Array
  jys: Float32Array
  alpha: Float32Array
  reveal: Float32Array
  /** Ringing only: where the strike is, and how far round its tail reaches,
      in turns. Null for LENGTH's tail. */
  ring: { pos: number; reach: number; at: Float32Array; needs: Float32Array } | null
}

const lengthOf = (tap: MarkTap) => clamp01((tap.length - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))

const sweepDelay = (s: number) => TAIL_GROWTH_S * Math.pow(s, TAIL_SWEEP_EASE)

/** The tail a tap leaves, or null for one that stops dead (LENGTH 0). */
export function sampleTrail(tap: MarkTap, inkScale = 1): Trail | null {
  const ringing = patternOf(tap).ringing
  return ringing ? sampleRinging(tap, inkScale) : sampleTail(tap, inkScale)
}

function sampleTail(tap: MarkTap, inkScale: number): Trail | null {
  const v = lengthOf(tap)
  if (v <= 0) return null
  // Its own stream, so re-placing tails leaves the mark untouched.
  const rand = makeRng(tap.seed ^ 0x9e3779b9)
  const e = clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))
  const body = LENGTH_MAX_BODY * v
  const arc = lerp(LENGTH_MIN_ARC, LENGTH_MAX_ARC, v)
  const spread = LENGTH_MAX_SPREAD * v
  const decay = lerp(LENGTH_DECAY_STEEP, LENGTH_DECAY_GENTLE, v)
  const count = Math.round(
    TAIL_PER_TAP *
      lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e) *
      body *
      inkOf(tap) *
      inkScale,
  )
  if (count <= 0) return null

  const theta0 = tap.pos * Math.PI * 2 - Math.PI / 2
  const ox = Math.cos(theta0)
  const oy = Math.sin(theta0)
  // The tail keeps out of the mark's own clearance and leaves from its edge.
  const hollowR = patternOf(tap).clear(characterOf(tap)) * unitOf(tap)
  // Lateral spread, measured off the ring: a fraction of minDim, in radii.
  const lateralUnit = (MARK_SCALE / CIRCLE_RADIUS) * spread
  const xs: number[] = []
  const ys: number[] = []
  const jxs: number[] = []
  const jys: number[] = []
  const alpha: number[] = []
  const reveal: number[] = []
  for (let i = 0; i < count; i++) {
    const s = Math.pow(rand(), TAIL_BIAS)
    const theta = theta0 + s * arc
    const lateral =
      gaussianFrom(rand) * lateralUnit * (TAIL_HEAD_WIDTH + (1 - TAIL_HEAD_WIDTH) * s)
    const radius = 1 + lateral
    const x = Math.cos(theta) * radius
    const y = Math.sin(theta) * radius
    if (hollowR > 0 && Math.hypot(x - ox, y - oy) < hollowR) continue
    xs.push(x)
    ys.push(y)
    alpha.push(BASE_ALPHA * TAIL_HEAD_ALPHA * Math.exp(-decay * s))
    reveal.push(sweepDelay(s))
    jxs.push(gaussianFrom(rand))
    jys.push(gaussianFrom(rand))
  }
  return {
    count: xs.length,
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    jxs: Float32Array.from(jxs),
    jys: Float32Array.from(jys),
    alpha: Float32Array.from(alpha),
    reveal: Float32Array.from(reveal),
    ring: null,
  }
}

/** A ride's own tail: the trace from its pad, bent along the ring and drawn
    out for as long as the ride rings. */
function sampleRinging(tap: MarkTap, inkScale: number): Trail | null {
  const ringing = patternOf(tap).ringing
  if (!ringing) return null
  const rand = makeRng(tap.seed ^ 0x51ed270b)
  const v = lengthOf(tap)
  const c = characterOf(tap)
  const arc = Math.min(
    RING_MAX_ARC,
    RING_ARC * (LENGTH_STRETCH_MIN + LENGTH_STRETCH_RANGE * v) * lerp(1, RING_HIGH_TUNE_REACH, c),
  )
  const unit = unitOf(tap)
  // Where the tail ends along its own axis, in field units.
  const reach = arc / unit - ringing.start
  if (reach <= 0) return null

  const vel = velocityOf(tap)
  const grown = vel.size * (patternOf(tap).ringScale ?? 1)
  const candidates = Math.round(
    SPECK_DENSITY *
      RING_INK *
      reach *
      2 *
      ringing.width *
      lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, energyOf(tap)) *
      vel.density *
      grown *
      grown *
      inkScale,
  )
  const theta0 = tap.pos * Math.PI * 2 - Math.PI / 2
  const ox = Math.cos(theta0)
  const oy = Math.sin(theta0)
  const hollowR = patternOf(tap).clear(c) * unit
  const xs: number[] = []
  const ys: number[] = []
  const jxs: number[] = []
  const jys: number[] = []
  const at: number[] = []
  const needs: number[] = []
  const reveal: number[] = []
  for (let i = 0; i < candidates; i++) {
    const along = ringing.start + rand() * reach
    const across = (rand() * 2 - 1) * ringing.width
    const keep = rand()
    if (keep >= ringing.tail(along, across, reach)) continue
    // Radians past the strike: distance along the tail, as arc of a unit ring.
    const turn = along * unit
    const radius = 1 + across * unit
    const x = Math.cos(theta0 + turn) * radius
    const y = Math.sin(theta0 + turn) * radius
    if (hollowR > 0 && Math.hypot(x - ox, y - oy) < hollowR) continue
    const t = (along - ringing.start) / reach
    xs.push(x)
    ys.push(y)
    at.push(turn / (Math.PI * 2))
    needs.push(rand())
    reveal.push(sweepDelay(t))
    jxs.push(gaussianFrom(rand))
    jys.push(gaussianFrom(rand))
  }
  if (xs.length === 0) return null
  return {
    count: xs.length,
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    jxs: Float32Array.from(jxs),
    jys: Float32Array.from(jys),
    alpha: new Float32Array(xs.length).fill(BASE_ALPHA),
    reveal: Float32Array.from(reveal),
    ring: {
      pos: tap.pos,
      reach: arc / (Math.PI * 2),
      at: Float32Array.from(at),
      needs: Float32Array.from(needs),
    },
  }
}

// ── FX's tone maps ────────────────────────────────────────────────────────
// HIGH PASS FILTER and SATURATE re-map the finished frame's ink, one
// alpha→alpha curve; the scene runs it in a shader. These say where its stops
// are for a pair of slider values.

const HIGHPASS_MAX_PIVOT = 0.8
/** Above this pivot HIGH PASS crossfades into a plain inversion. */
export const HIGHPASS_INVERT_FROM = 0.85
const SATURATE_MAX_FLOOR = 0.75

/** HIGH PASS's black stop and SATURATE's floor, each 0..1, from the 0..100
    sliders. Both 0 is the identity. */
export function toneStops(highpass: number, saturate: number): { pivot: number; floor: number } {
  return {
    pivot: HIGHPASS_MAX_PIVOT * clamp01(highpass / 100),
    floor: SATURATE_MAX_FLOOR * clamp01(saturate / 100),
  }
}
