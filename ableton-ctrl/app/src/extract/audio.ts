/**
 * Getting audio in and cutting it up: decoding a file, recording the
 * microphone, the overview the waveform draws, the mono clip the analysis
 * reads, and the backing clip the engine loops under the pattern.
 *
 * None of this touches the instrument's own audio context — decoding and
 * resampling run in offline contexts, recording needs no context at all — so
 * nothing here can disturb the loop that is playing.
 */

import type { MonoClip } from './types.ts'

/** The rate the analysis works at: everything a drum is lives under 11kHz. */
export const ANALYSIS_RATE = 22050
/** The rate files are decoded to. */
const DECODE_RATE = 44100

export const SELECTION_MIN_S = 5
export const SELECTION_MAX_S = 15
export const RECORD_MAX_S = 15
/** A recording shorter than this has too little in it to find a tempo. */
export const SOURCE_MIN_S = 2

type OfflineCtor = typeof OfflineAudioContext

function offlineContext(channels: number, length: number, rate: number): OfflineAudioContext {
  const Ctor: OfflineCtor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: OfflineCtor }).webkitOfflineAudioContext
  return new Ctor(channels, Math.max(1, length), rate)
}

/** Any audio file the browser can play, as an AudioBuffer. */
export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = offlineContext(2, 1, DECODE_RATE)
  // The promise form, with the callback form's arguments too: older Safari
  // only ever calls back.
  return await new Promise<AudioBuffer>((resolve, reject) => {
    const settled = ctx.decodeAudioData(data, resolve, (e) => reject(e ?? new Error('Could not decode')))
    settled?.then(resolve, reject)
  })
}

/** Loudest sample per bucket, `buckets` across the whole buffer — what the
    waveform draws. */
export function overview(buffer: AudioBuffer, buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  const per = buffer.length / buckets
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let b = 0; b < buckets; b++) {
      const from = Math.floor(b * per)
      const to = Math.min(data.length, Math.floor((b + 1) * per))
      let peak = out[b]
      for (let i = from; i < to; i++) {
        const v = Math.abs(data[i])
        if (v > peak) peak = v
      }
      out[b] = peak
    }
  }
  let top = 0
  for (const v of out) top = Math.max(top, v)
  if (top > 0) for (let b = 0; b < buckets; b++) out[b] /= top
  return out
}

/** `start`..`start + duration` seconds of `buffer`, down-mixed to mono at the
    analysis rate. */
export async function analysisClip(buffer: AudioBuffer, start: number, duration: number): Promise<MonoClip> {
  const length = Math.round(duration * ANALYSIS_RATE)
  const ctx = offlineContext(1, length, ANALYSIS_RATE)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start(0, start, duration)
  const rendered = await ctx.startRendering()
  const samples = rendered.getChannelData(0).slice()
  // Normalized, so a quiet recording is analysed like a loud one.
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] /= peak
  return { samples, sampleRate: ANALYSIS_RATE }
}

/**
 * The backing clip: `loops` passes of the loop, `loopSeconds` each, cut from
 * `buffer` starting at `start` seconds — a downbeat. Silence pads whatever the
 * source runs short of. A few milliseconds of fade at the seam keep the wrap
 * from clicking without blunting the downbeat that follows it.
 */
export function cutBacking(
  buffer: AudioBuffer,
  start: number,
  loops: number,
  loopSeconds: number,
): AudioBuffer {
  const rate = buffer.sampleRate
  const length = Math.max(1, Math.round(loops * loopSeconds * rate))
  const out = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: rate })
  const from = Math.max(0, Math.round(start * rate))
  const fadeIn = Math.round(0.001 * rate)
  const fadeOut = Math.round(0.006 * rate)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c)
    const dst = new Float32Array(length)
    for (let i = 0; i < length && from + i < src.length; i++) dst[i] = src[from + i]
    for (let i = 0; i < fadeIn && i < length; i++) dst[i] *= i / fadeIn
    for (let i = 0; i < fadeOut && i < length; i++) dst[length - 1 - i] *= i / fadeOut
    out.copyToChannel(dst, c)
  }
  return out
}

/**
 * A microphone take, up to RECORD_MAX_S long. The browser's voice processing
 * is turned off: echo cancellation, noise suppression and automatic gain are
 * built to remove exactly the transients a drum is made of.
 */
export class MicRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private meterCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private done: ((blob: Blob) => void) | null = null
  private failed: ((e: Error) => void) | null = null

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  /** Ask for the microphone and start recording. Resolves once recording has
      begun, with `take`: the recording, which settles when it stops — by
      `stop()` or at the time limit. (Wrapped, because an async function
      handed back a bare promise would wait for it.) */
  async start(): Promise<{ take: Promise<Blob> }> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    this.stream = stream
    const recorder = new MediaRecorder(stream)
    this.recorder = recorder
    this.chunks = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    const take = new Promise<Blob>((resolve, reject) => {
      this.done = resolve
      this.failed = reject
    })
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' })
      this.release()
      this.done?.(blob)
    }
    recorder.onerror = () => {
      this.release()
      this.failed?.(new Error('Recording failed'))
    }
    recorder.start()
    this.timer = setTimeout(() => this.stop(), RECORD_MAX_S * 1000)

    // A level meter, so the take can be seen while it is made.
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      this.meterCtx = ctx
      this.analyser = analyser
    } catch {
      // The meter is a nicety; the take does not depend on it.
    }
    return { take }
  }

  /** Peak input level right now, 0..1. */
  level(): number {
    const analyser = this.analyser
    if (!analyser) return 0
    const data = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v))
    return Math.min(1, peak)
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
  }

  /** Abandon a take without keeping it. */
  cancel(): void {
    this.done = null
    this.failed = null
    this.stop()
    this.release()
  }

  private release(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    void this.meterCtx?.close()
    this.meterCtx = null
    this.analyser = null
  }
}
