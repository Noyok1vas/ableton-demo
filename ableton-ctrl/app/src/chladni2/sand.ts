/**
 * Sand on the nodal lines — Chladni's own picture, and the one renderer every
 * Chladni 2 figure goes through.
 *
 * A figure (glyphs.ts) is a few signed fields ψ and a handful of channel
 * amounts. Pouring sand on it:
 *
 *   1. LINES — each ψ's zero set is traced on a grid (marching squares, with
 *      the crossing interpolated), and grains are laid along every piece at a
 *      fixed number per unit length, stratified so they spread out evenly
 *      rather than clumping (a 1-D blue noise). Each grain sits off the line
 *      by a small gaussian along the normal: the line's width.
 *   2. NOISE (channel 3) — a pure tone holds every grain on its line; noise
 *      shakes a share of them off, and the more noise the larger that share
 *      and the further they land, mostly along the normal — until at full
 *      every grain is off and the figure is a cloud. What stays on the lines
 *      stays sharp, so a little noise reads as loose sand on a clear figure,
 *      not as a blurred one.
 *   3. AFTERGLOW (channel 4) — loose grains outside the silhouette, thinning
 *      exponentially; DECAY sets how far.
 *   4. IMPACT / BELL (channel 6) — a solid disc at the centre.
 *   5. DRIVE (channel 7) — wider, denser lines, and grains spilling off them.
 *   6. COPIES (channel 8, and the hat's two plates) — the lines poured again
 *      for each copy, moved, turned or scaled.
 *   7. TWIST (channel 5) — every grain moved: circles open into a clockwise
 *      inward spiral, spokes bend into a clockwise inward vortex.
 *   8. SPREAD (channel 9) — every grain stretched sideways.
 *
 * Coordinates are body units: a membrane or plate has radius 1, y down.
 */

export type Field = (x: number, y: number) => number

/** One set of nodal lines: the zero set of `psi`, wherever `inside` holds. */
export type Lines = {
  psi: Field
  /** Share of full density, 0..1 — a mode fading in or out. */
  weight: number
  inside: (x: number, y: number) => boolean
  /** The faint secondary texture of channel 2: thinner, lighter. */
  faint?: boolean
}

/** A drawn silhouette (the bar's): `at(t)` walks it, t ∈ [0, 1). */
export type Outline = {
  length: number
  weight: number
  at: (t: number) => { x: number; y: number; nx: number; ny: number }
}

/** One more pour of the lines, moved by (dx, dy), turned by `rot` and
    scaled by `scale` about the centre. */
export type Copy = { dx: number; dy: number; rot: number; scale: number; weight: number }

export type Figure = {
  /** Half-width of the square the lines are looked for in. */
  reach: number
  lines: Lines[]
  outline?: Outline
  /** Absent: the lines are poured once, in place. */
  copies?: Copy[]
  /** How far a point is outside the silhouette (≤ 0 inside) — what the
      afterglow fades away from. */
  outside: Field
  /** The body's |ψ|², for the optional faint fill, and where the body is. */
  body?: { psi: Field; inside: (x: number, y: number) => boolean }
  /** Channel amounts, 0..1. */
  noise: number
  /** Where shaken-off sand may land, by radius (SNARE's filter type). */
  noiseBand?: (r: number) => number
  halo: number
  /** How far the afterglow can reach at halo 1, in body units. */
  haloReach: number
  twist: number
  impact?: { radius: number; sharp: number }
  bell?: number
  drive: number
  spread: number
  /** Grain size, × the base. */
  grain: number
  /** The whole figure's size, × its body units. */
  size: number
  /** The renderer's own constants, overridden for this figure — the
      Chladni Editor puts every one of them on a slider. */
  tuning?: Partial<SandTuning>
}

/** Everything the renderer would otherwise hold fixed. */
export type SandTuning = {
  /** Grains per px of line, and the line's own half-width in px. */
  lineGrains: number
  lineSigma: number
  /** How much of a full line a faint (TONE) line prints. */
  faintShare: number
  /** Where shaken sand lands at the least noise, and at full. */
  shakeMin: number
  shakeMax: number
  /** Grains per px² of afterglow, solid disc and body fill. */
  haloDensity: number
  solidDensity: number
  fillDensity: number
  /** TWIST at 1: a circle's drop over one turn, and a spoke's inner turn. */
  spiralDrop: number
  vortexTurn: number
  /** SPREAD at 1: how much wider. */
  spreadStretch: number
  /** Marching-squares cell, in px. */
  cellPx: number
}

/** What a grain is, which sets how it is printed. */
export const Kind = { Line: 0, Faint: 1, Halo: 2, Solid: 3, Fill: 4 } as const
export type Kind = (typeof Kind)[keyof typeof Kind]

export type Sand = {
  count: number
  xs: Float32Array
  ys: Float32Array
  kinds: Uint8Array
  grain: number
}

// ── Tuning ───────────────────────────────────────────────────────────────

/** The renderer's tuning, as every figure but the editor's uses it. */
export const SAND_TUNING: SandTuning = {
  lineGrains: 1.5,
  lineSigma: 0.75,
  faintShare: 0.5,
  // How far, in body units, a shaken grain lands from its line: the least
  // noise shakes it this far, full noise this far — a cloud the body's size.
  shakeMin: 0.05,
  shakeMax: 0.4,
  haloDensity: 0.05,
  solidDensity: 0.85,
  fillDensity: 0.16,
  spiralDrop: 0.32,
  vortexTurn: 1.9,
  spreadStretch: 0.45,
  cellPx: 2.4,
}

// ── Randomness ───────────────────────────────────────────────────────────

/** mulberry32 — seeded, so a figure re-poured at the same knobs is the same. */
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

function gaussian(rand: () => number): number {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

// ── Growing buffers ──────────────────────────────────────────────────────

class GrainBuffer {
  xs = new Float32Array(4096)
  ys = new Float32Array(4096)
  kinds = new Uint8Array(4096)
  count = 0

  push(x: number, y: number, kind: Kind) {
    if (this.count === this.xs.length) {
      const grow = (a: Float32Array) => {
        const b = new Float32Array(a.length * 2)
        b.set(a)
        return b
      }
      this.xs = grow(this.xs)
      this.ys = grow(this.ys)
      const k = new Uint8Array(this.kinds.length * 2)
      k.set(this.kinds)
      this.kinds = k
    }
    this.xs[this.count] = x
    this.ys[this.count] = y
    this.kinds[this.count] = kind
    this.count++
  }
}

// ── Tracing ──────────────────────────────────────────────────────────────

/** Line pieces (x0, y0, x1, y1, …) of ψ = 0 on a `cells`² grid over ±reach. */
function trace(psi: Field, reach: number, cells: number): Float32Array {
  const n = cells + 1
  const h = (2 * reach) / cells
  const v = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    const y = -reach + j * h
    for (let i = 0; i < n; i++) v[j * n + i] = psi(-reach + i * h, y)
  }
  const out: number[] = []
  // Where along an edge from a (value va) to b (value vb) the zero falls.
  const cross = (va: number, vb: number) => (va === vb ? 0.5 : va / (va - vb))
  for (let j = 0; j < cells; j++) {
    const y0 = -reach + j * h
    for (let i = 0; i < cells; i++) {
      const x0 = -reach + i * h
      const a = v[j * n + i] // top-left
      const b = v[j * n + i + 1] // top-right
      const c = v[(j + 1) * n + i + 1] // bottom-right
      const d = v[(j + 1) * n + i] // bottom-left
      const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0)
      if (code === 0 || code === 15) continue
      // Crossings on the four edges: top, right, bottom, left.
      const pts: number[] = []
      if ((a > 0) !== (b > 0)) pts.push(x0 + cross(a, b) * h, y0)
      if ((b > 0) !== (c > 0)) pts.push(x0 + h, y0 + cross(b, c) * h)
      if ((c > 0) !== (d > 0)) pts.push(x0 + h - cross(c, d) * h, y0 + h)
      if ((d > 0) !== (a > 0)) pts.push(x0, y0 + h - cross(d, a) * h)
      if (pts.length === 4) {
        out.push(pts[0], pts[1], pts[2], pts[3])
      } else if (pts.length === 8) {
        // A saddle: pair the crossings the way the centre's sign says.
        const centre = (a + b + c + d) / 4
        if ((centre > 0) === (a > 0)) {
          out.push(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7])
        } else {
          out.push(pts[0], pts[1], pts[6], pts[7], pts[2], pts[3], pts[4], pts[5])
        }
      }
    }
  }
  return Float32Array.from(out)
}

// ── Pouring ──────────────────────────────────────────────────────────────

export type PourOptions = {
  seed: number
  /** Px per body unit the figure will be drawn at — sets how many grains. */
  px: number
  /** Lay the faint |ψ|² fill under the sand. */
  fill: boolean
}

/** Pour sand on a figure. Positions come back in body units × `size`. */
export function pour(fig: Figure, { seed, px, fill }: PourOptions): Sand {
  const rand = makeRng(seed)
  const out = new GrainBuffer()
  const T: SandTuning = { ...SAND_TUNING, ...fig.tuning }
  const unitPx = px * fig.size
  const cells = Math.max(60, Math.min(260, Math.round((2 * fig.reach * unitPx) / T.cellPx)))
  const lineSigma = (T.lineSigma / unitPx) * (1 + 1.6 * fig.drive)
  const perUnit = T.lineGrains * unitPx * (1 + 1.2 * fig.drive)
  const shakeShare = Math.pow(fig.noise, 0.8)
  const shakeSigma = T.shakeMin + (T.shakeMax - T.shakeMin) * fig.noise
  const spill = 0.3 * fig.drive

  /** One grain off the line at (x, y) with normal (nx, ny). */
  const scatter = (x: number, y: number, nx: number, ny: number, kind: Kind, copy: Copy) => {
    const wide = rand() < spill ? 4 : 1
    const shake = rand() < shakeShare
    const sigma = shake ? shakeSigma : 0
    const off = gaussian(rand) * lineSigma * wide + gaussian(rand) * sigma
    const slide = gaussian(rand) * sigma * 0.6
    let gx = x + nx * off - ny * slide
    let gy = y + ny * off + nx * slide
    // Shaken sand only lands where the band lets it (SNARE's filter type).
    if (shake && fig.noiseBand && rand() >= fig.noiseBand(Math.hypot(gx, gy))) return
    if (copy.rot !== 0 || copy.scale !== 1) {
      const cs = Math.cos(copy.rot) * copy.scale
      const sn = Math.sin(copy.rot) * copy.scale
      const rx = gx * cs - gy * sn
      gy = gx * sn + gy * cs
      gx = rx
    }
    out.push(gx + copy.dx, gy + copy.dy, kind)
  }

  const copies = fig.copies ?? [{ dx: 0, dy: 0, rot: 0, scale: 1, weight: 1 }]
  const traced = fig.lines.map((lines) => (lines.weight > 0 ? trace(lines.psi, fig.reach, cells) : null))

  for (const copy of copies) {
    fig.lines.forEach((lines, l) => {
      const segs = traced[l]
      if (!segs) return
      const kind = lines.faint ? Kind.Faint : Kind.Line
      const rate = perUnit * lines.weight * copy.weight * (lines.faint ? T.faintShare : 1)
      let carry = rand()
      for (let s = 0; s < segs.length; s += 4) {
        const x0 = segs[s]
        const y0 = segs[s + 1]
        const x1 = segs[s + 2]
        const y1 = segs[s + 3]
        if (!lines.inside((x0 + x1) / 2, (y0 + y1) / 2)) continue
        const len = Math.hypot(x1 - x0, y1 - y0)
        if (len === 0) continue
        carry += len * rate
        const count = Math.floor(carry)
        carry -= count
        const nx = -(y1 - y0) / len
        const ny = (x1 - x0) / len
        for (let k = 0; k < count; k++) {
          // Stratified along the piece: even, never regular.
          const t = (k + 0.5 + 0.8 * (rand() - 0.5)) / count
          scatter(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny, kind, copy)
        }
      }
    })

    if (fig.outline) {
      const { length, at } = fig.outline
      const count = Math.round(length * perUnit * fig.outline.weight * copy.weight)
      for (let k = 0; k < count; k++) {
        const p = at((k + 0.5 + 0.8 * (rand() - 0.5)) / count)
        scatter(p.x, p.y, p.nx, p.ny, Kind.Line, copy)
      }
    }
  }

  // A solid disc of grains: dense inside `radius`, its edge `soft` wide.
  const disc = (radius: number, soft: number) => {
    const step = 1 / (unitPx * Math.sqrt(T.solidDensity))
    const extent = radius * (1 + soft) + step
    for (let y = -extent; y <= extent; y += step) {
      for (let x = -extent; x <= extent; x += step) {
        const jx = x + (rand() - 0.5) * step
        const jy = y + (rand() - 0.5) * step
        const d = Math.hypot(jx, jy) / radius
        const keep = d <= 1 - soft ? 1 : d >= 1 + soft ? 0 : 0.5 - (d - 1) / (2 * soft)
        if (rand() < keep) out.push(jx, jy, Kind.Solid)
      }
    }
  }
  if (fig.impact) disc(fig.impact.radius, 0.04 + 0.6 * (1 - fig.impact.sharp))
  if (fig.bell) disc(fig.bell, 0.05)

  // Afterglow: a jittered grid outside the silhouette, thinning outward.
  if (fig.halo > 0) {
    const lambda = fig.haloReach * (0.08 + 0.92 * fig.halo) * 0.33
    const base = 0.55 * Math.sqrt(fig.halo)
    const step = 1 / (unitPx * Math.sqrt(T.haloDensity))
    const extent = fig.reach + 4 * lambda
    for (let y = -extent; y <= extent; y += step) {
      for (let x = -extent; x <= extent; x += step) {
        const jx = x + (rand() - 0.5) * step
        const jy = y + (rand() - 0.5) * step
        const d = fig.outside(jx, jy)
        if (d <= 0) continue
        if (rand() < base * Math.exp(-d / lambda)) out.push(jx, jy, Kind.Halo)
      }
    }
  }

  // The body itself, faint: |ψ|² as a stipple, for its volume.
  if (fill && fig.body) {
    const { psi, inside } = fig.body
    const step = 1 / (unitPx * Math.sqrt(T.fillDensity))
    for (let y = -fig.reach; y <= fig.reach; y += step) {
      for (let x = -fig.reach; x <= fig.reach; x += step) {
        const jx = x + (rand() - 0.5) * step
        const jy = y + (rand() - 0.5) * step
        if (!inside(jx, jy)) continue
        const v = psi(jx, jy)
        if (rand() < Math.min(1, v * v)) out.push(jx, jy, Kind.Fill)
      }
    }
  }

  // TWIST, SPREAD and size: every grain moved, whatever it is.
  const twist = fig.twist
  const stretch = 1 + T.spreadStretch * fig.spread
  for (let i = 0; i < out.count; i++) {
    let x = out.xs[i]
    let y = out.ys[i]
    if (twist > 0) {
      const r = Math.hypot(x, y)
      const theta = Math.atan2(y, x)
      // Share of a clockwise turn from 12 o'clock (y is down, so clockwise
      // is increasing angle).
      const u = (((theta + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI)
      const r2 = r * (1 - T.spiralDrop * twist * u)
      const t2 = theta + T.vortexTurn * twist * Math.max(0, 1 - r2)
      x = Math.cos(t2) * r2
      y = Math.sin(t2) * r2
    }
    out.xs[i] = x * stretch * fig.size
    out.ys[i] = y * fig.size
  }

  return { count: out.count, xs: out.xs, ys: out.ys, kinds: out.kinds, grain: fig.grain }
}

// ── Printing ─────────────────────────────────────────────────────────────

/** How strongly each kind of grain prints. */
const KIND_ALPHA: Record<Kind, number> = {
  [Kind.Line]: 0.9,
  [Kind.Faint]: 0.42,
  [Kind.Halo]: 0.4,
  [Kind.Solid]: 0.95,
  [Kind.Fill]: 0.2,
}
const KINDS = [Kind.Fill, Kind.Halo, Kind.Faint, Kind.Line, Kind.Solid] as const

/** One grain's side, in px, at grain 1. */
export const GRAIN_PX = 1.15

/**
 * Print sand onto a 2D context, centred at (cx, cy), `px` per body unit.
 * Grains are squares — at this size a circle is a square anyway, and a
 * rectangle is far cheaper — printed one kind at a time, faint ones first.
 */
export function printSand(
  ctx: CanvasRenderingContext2D,
  sand: Sand,
  cx: number,
  cy: number,
  px: number,
  grainPx = GRAIN_PX,
  alpha = 1,
  /** Per-kind print strength, overriding the defaults (the editor's). */
  kindAlpha?: Partial<Record<Kind, number>>,
): void {
  const g = grainPx * sand.grain
  const half = g / 2
  ctx.fillStyle = '#000000'
  for (const kind of KINDS) {
    ctx.globalAlpha = (kindAlpha?.[kind] ?? KIND_ALPHA[kind]) * alpha
    for (let i = 0; i < sand.count; i++) {
      if (sand.kinds[i] !== kind) continue
      ctx.fillRect(cx + sand.xs[i] * px - half, cy + sand.ys[i] * px - half, g, g)
    }
  }
  ctx.globalAlpha = 1
}
