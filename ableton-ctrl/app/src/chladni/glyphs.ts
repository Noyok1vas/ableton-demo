/**
 * The eight sound marks again, made the Chladni way: each is a circular
 * membrane (or plate) vibrating in a few of its modes, and the character
 * slider only moves the weights between those modes.
 *
 * What is drawn is the vibration's energy, not Chladni's sand. Sand gathers
 * on the nodal lines, where nothing moves, so the fundamental (0,1) in sand is
 * a hollow ring — which would make the kick hollow, against "solid = low and
 * heavy". Here ink density follows the time-averaged energy instead, the
 * modes summed incoherently:
 *
 *   E(r, θ) = Σ_k w_k · ψ_k(r, θ)²
 *   D(r, θ) = clamp((E / Emax)^γ, 0, 1)      — the stipple's density
 *
 * γ is the edge: high keeps only the peaks (a diffuse, thin mark), low
 * flattens them into a plateau (a solid, firm one).
 *
 * Two kinds of ink, one per kind of sound:
 *   - stipple, following the energy  = the tonal part
 *   - solid grains, placed on lobes  = the noise part (SNARE's wires)
 *
 * Field units are the hand-drawn marks' own (a pad shows ±1, y down), so the
 * two versions can be laid side by side at one scale. Membrane radii are
 * MEMBRANE × the size each sound's spec gives.
 */

import { lobed, radial } from './bessel.ts'
import { rideTrace, type PatternId } from '../selector/patterns.ts'

/** Switches for the comparisons the spec asks for. */
export type ModalOptions = {
  /** TOM's highest angular order: 3 matches the hand-drawn ring, 5 is the
      literal 196/52 Hz ratio — a much thinner ring. */
  tomMax: 3 | 5
  /** KICK's faint outer halo, mode (0,2) up to 0.08 as it hardens. */
  kickHalo: boolean
  /** FX built as a true sum of modes, or as the separable approximation that
      keeps its ripple and teeth on the ring. */
  fxVariant: 'modal' | 'separable'
}

export const DEFAULT_MODAL_OPTIONS: ModalOptions = {
  tomMax: 3,
  kickHalo: false,
  fxVariant: 'modal',
}

/** One vibrating body: its energy in its own unit disc, placed in the field. */
type Layer = {
  /** Membrane radius, in field units. */
  radius: number
  gamma: number
  /** Energy at polar coords in the unit membrane; any non-negative scale,
      the renderer normalizes by the layer's own peak. */
  energy: (r: number, theta: number) => number
}

/** A solid grain of sand, in field units. */
type Grain = { x: number; y: number; r: number }

type ModalMark = {
  layers: Layer[]
  grains?: Grain[]
  /** A ready-made 0..1 density laid over the rest (RIDE's hand-drawn trace). */
  extra?: (x: number, y: number) => number
}

export type ModalGlyph = {
  id: PatternId
  /** The field point drawn at a pad's centre, as on the hand-drawn marks. */
  anchor: { x: number; y: number }
  mark: (c: number, o: ModalOptions) => ModalMark
}

/** Field units per unit of the spec's "size". */
const MEMBRANE = 0.45

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

function hash(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(salt, 0x5bd1e995)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/**
 * The degenerate pair (m, 1) at a continuous order p: neighbouring integer
 * modes cross-faded, since a slider cannot jump between them. Solid at p = 0,
 * a ring moving out and thinning as p rises.
 */
function ringAt(p: number, r: number): number {
  const m0 = Math.floor(p)
  const f = p - m0
  const a = radial(m0, 1, r)
  return f > 0 ? a * (1 - f) + radial(m0 + 1, 1, r) * f : a
}

// ── The eight ────────────────────────────────────────────────────────────

const ORIGIN = { x: 0, y: 0 }

// KICK — (0,1): its energy is already densest at the centre, fading out.
const kick: ModalGlyph = {
  id: 'kick',
  anchor: ORIGIN,
  mark: (c, o) => ({
    layers: [
      {
        radius: MEMBRANE * lerp(0.85, 1.05, c),
        gamma: lerp(1.6, 0.4, c),
        energy: (r) => radial(0, 1, r) + (o.kickHalo ? 0.08 * c * radial(0, 2, r) : 0),
      },
    ],
  }),
}

// TOM — (m,1) pairs from m = 0 to tomMax: solid → thick ring as it tunes up.
const tom: ModalGlyph = {
  id: 'tom',
  anchor: ORIGIN,
  mark: (c, o) => ({
    layers: [{ radius: MEMBRANE * 0.8, gamma: 0.8, energy: (r) => ringAt(o.tomMax * c, r) }],
  }),
}

// SNARE — the head as (m,1) with p = 1.5c (a kick at BODY), and the wires as
// two halos of sand outside it, on the lobe centres of cos²(9θ) and cos²(12θ).
const SNARE_SIZE = 0.85
const SNARE_HALOS = [
  { at: 1.12, m: 9, size: 0.032, theta0: 0 },
  // Offset half a lobe so the two rings stagger rather than line up.
  { at: 1.3, m: 12, size: 0.024, theta0: Math.PI / 24 },
]

function snareGrains(radius: number, c: number): Grain[] {
  const grow = Math.pow(c, 1.2)
  if (grow <= 0) return []
  const grains: Grain[] = []
  SNARE_HALOS.forEach((halo, h) => {
    for (let k = 0; k < 2 * halo.m; k++) {
      // A little jitter in angle, radius and size, fixed per grain.
      const theta = halo.theta0 + (k * Math.PI) / halo.m + (hash(k, h, 1) - 0.5) * 0.12
      const rr = radius * (halo.at + (hash(k, h, 2) - 0.5) * 0.06)
      grains.push({
        x: Math.cos(theta) * rr,
        y: Math.sin(theta) * rr,
        r: halo.size * grow * (0.8 + 0.4 * hash(k, h, 3)),
      })
    }
  })
  return grains
}

const snare: ModalGlyph = {
  id: 'snare',
  anchor: ORIGIN,
  mark: (c) => {
    const radius = MEMBRANE * SNARE_SIZE
    return {
      layers: [{ radius, gamma: 0.8, energy: (r) => ringAt(1.5 * c, r) }],
      grains: snareGrains(radius, c),
    }
  },
}

// RIM — (0,1), small and hard-edged.
const rim: ModalGlyph = {
  id: 'rim',
  anchor: ORIGIN,
  mark: () => ({
    layers: [{ radius: MEMBRANE * 0.12, gamma: 0.3, energy: (r) => radial(0, 1, r) }],
  }),
}

// CLAP — a (0,1) dot between the two lobes of one orientation of (1,1), the
// nodal line between them vertical. Radial and angular parts take their own
// exponents: thin long arcs at BRIGHT, fat crescents at FULL. (A clap is no
// vibrating body; the dipole is borrowed for its shape.)
const CLAP_SIZE = 1.0 // field units: puts the lobes where the hand-drawn shells are
const CLAP_DOT = 0.15

const clap: ModalGlyph = {
  id: 'clap',
  anchor: ORIGIN,
  mark: (c) => {
    const gr = lerp(3.0, 0.7, c)
    const ga = lerp(0.5, 1.2, c)
    return {
      layers: [
        { radius: CLAP_DOT, gamma: 0.5, energy: (r) => radial(0, 1, r) },
        {
          radius: CLAP_SIZE,
          gamma: 1,
          energy: (r, theta) => {
            const a = Math.cos(theta)
            return Math.pow(radial(1, 1, r), gr) * Math.pow(a * a, ga)
          },
        },
      ],
    }
  },
}

// HAT — a plate in one orientation of (6,1): twelve beads. Opening brings in
// the higher radial orders at the same angles, (6,2) and (6,3), and the beads
// join up into rays — an open hat rings on in more modes.
const hat: ModalGlyph = {
  id: 'hat',
  anchor: ORIGIN,
  mark: (c) => ({
    layers: [
      {
        radius: MEMBRANE * lerp(0.7, 1.15, c),
        gamma: lerp(1.5, 1.0, c),
        energy: (r, t) => lobed(6, 1, r, t) + 0.7 * c * lobed(6, 2, r, t) + 0.5 * c * lobed(6, 3, r, t),
      },
    ],
  }),
}

// RIDE — the tom's family, p = 2.5c, with the pair's degeneracy broken
// (cos : sin = 1 : 0.75) so the ring is slightly uneven, as metal is. The
// trace keeps the hand-drawn logic.
const RIDE_SPLIT = 0.75

function rideRing(p: number, r: number, theta: number): number {
  const at = (m: number) => {
    if (m === 0) return radial(0, 1, r)
    const cs = Math.cos(m * theta)
    return radial(m, 1, r) * (cs * cs + RIDE_SPLIT * (1 - cs * cs))
  }
  const m0 = Math.floor(p)
  const f = p - m0
  return f > 0 ? at(m0) * (1 - f) + at(m0 + 1) * f : at(m0)
}

const ride: ModalGlyph = {
  id: 'ride',
  anchor: { x: 0, y: -0.3 },
  mark: (c) => ({
    layers: [{ radius: MEMBRANE * 0.6, gamma: 0.8, energy: (r, t) => rideRing(2.5 * c, r, t) }],
    extra: rideTrace,
  }),
}

// FX — the (1,1) ring, then a fine ripple (one orientation of (18,1)) that
// comes and goes, then ten teeth (one orientation of (5,1)) that grow to the
// end: the two FM modulators, in the order they arrive.
const FX_RIPPLE_M = 18

const fxRipple = (c: number) => 0.5 * smoothstep(0, 0.5, c) * (1 - smoothstep(0.6, 1, c))
const fxTeeth = (c: number) => 0.8 * smoothstep(0.4, 1, c)

const fx: ModalGlyph = {
  id: 'fx',
  anchor: ORIGIN,
  mark: (c, o) => {
    const a = fxRipple(c)
    const b = fxTeeth(c)
    const energy =
      o.fxVariant === 'modal'
        ? (r: number, t: number) =>
            radial(1, 1, r) + a * lobed(FX_RIPPLE_M, 1, r, t) + b * lobed(5, 1, r, t)
        : (r: number, t: number) => {
            const ca = Math.cos(FX_RIPPLE_M * t)
            const cb = Math.cos(5 * t)
            return radial(1, 1, r) * (1 - a - b + a * ca * ca + b * cb * cb)
          }
    return { layers: [{ radius: MEMBRANE * 1.33, gamma: 0.8, energy }] }
  },
}

/** In pad order, the same as PATTERNS. */
export const MODAL_GLYPHS: ModalGlyph[] = [kick, tom, snare, rim, clap, hat, ride, fx]

// ── Rendering ────────────────────────────────────────────────────────────

/** Tile size in pixels, and stipple cells across it. */
const TILE_PX = 800
const GRID = 800
/** How far a dot may wander from its cell's centre, in cells. */
const JITTER = 0.8
/** Dot radius, in cells: enough overlap that full density reads as solid. */
const DOT = 0.62
const INK = 'rgba(0, 0, 0, 0.92)'

/**
 * Stipple one glyph at character `c` into a TILE_PX² canvas spanning ±1
 * around its anchor. A jittered grid keeps the dots even but not regular;
 * each cell keeps its dot where a fixed per-cell random number falls under
 * the density, so moving the slider adds and removes dots rather than
 * reshuffling them all.
 */
export function renderModalTile(glyph: ModalGlyph, c: number, o: ModalOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_PX
  canvas.height = TILE_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const mark = glyph.mark(c, o)
  const { x: ax, y: ay } = glyph.anchor
  const cells = GRID * GRID
  const xs = new Float32Array(cells)
  const ys = new Float32Array(cells)
  const energy = mark.layers.map(() => new Float32Array(cells))
  const peak = mark.layers.map(() => 0)

  // Pass 1: energy of every layer at every dot, and each layer's peak.
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i
      const x = ((i + 0.5 + JITTER * (hash(i, j, 11) - 0.5)) / GRID) * 2 - 1 + ax
      const y = ((j + 0.5 + JITTER * (hash(i, j, 12) - 0.5)) / GRID) * 2 - 1 + ay
      xs[k] = x
      ys[k] = y
      mark.layers.forEach((layer, l) => {
        const r = Math.hypot(x, y) / layer.radius
        if (r >= 1) return
        const e = layer.energy(r, Math.atan2(y, x))
        energy[l][k] = e
        if (e > peak[l]) peak[l] = e
      })
    }
  }

  // Pass 2: density, and a dot wherever the cell's own number falls under it.
  const toPx = (v: number) => ((v + 1) / 2) * TILE_PX
  const dot = (DOT * TILE_PX) / GRID
  ctx.fillStyle = INK
  ctx.beginPath()
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i
      let d = 0
      mark.layers.forEach((layer, l) => {
        if (peak[l] > 0 && energy[l][k] > 0) {
          d = Math.max(d, clamp01(Math.pow(energy[l][k] / peak[l], layer.gamma)))
        }
      })
      if (mark.extra) d = Math.max(d, mark.extra(xs[k], ys[k]))
      if (hash(i, j, 13) < d) {
        const px = toPx(xs[k] - ax)
        const py = toPx(ys[k] - ay)
        ctx.moveTo(px + dot, py)
        ctx.arc(px, py, dot, 0, Math.PI * 2)
      }
    }
  }
  for (const g of mark.grains ?? []) {
    const px = toPx(g.x - ax)
    const py = toPx(g.y - ay)
    const r = (g.r * TILE_PX) / 2
    ctx.moveTo(px + r, py)
    ctx.arc(px, py, r, 0, Math.PI * 2)
  }
  ctx.fill()
  return canvas
}
