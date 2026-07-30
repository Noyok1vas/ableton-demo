/**
 * Ripple — the Selector's third mark, taken seriously as a gesture: one tap
 * sounds the note several times in a row (fors' ratchet), and every repeat is
 * one ring of the mark. This pass is GUI only. Nothing reaches Live yet: the
 * window exists to settle how the gesture reads and feels first.
 */

/** Repeats per tap. One is a plain tap; four is the ceiling for this pass. */
export const RIPPLE_MIN = 1
export const RIPPLE_MAX = 4

export const DEFAULT_RIPPLE_COUNT = 3

/** Gap between repeats, ms — the ratchet's rate. Fixed here; rate is the
    obvious second dimension once the count reads right. */
export const REPEAT_INTERVAL_MS = 130

/** How long one ring takes to travel from the centre out to the rim, ms.
    Deliberately several times REPEAT_INTERVAL_MS: the repeats overlap, which is
    what makes the mark read as concentric rings rather than one ring at a
    time. */
export const RING_LIFE_MS = 900
