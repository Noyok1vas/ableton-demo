/**
 * Stages 1 and 2 of the analysis — SEPARATE and LISTEN — which know nothing
 * about tempo or drums: where in the clip something struck, and a description
 * of each strike for the classifier to name.
 *
 * Shared, line for line, by the app and by the script that trains the
 * classifier, so the model only ever sees features made exactly the way it
 * will see them at run time.
 */

import { percussive, quantile, stft, type Spectrogram } from './dsp.ts'
import { bandIndex, PROFILE_BANDS, riseProfile } from './features.ts'
import type { MonoClip } from './types.ts'

/** Coarse bands, in Hz: where onsets are looked for. */
const BANDS = {
  sub: [30, 120], // kick fundamental
  low: [120, 350], // toms, the snare's body, the top of a kick
  mid: [350, 2000], // the snare's crack
  noise: [2000, 6000], // snare wires, the low end of metal
  air: [6000, 11000], // hats and cymbals
} as const
type Band = keyof typeof BANDS
const BAND_NAMES = Object.keys(BANDS) as Band[]

/** The four regions the decay and percussiveness features are read in. */
const REGIONS: readonly (readonly [number, number])[] = [
  [30, 150],
  [150, 1000],
  [1000, 5000],
  [5000, 11000],
]
/** When after a hit its decay is read, in seconds. */
const DECAY_AT = [0.05, 0.12] as const

/** The STFT's frames come out a little ahead of the hit they describe (a frame
    "hears" a transient before its centre reaches it). Measured against
    one-shots placed at known times; added back so the grid lines up with the
    audio itself. */
export const ONSET_LAG_S = 0.008

export const FEATURE_SIZE = PROFILE_BANDS + 1 + REGIONS.length * (2 + DECAY_AT.length)

export type Listening = {
  /** Frames per second of everything below. */
  rate: number
  frames: number
  /** Onset frames, ascending. */
  onsets: number[]
  /** One feature vector per onset (see `describe`). */
  features: Float32Array[]
  /** How much arrived at each onset, for velocity: total rise magnitude. */
  loudness: number[]
  /** Onset novelty per frame, all bands averaged — for tempo. */
  novelty: Float32Array
  /** Onset novelty weighted towards kick and snare — for beat phase. */
  beatNovelty: Float32Array
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

function binRange(spec: Spectrogram, [lo, hi]: readonly [number, number]): [number, number] {
  const from = Math.max(1, Math.round(lo / spec.binHz))
  const to = Math.min(spec.bins - 1, Math.round(hi / spec.binHz))
  return [from, Math.max(from, to)]
}

/** Log-compressed spectral flux, averaged over a band: how much NEW energy
    arrives in it at each frame. */
function bandFlux(log: Float32Array, spec: Spectrogram, band: readonly [number, number]): Float32Array {
  const [from, to] = binRange(spec, band)
  const out = new Float32Array(spec.frames)
  const width = to - from + 1
  for (let f = 1; f < spec.frames; f++) {
    let acc = 0
    const row = f * spec.bins
    const prev = row - spec.bins
    for (let k = from; k <= to; k++) {
      const d = log[row + k] - log[prev + k]
      if (d > 0) acc += d
    }
    out[f] = acc / width
  }
  return out
}

/** Power summed over a band, per frame. */
function bandPower(spec: Spectrogram, band: readonly [number, number]): Float32Array {
  const [from, to] = binRange(spec, band)
  const out = new Float32Array(spec.frames)
  for (let f = 0; f < spec.frames; f++) {
    let acc = 0
    const row = f * spec.bins
    for (let k = from; k <= to; k++) acc += spec.data[row + k] ** 2
    out[f] = acc
  }
  return out
}

/** Local maxima that stand clear of their surroundings. */
function pickPeaks(nov: Float32Array, rate: number, floor: number): number[] {
  const near = Math.max(2, Math.round(0.035 * rate))
  const before = Math.round(0.14 * rate)
  const after = Math.round(0.05 * rate)
  const gap = Math.round(0.05 * rate)
  const peaks: number[] = []
  for (let f = 1; f < nov.length - 1; f++) {
    const v = nov[f]
    if (v < floor) continue
    let isMax = true
    for (let g = Math.max(0, f - near); g <= Math.min(nov.length - 1, f + near); g++) {
      if (nov[g] > v || (nov[g] === v && g < f)) {
        isMax = false
        break
      }
    }
    if (!isMax) continue
    let mean = 0
    let n = 0
    for (let g = Math.max(0, f - before); g <= Math.min(nov.length - 1, f + after); g++) {
      mean += nov[g]
      n++
    }
    if (v < mean / n + 0.06) continue
    if (peaks.length > 0 && f - peaks[peaks.length - 1] < gap) continue
    peaks.push(f)
  }
  return peaks
}

/** Every band's arrivals, merged: two band peaks within `within` frames are one
    moment, at whichever frame the most new energy arrived. */
function mergeOnsets(lists: number[][], weight: Float32Array, within: number): number[] {
  const all = lists.flat().sort((a, b) => a - b)
  const out: number[] = []
  for (const f of all) {
    const last = out.length - 1
    if (last >= 0 && f - out[last] <= within) {
      if (weight[f] > weight[out[last]]) out[last] = f
    } else out.push(f)
  }
  return out
}

export function listen(clip: MonoClip): Listening {
  const { samples, sampleRate } = clip
  // ~46ms windows, ~11.6ms hop at any sample rate.
  const size = 2 ** Math.round(Math.log2(sampleRate * 0.046))
  const hop = size / 4

  // 1. SEPARATE — the percussive part of the spectrogram is the drum stem.
  const spec = stft(samples, sampleRate, size, hop)
  const perc = percussive(spec)
  const rate = spec.rate

  // 2. LISTEN — log-compressed so a quiet hat still registers next to a kick.
  let maxP = 0
  for (let i = 0; i < perc.data.length; i++) if (perc.data[i] > maxP) maxP = perc.data[i]
  const log = new Float32Array(perc.data.length)
  const gamma = maxP > 0 ? 1000 / maxP : 0
  for (let i = 0; i < log.length; i++) log[i] = Math.log1p(gamma * perc.data[i])

  const rawNov = Object.fromEntries(
    BAND_NAMES.map((b) => [b, bandFlux(log, perc, BANDS[b])]),
  ) as Record<Band, Float32Array>
  // Each band is scaled by its own loudest arrivals, but never by less than a
  // quarter of the loudest band's — so a song with no hats does not have its
  // hiss promoted into a hi-hat part.
  const p99 = Object.fromEntries(BAND_NAMES.map((b) => [b, quantile(rawNov[b], 0.99)])) as Record<Band, number>
  const loudest = Math.max(...BAND_NAMES.map((b) => p99[b]), 1e-9)
  const nov = Object.fromEntries(
    BAND_NAMES.map((b) => {
      const scale = Math.max(p99[b], 0.25 * loudest)
      return [b, rawNov[b].map((v) => v / scale)]
    }),
  ) as Record<Band, Float32Array>

  const novelty = new Float32Array(spec.frames)
  const beatNovelty = new Float32Array(spec.frames)
  for (let f = 0; f < spec.frames; f++) {
    novelty[f] = BAND_NAMES.reduce((acc, b) => acc + nov[b][f], 0) / BAND_NAMES.length
    beatNovelty[f] = nov.sub[f] + 0.7 * nov.mid[f] + 0.4 * nov.noise[f] + 0.3 * nov.air[f]
  }

  const onsets = mergeOnsets(
    BAND_NAMES.map((b) => pickPeaks(nov[b], rate, 0.2)),
    novelty,
    Math.max(1, Math.round(0.025 * rate)),
  )

  // Describe every onset.
  const bands = bandIndex(perc)
  const profiles = onsets.map((f) => riseProfile(perc, bands, f))
  const totals = profiles.map((p) => p.reduce((a, b) => a + b, 0))
  const totalRef = Math.max(quantile(totals, 0.9), 1e-12)

  const fullPower = REGIONS.map((r) => bandPower(spec, r))
  const percPower = REGIONS.map((r) => bandPower(perc, r))

  const features = onsets.map((f, i) => {
    const out = new Float32Array(FEATURE_SIZE)
    let at = 0
    // Shape of the arrival, log-scaled against its own loudest band.
    const profile = profiles[i]
    const peak = Math.max(...profile, 1e-12)
    for (let b = 0; b < PROFILE_BANDS; b++) out[at++] = clamp(Math.log10(1e-4 + profile[b] / peak) / 4, -1, 0)
    // How loud it is next to the clip's other arrivals.
    out[at++] = clamp(Math.log10(totals[i] / totalRef + 1e-6) / 2, -1.5, 0.5)
    const next = i + 1 < onsets.length ? onsets[i + 1] - 1 : spec.frames - 1
    for (let r = 0; r < REGIONS.length; r++) {
      const full = fullPower[r]
      let top = 0
      for (let g = f; g <= Math.min(spec.frames - 1, f + 2); g++) top = Math.max(top, full[g])
      // How much of the region's energy here is struck rather than sustained.
      let struck = 0
      for (let g = f; g <= Math.min(spec.frames - 1, f + 2); g++) struck = Math.max(struck, percPower[r][g])
      out[at++] = top > 0 ? clamp(struck / top, 0, 1) : 0
      // The region's level next to the same region across the clip.
      out[at++] = 0 // filled below, once every onset's level is known
      // How fast it dies away, read before the next hit can refill it.
      for (const t of DECAY_AT) {
        const g = Math.min(f + Math.round(t * rate), next, spec.frames - 1)
        const ratio = top > 0 ? full[g] / top : 0
        out[at++] = clamp(Math.log10(ratio + 1e-3) / 3, -1, 0.2)
      }
    }
    return out
  })

  // Region levels relative to the clip, now that every onset has been read.
  const regionOffset = (r: number) => PROFILE_BANDS + 1 + r * (2 + DECAY_AT.length) + 1
  for (let r = 0; r < REGIONS.length; r++) {
    const levels = onsets.map((f) => {
      let top = 0
      for (let g = f; g <= Math.min(spec.frames - 1, f + 2); g++) top = Math.max(top, percPower[r][g])
      return top
    })
    const ref = Math.max(quantile(levels, 0.9), 1e-12)
    levels.forEach((v, i) => {
      features[i][regionOffset(r)] = clamp(Math.log10(v / ref + 1e-6) / 3, -1.5, 0.5)
    })
  }

  return {
    rate,
    frames: spec.frames,
    onsets,
    features,
    loudness: totals.map((t) => t / totalRef),
    novelty,
    beatNovelty,
  }
}
