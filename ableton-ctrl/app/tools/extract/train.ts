/**
 * Train the drum classifier (src/extract/model.ts) on synthesized drum
 * performances: real one-shots arranged into random patterns at random
 * tempos, under drum-free loops and rhythmic bass/stab parts, run through the
 * app's own listen(). Each detected onset is labelled with the drums placed
 * within 30 ms of it; onsets nothing was placed at are negatives.
 *
 *   node train.ts                       train and report
 *   node train.ts write ../../src/extract/modelWeights.ts
 *
 * Env: DATA (default ./data, from prepare.sh), NTRAIN / NTEST (clips),
 * HIDDEN, EPOCHS, SEED, REGEN=1 to rebuild the cached dataset.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listen, ONSET_LAG_S, FEATURE_SIZE } from '../../src/extract/listen.ts'
import { OUTPUTS } from '../../src/extract/model.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SP = (process.env.DATA ?? join(HERE, 'data')) + '/'
const sr = 22050
type Out = (typeof OUTPUTS)[number]

function readWav(path: string): Float32Array {
  const buf = readFileSync(path)
  let p = 12
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'data') {
      const n = Math.floor(size / 2)
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(p + 8 + i * 2) / 32768
      return out
    }
    p += 8 + size + (size % 2)
  }
  throw new Error('no data ' + path)
}

let seed = Number(process.env.SEED ?? 11)
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
const between = (a: number, b: number) => a + rand() * (b - a)

function classOf(name: string): Out | null {
  const open = /(open|[^a-z]op[^a-z]|[^a-z]op$|oh[^a-z]|opn)/i.test(name.replace(/_/g, ' ') + ' ')
  if (/-Kick-/i.test(name)) return 'kick'
  if (/-(Snare|Clap)-/i.test(name)) return 'snare'
  if (/-(Hat|HiHat)-/i.test(name)) return open ? 'open' : 'hihat'
  if (/-Cymbal-/i.test(name)) return 'cymbal'
  if (/-Tom-|Perc-909_Tom/i.test(name)) return 'tom'
  return null
}

const shots: Record<'train' | 'test', Record<Out, Float32Array[]>> = {
  train: { kick: [], snare: [], hihat: [], open: [], tom: [], cymbal: [] },
  test: { kick: [], snare: [], hihat: [], open: [], tom: [], cymbal: [] },
}
readdirSync(SP + 'shots')
  .filter((f) => f.endsWith('.wav'))
  .forEach((f, i) => {
    const c = classOf(f)
    if (!c) return
    const s = readWav(SP + 'shots/' + f)
    let peak = 0
    for (const v of s) peak = Math.max(peak, Math.abs(v))
    const norm = s.slice(0, Math.min(s.length, sr * 2)).map((v) => v / (peak || 1))
    shots[i % 4 === 0 ? 'test' : 'train'][c].push(norm)
  })
const beds: Record<'train' | 'test', Float32Array[]> = { train: [], test: [] }
readdirSync(SP + 'beds')
  .filter((f) => f.endsWith('.wav'))
  .forEach((f, i) => beds[i % 4 === 0 ? 'test' : 'train'].push(readWav(SP + 'beds/' + f)))
// Pitched one-shots — bass notes, stabs, chords, keys — played rhythmically
// under the drums and labelled as NOT a drum: the commonest false kick in a
// real mix is a bass note, the commonest false snare a stab.
const tonal: Record<'train' | 'test', { bass: Float32Array[]; stab: Float32Array[] }> = {
  train: { bass: [], stab: [] },
  test: { bass: [], stab: [] },
}
readdirSync(SP + 'tonal')
  .filter((f) => f.endsWith('.wav') && !/808|Sub/i.test(f))
  .forEach((f, i) => {
    const s = readWav(SP + 'tonal/' + f)
    let peak = 0
    for (const v of s) peak = Math.max(peak, Math.abs(v))
    const norm = s.slice(0, Math.min(s.length, sr * 2)).map((v) => v / (peak || 1))
    tonal[i % 4 === 0 ? 'test' : 'train'][/-Bass-/i.test(f) ? 'bass' : 'stab'].push(norm)
  })
console.error('tonal', tonal.train.bass.length, tonal.train.stab.length, tonal.test.bass.length, tonal.test.stab.length)
console.error(
  'shots',
  Object.fromEntries(OUTPUTS.map((o) => [o, `${shots.train[o].length}/${shots.test[o].length}`])),
  'beds',
  beds.train.length,
  beds.test.length,
)

type Hit = { t: number; c: Out }
function makeClip(split: 'train' | 'test'): { audio: Float32Array; hits: Hit[] } {
  const S = shots[split]
  const bpm = between(70, 175)
  const dur = between(6, 10)
  const step = 60 / bpm / 4
  const offset = between(0, 1)
  const kit = {
    kick: pick(S.kick),
    snare: pick(S.snare),
    hihat: pick(S.hihat),
    open: pick(S.open),
    tom: [pick(S.tom), pick(S.tom)],
    cymbal: pick(S.cymbal),
  }
  const gain = {
    kick: between(0.5, 1),
    snare: between(0.35, 0.9),
    hihat: between(0.1, 0.6),
    open: between(0.1, 0.6),
    tom: between(0.35, 0.8),
    cymbal: between(0.15, 0.6),
  }
  const fourFloor = rand() < 0.35
  const halfTime = rand() < 0.2
  const hatStyle = pick(['8', '16', 'off', 'none', '8', '16'])
  const ride = rand() < 0.15
  const crash = rand() < 0.35
  const fills = rand() < 0.3
  const humanize = rand() < 0.4 ? 0.008 : 0
  const kickSteps = new Set<number>([0])
  for (let s = 0; s < 32; s++) {
    if (fourFloor && s % 4 === 0) kickSteps.add(s)
    else if (rand() < (s % 2 === 0 ? 0.2 : 0.08)) kickSteps.add(s)
  }
  const out = new Float32Array(Math.round(dur * sr))
  const hits: Hit[] = []
  const put = (c: Out, sample: Float32Array, t: number, g: number) => {
    const at = t + (humanize ? between(-humanize, humanize) : 0)
    const i0 = Math.round(at * sr)
    const v = g * between(0.6, 1)
    for (let i = 0; i < sample.length; i++) {
      const j = i0 + i
      if (j >= 0 && j < out.length) out[j] += sample[i] * v
    }
    if (at >= 0 && at < dur - 0.05) hits.push({ t: at, c })
  }
  for (let abs = -4; offset + abs * step < dur; abs++) {
    const s = ((abs % 32) + 32) % 32
    const t = offset + abs * step
    const inBar = s % 16
    if (kickSteps.has(s)) put('kick', kit.kick, t, gain.kick)
    const backbeat = halfTime ? inBar === 8 : inBar === 4 || inBar === 12
    if ((backbeat && rand() < 0.95) || (!backbeat && rand() < 0.04)) put('snare', kit.snare, t, gain.snare * (backbeat ? 1 : 0.5))
    if (ride) {
      if (s % 2 === 0) put('cymbal', kit.cymbal, t, gain.cymbal)
    } else {
      const hat =
        hatStyle === '16' ? true : hatStyle === '8' ? s % 2 === 0 : hatStyle === 'off' ? s % 4 === 2 : false
      if (hat) {
        if (s % 4 === 2 && rand() < 0.12) put('open', kit.open, t, gain.open)
        else put('hihat', kit.hihat, t, gain.hihat * (s % 2 === 1 ? 0.7 : 1))
      }
    }
    if (crash && s === 0 && rand() < 0.8) put('cymbal', kit.cymbal, t, gain.cymbal * 1.2)
    if (fills && s >= 28 && rand() < 0.6) put('tom', kit.tom[s % 2], t, gain.tom)
  }
  // pitched parts on the grid, gated to their step, unlabelled
  const drumsRms = Math.sqrt(out.reduce((a, v) => a + v * v, 0) / out.length) || 0.1
  for (const [kind, chance, density, level] of [
    ['bass', 0.65, 0.35, [0.6, 2.0]],
    ['stab', 0.45, 0.2, [0.3, 1.5]],
  ] as const) {
    if (rand() > chance) continue
    const note = pick(tonal[split][kind])
    const rms = Math.sqrt(note.slice(0, sr * 0.3).reduce((a, v) => a + v * v, 0) / Math.min(note.length, sr * 0.3)) || 0.1
    const g = (drumsRms / rms) * between(level[0], level[1])
    const steps = new Set<number>()
    for (let s = 0; s < 32; s++) if (rand() < (s % 2 === 1 ? density * 1.3 : density)) steps.add(s)
    const gate = Math.floor(between(1, 4))
    for (let abs = -4; offset + abs * step < dur; abs++) {
      const s = ((abs % 32) + 32) % 32
      if (!steps.has(s)) continue
      const i0 = Math.round((offset + abs * step) * sr)
      const len = Math.min(note.length, Math.round(step * gate * sr))
      const fade = Math.round(0.01 * sr)
      for (let i = 0; i < len; i++) {
        const j = i0 + i
        if (j < 0 || j >= out.length) continue
        const env = i > len - fade ? (len - i) / fade : 1
        out[j] += note[i] * g * env
      }
    }
  }
  // a bed under it, at a random balance
  if (rand() < 0.75) {
    const bed = pick(beds[split])
    let dr = 0
    for (const v of out) dr += v * v
    let br = 0
    for (const v of bed) br += v * v
    const g = Math.sqrt(dr / out.length / (br / bed.length + 1e-12)) * between(0.15, 1.4)
    const start = Math.floor(rand() * bed.length)
    for (let i = 0; i < out.length; i++) out[i] += bed[(start + i) % bed.length] * g
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < out.length; i++) out[i] /= peak || 1
  return { audio: out, hits }
}

type Example = { x: Float32Array; y: Float32Array }
function examples(split: 'train' | 'test', clips: number) {
  const out: Example[] = []
  let truth = 0
  let matched = 0
  for (let n = 0; n < clips; n++) {
    const { audio, hits } = makeClip(split)
    const L = listen({ samples: audio, sampleRate: sr })
    const times = L.onsets.map((f) => f / L.rate + ONSET_LAG_S)
    const ys = L.onsets.map(() => new Float32Array(OUTPUTS.length))
    for (const h of hits) {
      truth++
      let best = -1
      let bestD = 0.03
      times.forEach((t, i) => {
        const d = Math.abs(t - h.t)
        if (d <= bestD) {
          bestD = d
          best = i
        }
      })
      if (best >= 0) {
        matched++
        ys[best][OUTPUTS.indexOf(h.c)] = 1
      }
    }
    L.features.forEach((x, i) => out.push({ x, y: ys[i] }))
  }
  console.error(split, 'onset recall', (matched / truth).toFixed(3), 'examples', out.length)
  return out
}

const CACHE = SP + 'dataset.json'
let train: Example[]
let test: Example[]
if (existsSync(CACHE) && !process.env.REGEN) {
  const raw = JSON.parse(readFileSync(CACHE, 'utf8'))
  const back = (r: { x: number[]; y: number[] }[]) => r.map((e) => ({ x: Float32Array.from(e.x), y: Float32Array.from(e.y) }))
  train = back(raw.train)
  test = back(raw.test)
} else {
  train = examples('train', Number(process.env.NTRAIN ?? 500))
  test = examples('test', Number(process.env.NTEST ?? 120))
  writeFileSync(CACHE, JSON.stringify({ train: train.map((e) => ({ x: [...e.x], y: [...e.y] })), test: test.map((e) => ({ x: [...e.x], y: [...e.y] })) }))
}

// ── MLP ──
const I = FEATURE_SIZE
const H = Number(process.env.HIDDEN ?? 32)
const O = OUTPUTS.length
const mean = new Float64Array(I)
const std = new Float64Array(I)
for (const e of train) for (let i = 0; i < I; i++) mean[i] += e.x[i] / train.length
for (const e of train) for (let i = 0; i < I; i++) std[i] += (e.x[i] - mean[i]) ** 2 / train.length
for (let i = 0; i < I; i++) std[i] = Math.sqrt(std[i]) > 1e-3 ? Math.sqrt(std[i]) : 1
const norm = (x: Float32Array) => Float64Array.from(x, (v, i) => (v - mean[i]) / std[i])
const trainX = train.map((e) => norm(e.x))
const testX = test.map((e) => norm(e.x))

const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
const w1 = Float64Array.from({ length: H * I }, () => gauss() * Math.sqrt(1 / I))
const b1 = new Float64Array(H)
const w2 = Float64Array.from({ length: O * H }, () => gauss() * Math.sqrt(1 / H))
const b2 = new Float64Array(O)
const params = [w1, b1, w2, b2]
const m1 = params.map((p) => new Float64Array(p.length))
const v1 = params.map((p) => new Float64Array(p.length))

// positive weighting per class
const pos = new Float64Array(O)
for (const e of train) for (let o = 0; o < O; o++) pos[o] += e.y[o]
const posW = Float64Array.from(pos, (p) => Math.min(4, Math.sqrt((train.length - p) / Math.max(1, p))))
console.error('positives', [...pos], 'posW', [...posW].map((x) => x.toFixed(2)))

function forward(x: Float64Array) {
  const h = new Float64Array(H)
  for (let j = 0; j < H; j++) {
    let a = b1[j]
    for (let i = 0; i < I; i++) a += w1[j * I + i] * x[i]
    h[j] = Math.tanh(a)
  }
  const y = new Float64Array(O)
  for (let o = 0; o < O; o++) {
    let a = b2[o]
    for (let j = 0; j < H; j++) a += w2[o * H + j] * h[j]
    y[o] = 1 / (1 + Math.exp(-a))
  }
  return { h, y }
}

const lr = 0.003
const epochs = Number(process.env.EPOCHS ?? 60)
const batch = 64
const l2 = 1e-4
let t = 0
const order = trainX.map((_, i) => i)
for (let ep = 0; ep < epochs; ep++) {
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  let loss = 0
  for (let s = 0; s < order.length; s += batch) {
    const grads = params.map((p) => new Float64Array(p.length))
    const idx = order.slice(s, s + batch)
    for (const n of idx) {
      const x = trainX[n]
      const target = train[n].y
      const { h, y } = forward(x)
      const dy = new Float64Array(O)
      for (let o = 0; o < O; o++) {
        const w = target[o] ? posW[o] : 1
        loss += -w * (target[o] ? Math.log(y[o] + 1e-9) : Math.log(1 - y[o] + 1e-9))
        dy[o] = w * (y[o] - target[o])
      }
      const dh = new Float64Array(H)
      for (let o = 0; o < O; o++) {
        grads[3][o] += dy[o]
        for (let j = 0; j < H; j++) {
          grads[2][o * H + j] += dy[o] * h[j]
          dh[j] += dy[o] * w2[o * H + j]
        }
      }
      for (let j = 0; j < H; j++) {
        const da = dh[j] * (1 - h[j] * h[j])
        grads[1][j] += da
        for (let i = 0; i < I; i++) grads[0][j * I + i] += da * x[i]
      }
    }
    t++
    params.forEach((p, k) => {
      const g = grads[k]
      for (let i = 0; i < p.length; i++) {
        const gi = g[i] / idx.length + l2 * p[i]
        m1[k][i] = 0.9 * m1[k][i] + 0.1 * gi
        v1[k][i] = 0.999 * v1[k][i] + 0.001 * gi * gi
        const mh = m1[k][i] / (1 - 0.9 ** t)
        const vh = v1[k][i] / (1 - 0.999 ** t)
        p[i] -= lr * mh / (Math.sqrt(vh) + 1e-8)
      }
    })
  }
  if (ep % 10 === 9 || ep === epochs - 1) console.error('epoch', ep + 1, 'loss', (loss / order.length).toFixed(4))
}

// evaluate + tune thresholds on a split of test (first half tune, second half report)
const preds = testX.map((x) => forward(x).y)
const half = Math.floor(test.length / 2)
const thresholds: number[] = []
for (let o = 0; o < O; o++) {
  let best = 0.5
  let bestF = -1
  for (let th = 0.2; th <= 0.9; th += 0.05) {
    let tp = 0,
      fp = 0,
      fn = 0
    for (let n = 0; n < half; n++) {
      const p = preds[n][o] >= th
      const y = test[n].y[o] === 1
      if (p && y) tp++
      else if (p) fp++
      else if (y) fn++
    }
    const f = (2 * tp) / (2 * tp + fp + fn || 1)
    if (f > bestF) {
      bestF = f
      best = th
    }
  }
  thresholds.push(Math.round(best * 100) / 100)
}
const report: string[] = []
for (let o = 0; o < O; o++) {
  let tp = 0,
    fp = 0,
    fn = 0
  for (let n = half; n < test.length; n++) {
    const p = preds[n][o] >= thresholds[o]
    const y = test[n].y[o] === 1
    if (p && y) tp++
    else if (p) fp++
    else if (y) fn++
  }
  const line = `${OUTPUTS[o].padEnd(7)} th ${thresholds[o].toFixed(2)}  precision ${(tp / (tp + fp || 1)).toFixed(3)}  recall ${(tp / (tp + fn || 1)).toFixed(3)}  (n=${tp + fn})`
  report.push(line)
  console.error(line)
}

if (process.argv[2] === 'write') {
  const r = (xs: ArrayLike<number>) => `[${Array.from(xs, (v) => +v.toFixed(5)).join(',')}]`
  const src = `/**
 * Weights for model.ts — generated by the training script, not edited by hand.
 *
 * Trained on ${train.length} onsets from ${process.env.NTRAIN ?? 500} synthesized clips; measured on
 * ${test.length - half} onsets from clips built only from held-out one-shots and loops:
 *
${report.map((l) => ' *   ' + l).join('\n')}
 */

import type { ModelWeights } from './model.ts'

export const MODEL_WEIGHTS: ModelWeights = {
  inputs: ${I},
  hidden: ${H},
  mean: ${r(mean)},
  std: ${r(std)},
  w1: ${r(w1)},
  b1: ${r(b1)},
  w2: ${r(w2)},
  b2: ${r(b2)},
  thresholds: ${r(thresholds)},
}
`
  writeFileSync(process.argv[3], src)
  console.error('wrote', process.argv[3])
}
