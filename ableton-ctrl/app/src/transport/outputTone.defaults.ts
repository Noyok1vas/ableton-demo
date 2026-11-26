// The device's saved output tone — written by the workbench's "Save as device
// default" (/?bench, dev server only). Committed, so the Pi build plays with it.
import type { OutputTone } from './outputTone.ts'

export const OUTPUT_TONE_DEFAULTS: OutputTone = {
  volume: 0,
  lowGain: 0,
  lowFreq: 120,
  midGain: 0,
  midFreq: 1000,
  midQ: 0.8,
  highGain: 0,
  highFreq: 6000,
}
