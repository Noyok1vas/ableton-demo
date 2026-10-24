/**
 * The laboratory's catalogue. Classic and artist kits are text — names and a
 * figure for each of the eight slots — and carry no samples. A figure is the
 * editor's own shape, shifted per machine and per voice, so loading a kit
 * changes what the plate and the rack show.
 */

import { SOUND_VOICES, type SoundVoiceId } from '../transport/engine.ts'
import { DEFAULT_SHAPE, completeShape, type ShapeParams } from './shape.ts'

export type CatalogKind = 'classic' | 'artist'

export type CatalogKit = {
  id: string
  name: string
  maker: string
  year: string
  kind: CatalogKind
  /** Which body the eight figures share. See BODIES in shape.ts. */
  body: number
  /** Rotates the family so two kits on the same body do not coincide. */
  turn: number
  /** Added to every voice's noise, then clamped. */
  air: number
  /** Draws the second mode, so the kit reads as a pair of figures. */
  pair: boolean
  voices: readonly [string, string, string, string, string, string, string, string]
  /** Artist packs only: one line under the name. Classic packs use maker and year. */
  description?: string
}

const kit = (
  id: string,
  name: string,
  maker: string,
  year: string,
  body: number,
  turn: number,
  air: number,
  pair: boolean,
  voices: CatalogKit['voices'],
  kind: CatalogKind = 'classic',
  description?: string,
): CatalogKit => ({ id, name, maker, year, kind, body, turn, air, pair, voices, description })

/** The classic machines, in the order the library lists them. */
export const CLASSIC_KITS: readonly CatalogKit[] = [
  kit('cr-78', 'CR-78', 'Roland', '1978', 0, 12, 0.04, false, [
    'Bass', 'Snare', 'Rim', 'Hat', 'Cymbal', 'Maracas', 'Claves', 'Cowbell',
  ]),
  kit('tr-606', 'TR-606', 'Roland', '1981', 0, 28, 0.02, false, [
    'Bass', 'Snare', 'Low Tom', 'High Tom', 'Cymbal', 'Open Hat', 'Closed Hat', 'Accent',
  ]),
  kit('tr-707', 'TR-707', 'Roland', '1984', 1, 44, 0, false, [
    'Bass', 'Snare', 'Low Tom', 'Mid Tom', 'Rim', 'Clap', 'Hat', 'Ride',
  ]),
  kit('tr-727', 'TR-727', 'Roland', '1985', 0, 60, 0.14, true, [
    'Bass', 'Conga', 'Bongo', 'Timbale', 'Clave', 'Cowbell', 'Agogo', 'Whistle',
  ]),
  kit('tr-808', 'TR-808', 'Roland', '1980', 0, 6, 0, false, [
    'Bass', 'Low Tom', 'Snare', 'Rim', 'Clap', 'Hat', 'Cowbell', 'Cymbal',
  ]),
  kit('tr-909', 'TR-909', 'Roland', '1983', 1, 78, 0, false, [
    'Bass', 'Low Tom', 'Snare', 'Rim', 'Clap', 'Hat', 'Ride', 'Crash',
  ]),
  kit('lm-1', 'LM-1', 'Linn', '1980', 1, 96, 0.06, false, [
    'Kick', 'Snare', 'Hat', 'Tom', 'Clap', 'Cabasa', 'Tamb', 'Cowbell',
  ]),
  kit('linndrum', 'LinnDrum', 'Linn', '1982', 1, 112, 0.05, false, [
    'Kick', 'Snare', 'Rim', 'Tom', 'Clap', 'Hat', 'Ride', 'Crash',
  ]),
  kit('dmx', 'DMX', 'Oberheim', '1981', 1, 18, 0.08, false, [
    'Bass', 'Snare', 'Tom', 'Rim', 'Clap', 'Hat', 'Shaker', 'Perc',
  ]),
  kit('drumtraks', 'DrumTraks', 'Sequential', '1984', 1, 132, 0.04, false, [
    'Kick', 'Snare', 'Tom', 'Rim', 'Clap', 'Hat', 'Ride', 'Crash',
  ]),
  kit('drumulator', 'Drumulator', 'E-mu', '1983', 1, 148, 0.07, false, [
    'Kick', 'Snare', 'Tom', 'Rim', 'Clap', 'Hat', 'Ride', 'Crash',
  ]),
  kit('sds-v', 'SDS-V', 'Simmons', '1981', 1, 36, 0, true, [
    'Bass', 'Snare', 'Tom', 'Rim', 'Clap', 'Hat', 'Cymbal', 'Perc',
  ]),
  kit('sp-12', 'SP-12', 'E-mu', '1985', 1, 88, 0.1, false, [
    'Kick', 'Snare', 'Hat', 'Tom', 'Rim', 'Clap', 'Ride', 'Crash',
  ]),
  kit('sp-1200', 'SP-1200', 'E-mu', '1987', 1, 164, 0.22, false, [
    'Kick', 'Snare', 'Hat', 'Tom', 'Rim', 'Clap', 'Ride', 'Crash',
  ]),
  kit('mpc60', 'MPC60', 'Akai', '1988', 1, 52, 0.06, false, [
    'Kick', 'Snare', 'Hat', 'Tom', 'Rim', 'Clap', 'Ride', 'Perc',
  ]),
  kit('rx-11', 'RX-11', 'Yamaha', '1984', 0, 70, 0.03, false, [
    'Bass', 'Snare', 'Tom', 'Rim', 'Clap', 'Hat', 'Ride', 'Cowbell',
  ]),
  kit('rz-1', 'RZ-1', 'Casio', '1986', 0, 100, 0.12, false, [
    'Bass', 'Snare', 'Tom', 'Rim', 'Clap', 'Hat', 'Ride', 'Cowbell',
  ]),
  kit('dr-55', 'DR-55', 'Boss', '1979', 0, 4, 0, false, [
    'Bass', 'Snare', 'Rim', 'Hat', 'Accent', 'Cymbal', 'Clave', 'Cowbell',
  ]),
]

/**
 * Artist packs, named after Ableton's own artist drum packs. The line under
 * each name is a short account of that pack — no sample list on the card.
 */
export const ARTIST_KITS: readonly CatalogKit[] = [
  kit(
    'trap-drums',
    'Trap Drums',
    'Sound Oracle',
    '—',
    0,
    20,
    0.04,
    false,
    ['Kick', 'Snare', 'Hat', 'Open Hat', 'Clap', 'Rim', 'Perc', 'Sub'],
    'artist',
    'Sound Oracle. Futuristic kits: heavy kicks, whipcrack snares, sizzling hats.',
  ),
  kit(
    'golden-era',
    'Golden Era Hip-Hop Drums',
    'Sound Oracle',
    '—',
    1,
    140,
    0.18,
    false,
    ['Kick', 'Snare', 'Hat', 'Tom', 'Rim', 'Clap', 'Perc', 'Break'],
    'artist',
    'Sound Oracle. Boom-bap kits. Punishing kicks, crunchy snares, vintage warmth.',
  ),
  kit(
    'breakbeats',
    'Breakbeats',
    'KutMasta Kurt',
    '—',
    1,
    80,
    0.12,
    true,
    ['Kick', 'Snare', 'Hat', 'Tom', 'Rim', 'Clap', 'Perc', 'Chop'],
    'artist',
    'KutMasta Kurt. Vintage hip-hop breaks, chopped into racks from his own vault.',
  ),
  kit(
    'mad-beatz',
    'Mad Beatz',
    'KJ Sawka',
    '—',
    1,
    48,
    0.08,
    false,
    ['Kick', 'Snare', 'Hat', 'Tom', 'Ride', 'Crash', 'Perc', 'Break'],
    'artist',
    'KJ Sawka. Drum and bass, dubstep and breakbeat, cut from a live drum session.',
  ),
]

/** Names used when a save has none — the eight roles, not a machine's. */
export const ROLE_LABELS: Record<SoundVoiceId, string> = {
  kick: 'Kick',
  tom: 'Tom',
  snare: 'Snare',
  rim: 'Rim',
  clap: 'Clap',
  hat: 'Hat',
  ride: 'Ride',
  fx: 'FX',
}

/**
 * What each role does to a kit's shared body. The numbers are the editor's
 * own controls, so a voice is a place on the plate and not a sample.
 */
const VOICE_FIGURE: Record<SoundVoiceId, Partial<ShapeParams>> = {
  kick: { m: 0, n: 1, size: 1.18, impact: 0.18, impactSharp: 0.85, noise: 0.02, outline: 0.2 },
  tom: { m: 2, n: 1, size: 1.02, bell: 0.14, halo: 0.18, outline: 0.28 },
  snare: { m: 3, n: 1, size: 0.94, noise: 0.48, texAmount: 0.45, texIndex: 8, outline: 0.5 },
  rim: { m: 1, n: 1, size: 0.58, impact: 0.26, impactSharp: 1, noise: 0, outline: 0.85 },
  clap: { m: 4, n: 1, copies: 2, copyDx: 0.18, copyDy: 0.02, copyWeight: 0.65, noise: 0.32, size: 0.86 },
  hat: { m: 8, n: 2, size: 0.76, texAmount: 0.72, texIndex: 16, noise: 0.2, outline: 0.62 },
  ride: { m: 5, n: 2, size: 1.08, halo: 0.72, haloReach: 1.35, bell: 0.2, outline: 0.4 },
  fx: { m: 6, n: 2, fmIndex: 1.7, fmRatio: 2, spiralDrop: 0.32, vortexTurn: 1.4, drive: 0.45, size: 0.9 },
}

/** One voice of a catalogue kit, as a shape the plate can draw. */
export function figureFor(kit: CatalogKit, voice: SoundVoiceId, index: number): ShapeParams {
  const next: ShapeParams = { ...DEFAULT_SHAPE }
  for (const [key, value] of Object.entries(VOICE_FIGURE[voice])) {
    if (typeof value === 'number') next[key] = value
  }
  next.body = kit.body
  next.angle = (kit.turn + index * 17) % 180
  next.angleB = (Number(next.angle) + 36) % 180
  next.noise = Math.min(1, Number(next.noise ?? 0) + kit.air)
  next.mixB = kit.pair ? 0.4 : 0
  if (kit.body === 3) next.ringRadius = 0.34 + index * 0.07
  next.mB = Math.min(10, Number(next.m ?? 0) + 2)
  return completeShape(next)
}

export function labelsFor(kit: CatalogKit): Record<SoundVoiceId, string> {
  return Object.fromEntries(SOUND_VOICES.map((id, i) => [id, kit.voices[i]])) as Record<SoundVoiceId, string>
}

export function figuresFor(kit: CatalogKit): Record<SoundVoiceId, ShapeParams> {
  return Object.fromEntries(SOUND_VOICES.map((id, i) => [id, figureFor(kit, id, i)])) as Record<
    SoundVoiceId,
    ShapeParams
  >
}

/** What a first visit opens on: the 909, whose knobs the synth already sits at. */
export const STARTER_KIT = CLASSIC_KITS.find((k) => k.id === 'tr-909') ?? CLASSIC_KITS[0]
