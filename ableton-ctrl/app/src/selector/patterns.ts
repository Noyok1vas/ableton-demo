/**
 * The four selector marks, defined as continuous ink fields rather than art
 * assets: each pattern is a function of normalized coordinates, rasterized with
 * grain so it reads like the printed/plotted reference images (soft greys, no
 * hard vector edges). Same black/white/grey palette as the rest of the GUI.
 *
 * One graphic system, four members, each the picture of what it sounds like:
 *
 *   HIT      ●  a solid dot          — kick: low, filled, grounded
 *   TICK     ○  a ring               — hat: light, empty, and breakable
 *   SPLASH   ✳  a solid starburst    — clap: one sharp transient radiating out
 *   SCATTER  ·  a field of grains    — noise: dispersed, atmospheric
 *
 * HIT and TICK are deliberately the same mark in two states, filled and hollow,
 * because that is the relationship the two sounds have. The Sound Visual draws
 * the same four marks on its ring — these icons are the key to that canvas, so
 * a change here belongs in SoundVisualScreen too.
 */

import type { SoundVoiceId } from '../transport/engine.ts'

/** The Selector's marks and the engine's sound identities are the same four
    things, so they are one id: choosing a mark chooses a sound. */
export type PatternId = SoundVoiceId

export type Pattern = {
  id: PatternId
  label: string
  /** Ink density 0..1 at normalized coords, canvas centre at (0,0), edges ±1.
   *
   * `c` is the sound's character, 0..1 — the panel's slider. One field per
   * identity serves both levels of the Selector: the grid draws it at the
   * fixed IDENTITY_CHARACTER and never redraws, the panel draws it at the live
   * value and redraws on every move. Same shape, asked two different
   * questions. Identities with no axis (SPLASH) ignore `c` entirely. */
  field: (x: number, y: number, c: number) => number
  /** Darkest tone the field maps to (1 = pure black). Keeps the placeholders
      grey while the live HIT mark goes near-black. */
  maxInk: number
  /** Grain strength; the noise is concentrated in mid tones, where a printed
      halftone actually breaks up. */
  grain: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/** Deterministic 0..1 from a pair of integers — the grain field's randomness,
    which has to be a *function* of position because the field is sampled per
    pixel with no memory between samples. */
function hash2(i: number, j: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

// ── 1. SPLASH — one solid burst radiating from a point ───────────────────
// Eight long strokes out of a small, very dense middle — not a fat star with
// stubby points. Each ray keeps most of its width along its length and only
// gives out near the tip, which is what makes the mark read as something thrown
// outward rather than as a drawn asterisk. Not rings: nothing here travels over
// time; it is one instant, seen at once.
const SPLASH_RAYS = 8
const SPLASH_CORE = 0.09 // the dense centre — small, so the rays are the mark
const SPLASH_REACH = 0.96 // rays run nearly to the frame
const SPLASH_RAY_WIDTH = 0.055 // half-width, held almost constant along the ray
const SPLASH_RAY_TAPER = 0.3 // share of that width lost by the tip
const SPLASH_FADE_FROM = 0.5 // share of the reach at full strength before fading

// Ignores `c`: SPLASH has no character axis in v0.3, on purpose — see
// character.ts. Its panel shows this mark and no slider.
function splashField(x: number, y: number): number {
  const r = Math.hypot(x, y)
  // The concentrated impact. A steeper-than-gaussian falloff keeps it solid to
  // its edge instead of blooming, which is what makes it read as sharp.
  let v = Math.exp(-Math.pow(r / SPLASH_CORE, 2.2)) * 1.35
  // Angular distance to the nearest of the eight ray directions. Doing it by
  // angle rather than per-ray dot products is what lets the strokes taper.
  const step = (2 * Math.PI) / SPLASH_RAYS
  const a = Math.atan2(y, x)
  const da = Math.abs((((a + step / 2) % step) + step) % step - step / 2)
  const across = r * Math.sin(da) // perpendicular distance to the ray
  const t = clamp01(r / SPLASH_REACH)
  const width = SPLASH_RAY_WIDTH * (1 - SPLASH_RAY_TAPER * t)
  // Full strength out to SPLASH_FADE_FROM, then away — a stroke that ends,
  // rather than a spike that has been thinning since it left the middle.
  const along = t <= SPLASH_FADE_FROM ? 1 : 1 - (t - SPLASH_FADE_FROM) / (1 - SPLASH_FADE_FROM)
  v += Math.exp(-Math.pow(across / width, 2)) * Math.pow(clamp01(along), 1.2) * 1.2
  return clamp01(v)
}

// ── 2. HIT — the solid disc ●, SOFT ←→ HARD ──────────────────────────────
// Always the same solid circular mass; what the character moves is how that
// mass is distributed. Soft is small, faint and diffuse with no real centre;
// hard is wider, heavier, and gathers a genuinely dark core. Three quantities
// carry it, and none of them is the outline — the shape never becomes
// something else.
const HIT_SOFT_RADIUS = 0.34
const HIT_HARD_RADIUS = 0.5
// Falloff exponent. Low is a long diffuse tail with no edge (soft); high is a
// fuller body that then stops (hard).
const HIT_SOFT_FALLOFF = 1.25
const HIT_HARD_FALLOFF = 2.2
const HIT_SOFT_INK = 0.62
const HIT_HARD_INK = 1.05
// The dark core, which only exists as the hit gets harder. It is what makes a
// hard hit read as weight rather than just as a bigger blot.
const HIT_CORE_SHARE = 0.35
const HIT_CORE_SIZE = 0.42 // as a share of the body radius

function hitField(x: number, y: number, c: number): number {
  const radius = lerp(HIT_SOFT_RADIUS, HIT_HARD_RADIUS, c)
  const r = Math.hypot(x, y) / radius
  const body = lerp(HIT_SOFT_INK, HIT_HARD_INK, c) * Math.exp(-Math.pow(r, lerp(HIT_SOFT_FALLOFF, HIT_HARD_FALLOFF, c)))
  const core = c * HIT_CORE_SHARE * Math.exp(-Math.pow(r / HIT_CORE_SIZE, 2))
  return clamp01(body + core)
}

// ── 3. TICK — a ring ○, ROUNDED ←→ CRISPY ────────────────────────────────
// HIT's own outline with nothing inside it: one contour, never a second ring.
// The character does two things at once as it travels — the circle WIDENS, and
// the contour BREAKS. Rounded is one small unbroken line; crispy is a larger
// circle of separate marks, the same shape gone granular. Round becoming
// granular is what "crisp" looks like, and it is the same idea the sound is
// doing (a long round hat becoming a short dry one) seen instead of heard.
//
// The centre stays empty at every point of the travel. That is not a tuning
// choice but the mark's meaning, so the numbers below keep the ring's inner
// falloff reaching zero well before the middle.
const TICK_ROUND_RADIUS = 0.38
const TICK_CRISP_RADIUS = 0.62
const TICK_ROUND_WIDTH = 0.05
const TICK_CRISP_WIDTH = 0.042
const TICK_ROUND_INK = 1.1
const TICK_CRISP_INK = 1.2
// The break. Below TICK_BREAK_FROM the contour is solid — a hat that is only
// slightly crisp should not already be dotted. Past it, the ring divides into
// more and more segments while each segment keeps less and less of its arc,
// which is what carries it from a faceted line to separate round marks.
const TICK_BREAK_FROM = 0.18
const TICK_MIN_SEGMENTS = 8
const TICK_MAX_SEGMENTS = 20
const TICK_MIN_DUTY = 0.3 // share of a segment that stays ink, at fully crispy
// How sharply a segment ends. High is a hard edge; this is a crisp mark, so the
// ends are meant to be definite rather than feathered.
const TICK_EDGE = 6

function tickField(x: number, y: number, c: number): number {
  const radius = lerp(TICK_ROUND_RADIUS, TICK_CRISP_RADIUS, c)
  const width = lerp(TICK_ROUND_WIDTH, TICK_CRISP_WIDTH, c)
  const d = Math.hypot(x, y) - radius
  const radial = Math.exp(-Math.pow(d / width, 2))
  if (radial < 0.002) return 0 // nowhere near the contour — nothing to break up

  const b = clamp01((c - TICK_BREAK_FROM) / (1 - TICK_BREAK_FROM))
  const duty = lerp(1, TICK_MIN_DUTY, b)
  if (duty >= 1) return clamp01(lerp(TICK_ROUND_INK, TICK_CRISP_INK, c) * radial)

  const segments = Math.round(lerp(TICK_MIN_SEGMENTS, TICK_MAX_SEGMENTS, b))
  const step = (2 * Math.PI) / segments
  const a = Math.atan2(y, x)
  // Position within this segment, 0 at its centre and 1 at its edge.
  const off = Math.abs((((a % step) + step) % step) / step - 0.5) * 2
  const gate = Math.exp(-Math.pow(off / duty, TICK_EDGE))
  return clamp01(lerp(TICK_ROUND_INK, TICK_CRISP_INK, c) * radial * gate)
}

// ── 4. SCATTER — a grain field, AIRY ←→ DENSE ────────────────────────────
// Noise seen rather than heard, and the only one of the four that is a field
// rather than an object. Built on a coarse grid whose points are jittered well
// past their own cells and thinned at random, so what is left reads as
// distributed and never as the lattice underneath it.
//
// Character moves three things at once, all of them "how occupied is this":
// how many cells carry a grain, how large each grain is, and how strongly it
// prints. Airy leaves most of the square as negative space; dense closes it up.
// The field never becomes a shape — at both ends it is still many things.
const GRAIN_CELL = 0.52 // grid pitch, normalized units
const GRAIN_JITTER = 1.05 // how far a grain strays from its cell, in cells
const GRAIN_SIZE = 0.15 // base grain radius (gaussian sigma)
// The dense end is deliberately short of saturation. Pushed further, the grains
// merge into a solid with white holes punched in it — which reads as an
// inverted shape, not as an occupied field, and loses the one thing SCATTER is
// supposed to be made of.
const GRAIN_AIRY_KEEP = 0.34 // share of cells carrying a grain, at airy…
const GRAIN_DENSE_KEEP = 0.9 // …and at dense
const GRAIN_AIRY_SIZE = 0.72 // size multiplier at airy…
const GRAIN_DENSE_SIZE = 1.02 // …and at dense
const GRAIN_AIRY_INK = 0.5
const GRAIN_DENSE_INK = 0.88

function scatterField(x: number, y: number, c: number): number {
  const keep = lerp(GRAIN_AIRY_KEEP, GRAIN_DENSE_KEEP, c)
  const scale = GRAIN_SIZE * lerp(GRAIN_AIRY_SIZE, GRAIN_DENSE_SIZE, c)
  const strength = lerp(GRAIN_AIRY_INK, GRAIN_DENSE_INK, c)
  const ci = Math.round(x / GRAIN_CELL)
  const cj = Math.round(y / GRAIN_CELL)
  let v = 0
  // 5×5, not 3×3: a grain jittered half a cell out of its own, and most of a
  // cell wide on top of that, still has to be found from where it landed.
  for (let di = -2; di <= 2; di++) {
    for (let dj = -2; dj <= 2; dj++) {
      const i = ci + di
      const j = cj + dj
      // The SAME cells survive as the field thickens — a rising threshold adds
      // grains without moving the ones already there, so the slider reads as
      // one field filling in rather than as a new field on every step.
      const pick = hash2(i, j)
      if (pick > keep) continue // an empty cell — the gaps are the texture
      const px = (i + (hash2(i + 8191, j) - 0.5) * GRAIN_JITTER) * GRAIN_CELL
      const py = (j + (hash2(i, j - 5381) - 0.5) * GRAIN_JITTER) * GRAIN_CELL
      const size = scale * (0.55 + 1.1 * (pick / Math.max(keep, 0.01))) // no two grains alike
      const dx = x - px
      const dy = y - py
      v += Math.exp(-(dx * dx + dy * dy) / (size * size)) * strength * 0.9
    }
  }
  return clamp01(v)
}

export const PATTERNS: Pattern[] = [
  // Ids ARE the sound identities now, so a mark, a voice and a drawn shape all
  // answer to the same name — the Sound Visual and the engine both key off this.
  { id: 'splash', label: 'Splash', field: splashField, maxInk: 0.94, grain: 1.0 },
  { id: 'hit', label: 'Hit', field: hitField, maxInk: 0.96, grain: 1.0 },
  { id: 'tick', label: 'Tick', field: tickField, maxInk: 0.9, grain: 0.9 },
  { id: 'scatter', label: 'Scatter', field: scatterField, maxInk: 0.78, grain: 0.6 },
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
 * Called once per identity for the grid (at IDENTITY_CHARACTER, then cached)
 * and once per slider frame for the panel — the same function either way, so
 * the two levels of the Selector can never drift into different-looking marks.
 */
export function renderPatternTile(pattern: Pattern, c: number): HTMLCanvasElement {
  const size = TILE_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const image = ctx.createImageData(size, size)
  const data = image.data
  for (let py = 0; py < size; py++) {
    // +0.5 samples pixel centres; the *2-1 maps the tile to [-1,1].
    const ny = ((py + 0.5) / size) * 2 - 1
    for (let px = 0; px < size; px++) {
      const nx = ((px + 0.5) / size) * 2 - 1
      const v = pattern.field(nx, ny, c)
      const noise = (Math.random() - 0.5) * pattern.grain * (v * (1 - v) * 4)
      const ink = clamp01(v + noise) * pattern.maxInk
      const tone = Math.round(255 * (1 - ink))
      const i = (py * size + px) * 4
      data[i] = tone
      data[i + 1] = tone
      data[i + 2] = tone
      data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
