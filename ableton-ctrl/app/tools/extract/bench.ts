/**
 * Bench for the whole analysis (src/extract/analyze.ts): one-shots arranged
 * into known patterns over a music bed — tempo, downbeat and per-drum hits
 * scored against the truth — then the MPC demo songs, printed as lanes to be
 * read by eye.
 *
 *   node bench.ts            patterns and songs
 *   node bench.ts " " v      patterns only, with lanes
 *   node bench.ts songs      songs only (AT=0.4: where in each song to look)
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeRhythm } from '../../src/extract/analyze.ts'
import type { DrumType } from '../../src/extract/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = (process.env.DATA ?? join(HERE, 'data')) + '/'
const DIR = DATA + 'shots/'
const sr = 22050

function readWav(name: string): Float32Array {
  const buf = readFileSync(DIR + name + '.wav')
  let p = 12
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'data') {
      const n = size / 2
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(p + 8 + i * 2) / 32768
      return out
    }
    p += 8 + size + (size % 2)
  }
  throw new Error('no data')
}

type Kit = Partial<Record<DrumType | 'open', string>>
type Test = {
  name: string
  bpm: number
  kit: Kit
  lanes: Partial<Record<DrumType | 'open', string>> // 32 chars, x = hit, X = accent
  bed?: string
  bedGain?: number
  offset: number
  dur: number
  oneOff?: { drum: DrumType; abs: number[] }
}

const cache = new Map<string, Float32Array>()
const sample = (n: string) => cache.get(n) ?? (cache.set(n, readWav(n)), cache.get(n)!)

function render(t: Test): { audio: Float32Array; truth: Set<string> } {
  const out = new Float32Array(Math.round(t.dur * sr))
  const step = 60 / t.bpm / 4
  const put = (name: string, at: number, gain: number) => {
    const s = sample(name)
    const i0 = Math.round(at * sr)
    for (let i = 0; i < s.length; i++) {
      const j = i0 + i
      if (j >= 0 && j < out.length) out[j] += s[i] * gain
    }
  }
  const truth = new Set<string>()
  for (let abs = -8; abs * step + t.offset < t.dur; abs++) {
    const s = ((abs % 32) + 32) % 32
    for (const [lane, pat] of Object.entries(t.lanes)) {
      const c = pat![s]
      if (c === 'x' || c === 'X') {
        put(t.kit[lane as DrumType]!, t.offset + abs * step, c === 'X' ? 0.9 : 0.6)
        truth.add(`${lane === 'open' ? 'hihat' : lane}:${s}`)
      }
    }
  }
  for (const o of t.oneOff ?? []) for (const abs of o.abs) put(t.kit[o.drum]!, t.offset + abs * step, 0.7)
  if (t.bed) {
    const b = sample(t.bed)
    for (let i = 0; i < out.length; i++) out[i] += b[i % b.length] * (t.bedGain ?? 0.5)
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  for (let i = 0; i < out.length; i++) out[i] /= peak
  return { audio: out, truth }
}

const K909: Kit = { kick: 'DrumMachine-Kick-909_Kick_1', snare: 'DrumMachine-Snare-909_Snr_1', hihat: 'DrumMachine-Hat-909_HH_1', open: 'DrumMachine-Hat-909_Open', cymbal: 'DrumMachine-Cymbal-909_Crash', tom: 'DrumMachine-Perc-909_Tom_3' }
const KAC: Kit = { kick: 'Acoustic-Kick-Ac2_Kik_Op', snare: 'Acoustic-Snare-Ac2_Sn_Cnt', hihat: 'Acoustic-Hat-Ac2_HH_Cl', open: 'Acoustic-Hat-Ac2_HH_Op', cymbal: 'Acoustic-Cymbal-Ac2_Crsh_1', tom: 'Acoustic-Tom-Ac2_Tom_12' }
const KAC_RIDE: Kit = { ...KAC, cymbal: 'Acoustic-Cymbal-Ac2_Rd_Bow' }
const K808: Kit = { kick: 'DrumMachine-Kick-808_Kik_1', snare: 'DrumMachine-Snare-808_Snr_1', hihat: 'DrumMachine-Hat-808_HH_1', open: 'DrumMachine-Hat-909_Open', cymbal: 'DrumMachine-Cymbal-909_Crash', tom: 'DrumMachine-Perc-909_Tom_3' }

const tests: Test[] = [
  {
    name: 'house 909 + bed',
    bpm: 124,
    kit: K909,
    lanes: {
      kick: 'X...X...X...X...X...X...X...X...',
      snare: '....x.......x.......x.......x...',
      hihat: '..x...x...x.....x.x...x...x.....',
      open: '..............x...............x.',
      cymbal: 'x...............................',
    },
    bed: '../beds/DeepHouse-Loop-Synth-10Slp124Am',
    bedGain: 0.35,
    offset: 0.41,
    dur: 10,
  },
  {
    name: 'rock acoustic + bed',
    bpm: 112,
    kit: KAC,
    lanes: {
      kick: 'X......x.x........x.x.....x.....',
      snare: '....X.......X.......X.......X...',
      hihat: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x...',
      cymbal: 'x...............................',
      tom: '..............................xx',
    },
    bed: '../beds/EDM-Loop-Synth-05_SLG_128',
    bedGain: 0.4,
    offset: 0.9,
    dur: 12,
  },
  {
    name: 'hiphop 808 dry 90',
    bpm: 90,
    kit: K808,
    lanes: {
      kick: 'X..x......x.....X..x...x..x.....',
      snare: '....X.......X.......X.......X...',
      hihat: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    },
    offset: 0.2,
    dur: 11,
  },
  {
    name: 'ride jazz-ish acoustic 132',
    bpm: 132,
    kit: KAC_RIDE,
    lanes: {
      kick: 'X.......x.......X.......x.x.....',
      snare: '....x.......x.......x.......x...',
      cymbal: 'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.',
    },
    bed: '../beds/EDM-Loop-Synth-05_SLG_128',
    bedGain: 0.3,
    offset: 0.05,
    dur: 9,
  },
]

function scoreRun(truth: Set<string>, got: Set<string>) {
  const per: Record<string, { tp: number; fp: number; fn: number }> = {}
  const d = (k: string) => (per[k.split(':')[0]] ??= { tp: 0, fp: 0, fn: 0 })
  for (const k of got) truth.has(k) ? d(k).tp++ : d(k).fp++
  for (const k of truth) if (!got.has(k)) d(k).fn++
  return per
}

const only = process.argv[2]
for (const t of tests) {
  if (only && !t.name.includes(only)) continue
  const { audio, truth } = render(t)
  const r = analyzeRhythm({ samples: audio, sampleRate: sr }, { bars: 2 })
  // allow rotation by whole bars (16) — a 2-bar loop's two bars can swap
  let best = { rot: 0, f: -1, per: {} as ReturnType<typeof scoreRun> }
  for (const rot of [0, 16]) {
    const got = new Set(r.pattern.map((h) => `${h.drum}:${(h.step + rot) % 32}`))
    const per = scoreRun(truth, got)
    const tp = Object.values(per).reduce((a, b) => a + b.tp, 0)
    const all = Object.values(per).reduce((a, b) => a + b.tp + b.fp + b.fn, 0)
    if (tp / all > best.f) best = { rot, f: tp / all, per }
  }
  const expectDown = t.offset
  const loop = (60 / t.bpm) * 8
  const downErr = ((r.downbeat - expectDown) % (loop / 2) + loop / 2) % (loop / 2)
  console.log(
    `\n== ${t.name}: bpm ${r.bpm} (true ${t.bpm}) conf ${r.tempoConfidence}  downbeat ${r.downbeat.toFixed(3)} (true ${expectDown}, err mod bar ${Math.min(downErr, loop / 2 - downErr).toFixed(3)}s) rot ${best.rot}  ${r.elapsedMs}ms`,
  )
  for (const [drum, s] of Object.entries(best.per)) {
    console.log(`   ${drum.padEnd(7)} tp ${s.tp}  fp ${s.fp}  fn ${s.fn}`)
  }
  if (process.argv[3] === 'v') {
    const lanes: Record<string, string[]> = {}
    for (const dname of ['kick', 'snare', 'hihat', 'tom', 'cymbal']) lanes[dname] = Array(32).fill('.')
    for (const h of r.pattern) lanes[h.drum][(h.step + best.rot) % 32] = h.open ? 'o' : 'x'
    for (const [k, v] of Object.entries(lanes)) console.log(`   got  ${k.padEnd(7)}${v.join('')}`)
    for (const [k, v] of Object.entries(t.lanes)) console.log(`   true ${k.padEnd(7)}${v}`)
  }
}

if (process.argv[2] === 'songs' || process.argv[2] === undefined) {
  const songs = ['Classic_House', 'DanceHall', 'Deep_House', 'DnB', 'FutureBass', 'HipHop', 'Pop', 'RnB_Pop', 'Tech_House', 'Techno', 'Trap', 'TrapSoul']
  for (const s of songs) {
    const all = sample('../songs/' + s)
    // 10 s from 40% in
    const start = Math.floor(all.length * Number(process.env.AT ?? 0.4))
    const clip = all.slice(start, start + sr * 10)
    const r = analyzeRhythm({ samples: clip, sampleRate: sr }, { bars: 2 })
    const lanes: Record<string, string[]> = {}
    for (const dname of ['kick', 'snare', 'hihat', 'tom', 'cymbal']) lanes[dname] = Array(32).fill('.')
    for (const h of r.pattern) lanes[h.drum][h.step] = h.open ? 'o' : 'x'
    console.log(`\n== song ${s}: bpm ${r.bpm} conf ${r.tempoConfidence} downbeat ${r.downbeat.toFixed(2)} loops ${r.loopsAnalysed} ${r.elapsedMs}ms`)
    for (const [k, v] of Object.entries(lanes)) console.log(`   ${k.padEnd(7)}${v.join('')}`)
  }
}
