/**
 * The March Family — ten hand-composed rhythmic building blocks.
 *
 * A block is NOT "one sequence plus one sound". It is three synchronized
 * 16-step sequences played by three fixed percussion voices, and the
 * relationship between those three tracks is the composed thing: the generator
 * picks whole blocks and never touches the notes inside one, so Low, High and
 * Tick keep the counterpoint they were written with.
 *
 * All blocks are one bar of 4/4 at a 1/16 grid. `1` is a note, `0` a rest.
 * Velocity, accent and swing are deliberately absent in v0.2 — every note is
 * struck the same way, so what is being tested is the sentence structure and
 * nothing else.
 */

import type { MarchEvent, MarchVoiceId } from '../transport/engine.ts'

export const STEPS_PER_BAR = 16
export const BEATS_PER_BAR = 4
export const STEPS_PER_BEAT = STEPS_PER_BAR / BEATS_PER_BAR

/** Seconds one March bar takes at `bpm`. The tempo is the transport's — March
    is a layer inside the same clock as everything else, not a clock of its own. */
export const barDurationFor = (bpm: number) => (BEATS_PER_BAR * 60) / bpm

/** The three fixed voices of the March instrument. The audience never chooses
    or edits these; they are the instrument, the way a drum kit's shells are.
    Named by the engine, which is what turns a voice into a sound. */
export type VoiceId = MarchVoiceId

export const VOICE_IDS: readonly VoiceId[] = ['low', 'high', 'tick']

export const VOICE_LABEL: Record<VoiceId, string> = {
  low: 'LOW',
  high: 'HIGH',
  tick: 'TICK',
}

/** Which functional group a block belongs to — the alphabet the phrase grammar
    spells with. */
export type GroupId = 'O' | 'R' | 'E'

export type Group = {
  id: GroupId
  name: string
  /** What this group is for, in the designer's words. */
  note: string
}

export const GROUPS: readonly Group[] = [
  {
    id: 'O',
    name: 'Opening',
    note: 'Introduces the March. Sparse at the top of the bar, gathering activity toward its second half.',
  },
  {
    id: 'R',
    name: 'Running',
    note: 'The continuous body. One rhythmic language, four readings of it, so switching between them evolves without changing subject.',
  },
  {
    id: 'E',
    name: 'Ending',
    note: 'Resolves, releases or interrupts. Whatever the strategy, it says the gesture reached a boundary.',
  },
]

export type Pattern = {
  id: string
  group: GroupId
  /** Designer-facing description of what this block does musically. */
  note: string
  steps: Record<VoiceId, readonly number[]>
}

const P = (
  id: string,
  group: GroupId,
  note: string,
  low: readonly number[],
  high: readonly number[],
  tick: readonly number[],
): Pattern => ({ id, group, note, steps: { low, high, tick } })

/**
 * The blocks themselves. Columns are 1/16 steps; the groups of four are beats.
 *
 * The whole family shares one habit — Tick carries the offbeat, Low places the
 * weight, High syncopates against both — so any Opening leads into any Running
 * and any Running into any Ending. That interchangeability is the property the
 * grammar depends on, and it is maintained here by hand, not enforced by code.
 */
export const PATTERNS: readonly Pattern[] = [
  // ── Opening ─────────────────────────────────────────────────────────
  //                             1  .  .  .   2  .  .  .   3  .  .  .   4  .  .  .
  P(
    'O1',
    'O',
    'The barest arrival: one mark on the downbeat, then the Tick creeping in from halfway and a lift into the next bar.',
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  ),
  P(
    'O2',
    'O',
    'Two low marks split the bar in half before the High answers — the most neutral way in, and the one that leads anywhere.',
    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  ),
  P(
    'O3',
    'O',
    'Enters off the downbeat and rolls: the Tick doubles across the last beat, so the March is already moving when the phrase reaches it.',
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1],
  ),

  // ── Running ─────────────────────────────────────────────────────────
  //                             1  .  .  .   2  .  .  .   3  .  .  .   4  .  .  .
  P(
    'R1',
    'R',
    'The reference groove. Low walks unevenly, High fills the holes it leaves, Tick keeps a flat offbeat under both.',
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  ),
  P(
    'R2',
    'R',
    'R1 pushed late: the Low abandons the downbeat and lands in pairs at the end of the bar, with a 1/16 flick in the third beat.',
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1],
    [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0],
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1],
  ),
  P(
    'R3',
    'R',
    'The open one. Tick thins to the offbeat eighths, which lets the Low state a plain three-three-two and the High answer across the barline.',
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1],
    [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  ),
  P(
    'R4',
    'R',
    'The driving one. Low holds still while High takes over the syncopation and the Tick closes to straight 1/16s for the last beat.',
    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
    [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1],
  ),

  // ── Ending ──────────────────────────────────────────────────────────
  //                             1  .  .  .   2  .  .  .   3  .  .  .   4  .  .  .
  P(
    'E1',
    'E',
    'Resolves by filling: everything thickens across the second half and the last beat arrives as a wall.',
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ),
  P(
    'E2',
    'E',
    'Resolves by leaving: the voices drop out one after another and the last beat is silence, which is what makes the ending audible.',
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0],
  ),
  P(
    'E3',
    'E',
    'A turnaround: the middle of the bar is cut out entirely, then a short figure stamps the fourth beat shut.',
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
    [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
  ),
]

export const PATTERNS_BY_ID: ReadonlyMap<string, Pattern> = new Map(
  PATTERNS.map((pattern) => [pattern.id, pattern]),
)

export const patternsIn = (group: GroupId): readonly Pattern[] =>
  PATTERNS.filter((pattern) => pattern.group === group)

/**
 * Flatten a phrase into the events the engine loops.
 *
 * One list, with positions measured 0..1 across the *whole* phrase rather than
 * within a bar: a five-bar March is one loop five bars long, not five loops of
 * one bar. That is what makes the Opening happen once and the Ending land where
 * it was written to land.
 */
export function phraseEvents(patterns: readonly Pattern[]): MarchEvent[] {
  const bars = patterns.length
  const events: MarchEvent[] = []
  if (bars === 0) return events
  patterns.forEach((pattern, bar) => {
    for (const voice of VOICE_IDS) {
      pattern.steps[voice].forEach((step, index) => {
        if (step) events.push({ voice, pos: (bar + index / STEPS_PER_BAR) / bars })
      })
    }
  })
  return events
}

/** How many notes a block plays in total — the Family window's density read. */
export const noteCount = (pattern: Pattern): number =>
  VOICE_IDS.reduce((total, id) => total + pattern.steps[id].reduce((n, step) => n + step, 0), 0)
