/**
 * The four selector marks, defined as continuous ink fields rather than art
 * assets: each pattern is a function of normalized coordinates, rasterized with
 * grain so it reads like the printed/plotted reference images (soft greys, no
 * hard vector edges). Same black/white/grey palette as the rest of the GUI.
 */

export type PatternId = 'burst' | 'bloom' | 'ripple' | 'lattice'

export type Pattern = {
  id: PatternId
  label: string
  /** Ink density 0..1 at normalized coords, canvas centre at (0,0), edges ±1. */
  field: (x: number, y: number) => number
  /** Darkest tone the field maps to (1 = pure black). Keeps the placeholders
      grey while the live BLOOM mark goes near-black. */
  maxInk: number
  /** Grain strength; the noise is concentrated in mid tones, where a printed
      halftone actually breaks up. */
  grain: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Soft-edged ring: peaks on the circle of radius r0, falls off over width w. */
function ring(r: number, r0: number, w: number): number {
  const d = (r - r0) / w
  return Math.exp(-d * d)
}

function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// ── 1. BURST — twin rings with six rays ──────────────────────────────────
// Rays: horizontal pair plus the four diagonals, starting clear of the rings.
const RAY_ANGLES = [0, 45, 135, 180, 225, 315].map((deg) => (deg * Math.PI) / 180)
const RAY_START = 0.36
const RAY_WIDTH = 0.05

function burstField(x: number, y: number): number {
  const r = Math.hypot(x, y)
  let v = ring(r, 0.12, 0.045) * 0.55 + ring(r, 0.28, 0.075) * 0.9
  for (const a of RAY_ANGLES) {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const along = x * dx + y * dy // distance out along the ray
    if (along <= RAY_START) continue
    const across = Math.abs(x * dy - y * dx) // perpendicular offset
    const p = across / RAY_WIDTH
    v += Math.exp(-p * p) * 0.75 * smoothstep(RAY_START, RAY_START + 0.12, along)
  }
  return clamp01(v)
}

// ── 2. BLOOM — the solid diffusing disc (the live TAP mark) ───────────────
function bloomField(x: number, y: number): number {
  const r = Math.hypot(x, y) / 0.46
  return clamp01(Math.exp(-r * r) * 1.02)
}

// ── 3. RIPPLE — concentric rings over a light field ───────────────────────
const RIPPLE_PERIOD = 0.42
const RIPPLE_PHASE = 0.17 // radius where the white core ends

function rippleField(x: number, y: number): number {
  const r = Math.hypot(x, y)
  const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * (r - RIPPLE_PHASE)) / RIPPLE_PERIOD)
  // Contrast decays outward, so the outer rings dissolve into the light field.
  const amp = 0.9 * Math.exp(-r * 1.0)
  const base = 0.22 * smoothstep(0.15, 0.7, r)
  return clamp01(base + amp * wave * smoothstep(0, RIPPLE_PHASE, r))
}

// ── 4. LATTICE — soft dots on a triangular lattice ────────────────────────
const LAT_SPACING = 0.78
const LAT_ROW = LAT_SPACING * Math.sqrt(3) * 0.5
const LAT_SIGMA = 0.19

function latticeField(x: number, y: number): number {
  const row = Math.round(y / LAT_ROW)
  let v = 0
  // Only the 3×3 neighbourhood of lattice points can reach this pixel.
  for (let dr = -1; dr <= 1; dr++) {
    const rr = row + dr
    const py = rr * LAT_ROW
    const offset = (((rr % 2) + 2) % 2) * LAT_SPACING * 0.5 // odd rows are staggered
    const col = Math.round((x - offset) / LAT_SPACING)
    for (let dc = -1; dc <= 1; dc++) {
      const px = (col + dc) * LAT_SPACING + offset
      const ddx = x - px
      const ddy = y - py
      v += Math.exp(-(ddx * ddx + ddy * ddy) / (LAT_SIGMA * LAT_SIGMA))
    }
  }
  return clamp01(v * 0.9)
}

export const PATTERNS: Pattern[] = [
  { id: 'burst', label: 'Burst', field: burstField, maxInk: 0.62, grain: 1.1 },
  { id: 'bloom', label: 'Bloom', field: bloomField, maxInk: 0.96, grain: 1.0 },
  { id: 'ripple', label: 'Ripple', field: rippleField, maxInk: 0.6, grain: 0.9 },
  { id: 'lattice', label: 'Lattice', field: latticeField, maxInk: 0.62, grain: 1.0 },
]

/** Rasterization size of a mark. Deliberately low: the tile is drawn scaled up
    with smoothing, which both blurs the field and gives the grain a chunkier,
    printed feel than per-device-pixel noise would. */
export const TILE_SIZE = 180

/**
 * Rasterize one pattern into an offscreen canvas of TILE_SIZE². The grain is a
 * per-pixel jitter weighted by ink*(1-ink), so flat white and the solid core
 * stay clean and the transitions break up.
 */
export function renderPatternTile(pattern: Pattern): HTMLCanvasElement {
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
      const v = pattern.field(nx, ny)
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
