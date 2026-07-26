/**
 * FX — the "how does the sound behave in the room" module, the third peer
 * alongside Rhythmic Intent (when it happens) and Sound Intent (what it is).
 *
 * The distinction that defines this module: Rhythmic and Sound parameters are
 * snapshotted **per tap** — they belong to the event. FX parameters are a
 * property of the **space**, so they apply to everything at once: changing one
 * re-renders every blot already on the Sound Visual, and drives a set-wide
 * macro in Live rather than the selected track's.
 */

export type FxControlId = 'reverb' | 'highpass' | 'repeat'

export type FxParams = Record<FxControlId, number>

/** `macroName`, when set, is the exact name of a parameter the bridge drives on
    EVERY track that has one (scope `all`) — the room, not one instrument.
    Controls without it are UI only for now: they move and read back, but send
    nothing to Live and change nothing in the visual. */
export type FxControl = { id: FxControlId; label: string; macroName?: string }

export const FX_CONTROLS: FxControl[] = [
  // Live's stock Reverb calls its Decay knob "Decay Time" (a 0..1 parameter —
  // the bridge scales the slider's 0..127 into that range).
  { id: 'reverb', label: 'REVERB', macroName: 'Decay Time' },
  { id: 'highpass', label: 'HIGH PASS FILTER' },
  { id: 'repeat', label: 'REPEAT' },
]

export const FX_MIN = 0
export const FX_MAX = 100

/** Reverb starts at 0 — a dry room. Nothing diffuses until it is turned up. */
export const DEFAULT_FX_PARAMS: FxParams = {
  reverb: 0,
  highpass: 0,
  repeat: 0,
}
