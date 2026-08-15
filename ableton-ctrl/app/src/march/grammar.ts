/**
 * The phrase grammar — where a held gesture becomes a sentence.
 *
 * The audience communicates two things and only two: when the March begins,
 * and how long it should continue. Everything between those two facts and the
 * finished bar of MIDI happens here, in local procedural logic:
 *
 *   held seconds → bars → tier → shape → blocks
 *
 * Randomness operates at the block level and nowhere else. Individual notes are
 * never generated, and the three voices inside a block are never rolled
 * separately — their relationship is the composed material.
 */

import { PATTERNS_BY_ID, patternsIn, type GroupId, type Pattern } from './patterns.ts'

/** One duration band and the sentence it spells.
 *
 *  `upToBars` is the exclusive upper bound of the band, measured in bars of the
 *  transport's current tempo — so the same gesture means the same thing at any
 *  BPM. The bounds sit on the half-bar, which makes the band a rounding rule:
 *  hold for roughly N bars and you get an N-bar phrase.
 *
 *  These are the tuning surface of the whole prototype. Edit them here. */
export type PhraseTier = {
  id: string
  /** Shown only in the designer window; the audience never sees a tier name. */
  name: string
  upToBars: number
  shape: readonly GroupId[]
}

export const PHRASE_TIERS: readonly PhraseTier[] = [
  { id: 'very-short', name: 'Very short', upToBars: 1.5, shape: ['E'] },
  { id: 'short', name: 'Short', upToBars: 2.5, shape: ['O', 'E'] },
  { id: 'medium', name: 'Medium', upToBars: 3.5, shape: ['O', 'R', 'E'] },
  { id: 'long', name: 'Long', upToBars: 4.5, shape: ['O', 'R', 'R', 'E'] },
  { id: 'extended', name: 'Extended', upToBars: Infinity, shape: ['O', 'R', 'R', 'R', 'E'] },
]

/** The longest phrase the grammar can spell, in bars. The gesture meter fills
    against this, and holding past it changes nothing. */
export const MAX_PHRASE_BARS = PHRASE_TIERS.reduce(
  (longest, tier) => Math.max(longest, tier.shape.length),
  0,
)

/** Two of the same Running block back to back reads as the system doing
    nothing, which is the opposite of what Running is for. Neighbours are drawn
    without replacement instead; set false to see the raw uniform selection. */
export const AVOID_IMMEDIATE_REPEAT = true

/** A gesture, resolved to musical time but not yet spelled out. */
export type Quantized = {
  /** Seconds the button was actually held. */
  heldSeconds: number
  /** That duration in bars, before rounding — the designer's view of the raw
      gesture, and the only place the un-quantized number survives. */
  rawBars: number
  tier: PhraseTier
  /** Bars the phrase will occupy. Equal to the shape's length: a phrase lasts
      exactly as long as the gesture asked for, once rounded. */
  bars: number
}

export function quantizeGesture(heldSeconds: number, barDuration: number): Quantized {
  const rawBars = barDuration > 0 ? Math.max(0, heldSeconds) / barDuration : 0
  const tier = PHRASE_TIERS.find((t) => rawBars < t.upToBars) ?? PHRASE_TIERS[PHRASE_TIERS.length - 1]
  return { heldSeconds, rawBars, tier, bars: tier.shape.length }
}

/** Where a still-held gesture would land if it were released now. The audience
    meter uses this to snap its outline; nothing is generated from it. */
export const previewBars = (heldSeconds: number, barDuration: number): number =>
  quantizeGesture(heldSeconds, barDuration).bars

/** One generated March: the sentence, and the blocks that spell it. */
export type Phrase = {
  id: string
  gesture: Quantized
  patterns: readonly Pattern[]
  /** "O2 + R1 + R3 + E2" — the Current Phrase readout. */
  label: string
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** Draw one block from `group`, avoiding an immediate repeat of `previous`
    where the group is big enough to offer an alternative. */
function selectPattern(group: GroupId, previous: Pattern | null): Pattern {
  const candidates = patternsIn(group)
  const eligible =
    AVOID_IMMEDIATE_REPEAT && previous
      ? candidates.filter((pattern) => pattern.id !== previous.id)
      : candidates
  return pick(eligible.length > 0 ? eligible : candidates)
}

/**
 * The whole pipeline, minus the sound: measure → quantize → determine
 * structure → select blocks. Two gestures of the same length take the same
 * route and arrive at different sentences, because only the selection is
 * random.
 */
export function generatePhrase(heldSeconds: number, barDuration: number): Phrase {
  const gesture = quantizeGesture(heldSeconds, barDuration)
  const patterns: Pattern[] = []
  for (const group of gesture.tier.shape) {
    patterns.push(selectPattern(group, patterns[patterns.length - 1] ?? null))
  }
  return {
    id: crypto.randomUUID(),
    gesture,
    patterns,
    label: patterns.map((pattern) => pattern.id).join(' + '),
  }
}

/** Rebuild a phrase from block ids — used by nothing in the UI yet, but it is
    what makes a generated phrase reproducible outside this session. */
export function phraseFromIds(ids: readonly string[]): readonly Pattern[] {
  return ids.flatMap((id) => {
    const pattern = PATTERNS_BY_ID.get(id)
    return pattern ? [pattern] : []
  })
}
