/**
 * Chladni 2's eight figures, built from one set of rules.
 *
 * Nothing here decides what a sound "looks like" on its own. Two things do:
 *
 *   BODY — what vibrates, taken from the instrument's physics. It is the
 *   silhouette, and it is what tells the five kinds apart at a glance:
 *     membrane  KICK TOM SNARE   fixed edge: the edge is a line of sand
 *     bar       RIM              a short capsule, struck across: stripes
 *     plate     HAT RIDE         free edge: no outline, metal (moiré, bell)
 *     sand      CLAP             no body at all — air and hands
 *     FM        FX               a membrane whose angle is frequency-modulated
 *
 *   CHANNELS — the audio features every drum shares (params.ts), each always
 *   drawn the same way: TUNE is the mode order, TONE a faint higher mode,
 *   NOISE shakes the sand off the lines, DECAY is an afterglow, a pitch
 *   envelope twists, CLICK is a solid centre, DRIVE bleeds, repeats ghost,
 *   SPREAD stretches, VELOCITY scales. The renderer (sand.ts) applies them;
 *   each sound only says which it has and how much.
 */

import type { DrumParams, SoundVoiceId } from '../transport/engine.ts'
import { drumValue, orderSplit } from './params.ts'
import { circleMode, overtone, radialPart, barMode, type Edge } from './modes.ts'
import type { Copy, Field, Figure, Lines, Outline } from './sand.ts'

export type BodyKind = 'membrane' | 'bar' | 'plate' | 'sand' | 'fm'

export const BODY_OF: Record<SoundVoiceId, BodyKind> = {
  kick: 'membrane',
  tom: 'membrane',
  snare: 'membrane',
  rim: 'bar',
  clap: 'sand',
  hat: 'plate',
  ride: 'plate',
  fx: 'fm',
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ── Bodies ───────────────────────────────────────────────────────────────

/** The disc, and a little past its edge so the fixed edge's own line is kept. */
const EDGE_KEEP = 1.012
const inDisc = (x: number, y: number) => x * x + y * y <= EDGE_KEEP * EDGE_KEEP
/** Strictly inside: for a second set of lines that must not thicken the edge,
    and for a plate, whose free edge carries no line. */
const inOpen = (x: number, y: number) => x * x + y * y <= 0.965 * 0.965
const outsideDisc: Field = (x, y) => Math.hypot(x, y) - 1

/** Mode (m, n) of a disc as a field, its angular part turned by `phase`. */
function discField(edge: Edge, m: number, n: number, phase = 0): Field {
  const mode = circleMode(edge, m, n)
  if (m === 0) return (x, y) => radialPart(mode, Math.hypot(x, y))
  return (x, y) => radialPart(mode, Math.hypot(x, y)) * Math.cos(m * (Math.atan2(y, x) - phase))
}

/**
 * CHANNEL 1 — a continuous order `p` as the lines of its two neighbouring
 * integer modes, the upper fading in as the lower fades out.
 */
function ordered(
  p: number,
  field: (order: number) => Field,
  inside: (x: number, y: number) => boolean,
  weight = 1,
): Lines[] {
  const { lo, f } = orderSplit(p)
  const lines: Lines[] = [{ psi: field(lo), weight: weight * (1 - f), inside }]
  if (f > 0) lines.push({ psi: field(lo + 1), weight: weight * f, inside })
  return lines
}

/**
 * CHANNEL 2 — TONE as one of the body's own higher overtones, drawn faint.
 * Brighter is literally a higher partial: further up the body's modes in
 * frequency order, and printed more strongly.
 */
function texture(edge: Edge, tone: number): Lines[] {
  const index = 5 + 15 * tone
  const { lo, f } = orderSplit(index)
  const weight = 0.06 + 0.9 * tone
  const at = (i: number): Lines => {
    const { m, n } = overtone(edge, i)
    return { psi: discField(edge, m, n, 0.35), weight: 0, inside: inOpen, faint: true }
  }
  const lines = [{ ...at(lo), weight: weight * (1 - f) }]
  if (f > 0) lines.push({ ...at(lo + 1), weight: weight * f })
  return lines
}

/** Defaults every figure starts from: no channel engaged. */
const BASE: Omit<Figure, 'reach' | 'lines' | 'outside'> = {
  noise: 0,
  halo: 0,
  haloReach: 0.9,
  twist: 0,
  drive: 0,
  spread: 0,
  grain: 1,
  size: 1,
}

// ── The eight ────────────────────────────────────────────────────────────

type Knob = (key: string) => number

// KICK — the beater strikes dead centre, which excites only the axisymmetric
// modes (0, n): rings and nothing else. At rest a clean (0,1) — the head's
// edge — with the beater's mark in the middle.
function kick(v: Knob): Figure {
  return {
    ...BASE,
    reach: 1.08,
    lines: ordered(1 + 2 * v('tune'), (n) => discField('fixed', 0, n), inDisc),
    outside: outsideDisc,
    body: { psi: discField('fixed', 0, 1), inside: inDisc },
    halo: v('decay'),
    twist: v('sweep'),
    impact: { radius: 0.035 + 0.12 * v('click'), sharp: 0.3 + 0.7 * v('click') },
    drive: v('drive'),
    size: 0.92,
  }
}

// TOM — the stick lands off centre, so the angular modes (m, 1) ring: one
// diameter, then a cross, then three as it tunes up.
function tom(v: Knob): Figure {
  return {
    ...BASE,
    reach: 1.08,
    lines: [
      ...ordered(1 + 2 * v('tune'), (m) => discField('fixed', m, 1, Math.PI / 2), inDisc),
      ...texture('fixed', v('tone')),
    ],
    outside: outsideDisc,
    body: { psi: discField('fixed', 2, 1, Math.PI / 2), inside: inDisc },
    halo: v('decay'),
    twist: v('bend'),
    size: 0.82,
  }
}

// SNARE — the 909 snare's two pitched oscillators are two modes at once: an
// axisymmetric ring and an angular cross, (0,2) + (2,1) at its classic tune.
// SNAPPY is the wires: the sand comes off the lines; the FILTER type says
// where it lands — LP in the middle, BP in a ring, HP out at the edge.
const SNARE_BANDS: ((r: number) => number)[] = [
  (r) => Math.exp(-((r / 0.42) ** 2)),
  (r) => Math.exp(-(((r - 0.56) / 0.2) ** 2)),
  (r) => smoothstep(0.5, 0.92, r) * (1 - smoothstep(1.05, 1.3, r)),
]

function snare(v: Knob): Figure {
  const p = 1 + 2 * v('tune')
  return {
    ...BASE,
    reach: 1.12,
    lines: [
      ...ordered(p, (n) => discField('fixed', 0, n), inDisc),
      // The second oscillator's lines; the edge is already the first's.
      ...ordered(p, (m) => discField('fixed', m, 1, Math.PI / 4), inOpen),
      ...texture('fixed', v('tone')),
    ],
    outside: outsideDisc,
    body: { psi: discField('fixed', 0, 2), inside: inDisc },
    noise: 0.8 * v('snappy'),
    noiseBand: SNARE_BANDS[v('filter')],
    halo: v('decay'),
    size: 0.86,
  }
}

// RIM — wood: a short free-free bar. The sand lies across it on the bar's own
// nodes (0.224 / 0.776, then 0.132 / 0.5 / 0.868, then 0.094 / 0.356 / 0.644 /
// 0.906 of its length), and its outline is the silhouette. Almost no decay.
const BAR_HALF = 0.62 // half the straight part
const BAR_RADIUS = 0.24 // the rounded ends' radius
const BAR_LENGTH = 2 * (BAR_HALF + BAR_RADIUS)

/** Signed distance to the capsule's edge, positive outside. */
const barOutside: Field = (x, y) => {
  const cx = Math.max(-BAR_HALF, Math.min(BAR_HALF, x))
  return Math.hypot(x - cx, y) - BAR_RADIUS
}
const inBar = (x: number, y: number) => barOutside(x, y) <= -0.012

const barOutline: Outline = (() => {
  const straight = 2 * BAR_HALF
  const arc = Math.PI * BAR_RADIUS
  const length = 2 * straight + 2 * arc
  return {
    length,
    weight: 0.55,
    at: (t: number) => {
      let s = t * length
      if (s < straight) return { x: -BAR_HALF + s, y: -BAR_RADIUS, nx: 0, ny: -1 }
      s -= straight
      if (s < arc) {
        const a = -Math.PI / 2 + s / BAR_RADIUS
        return { x: BAR_HALF + Math.cos(a) * BAR_RADIUS, y: Math.sin(a) * BAR_RADIUS, nx: Math.cos(a), ny: Math.sin(a) }
      }
      s -= arc
      if (s < straight) return { x: BAR_HALF - s, y: BAR_RADIUS, nx: 0, ny: 1 }
      s -= straight
      const a = Math.PI / 2 + s / BAR_RADIUS
      return { x: -BAR_HALF + Math.cos(a) * BAR_RADIUS, y: Math.sin(a) * BAR_RADIUS, nx: Math.cos(a), ny: Math.sin(a) }
    },
  }
})()

function rim(v: Knob): Figure {
  const along = (x: number) => (x + BAR_HALF + BAR_RADIUS) / BAR_LENGTH
  return {
    ...BASE,
    reach: BAR_HALF + BAR_RADIUS + 0.04,
    lines: ordered(1 + 2 * v('tune'), (k) => (x) => barMode(k, along(x)), inBar),
    outline: barOutline,
    outside: barOutside,
    body: { psi: (x) => barMode(1, along(x)), inside: inBar },
    halo: 0.18 * v('decay'),
    haloReach: 0.6,
    size: 0.76,
  }
}

// CLAP — no body: nothing rings, so there are no modes. Only sand — the air
// between the hands — as a ring poured once per burst. SLOPPY spreads the
// bursts apart, TAIL is noise and a dust of afterglow, TONE the grain: fine
// when bright, coarse when dark. SPREAD pulls it wide.
const CLAP_RADIUS = 0.62
const CLAP_BURSTS = 4

function clap(v: Knob): Figure {
  const sloppy = v('sloppy')
  const tail = v('tail')
  // Each burst a little later, a little off: the hands are never one hand.
  const copies: Copy[] = Array.from({ length: CLAP_BURSTS }, (_, k) => ({
    dx: sloppy * 0.4 * (k - (CLAP_BURSTS - 1) / 2),
    dy: sloppy * 0.16 * Math.sin(2.3 * k + 0.6),
    rot: 0,
    scale: 1 + sloppy * 0.1 * Math.cos(1.7 * k + 0.4),
    weight: 0.45,
  }))
  const reachX = CLAP_RADIUS + sloppy * 0.65
  return {
    ...BASE,
    reach: CLAP_RADIUS + 0.1,
    lines: [{ psi: (x, y) => Math.hypot(x, y) - CLAP_RADIUS, weight: 1, inside: () => true }],
    copies,
    outside: (x, y) => Math.hypot(x / reachX, y / CLAP_RADIUS) * CLAP_RADIUS - CLAP_RADIUS - 0.03,
    noise: 0.08 + 0.3 * tail,
    halo: tail,
    haloReach: 1.1,
    spread: v('spread'),
    grain: lerp(2.1, 0.75, v('tone')),
    size: 0.85,
  }
}

// HAT — two cymbals, so two copies of one plate's pattern turned against each
// other: the moiré is literal. CLOSED holds them together (a sliver of turn,
// small, no afterglow); opening them lets each ring on its own — the turn
// widens, the moiré opens, the figure grows and glows.
//
// A plate's free edge carries no sand and no outline (see modes.ts on the
// approximation). Its pattern is two modes together, as struck metal is.
function plateField(m: number, n: number, partner: number): Field {
  const a = discField('free', m, n)
  const b = discField('free', m + partner, 1, 0.45)
  return (x, y) => a(x, y) + 0.7 * b(x, y)
}

function hat(v: Knob): Figure {
  const open = v('decay')
  const turn = lerp(0.05, 0.4, open)
  const pair: Copy[] = [-1, 1].map((side) => ({
    dx: 0,
    dy: 0,
    rot: (side * turn) / 2,
    scale: 1,
    weight: 0.8,
  }))
  return {
    ...BASE,
    reach: 1.02,
    lines: [
      ...ordered(2 + 4 * v('tune'), (m) => plateField(m, 2, 3), inOpen),
      ...texture('free', v('tone')),
    ],
    copies: pair,
    outside: outsideDisc,
    body: { psi: plateField(4, 2, 3), inside: inOpen },
    halo: smoothstep(0.2, 1, open),
    size: lerp(0.62, 0.95, open),
  }
}

// RIDE — one big plate: a dense metal pattern with no outline, and the bell
// at its centre as a solid disc (BELL sets its size). It rings longest of all.
function ride(v: Knob): Figure {
  return {
    ...BASE,
    reach: 1.02,
    lines: [
      ...ordered(2 + 4 * v('tune'), (m) => plateField(m, 3, 2), inOpen),
      ...texture('free', v('tone')),
    ],
    outside: outsideDisc,
    body: { psi: plateField(4, 3, 2), inside: inOpen },
    bell: 0.05 + 0.24 * v('bell'),
    halo: v('decay'),
    haloReach: 1.05,
    size: 1.06,
  }
}

// FX — FM, literally: the angle of a membrane mode is itself modulated,
//   ψ = J_m(j_m1·r) · cos(mθ + I·sin(kθ)),
// so the spokes bunch and spread exactly as an FM spectrum's sidebands do.
// AMNT is the index I, MOD the ratio k, FEEDBACK the noise.
function fmField(m: number, index: number, ratio: number): Field {
  const mode = circleMode('fixed', m, 1)
  return (x, y) => {
    const theta = Math.atan2(y, x)
    return radialPart(mode, Math.hypot(x, y)) * Math.cos(m * theta + index * Math.sin(ratio * theta))
  }
}

function fx(v: Knob): Figure {
  const index = 3 * v('amnt')
  const ratio = v('mod') + 1
  return {
    ...BASE,
    reach: 1.08,
    lines: ordered(1 + 4 * v('pitch'), (m) => fmField(m, index, ratio), inDisc),
    outside: outsideDisc,
    body: { psi: fmField(3, index, ratio), inside: inDisc },
    noise: 0.8 * v('feedback'),
    halo: v('decay'),
    size: 0.86,
  }
}

const BUILD: Record<SoundVoiceId, (v: Knob) => Figure> = {
  kick,
  tom,
  snare,
  rim,
  clap,
  hat,
  ride,
  fx,
}

/** The figure of sound `id` at knobs `params`. */
export function figureOf(id: SoundVoiceId, params: DrumParams | undefined): Figure {
  return BUILD[id]((key) => drumValue(id, key, params))
}

/** How much larger a sound's mark is drawn on the ring than on its pad —
    only RIM, which would otherwise be lost among the others. */
export const RING_SCALE: Partial<Record<SoundVoiceId, number>> = { rim: 1.6 }
