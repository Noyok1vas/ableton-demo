/**
 * The Chladni Editor's figure: not a sound's figure, but every control the
 * Chladni 2 renderer has, laid open, so a figure can be found by hand and then
 * given to a sound.
 *
 * A shape is a flat record of numbers, one per control below, each in its
 * own units. `buildShape` turns it into the same Figure the Chladni 2 pages
 * draw (chladni2/sand.ts) — same bodies, same modes, same sand — with the
 * renderer's own constants overridden from here too.
 */

import { circleMode, barMode, overtone, radialPart, type Edge } from '../chladni2/modes.ts'
import { orderSplit } from '../chladni2/params.ts'
import { Kind, type Copy, type Field, type Figure, type Lines, type Outline } from '../chladni2/sand.ts'

export type ShapeParams = Record<string, number>

export type ShapeControl = {
  id: string
  label: string
  min: number
  max: number
  step: number
  initial: number
  /** A discrete choice: the value is the index into these labels. */
  steps?: readonly string[]
  /** Printed after the value. */
  unit?: string
}

export type ShapeGroup = { title: string; note?: string; controls: readonly ShapeControl[] }

const slider = (
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  unit?: string,
): ShapeControl => ({ id, label, min, max, step, initial, unit })

const choice = (id: string, label: string, steps: readonly string[], initial = 0): ShapeControl => ({
  id,
  label,
  min: 0,
  max: steps.length - 1,
  step: 1,
  initial,
  steps,
})

export const BODIES = ['MEMBRANE', 'PLATE', 'BAR', 'SAND RING'] as const
const BAND_STEPS = ['ALL', 'CENTRE', 'MIDDLE', 'EDGE'] as const

/** Every control, in the order the panel shows them. */
export const SHAPE_GROUPS: readonly ShapeGroup[] = [
  {
    title: 'BODY',
    note: 'Membrane: fixed edge (the edge is a line). Plate: free edge (no line). Bar: free-free beam. Sand ring: no body.',
    controls: [
      choice('body', 'BODY', BODIES),
      slider('size', 'SIZE', 0.3, 1.4, 0.01, 0.9),
      slider('outline', 'OUTLINE', 0, 1, 0.01, 0),
      slider('barLength', 'BAR LENGTH', 0.8, 2.4, 0.01, 1.72),
      slider('barWidth', 'BAR WIDTH', 0.12, 0.8, 0.01, 0.48),
      slider('ringRadius', 'RING RADIUS', 0.2, 1, 0.01, 0.62),
    ],
  },
  {
    title: 'MODE A — PITCH',
    note: 'Between whole orders the two neighbouring modes cross-fade. BAR MODE is used by the bar only.',
    controls: [
      slider('m', 'ANGULAR m', 0, 10, 0.01, 2),
      slider('n', 'RADIAL n', 1, 3, 0.01, 1),
      slider('angle', 'ANGLE', 0, 180, 1, 0, '°'),
      slider('barK', 'BAR MODE', 1, 5, 0.01, 2),
      slider('fmIndex', 'FM INDEX I', 0, 4, 0.01, 0),
      choice('fmRatio', 'FM RATIO k', ['1', '2', '3', '4', '5', '6'], 1),
    ],
  },
  {
    title: 'MODE B — SECOND MODE',
    note: 'Membrane and plate only. UNION draws both sets of lines; SUM adds the fields into one web.',
    controls: [
      slider('mixB', 'MIX', 0, 1, 0.01, 0),
      slider('mB', 'ANGULAR m', 0, 10, 0.01, 4),
      slider('nB', 'RADIAL n', 1, 3, 0.01, 1),
      slider('angleB', 'ANGLE', 0, 180, 1, 30, '°'),
      choice('combine', 'COMBINE', ['UNION', 'SUM']),
    ],
  },
  {
    title: 'TEXTURE — TONE',
    note: 'One of the body’s own overtones, in frequency order, drawn faint.',
    controls: [
      slider('texAmount', 'AMOUNT', 0, 1, 0.01, 0),
      slider('texIndex', 'OVERTONE #', 0, 30, 0.01, 10),
      slider('faintShare', 'FAINT DENSITY', 0, 1, 0.01, 0.5),
    ],
  },
  {
    title: 'SAND — NOISE',
    controls: [
      slider('noise', 'NOISE', 0, 1, 0.01, 0),
      choice('noiseBand', 'LANDS', BAND_STEPS),
      slider('shakeMin', 'SHAKE MIN', 0, 0.3, 0.005, 0.05),
      slider('shakeMax', 'SHAKE MAX', 0, 1, 0.01, 0.4),
      slider('lineGrains', 'GRAINS / PX', 0.2, 4, 0.05, 1.5),
      slider('lineSigma', 'LINE WIDTH', 0.2, 4, 0.05, 0.75, 'px'),
      slider('grain', 'GRAIN SIZE', 0.4, 3, 0.05, 1),
      slider('cellPx', 'TRACE CELL', 1.2, 6, 0.1, 2.4, 'px'),
    ],
  },
  {
    title: 'DECAY — AFTERGLOW',
    controls: [
      slider('halo', 'AFTERGLOW', 0, 1, 0.01, 0),
      slider('haloReach', 'REACH', 0.2, 2, 0.01, 0.9),
      slider('haloDensity', 'DENSITY', 0.01, 0.2, 0.005, 0.05),
    ],
  },
  {
    title: 'PITCH ENV — TWIST',
    controls: [
      slider('spiralDrop', 'SPIRAL', 0, 0.8, 0.01, 0),
      slider('vortexTurn', 'VORTEX', 0, 6, 0.05, 0, 'rad'),
    ],
  },
  {
    title: 'CENTRE — CLICK / BELL',
    controls: [
      slider('impact', 'CLICK RADIUS', 0, 0.4, 0.005, 0),
      slider('impactSharp', 'CLICK SHARPNESS', 0, 1, 0.01, 0.7),
      slider('bell', 'BELL RADIUS', 0, 0.5, 0.005, 0),
      slider('solidDensity', 'SOLID DENSITY', 0.2, 1.5, 0.05, 0.85),
    ],
  },
  {
    title: 'DRIVE · SPREAD',
    controls: [
      slider('drive', 'DRIVE', 0, 1, 0.01, 0),
      slider('stretch', 'STRETCH X', 0, 1.5, 0.01, 0),
    ],
  },
  {
    title: 'COPIES — REPEATS',
    note: 'The lines poured again per copy, spread evenly either side of the centre.',
    controls: [
      choice('copies', 'COPIES', ['1', '2', '3', '4', '5', '6']),
      slider('copyDx', 'OFFSET X', -0.6, 0.6, 0.01, 0.2),
      slider('copyDy', 'OFFSET Y', -0.6, 0.6, 0.01, 0),
      slider('copyRot', 'TURN', -45, 45, 0.5, 0, '°'),
      slider('copyScale', 'SCALE STEP', -0.25, 0.25, 0.005, 0),
      slider('copyWeight', 'EACH COPY', 0.1, 1, 0.01, 0.6),
    ],
  },
  {
    title: 'INK',
    controls: [
      slider('fillDensity', '|ψ|² FILL', 0, 0.5, 0.01, 0),
      slider('alphaLine', 'LINES', 0, 1, 0.01, 0.9),
      slider('alphaFaint', 'TEXTURE', 0, 1, 0.01, 0.42),
      slider('alphaHalo', 'AFTERGLOW', 0, 1, 0.01, 0.4),
      slider('alphaSolid', 'SOLID', 0, 1, 0.01, 0.95),
      slider('alphaFill', 'FILL', 0, 1, 0.01, 0.2),
    ],
  },
]

const CONTROLS = SHAPE_GROUPS.flatMap((g) => g.controls)
const CONTROL_BY_ID = new Map(CONTROLS.map((c) => [c.id, c]))

export const DEFAULT_SHAPE: ShapeParams = Object.fromEntries(CONTROLS.map((c) => [c.id, c.initial]))

/** A shape with every control present and in range — for anything read back
    from storage. */
export function completeShape(raw: unknown): ShapeParams {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(
    CONTROLS.map((c) => {
      const v = src[c.id]
      const n = typeof v === 'number' && Number.isFinite(v) ? v : c.initial
      return [c.id, clampTo(c, n)]
    }),
  )
}

/** A value snapped to a control's step and range. */
export function clampTo(c: ShapeControl, v: number): number {
  const snapped = c.min + Math.round((v - c.min) / c.step) * c.step
  return Math.min(c.max, Math.max(c.min, Number(snapped.toFixed(6))))
}

export const controlOf = (id: string) => CONTROL_BY_ID.get(id)

/** Every control at a random place in its range — a starting point to
    search from. The ink and the renderer's own constants are left alone:
    a random grain size is noise, not a figure. */
const RANDOM_GROUPS = new Set(['BODY', 'MODE A — PITCH', 'MODE B — SECOND MODE', 'TEXTURE — TONE'])
export function randomShape(from: ShapeParams): ShapeParams {
  const next = { ...from }
  for (const group of SHAPE_GROUPS) {
    if (!RANDOM_GROUPS.has(group.title)) continue
    for (const c of group.controls) {
      if (c.id === 'size' || c.id === 'outline') continue
      next[c.id] = clampTo(c, c.min + Math.random() * (c.max - c.min))
    }
  }
  // Mostly whole orders: a cross-fade is a passage, not a place to land.
  for (const id of ['m', 'n', 'mB', 'nB', 'barK']) {
    if (Math.random() < 0.8) next[id] = Math.round(next[id])
  }
  return next
}

// ── Shape → Figure ───────────────────────────────────────────────────────

const DEG = Math.PI / 180

/** A disc mode with its angle optionally frequency-modulated:
    ψ = J_m(k_mn·r) · cos(m(θ − θ0) + I·sin(kθ)). */
function discField(edge: Edge, m: number, n: number, phase: number, index: number, ratio: number): Field {
  const mode = circleMode(edge, m, n)
  if (m === 0 && index === 0) return (x, y) => radialPart(mode, Math.hypot(x, y))
  return (x, y) => {
    const theta = Math.atan2(y, x)
    return radialPart(mode, Math.hypot(x, y)) * Math.cos(m * (theta - phase) + index * Math.sin(ratio * theta))
  }
}

/** Continuous (m, n) as up to four integer modes, cross-faded in both. */
function crossfaded(
  m: number,
  n: number,
  make: (m: number, n: number) => Field,
  inside: (x: number, y: number) => boolean,
  weight: number,
  faint = false,
): Lines[] {
  const a = orderSplit(m)
  const b = orderSplit(n)
  const corners: [number, number, number][] = [
    [a.lo, b.lo, (1 - a.f) * (1 - b.f)],
    [a.lo + 1, b.lo, a.f * (1 - b.f)],
    [a.lo, b.lo + 1, (1 - a.f) * b.f],
    [a.lo + 1, b.lo + 1, a.f * b.f],
  ]
  return corners
    .filter(([, , w]) => w > 0.001)
    .map(([mi, ni, w]) => ({
      psi: make(Math.min(10, mi), Math.min(3, Math.max(1, ni))),
      weight: weight * w,
      inside,
      faint,
    }))
}

const circleOutline = (radius: number, weight: number): Outline => ({
  length: 2 * Math.PI * radius,
  weight,
  at: (t) => {
    const a = t * 2 * Math.PI
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, nx: Math.cos(a), ny: Math.sin(a) }
  },
})

function capsuleOutline(half: number, radius: number, weight: number): Outline {
  const straight = 2 * half
  const arc = Math.PI * radius
  const length = 2 * straight + 2 * arc
  return {
    length,
    weight,
    at: (t) => {
      let s = t * length
      if (s < straight) return { x: -half + s, y: -radius, nx: 0, ny: -1 }
      s -= straight
      if (s < arc) {
        const a = -Math.PI / 2 + s / radius
        return { x: half + Math.cos(a) * radius, y: Math.sin(a) * radius, nx: Math.cos(a), ny: Math.sin(a) }
      }
      s -= arc
      if (s < straight) return { x: half - s, y: radius, nx: 0, ny: 1 }
      s -= straight
      const a = Math.PI / 2 + s / radius
      return { x: -half + Math.cos(a) * radius, y: Math.sin(a) * radius, nx: Math.cos(a), ny: Math.sin(a) }
    },
  }
}

const BANDS: (((r: number) => number) | undefined)[] = [
  undefined,
  (r) => Math.exp(-((r / 0.42) ** 2)),
  (r) => Math.exp(-(((r - 0.56) / 0.2) ** 2)),
  (r) => Math.min(1, Math.max(0, (r - 0.5) / 0.42)),
]

/** The shape as a Figure for the Chladni 2 renderer. */
export function buildShape(p: ShapeParams): Figure {
  const body = BODIES[p.body] ?? 'MEMBRANE'
  const fmRatio = p.fmRatio + 1
  let reach = 1.08
  let lines: Lines[] = []
  let outline: Outline | undefined
  let outside: Field = (x, y) => Math.hypot(x, y) - 1
  let fill: Figure['body']

  if (body === 'MEMBRANE' || body === 'PLATE') {
    const edge: Edge = body === 'MEMBRANE' ? 'fixed' : 'free'
    // A membrane keeps its fixed edge's line; a plate's free edge has none.
    const keep = body === 'MEMBRANE' ? 1.012 : 0.965
    const inBody = (x: number, y: number) => x * x + y * y <= keep * keep
    const inOpen = (x: number, y: number) => x * x + y * y <= 0.965 * 0.965
    const fieldA = (m: number, n: number) => discField(edge, m, n, p.angle * DEG, p.fmIndex, fmRatio)
    const fieldB = (m: number, n: number) => discField(edge, m, n, p.angleB * DEG, 0, 1)
    if (p.combine === 1 && p.mixB > 0) {
      const a = fieldA(Math.round(p.m), Math.round(p.n))
      const b = fieldB(Math.round(p.mB), Math.round(p.nB))
      lines.push({ psi: (x, y) => a(x, y) + p.mixB * b(x, y), weight: 1, inside: inBody })
    } else {
      lines = crossfaded(p.m, p.n, fieldA, inBody, 1)
      if (p.mixB > 0) lines.push(...crossfaded(p.mB, p.nB, fieldB, inOpen, p.mixB))
    }
    if (p.texAmount > 0) {
      const { lo, f } = orderSplit(p.texIndex)
      const tex = (i: number) => {
        const o = overtone(edge, i)
        return discField(edge, o.m, o.n, 0.35, 0, 1)
      }
      lines.push({ psi: tex(lo), weight: p.texAmount * (1 - f), inside: inOpen, faint: true })
      if (f > 0) lines.push({ psi: tex(lo + 1), weight: p.texAmount * f, inside: inOpen, faint: true })
    }
    if (p.outline > 0) outline = circleOutline(1, p.outline)
    fill = { psi: fieldA(Math.round(p.m), Math.round(p.n)), inside: inBody }
  } else if (body === 'BAR') {
    const radius = p.barWidth / 2
    const half = Math.max(0.01, p.barLength / 2 - radius)
    const along = (x: number) => (x + half + radius) / (2 * (half + radius))
    const barOutside: Field = (x, y) => Math.hypot(x - Math.max(-half, Math.min(half, x)), y) - radius
    const inBar = (x: number, y: number) => barOutside(x, y) <= -0.012
    const { lo, f } = orderSplit(p.barK)
    lines.push({ psi: (x) => barMode(lo, along(x)), weight: 1 - f, inside: inBar })
    if (f > 0) lines.push({ psi: (x) => barMode(lo + 1, along(x)), weight: f, inside: inBar })
    outline = capsuleOutline(half, radius, p.outline)
    outside = barOutside
    reach = half + radius + 0.05
    fill = { psi: (x) => barMode(Math.round(p.barK), along(x)), inside: inBar }
  } else {
    const r0 = p.ringRadius
    lines.push({ psi: (x, y) => Math.hypot(x, y) - r0, weight: 1, inside: () => true })
    outside = (x, y) => Math.hypot(x, y) - r0 - 0.03
    reach = r0 + 0.1
  }

  const n = p.copies + 1
  const copies: Copy[] | undefined =
    n > 1
      ? Array.from({ length: n }, (_, k) => {
          const c = k - (n - 1) / 2
          return {
            dx: c * p.copyDx,
            dy: c * p.copyDy,
            rot: c * p.copyRot * DEG,
            scale: 1 + c * p.copyScale,
            weight: p.copyWeight,
          }
        })
      : undefined
  // The copies can reach past the body: look for lines that far out too.
  if (copies) reach += Math.max(...copies.map((c) => Math.hypot(c.dx, c.dy)))

  return {
    reach,
    lines,
    outline,
    copies,
    outside,
    body: fill,
    noise: p.noise,
    noiseBand: BANDS[p.noiseBand],
    halo: p.halo,
    haloReach: p.haloReach,
    twist: p.spiralDrop > 0 || p.vortexTurn > 0 ? 1 : 0,
    impact: p.impact > 0 ? { radius: p.impact, sharp: p.impactSharp } : undefined,
    bell: p.bell > 0 ? p.bell : undefined,
    drive: p.drive,
    spread: p.stretch > 0 ? 1 : 0,
    grain: p.grain,
    size: p.size,
    tuning: {
      lineGrains: p.lineGrains,
      lineSigma: p.lineSigma,
      faintShare: p.faintShare,
      shakeMin: p.shakeMin,
      shakeMax: p.shakeMax,
      haloDensity: p.haloDensity,
      solidDensity: p.solidDensity,
      fillDensity: Math.max(0.001, p.fillDensity),
      spiralDrop: p.spiralDrop,
      vortexTurn: p.vortexTurn,
      spreadStretch: p.stretch,
      cellPx: p.cellPx,
    },
  }
}

/** Whether the shape lays the |ψ|² fill at all. */
export const shapeFills = (p: ShapeParams) => p.fillDensity > 0

/** The INK group's print strengths, per kind of grain. */
export const shapeAlpha = (p: ShapeParams): Partial<Record<Kind, number>> => ({
  [Kind.Line]: p.alphaLine,
  [Kind.Faint]: p.alphaFaint,
  [Kind.Halo]: p.alphaHalo,
  [Kind.Solid]: p.alphaSolid,
  [Kind.Fill]: p.alphaFill,
})
