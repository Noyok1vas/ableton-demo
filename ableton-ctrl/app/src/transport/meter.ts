/**
 * Time signature — how the transport counts, alongside the tempo.
 *
 * `beats` is the numerator and `unit` the note value that gets the beat, so
 * 3/8 is `{ beats: 3, unit: 8 }`. Tempo is always in quarter notes per minute
 * (the DAW convention), which makes a bar of 3/8 a bar and a half of quarters
 * shorter than one of 4/4 at the same BPM — the meter changes how long a bar
 * is, not how fast the clock runs.
 *
 * The tapped loop is always BARS_PER_LOOP bars of this meter, and its grid is
 * always sixteenth notes, so both follow from the numbers here.
 */

export type MeterUnit = 2 | 4 | 8 | 16

export type Meter = { beats: number; unit: MeterUnit }

export const METER_UNITS: readonly MeterUnit[] = [2, 4, 8, 16]
export const METER_BEATS_MIN = 1
export const METER_BEATS_MAX = 16

export const DEFAULT_METER: Meter = { beats: 4, unit: 4 }

/** A bar's length in quarter notes: 4/4 → 4, 3/8 → 1.5, 6/8 → 3. */
export const quartersPerBar = (m: Meter) => (m.beats * 4) / m.unit

/** A bar's length in seconds at `bpm` quarter notes per minute. */
export const barSecondsFor = (bpm: number, m: Meter) => (quartersPerBar(m) * 60) / bpm

/** Sixteenth notes in one bar — always a whole number for the units allowed. */
export const sixteenthsPerBar = (m: Meter) => (m.beats * 16) / m.unit

export const formatMeter = (m: Meter) => `${m.beats}/${m.unit}`

/** A stored value back into a meter, or null if it is not one. */
export function parseMeter(raw: unknown): Meter | null {
  if (!raw || typeof raw !== 'object') return null
  const { beats, unit } = raw as Record<string, unknown>
  if (typeof beats !== 'number' || !Number.isInteger(beats)) return null
  if (beats < METER_BEATS_MIN || beats > METER_BEATS_MAX) return null
  if (!METER_UNITS.includes(unit as MeterUnit)) return null
  return { beats, unit: unit as MeterUnit }
}
