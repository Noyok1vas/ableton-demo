/**
 * The signal-processing primitives the analysis is built from: a radix-2 FFT,
 * a magnitude spectrogram, and the median filters harmonic/percussive
 * separation needs. Plain typed arrays, no dependencies, so the whole thing
 * runs in a worker.
 */

/** A magnitude spectrogram, frame-major: `data[frame * bins + bin]`. */
export type Spectrogram = {
  data: Float32Array
  frames: number
  bins: number
  /** Frames per second. */
  rate: number
  /** Hz per bin. */
  binHz: number
}

/** In-place iterative radix-2 FFT over `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]
        const wi = -sin[k * step]
        const a = start + k
        const b = a + half
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

/** Magnitude STFT with a Hann window, centred frames (the signal is padded by
    half a window either side, so frame `i` is centred on sample `i * hop`). */
export function stft(
  samples: Float32Array,
  sampleRate: number,
  size: number,
  hop: number,
): Spectrogram {
  const bins = size / 2 + 1
  const frames = Math.max(1, Math.floor(samples.length / hop) + 1)
  const data = new Float32Array(frames * bins)
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  const cos = new Float64Array(size)
  const sin = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size)
    sin[i] = Math.sin((2 * Math.PI * i) / size)
  }
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  const half = size / 2
  for (let f = 0; f < frames; f++) {
    const centre = f * hop
    for (let i = 0; i < size; i++) {
      const at = centre - half + i
      re[i] = at >= 0 && at < samples.length ? samples[at] * window[i] : 0
      im[i] = 0
    }
    fft(re, im, cos, sin)
    const row = f * bins
    for (let k = 0; k < bins; k++) data[row + k] = Math.hypot(re[k], im[k])
  }
  return { data, frames, bins, rate: sampleRate / hop, binHz: sampleRate / size }
}

/** Median of `buf[0..count)`, partially reordering it (quickselect). */
function median(buf: Float32Array, count: number): number {
  const k = count >> 1
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const pivot = buf[(lo + hi) >> 1]
    let i = lo
    let j = hi
    while (i <= j) {
      while (buf[i] < pivot) i++
      while (buf[j] > pivot) j--
      if (i <= j) {
        const t = buf[i]
        buf[i] = buf[j]
        buf[j] = t
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return buf[k]
}

/**
 * Harmonic/percussive separation by median filtering (Fitzgerald 2010).
 *
 * A pitched, sustained sound is a horizontal line in a spectrogram and a drum
 * hit a vertical one, so a median taken along time keeps the first and one
 * taken along frequency keeps the second. Each bin is then shared out between
 * the two by a soft mask. What comes back is the percussive part — the drum
 * stem, as far as the analysis is concerned — at the same shape as the input.
 */
export function percussive(spec: Spectrogram, kernel = 17): Spectrogram {
  const { data, frames, bins } = spec
  const half = kernel >> 1
  const harm = new Float32Array(data.length)
  const perc = new Float32Array(data.length)
  const buf = new Float32Array(kernel)

  // Along time, per bin → harmonic.
  for (let k = 0; k < bins; k++) {
    for (let f = 0; f < frames; f++) {
      let n = 0
      const from = Math.max(0, f - half)
      const to = Math.min(frames - 1, f + half)
      for (let g = from; g <= to; g++) buf[n++] = data[g * bins + k]
      harm[f * bins + k] = median(buf, n)
    }
  }
  // Along frequency, per frame → percussive.
  for (let f = 0; f < frames; f++) {
    const row = f * bins
    for (let k = 0; k < bins; k++) {
      let n = 0
      const from = Math.max(0, k - half)
      const to = Math.min(bins - 1, k + half)
      for (let j = from; j <= to; j++) buf[n++] = data[row + j]
      perc[row + k] = median(buf, n)
    }
  }

  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const p = perc[i] * perc[i]
    const h = harm[i] * harm[i]
    out[i] = (data[i] * p) / (p + h + 1e-12)
  }
  return { ...spec, data: out }
}

/** The `q` quantile (0..1) of a list, without disturbing it. */
export function quantile(values: ArrayLike<number>, q: number): number {
  if (values.length === 0) return 0
  const sorted = Float64Array.from(values).sort()
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[at]
}

/** Gaussian smoothing of a 1-D signal, `sigma` in samples. */
export function smooth(values: Float32Array, sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float64Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma))
    sum += kernel[i + radius]
  }
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    let acc = 0
    for (let j = -radius; j <= radius; j++) {
      const at = Math.min(values.length - 1, Math.max(0, i + j))
      acc += values[at] * kernel[j + radius]
    }
    out[i] = acc / sum
  }
  return out
}

/** Linear interpolation into a signal at a fractional index; 0 outside it. */
export function sampleAt(values: Float32Array, at: number): number {
  if (at < 0 || at > values.length - 1) return 0
  const i = Math.floor(at)
  const u = at - i
  return i + 1 < values.length ? values[i] * (1 - u) + values[i + 1] * u : values[i]
}
