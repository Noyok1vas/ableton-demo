/**
 * The hardware, in millimetres, from the CAD (Ephnim_demoCAD1017.stp). The
 * render in public/device.webp is that CAD seen straight down, the body's
 * edges on the image's edges, so a millimetre here is a known place on the
 * picture — and `u` turns it into the device units the UI is laid out in.
 *
 * Every position below is from the top-left corner of the body, y down.
 */

/** The body: 140 × 210 mm, exactly the UI's 1024 × 1536 unit box. */
export const BODY_MM = { w: 140, h: 210 }
export const DEVICE_UNITS = { w: 1024, h: 1536 }

/** Device units per millimetre. */
const UNITS_PER_MM = DEVICE_UNITS.w / BODY_MM.w

/** Millimetres → device units, rounded to a hundredth. */
export const u = (mm: number) => Math.round(mm * UNITS_PER_MM * 100) / 100

/** The main screen: a 128 mm square, 6 mm in from the top and both sides. */
export const SCREEN_MM = { x: 6, y: 6, size: 128 }

/** The pads: 30 mm squares. The CAD's columns are not quite an even grid
    (the last gap is 3 mm, the others 3.5), so each column is listed. */
export const PAD_MM = 30
export const PAD_COLS_MM = [5, 38.5, 72, 105]
export const PAD_ROWS_MM = [141.5, 175]

/** The round screen set into each pad, centred on it. */
export const PAD_SCREEN_MM = 17

/** The body's corner radius, for the shadow under it. */
export const CORNER_MM = 4

/** Where pad `index` (row-major, 4 × 2) sits, in device units. */
export function padRect(index: number) {
  const col = index % 4
  const row = Math.floor(index / 4)
  return { x: u(PAD_COLS_MM[col]), y: u(PAD_ROWS_MM[row]), size: u(PAD_MM) }
}
