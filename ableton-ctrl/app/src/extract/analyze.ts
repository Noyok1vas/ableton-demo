/**
 * Audio → rhythmic skeleton, in five stages:
 *
 *   1. SEPARATE  harmonic/percussive split of the spectrogram — the drum stem
 *   2. LISTEN    onsets found in five bands, each one described  (listen.ts)
 *   3. NAME      a small trained network says which drums struck   (model.ts)
 *   4. COUNT     tempo by autocorrelation, checked against how well each
 *                candidate's 1/16 grid fits the onsets; then the beat phase
 *                and the downbeat
 *   5. FOLD      hits quantized to 1/16 steps and voted across every repeat of
 *                the loop the clip covers, so what survives is what recurs
 *
 * It runs in a worker, in this page, in a few hundred milliseconds. Behind the
 * RhythmExtractor seam the whole module can be swapped for a heavier model on
 * a server without the UI noticing.
 */

import { sampleAt, smooth } from './dsp.ts'
import { listen, ONSET_LAG_S, type Listening } from './listen.ts'
import { OUTPUTS, predict } from './model.ts'
import { MODEL_WEIGHTS } from './modelWeights.ts'
import type { DetectedHit, DrumType, ExtractionResult, MonoClip, PatternHit } from './types.ts'

const BPM_MIN = 60
const BPM_MAX = 200
/** Where the tempo prior is centred, and how wide it is in octaves. Most
    drum-led music sits within an octave of 120; the prior is what decides
    between a tempo and its double when the hits alone cannot. */
const BPM_PRIOR_CENTRE = 120
const BPM_PRIOR_OCTAVES = 0.7

const STEPS_PER_BEAT = 4
const BEATS_PER_BAR = 4

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

// ── 3. Naming ────────────────────────────────────────────────────────────────

type Named = { drum: DrumType; frame: number; strength: number; confidence: number; open?: boolean }
type Output = (typeof OUTPUTS)[number]

function name(heard: Listening): Named[] {
  const out: Named[] = []
  const th = MODEL_WEIGHTS.thresholds
  heard.onsets.forEach((frame, i) => {
    const p = predict(heard.features[i])
    const prob = (o: Output) => p[OUTPUTS.indexOf(o)]
    const yes = (o: Output) => prob(o) >= th[OUTPUTS.indexOf(o)]
    // Confidence: how far past its threshold the answer is, 0.5 at the line.
    const sure = (o: Output) => {
      const t = th[OUTPUTS.indexOf(o)]
      return clamp01(0.5 + (0.5 * (prob(o) - t)) / (1 - t))
    }
    const strength = Math.sqrt(heard.loudness[i])
    // How far past its own line each answer is — what decides between two
    // answers that cannot both be true.
    const margin = (o: Output) => prob(o) - th[OUTPUTS.indexOf(o)]

    // A snare is a struck head with metal wires: half of it looks like a tom
    // and the other half like metal, so on an arrival called a snare a tom or
    // a cymbal has to be clearly MORE likely to stand beside it.
    const snare = yes('snare') && !(yes('tom') && margin('tom') > margin('snare'))
    if (snare) out.push({ drum: 'snare', frame, strength, confidence: sure('snare') })

    // Low end: a kick or a tom on one arrival, never both.
    if (yes('kick') && (!yes('tom') || prob('kick') >= prob('tom'))) {
      out.push({ drum: 'kick', frame, strength, confidence: sure('kick') })
    } else if (yes('tom') && !snare) {
      out.push({ drum: 'tom', frame, strength, confidence: sure('tom') })
    }
    // Metal: a hat (closed or open) or a cymbal.
    const hat = yes('hihat') || yes('open')
    const cymbal = yes('cymbal') && (!snare || prob('cymbal') >= 0.9)
    if (cymbal && (!hat || prob('cymbal') > Math.max(prob('hihat'), prob('open')))) {
      out.push({ drum: 'cymbal', frame, strength, confidence: sure('cymbal') })
    } else if (hat) {
      const open = prob('open') > prob('hihat')
      out.push({ drum: 'hihat', frame, strength, confidence: sure(open ? 'open' : 'hihat'), open })
    }
  })
  return out
}

// ── 4. Tempo and grid ────────────────────────────────────────────────────────

function autocorrelate(env: Float32Array, maxLag: number): Float32Array {
  const ac = new Float32Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) {
    let acc = 0
    for (let i = lag; i < env.length; i++) acc += env[i] * env[i - lag]
    ac[lag] = acc
  }
  const zero = ac[0] || 1
  for (let lag = 0; lag <= maxLag; lag++) ac[lag] /= zero
  return ac
}

const prior = (bpm: number) =>
  Math.exp(-0.5 * (Math.log2(bpm / BPM_PRIOR_CENTRE) / BPM_PRIOR_OCTAVES) ** 2)

/** Tempo candidates by autocorrelation of the onset envelope: the strongest
    peaks, best first, each with its prior-weighted score. */
function tempoCandidates(env: Float32Array, rate: number): { bpm: number; score: number }[] {
  const maxLag = Math.min(env.length - 1, Math.ceil(((60 * rate) / BPM_MIN) * 2))
  const ac = autocorrelate(env, maxLag)
  const scores: { bpm: number; score: number }[] = []
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm += 0.5) {
    const lag = (60 * rate) / bpm
    const raw = sampleAt(ac, lag) + 0.5 * sampleAt(ac, lag * 2) + 0.25 * sampleAt(ac, lag / 2)
    scores.push({ bpm, score: Math.max(0, raw) * prior(bpm) })
  }
  const peaks = scores.filter(
    (s, i) =>
      (i === 0 || s.score >= scores[i - 1].score) &&
      (i === scores.length - 1 || s.score >= scores[i + 1].score),
  )
  peaks.sort((a, b) => b.score - a.score)
  return peaks.slice(0, 6)
}

/**
 * The beat grid around `bpm`: tempo refined within `spread` and a phase, chosen
 * together to put as many strong onsets as possible on beats — and, with less
 * weight, on eighths and sixteenths, which is what tells a beat from the
 * off-beat between two of them.
 */
function fitGrid(
  env: Float32Array,
  rate: number,
  bpm: number,
  spread: number,
): { bpm: number; phase: number } {
  let best = { bpm, phase: 0, score: -Infinity }
  const steps = Math.max(1, Math.round(spread / 0.001))
  for (let s = -steps; s <= steps; s++) {
    const candidate = bpm * (1 + s * 0.001)
    const period = (60 * rate) / candidate
    for (let phase = 0; phase < period; phase += 0.5) {
      let score = 0
      let beats = 0
      for (let at = phase; at < env.length; at += period) {
        score +=
          sampleAt(env, at) +
          0.35 * sampleAt(env, at + period / 2) +
          0.15 * (sampleAt(env, at + period / 4) + sampleAt(env, at + (3 * period) / 4))
        beats++
      }
      score /= Math.max(1, beats)
      if (score > best.score) best = { bpm: candidate, phase: phase / rate, score }
    }
  }
  return { bpm: best.bpm, phase: best.phase }
}

/** 0..1 — how much of the onsets' weight lands on this grid's sixteenths. A
    tempo whose sixteenths fall between the hits (120 under a 90 BPM groove of
    straight sixteenths) scores low however well its beats line up. */
function alignment(onsets: readonly { time: number; weight: number }[], bpm: number, phase: number): number {
  const step = 60 / bpm / STEPS_PER_BEAT
  let on = 0
  let all = 0
  for (const o of onsets) {
    const pos = (o.time - phase) / step
    const d = Math.abs(pos - Math.round(pos))
    on += o.weight * Math.exp(-0.5 * (d / 0.12) ** 2)
    all += o.weight
  }
  return all > 0 ? on / all : 0
}

function chooseTempo(
  heard: Listening,
  forced?: number,
): { bpm: number; phase: number; confidence: number } {
  const { rate } = heard
  const local = smooth(heard.novelty, rate * 0.25)
  const tempoEnv = heard.novelty.map((v, i) => Math.max(0, v - local[i]))
  const beatEnv = smooth(heard.beatNovelty, 1)
  if (forced) return { ...fitGrid(beatEnv, rate, forced, 0.006), confidence: 1 }

  const onsets = heard.onsets.map((f, i) => ({
    time: f / rate + ONSET_LAG_S,
    weight: Math.sqrt(heard.loudness[i]),
  }))
  const seeds = tempoCandidates(tempoEnv, rate)
  if (seeds.length === 0) return { ...fitGrid(beatEnv, rate, BPM_PRIOR_CENTRE, 0.02), confidence: 0 }
  const top = seeds[0].score || 1
  // Each candidate and its simple relatives, judged on fit and prior together.
  const tried = new Set<number>()
  const judged: { bpm: number; phase: number; score: number }[] = []
  for (const seed of seeds) {
    for (const ratio of [1, 2, 0.5, 1.5, 2 / 3, 4 / 3, 3 / 4]) {
      const bpm = Math.round(seed.bpm * ratio * 2) / 2
      if (bpm < BPM_MIN || bpm > BPM_MAX || tried.has(bpm)) continue
      tried.add(bpm)
      const grid = fitGrid(beatEnv, rate, bpm, 0.015)
      const fit = alignment(onsets, grid.bpm, grid.phase + ONSET_LAG_S)
      const support = ratio === 1 ? seed.score / top : 0.5 * (seed.score / top)
      judged.push({ ...grid, score: fit ** 4 * prior(grid.bpm) * (0.5 + 0.5 * support) })
    }
  }
  judged.sort((a, b) => b.score - a.score)
  const best = judged[0]
  // Confidence: the winner's lead over the best rival that is not a double or
  // half of it (those are the same groove counted differently).
  const rival = judged.find(
    (j) => ![1, 2, 0.5].some((r) => Math.abs(j.bpm / (best.bpm * r) - 1) < 0.03),
  )
  const confidence = rival ? clamp01((1 - rival.score / best.score) * 1.5) : 1
  return { bpm: best.bpm, phase: best.phase, confidence }
}

// ── 5. Downbeat and folding ──────────────────────────────────────────────────

/**
 * Where the bar starts, to the sixteenth. The grid's phase was fitted to all
 * the onsets, and an off-beat hat or a bass line can pull a beat onto the
 * "and"; the drums themselves settle it: kicks like the beat and above all
 * the one, snares like two and four, a crash marks the one. Returns how many
 * sixteenths past the grid's phase the first downbeat falls (0..15).
 */
function chooseDownbeat(hits: readonly { drum: DrumType; beatStep: number; strength: number }[]): number {
  const bar = BEATS_PER_BAR * STEPS_PER_BEAT
  let best = 0
  let bestScore = -Infinity
  for (let r = 0; r < bar; r++) {
    let score = 0
    for (const hit of hits) {
      const s = (((hit.beatStep - r) % bar) + bar) % bar
      const w = 0.5 + hit.strength
      if (s % STEPS_PER_BEAT !== 0) {
        // Kicks and snares mostly sit on beats; one off it is weak evidence
        // against this reading.
        if (hit.drum === 'kick' || hit.drum === 'snare') score -= 0.2 * w
        continue
      }
      const beat = s / STEPS_PER_BEAT
      if (hit.drum === 'kick') score += w * (beat === 0 ? 2 : beat === 2 ? 1.2 : 0.6)
      if (hit.drum === 'snare') score += w * (beat === 1 || beat === 3 ? 1.5 : beat === 0 ? -0.3 : 0.3)
      if (hit.drum === 'cymbal') score += w * (beat === 0 ? 1 : 0)
      if (hit.drum === 'hihat') score += 0.1 * w
    }
    // Ties go to the earliest downbeat, so less of the clip is a pickup.
    if (score > bestScore + 1e-9) {
      bestScore = score
      best = r
    }
  }
  return best
}

export type AnalyzeOptions = {
  bars: number
  /** Skip tempo estimation and fit the grid around this tempo instead — the
      HALF / DOUBLE correction. */
  bpm?: number
}

export function analyzeRhythm(clip: MonoClip, options: AnalyzeOptions): ExtractionResult {
  const started = performance.now()
  const duration = clip.samples.length / clip.sampleRate

  const heard = listen(clip)
  const named = name(heard)
  const tempo = chooseTempo(heard, options.bpm)
  const beat = 60 / tempo.bpm
  const step = beat / STEPS_PER_BEAT

  // Strength within each category, so velocity reads as accent, not as how
  // loud one kind of drum is next to another.
  const top: Partial<Record<DrumType, number>> = {}
  for (const n of named) top[n.drum] = Math.max(top[n.drum] ?? 0, n.strength)

  const onGrid = named.map((n) => {
    const time = Math.max(0, n.frame / heard.rate + ONSET_LAG_S)
    const steps = (time - tempo.phase) / step
    const beatStep = Math.round(steps)
    return { n, time, beatStep, offset: steps - beatStep, strength: n.strength / (top[n.drum] || 1) }
  })

  // In sixteenths past the grid's phase.
  const rotation = chooseDownbeat(
    onGrid.map((h) => ({ drum: h.n.drum, beatStep: h.beatStep, strength: h.strength })),
  )
  const downbeat = tempo.phase + rotation * step
  const loopSteps = options.bars * BEATS_PER_BAR * STEPS_PER_BEAT

  // One hit per drum per step: a flam or a double detection is one hit.
  const byStep = new Map<string, DetectedHit>()
  for (const h of onGrid) {
    const absStep = h.beatStep - rotation
    // The closer to the grid, the more it is believed.
    const quantFit = 1 - 0.6 * (Math.abs(h.offset) / 0.5) ** 2
    const hit: DetectedHit = {
      drum: h.n.drum,
      time: Math.round(h.time * 1000) / 1000,
      absStep,
      offset: Math.round(h.offset * 100) / 100,
      strength: Math.round(clamp01(h.strength) * 100) / 100,
      confidence: Math.round(clamp01(h.n.confidence * quantFit) * 100) / 100,
      ...(h.n.open !== undefined ? { open: h.n.open } : {}),
    }
    const key = `${hit.drum}:${absStep}`
    const prev = byStep.get(key)
    if (!prev || prev.strength < hit.strength) byStep.set(key, hit)
  }
  const hits = [...byStep.values()].sort((a, b) => a.time - b.time)

  // How many times each loop step was heard at all: a step near the end of a
  // 1.5-loop clip was heard once, one near the start twice.
  const coverage = new Array<number>(loopSteps).fill(0)
  const loopSeconds = step * loopSteps
  const firstLoop = Math.floor((0 - downbeat) / loopSeconds)
  const lastLoop = Math.floor((duration - downbeat) / loopSeconds)
  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    for (let s = 0; s < loopSteps; s++) {
      const t = downbeat + (loop * loopSteps + s) * step
      if (t >= -step / 2 && t <= duration - step / 2) coverage[s]++
    }
  }

  type Vote = { count: number; conf: number; vel: number; open: number }
  const votes = new Map<string, Vote>()
  for (const hit of hits) {
    const s = ((hit.absStep % loopSteps) + loopSteps) % loopSteps
    const key = `${hit.drum}:${s}`
    const v = votes.get(key) ?? { count: 0, conf: 0, vel: 0, open: 0 }
    v.count++
    v.conf += hit.confidence
    v.vel += hit.strength
    v.open += hit.open ? 1 : 0
    votes.set(key, v)
  }

  const pattern: PatternHit[] = []
  for (const [key, v] of votes) {
    const [drum, stepText] = key.split(':') as [DrumType, string]
    const s = Number(stepText)
    const heardTimes = Math.max(1, coverage[s])
    const recurrence = Math.min(1, v.count / heardTimes)
    const meanConf = v.conf / v.count
    const confidence = meanConf * (0.4 + 0.6 * recurrence)
    // What recurs is the skeleton; a one-off fill is left out.
    if (recurrence < 0.5 || confidence < 0.3) continue
    const bar = Math.floor(s / (BEATS_PER_BAR * STEPS_PER_BEAT))
    const beatInBar = Math.floor(s / STEPS_PER_BEAT) % BEATS_PER_BAR
    const sixteenth = s % STEPS_PER_BEAT
    pattern.push({
      drum,
      step: s,
      bar: bar + 1,
      beat: beatInBar + 1,
      sixteenth: sixteenth + 1,
      position: `${bar + 1}.${beatInBar + 1}.${sixteenth + 1}`,
      velocity: Math.round(clamp01(0.45 + 0.55 * (v.vel / v.count)) * 100) / 100,
      confidence: Math.round(clamp01(confidence) * 100) / 100,
      ...(drum === 'hihat' ? { open: v.open / v.count >= 0.5 } : {}),
    })
  }
  pattern.sort((a, b) => a.step - b.step || a.drum.localeCompare(b.drum))

  return {
    bpm: Math.round(tempo.bpm * 100) / 100,
    tempoConfidence: Math.round(tempo.confidence * 100) / 100,
    meter: { beats: 4, unit: 4 },
    bars: options.bars,
    steps: loopSteps,
    downbeat: Math.round(downbeat * 1000) / 1000,
    loopsAnalysed: Math.max(0, Math.round(((duration - downbeat) / loopSeconds) * 10) / 10),
    pattern,
    hits,
    separation: 'hpss',
    elapsedMs: Math.round(performance.now() - started),
  }
}
