import type { SoundVoiceId } from '../transport/engine.ts'
import type { ShapeParams } from './shape.ts'

/**
 * The sound pack: one figure per sound, kept in the code rather than in a
 * browser, so the set survives a cleared site and travels with the build.
 * SOUND PACK on the rack loads every figure here into its slot.
 *
 * Filled from a browser's saved rack: in the console on the editor page,
 * `copy(localStorage.getItem('drumsynth.v1.shapeEditor'))`, then paste each
 * slot's `shape` under its sound. A sound left out keeps whatever is in its
 * slot.
 */
export const SOUND_PACK: Partial<Record<SoundVoiceId, ShapeParams>> = {}

/** True when the pack has at least one figure to load. */
export const SOUND_PACK_READY = Object.keys(SOUND_PACK).length > 0
