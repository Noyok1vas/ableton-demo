/**
 * The drum classifier: a small neural network that names what struck at each
 * onset. Multi-label — one output per kind of drum, each a probability on its
 * own — because a kick and a hat struck together is one onset with two answers.
 *
 *   features (FEATURE_SIZE) ─▶ 32 hidden (tanh) ─▶ 6 outputs (sigmoid)
 *
 * Trained offline on thousands of onsets from synthesized drum performances:
 * real one-shots (808, 909, acoustic, house, trap, hip-hop, DnB kits) arranged
 * into random patterns at random tempos, often under a non-drum music loop,
 * and run through the same `listen()` as here. The weights live in
 * modelWeights.ts; the numbers it was measured at are written there too.
 */

import { MODEL_WEIGHTS } from './modelWeights.ts'

/** What the network answers, in output order. `open` is an open hi-hat;
    `hihat` a closed one. */
export const OUTPUTS = ['kick', 'snare', 'hihat', 'open', 'tom', 'cymbal'] as const
export type Output = (typeof OUTPUTS)[number]

export type ModelWeights = {
  inputs: number
  hidden: number
  /** Feature standardization, applied before the first layer. */
  mean: readonly number[]
  std: readonly number[]
  /** Row-major: w1[h * inputs + i], w2[o * hidden + h]. */
  w1: readonly number[]
  b1: readonly number[]
  w2: readonly number[]
  b2: readonly number[]
  /** Per-output decision thresholds, tuned on held-out renders. */
  thresholds: readonly number[]
}

export function predict(features: Float32Array, m: ModelWeights = MODEL_WEIGHTS): Float32Array {
  const hidden = new Float32Array(m.hidden)
  for (let h = 0; h < m.hidden; h++) {
    let acc = m.b1[h]
    const row = h * m.inputs
    // A constant feature was stored with a zero spread; it carries nothing.
    for (let i = 0; i < m.inputs; i++) acc += m.w1[row + i] * ((features[i] - m.mean[i]) / (m.std[i] || 1))
    hidden[h] = Math.tanh(acc)
  }
  const out = new Float32Array(OUTPUTS.length)
  for (let o = 0; o < OUTPUTS.length; o++) {
    let acc = m.b2[o]
    const row = o * m.hidden
    for (let h = 0; h < m.hidden; h++) acc += m.w2[row + h] * hidden[h]
    out[o] = 1 / (1 + Math.exp(-acc))
  }
  return out
}
