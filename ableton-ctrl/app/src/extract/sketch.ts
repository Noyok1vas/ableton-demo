/**
 * Hand-drawn strokes for the extract window: lines, boxes, loops and hatching
 * that look drawn with a pen rather than set by a layout engine — the same
 * hand as the Selector's marks, in outline.
 *
 * Every stroke is drawn from a seed, so a box keeps the same wobble from one
 * render to the next instead of shimmering, and two boxes side by side never
 * wobble alike. All functions return SVG path data.
 */

/** A small, fast, seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seed from a string, so a stroke can be named rather than numbered. */
export function seedOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const f = (n: number) => n.toFixed(1)

/**
 * One pen line from (x1,y1) to (x2,y2): a single bowed curve that starts a
 * little before its point and runs a little past the other, the way a quick
 * ruled line does. `rough` is how far it strays, in px.
 */
export function line(x1: number, y1: number, x2: number, y2: number, rand: () => number, rough = 1.2): string {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  const nx = -uy
  const ny = ux
  const stray = Math.min(rough, len * 0.04 + 0.4)
  const j = () => (rand() - 0.5) * 2 * stray
  const over = () => (rand() - 0.3) * Math.min(3, len * 0.04)
  const sx = x1 - ux * over() + nx * j()
  const sy = y1 - uy * over() + ny * j()
  const ex = x2 + ux * over() + nx * j()
  const ey = y2 + uy * over() + ny * j()
  // The bow: a control point off the middle, a touch past halfway.
  const t = 0.45 + rand() * 0.15
  const bow = (rand() - 0.5) * 2 * stray * 1.6
  const cx = x1 + (x2 - x1) * t + nx * bow
  const cy = y1 + (y2 - y1) * t + ny * bow
  return `M${f(sx)} ${f(sy)}Q${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`
}

/** A line drawn twice, the second pass never quite on the first. */
export function line2(x1: number, y1: number, x2: number, y2: number, seed: number, rough = 1.2): string {
  const rand = seeded(seed)
  return line(x1, y1, x2, y2, rand, rough) + line(x1, y1, x2, y2, rand, rough * 0.8)
}

/** A box: four double-pass lines whose corners cross. */
export function box(x: number, y: number, w: number, h: number, seed: number, rough = 1.4): string {
  const rand = seeded(seed)
  const one = (x1: number, y1: number, x2: number, y2: number) =>
    line(x1, y1, x2, y2, rand, rough) + line(x1, y1, x2, y2, rand, rough * 0.7)
  return one(x, y, x + w, y) + one(x + w, y, x + w, y + h) + one(x + w, y + h, x, y + h) + one(x, y + h, x, y)
}

/**
 * A loop around (cx,cy): a wobbling ellipse that starts somewhere on its
 * rim and overshoots its own start, like a circle drawn in one go.
 */
export function loop(cx: number, cy: number, rx: number, ry: number, seed: number, rough = 0.12): string {
  const rand = seeded(seed)
  const start = rand() * Math.PI * 2
  const sweep = Math.PI * 2 + 0.35 + rand() * 0.4
  const steps = 18
  const wobble = Array.from({ length: 4 }, () => (rand() - 0.5) * 2 * rough)
  const phase = Array.from({ length: 4 }, () => rand() * Math.PI * 2)
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const a = start + (sweep * i) / steps
    // A slow drift in radius, so the loop is lopsided rather than noisy.
    const k = 1 + wobble[0] * Math.sin(a + phase[0]) + wobble[1] * Math.sin(2 * a + phase[1]) * 0.5
    const x = cx + Math.cos(a) * rx * k
    const y = cy + Math.sin(a) * ry * k
    d += i === 0 ? `M${f(x)} ${f(y)}` : `L${f(x)} ${f(y)}`
  }
  return d
}

/** A dense scribble filling a circle — an inked dot, not a flat disc. */
export function blot(cx: number, cy: number, r: number, seed: number): string {
  const rand = seeded(seed)
  // More turns for a bigger dot, so it fills rather than coils.
  const turns = Math.max(3.2, r / 2.4) + rand()
  const steps = Math.max(14, Math.round(turns * 9))
  const start = rand() * Math.PI * 2
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const a = start + u * turns * Math.PI * 2
    // An inward spiral, roughened: the pen goes round and fills as it goes.
    const rr = r * (1 - 0.82 * u) * (0.9 + rand() * 0.2)
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    d += i === 0 ? `M${f(x)} ${f(y)}` : `L${f(x)} ${f(y)}`
  }
  return d
}

/** Diagonal hatching across a box, each stroke its own pen line. */
export function hatch(x: number, y: number, w: number, h: number, gap: number, seed: number): string {
  const rand = seeded(seed)
  let d = ''
  // Lines at 45°: x - y = c, for c across the box.
  for (let c = -h; c < w; c += gap) {
    const x1 = x + Math.max(c, 0)
    const y1 = y + Math.max(-c, 0)
    const run = Math.min(w - Math.max(c, 0), h - Math.max(-c, 0))
    if (run <= 2) continue
    d += line(x1, y1, x1 + run, y1 + run, rand, 0.8)
  }
  return d
}

/**
 * A waveform as one pen scribble: the line runs left to right, swinging up
 * to each bucket's peak and down to its trough, so the shape of the song is
 * drawn rather than filled.
 */
export function scribble(peaks: ArrayLike<number>, x: number, y: number, w: number, h: number, seed: number): string {
  const rand = seeded(seed)
  const mid = y + h / 2
  const n = peaks.length
  if (n === 0) return ''
  let d = `M${f(x)} ${f(mid)}`
  for (let i = 0; i < n; i++) {
    const px = x + ((i + 0.5) / n) * w
    const a = Math.max(0.02, peaks[i]) * (h / 2) * (0.92 + rand() * 0.08)
    const up = i % 2 === 0
    d += `L${f(px + (rand() - 0.5) * 0.6)} ${f(mid + (up ? -a : a))}`
  }
  return d
}
