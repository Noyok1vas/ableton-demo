/**
 * What a hit looks like to the classifier: the shape of the energy that
 * ARRIVES with it, across a log-spaced set of bands from 30Hz to 11kHz.
 *
 * Only the rise counts — whatever was already sounding (the tail of the last
 * hit, a held chord) is subtracted out — so two drums struck together give the
 * sum of their two shapes, which the classifier (model.ts) learns to read
 * apart.
 */

import type { Spectrogram } from './dsp.ts'

export const PROFILE_LOW_HZ = 30
export const PROFILE_HIGH_HZ = 11000
export const PROFILE_BANDS = 20

/** Which profile band each spectrogram bin feeds, or -1 for none. */
export function bandIndex(spec: Spectrogram): Int16Array {
  const out = new Int16Array(spec.bins).fill(-1)
  const span = Math.log(PROFILE_HIGH_HZ / PROFILE_LOW_HZ)
  for (let k = 1; k < spec.bins; k++) {
    const hz = k * spec.binHz
    if (hz < PROFILE_LOW_HZ || hz >= PROFILE_HIGH_HZ) continue
    out[k] = Math.min(PROFILE_BANDS - 1, Math.floor((Math.log(hz / PROFILE_LOW_HZ) / span) * PROFILE_BANDS))
  }
  return out
}

/**
 * The rise at frame `f`, as magnitude per band: the loudest of the next three
 * frames minus the mean of the three before, per bin, in power — then summed
 * per band and square-rooted, so the profile adds roughly linearly when two
 * hits coincide.
 */
export function riseProfile(spec: Spectrogram, bands: Int16Array, f: number): Float32Array {
  const { data, bins, frames } = spec
  const power = new Float64Array(PROFILE_BANDS)
  for (let k = 1; k < bins; k++) {
    const band = bands[k]
    if (band < 0) continue
    let before = 0
    let n = 0
    for (let g = Math.max(0, f - 3); g <= f - 1; g++) {
      before += data[g * bins + k] ** 2
      n++
    }
    if (n > 0) before /= n
    let after = 0
    for (let g = f; g <= Math.min(frames - 1, f + 2); g++) after = Math.max(after, data[g * bins + k] ** 2)
    if (after > before) power[band] += after - before
  }
  const out = new Float32Array(PROFILE_BANDS)
  for (let b = 0; b < PROFILE_BANDS; b++) out[b] = Math.sqrt(power[b])
  return out
}
