/**
 * Three ready-made grooves for a quick demo — trap, boom bap and funk — put in
 * Saved on every device the app runs on (the Mac, the workbench, the Pi).
 *
 * Each is seeded once per browser: the ids that have been added are
 * remembered under `rhythmDemos`, so a demo pattern that is deleted stays
 * deleted, and a new one added here later still arrives on its own.
 *
 * Written on a sixteenth grid over the loop's two bars of 4/4 (steps 0–31,
 * fractions for rolls and swing). The duration is two bars at the style's
 * usual tempo; loading re-times it to whatever tempo is running, so the
 * groove holds at any speed.
 */
import { DEFAULT_METER } from '../transport/meter.ts'
import type { SoundVoiceId } from '../transport/engine.ts'
import { isRecord, loadSaved } from '../persist.ts'
import type { SavedPattern, Tap } from './types.ts'

const SEEDED_KEY = 'rhythmDemos'
const STORAGE_PREFIX = 'drumsynth.v1.'

/** Hat character: 0 is closed and tight, 1 open and washy (kit.ts). */
const CLOSED = 0.05
const OPEN = 0.85

type Hit = [step: number, voice: SoundVoiceId, velocity: number, character?: number]

interface Demo {
  id: string
  name: string
  bpm: number
  hits: Hit[]
}

const range = (from: number, to: number, every: number) => {
  const out: number[] = []
  for (let s = from; s < to; s += every) out.push(s)
  return out
}

/** Trap, ~140: half-time clap on 3, a sparse 808 kick, eighth hats that
    break into 32nd and triplet rolls. */
const TRAP: Demo = {
  id: 'demo-trap',
  name: 'Trap',
  bpm: 140,
  hits: [
    // kick
    [0, 'kick', 1],
    [6, 'kick', 0.8],
    [11, 'kick', 0.85],
    [16, 'kick', 1],
    [19, 'kick', 0.75],
    [26, 'kick', 0.9],
    // clap + snare on beat 3 of each bar
    [8, 'clap', 1],
    [8, 'snare', 0.6, 0.8],
    [24, 'clap', 1],
    [24, 'snare', 0.6, 0.8],
    // hats: eighths…
    ...range(0, 12, 2).map((s): Hit => [s, 'hat', s % 4 === 0 ? 0.8 : 0.6, CLOSED]),
    // …a 32nd roll into beat 4…
    ...[12, 12.5, 13, 13.5, 14, 15].map((s, i): Hit => [s, 'hat', 0.5 + i * 0.05, CLOSED]),
    ...range(16, 28, 2)
      .filter((s) => s !== 22)
      .map((s): Hit => [s, 'hat', s % 4 === 0 ? 0.8 : 0.6, CLOSED]),
    // …and a triplet roll to close the loop, with an open hat on top.
    ...[28, 28 + 2 / 3, 29 + 1 / 3, 30, 30 + 2 / 3, 31 + 1 / 3].map(
      (s, i): Hit => [s, 'hat', 0.55 + i * 0.07, CLOSED],
    ),
    [22, 'hat', 0.6, OPEN],
  ],
}

/** Swing on the off sixteenths, in steps — the lazy boom bap pocket. */
const SWING = 0.18
const sw = (step: number) => (step % 2 === 1 ? step + SWING : step)

/** Boom bap, ~90: hard snare on 2 and 4, a kick that skips around them,
    swung eighth hats and a ghost note before the turnaround. */
const BOOM_BAP: Demo = {
  id: 'demo-boombap',
  name: 'Boom bap',
  bpm: 90,
  hits: [
    // kick
    [0, 'kick', 1],
    [sw(7), 'kick', 0.75],
    [10, 'kick', 0.95],
    [16, 'kick', 1],
    [sw(19), 'kick', 0.7],
    [sw(23), 'kick', 0.8],
    [26, 'kick', 0.9],
    // snare on 2 and 4, a ghost before the last one
    [4, 'snare', 1, 0.35],
    [12, 'snare', 1, 0.35],
    [20, 'snare', 1, 0.35],
    [sw(27), 'snare', 0.3, 0.35],
    [28, 'snare', 1, 0.35],
    [12, 'rim', 0.45],
    [28, 'rim', 0.45],
    // swung hats: eighths with the odd sixteenth pickup
    ...range(0, 32, 2)
      .filter((s) => s !== 30)
      .map((s): Hit => [s, 'hat', s % 4 === 0 ? 0.7 : 0.5, CLOSED]),
    [sw(15), 'hat', 0.35, CLOSED],
    [sw(31), 'hat', 0.35, CLOSED],
    [30, 'hat', 0.55, 0.5],
  ],
}

/** Funk, ~104: busy sixteenth hats with accents and open hats on the "and"
    of 4, a syncopated kick, backbeat snare with ghost notes around it. */
const FUNK: Demo = {
  id: 'demo-funk',
  name: 'Funk',
  bpm: 104,
  hits: [
    // kick
    [0, 'kick', 1],
    [3, 'kick', 0.8],
    [10, 'kick', 0.9],
    [16, 'kick', 1],
    [19, 'kick', 0.8],
    [22, 'kick', 0.85],
    [27, 'kick', 0.75],
    // backbeat
    [4, 'snare', 1, 0.6],
    [12, 'snare', 1, 0.6],
    [20, 'snare', 1, 0.6],
    [28, 'snare', 1, 0.6],
    // ghost notes
    ...[7, 9, 15, 23, 25, 30].map((s): Hit => [s, 'snare', 0.28, 0.6]),
    // sixteenth hats, accented on the beat, open on the "and" of 4
    ...range(0, 32, 1)
      .filter((s) => s !== 14 && s !== 30)
      .map((s): Hit => [s, 'hat', s % 4 === 0 ? 0.75 : s % 2 === 0 ? 0.55 : 0.35, CLOSED]),
    [14, 'hat', 0.7, OPEN],
    [30, 'hat', 0.7, OPEN],
  ],
}

const DEMOS: Demo[] = [TRAP, BOOM_BAP, FUNK]

/** Two bars of 4/4 at `bpm`, in seconds. */
const loopSeconds = (bpm: number) => (60 / bpm) * DEFAULT_METER.beats * 2

function toPattern(demo: Demo, savedAt: number): SavedPattern {
  const duration = loopSeconds(demo.bpm)
  const stepSeconds = duration / 32
  const taps: Tap[] = demo.hits
    .map(([step, voice, velocity, character], i): Tap => ({
      id: `${demo.id}-${i}`,
      time: Math.min(step * stepSeconds, duration * 0.999999),
      velocity,
      voice,
      ...(character === undefined ? {} : { character }),
    }))
    .sort((a, b) => a.time - b.time)
  return {
    id: demo.id,
    taps,
    duration,
    meter: DEFAULT_METER,
    createdAt: savedAt,
    name: demo.name,
    savedAt,
  }
}

function seededIds(): Set<string> {
  const raw = loadSaved(SEEDED_KEY)
  return new Set(
    isRecord(raw) && Array.isArray(raw.ids) ? raw.ids.filter((v) => typeof v === 'string') : [],
  )
}

/**
 * `saved` with every demo this browser hasn't been given yet added on top,
 * in the order trap, boom bap, funk. Pure — React may run it twice while
 * restoring — so the session records the gift afterwards with
 * `markDemoPatternsSeeded`.
 */
export function withDemoPatterns(saved: SavedPattern[]): SavedPattern[] {
  const seeded = seededIds()
  const present = new Set(saved.map((e) => e.id))
  const now = Date.now()
  const fresh = DEMOS.filter((d) => !seeded.has(d.id) && !present.has(d.id)).map((d) =>
    toPattern(d, now),
  )
  return fresh.length === 0 ? saved : [...fresh, ...saved]
}

/** Remember that every demo has been handed over, so one deleted stays deleted. */
export function markDemoPatternsSeeded(): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + SEEDED_KEY,
      JSON.stringify({ ids: [...new Set([...seededIds(), ...DEMOS.map((d) => d.id)])] }),
    )
  } catch {
    // No storage: the demos simply arrive again next visit.
  }
}
