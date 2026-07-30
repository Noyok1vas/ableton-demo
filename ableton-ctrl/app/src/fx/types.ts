/**
 * FX — the "how does the sound behave in the room" module, the third peer
 * alongside Rhythmic Intent (when it happens) and Sound Intent (what it is).
 *
 * The distinction that defines this module: Rhythmic and Sound parameters are
 * snapshotted **per tap** — they belong to the event. FX parameters are a
 * property of the **space**, so they apply to everything at once: each is read
 * live and re-renders the entire Sound Visual, and (where it maps to Live at
 * all) drives a set-wide macro rather than the selected track's.
 *
 * All three controls draw. REVERB scatters every speck away from where it was
 * struck; HIGH PASS FILTER and SATURATE re-map the finished frame's tones, as
 * Photoshop's Gradient Map does (see SoundVisualScreen for both). None of them
 * touches the geometry a tap laid down — the field is re-rendered, never
 * re-spawned. Each is a no-op at 0, so a fresh set draws exactly what was
 * played. All three also reach Live, each driving the rack macro of the same
 * name on every track that carries it (scope `all` — the room, not one track).
 *
 * REVERB used to own the Sound Visual's ink tail; that effect described the
 * sound rather than the room and moved to Sound Intent's LENGTH dimension.
 */

export type FxControlId = 'reverb' | 'highpass' | 'saturate'

export type FxParams = Record<FxControlId, number>

/** `macroName`, when set, is the exact name of a parameter the bridge drives on
    EVERY track that has one (scope `all`) — the room, not one instrument.
    Controls without it draw but do not sound: they re-render the visual and
    send nothing to Live. */
export type FxControl = { id: FxControlId; label: string; macroName?: string }

// Each name below is a renamed rack macro in the Live set (verified with
// scripts/discover.py — they sit on the "Momentum Conservation" and "Probably
// House" instrument racks, 0..127 each). REVERB used to drive the stock Reverb's
// "Decay Time" instead; the rack macro is the better target because the rack
// already maps it to decay + dry/wet together.
export const FX_CONTROLS: FxControl[] = [
  { id: 'reverb', label: 'REVERB', macroName: 'Reverb' },
  // Live spells it "Hi Pass Filter"; the GUI label stays spelled out. The
  // bridge matches the macro name literally, so this must be Live's spelling.
  { id: 'highpass', label: 'HIGH PASS FILTER', macroName: 'Hi Pass Filter' },
  // Was REPEAT: the control is a tone map now, not a rhythmic effect, so the id
  // moved with the meaning rather than leaving a name that describes nothing.
  { id: 'saturate', label: 'SATURATE', macroName: 'Saturate' },
]

export const FX_MIN = 0
export const FX_MAX = 100

/** Every control rests at its no-op: a dry room in Live, nothing scattered and
    no tone re-mapped on the canvas. A fresh set draws exactly what was played. */
export const DEFAULT_FX_PARAMS: FxParams = {
  reverb: 0,
  highpass: 0,
  saturate: 0,
}
