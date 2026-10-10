/// <reference lib="webworker" />
/**
 * The analysis runs here, off the main thread: a few hundred milliseconds of
 * FFTs and median filters would otherwise freeze the ring mid-turn.
 */

import { analyzeRhythm } from './analyze.ts'

type Request = { id: number; samples: Float32Array; sampleRate: number; bars: number; bpm?: number }

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, samples, sampleRate, bars, bpm } = event.data
  try {
    const result = analyzeRhythm({ samples, sampleRate }, { bars, bpm })
    self.postMessage({ id, result })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
