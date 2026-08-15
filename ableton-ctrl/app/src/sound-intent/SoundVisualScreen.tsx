import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useSoundIntent } from './session.tsx'
import { useSession as useRhythmicIntent } from '../rhythmic-intent/session.tsx'
import { BEATS_PER_LOOP } from '../rhythmic-intent/types.ts'
import { SOUND_MAX, SOUND_MIN } from './types.ts'
import { useFx } from '../fx/session.tsx'
import { FX_MAX, FX_MIN, type FxParams } from '../fx/types.ts'
import type { PatternId } from '../selector/patterns.ts'
import './sound-intent.css'

/** The direction a speck strays in when REVERB scatters the field: a fixed
    gaussian vector, drawn once at spawn. Fixed is the point — raising REVERB
    then walks each speck steadily out along its own line instead of reshuffling
    the cloud on every frame. */
type Stray = { jx: number; jy: number }

/** One speck of the blot's solid body — the sound as it is struck. Coordinates
    are device pixels, offset from the canvas centre. Cores never move of their
    own accord: how long a sound rings on must not disturb how it landed. */
type CoreSpeck = { x: number; y: number } & Stray

/** One speck of a tail — the sound ringing on after the strike. Its final
    position is computed analytically at spawn (polar, on the ring), so the only
    animation is the moving reveal front that sweeps the tail into existence:
    `revealAt` is when this speck arrives. A rebuilt tail spawns with
    `revealAt = 0`, i.e. already fully swept, so a resize redraws instantly. */
type TailSpeck = { x: number; y: number; alpha: number; revealAt: number } & Stray

/** One grain of a SCATTER patch. Like every other speck it belongs to a mark at
    a moment; what makes it its own type is the alpha, which varies per grain —
    a spatter made of identical specks reads as a soft disc rather than as
    thrown texture. */
type GrainSpeck = { x: number; y: number; alpha: number } & Stray

/** The loop's record: everything on screen is a pure function of this list,
    which is what makes a full re-place possible whenever it changes — a knob
    turned in Rhythmic Intent, a tap added, one deleted, the canvas resized.
    `id` is Rhythmic Intent's tap id, so a mark keeps its identity (and its
    seed, and its snapshot) while `pos` moves underneath it. `energy` and
    `length` are the two mapped Sound Dimensions, `gesture` is the sound
    identity that decides WHICH of the four marks the tap draws and `character`
    is that identity's axis, which decides what that mark LOOKS LIKE within its
    own kind — all snapshotted at the tap, so a later slider move never edits a
    mark that has already sounded. */
type Tap = {
  id: string
  pos: number
  energy: number
  length: number
  seed: number
  gesture: PatternId
  character: number | null
}

// Tuning for the ink-drop look (see reference image 2): a tap lands as a
// defined-radius disc of ink.
const PARTICLES_PER_TAP = 6000
// Cap must cover a dense bar: MAX / PER_TAP ≈ how many blots can coexist.
// At 6k each, 96k holds ~16 taps (a full 1/16 grid); beyond that, spawn
// drops the oldest ink so a new tap never silently draws nothing.
const MAX_CORE_PARTICLES = 96000
const CORE_RADIUS = 0.04 // the circle's radius, as a fraction of min viewport dim
// Share of a tap's nominal ink that forms the disc. Not a wet/dry split any
// more — the diffusing rim is gone, replaced by the length tail below — just
// how dense the body reads.
const CORE_FRACTION = 0.55
// Body uses sqrt sampling (uniform 2D density) + a tiny gaussian edge softener so
// the boundary reads as organic ink rather than a hard-cut circle. This is the
// ink's material quality, not ring-out, so it survives at length 0; set it to
// 0 for a hard-stamped disc.
const EDGE_SOFT = 0.02 // gaussian sigma for body-edge softness, as fraction of minDim
const BASE_ALPHA = 0.7
// The loop mapped as a circle: a tap's 0..1 position becomes an angle, and its
// blot lands on this ring (radius as a fraction of the min viewport dimension).
// Sized by the crowding, not by taste: the loop is eight beats now, so eight
// marks a sixteenth apart have 2π·R/8 of ring between their centres, and a
// full-Energy RIPPLE mark is 2·0.14 wide — they only stay separable from about
// R = 0.35 up. 0.36 is also the ceiling: any further and that same mark, at 12
// or 6 o'clock, would cross the edge of a square canvas (0.36 + 0.14 = 0.5).
// Speck size is deliberately untouched — a bigger ring, the same grain.
const CIRCLE_RADIUS = 0.36
// Beyond this many taps the oldest is forgotten — bounds the cost of the
// full-field rebuild every pattern change triggers.
const MAX_TAPS = 64
// How near a double-click has to land to count as "on" a mark, as a fraction of
// minDim. A shade wider than the biggest blot, so the gesture is forgiving
// without letting a click in open space delete the nearest note across the ring.
const HIT_RADIUS = 0.075

// ── Canvas size → ink density ─────────────────────────────────────────────
// Every length here is a fraction of the canvas's min dimension, so a mark
// scales with the window. Its INK did not: both the speck count and the speck
// size were fixed, so at twice the size the same ink was spread over four times
// the area and the whole field read washed out. `ink` below is the correction —
// one factor from the canvas size, applied to both halves of coverage
// (count × speck area), half to each: the count grows linearly so the cost does
// too, and the speck grows only as its square root so the grain stays grain
// instead of turning into visible squares.
//
// REF_MIN_DIM is the canvas the numbers above were tuned against — the min
// dimension of the small window the visual was first designed in. Only growth is
// corrected: below the reference the factor pins at 1, so a window dragged
// smaller keeps the look it has always had. MAX_INK bounds the correction, and
// with it the per-frame cost, at the far end (a maximized window on a zoomed-in
// canvas); past that the field does start thinning again.
const REF_MIN_DIM = 500 // CSS px
const MAX_INK = 4

// ── Energy → tap blot ─────────────────────────────────────────────────────
// The Energy dimension (Sound Intent's first slider, mapped to the rack's
// "Energy" macro) sets the size and density of the blot each tap deposits,
// captured from the tap's own snapshot. Higher Energy → a BIGGER, DENSER (finer)
// circle; lower Energy → a SMALLER, LOOSER (sparser) one. Radius grows modestly
// while the particle count grows faster, so a high-energy blot reads as both
// larger and tighter, not just scaled up.
const ENERGY_MIN_RADIUS = 0.55 // radius multiplier on CORE_RADIUS at energy 0
const ENERGY_MAX_RADIUS = 1.4 // …and at energy 100
const ENERGY_MIN_DENSITY = 0.12 // share of PARTICLES_PER_TAP at energy 0
const ENERGY_MAX_DENSITY = 1 // …and at energy 100

// ── Character → variation within a mark ───────────────────────────────────
// The v0.3 addition, and the whole point of it: identity says WHICH mark, and
// character says what that mark is LIKE. Two HITs are both solid discs and
// still visibly a soft one and a hard one.
//
// Every number here is read from the TAP's own snapshot, never from the
// Selector. Moving a slider changes what the next mark will be and nothing
// about the ones already on the ring — the canvas is a record, not a view.
//
// HIT — SOFT ←→ HARD. Its axis IS Energy (see kit.ts), so a hit with a
// character uses it in place of the global ENERGY and gets that dimension's
// existing size-and-density treatment for free. What is new is the
// DISTRIBUTION: a soft hit is an even, fuzzy-edged cloud with no middle; a hard
// one gathers its ink into a genuinely dark core behind a tighter edge. Same
// disc either way — the mark never becomes another shape.
const HIT_SOFT_CLUSTER = 0.5 // radius sampling exponent: 0.5 is an even disc…
const HIT_HARD_CLUSTER = 0.33 // …and below it the ink pulls into the centre
const HIT_SOFT_EDGE = 2.4 // multiplier on EDGE_SOFT — soft bleeds outward…
const HIT_HARD_EDGE = 0.6 // …and hard stops where it stops

// TICK — ROUNDED ←→ CRISPY. The ring stays hollow at every point of the
// travel; what changes is its size and whether it is one line or many marks.
// Rounded is a small unbroken contour; crispy is a wider circle divided into
// separate arcs, each holding less and less of its share — the same shape gone
// granular, which is what the Selector's preview shows too.
const TICK_ROUND_SCALE = 0.85 // multiplier on TICK_RADIUS when fully rounded…
const TICK_CRISP_SCALE = 1.38 // …and when fully crispy
const TICK_BREAK_FROM = 0.18 // below this the contour stays solid
const TICK_MIN_SEGMENTS = 8
const TICK_MAX_SEGMENTS = 20
const TICK_MIN_DUTY = 0.3 // share of a segment that stays ink, at fully crispy

// SCATTER — AIRY ←→ DENSE. How occupied the patch is, three ways at once: how
// many grains it holds, how strongly each prints, and how much of it lies
// outside the clumps. Airy is a few separated specklings; dense closes the
// patch up. Character owns this axis alone — ENERGY deliberately does NOT also
// scale it, because two controls fighting over one quantity is how a prototype
// stops telling you anything.
const SCATTER_AIRY_COUNT = 0.35 // share of SCATTER_GRAINS at airy…
const SCATTER_DENSE_COUNT = 1.4 // …and at dense
const SCATTER_AIRY_INK = 0.55 // multiplier on SCATTER_ALPHA at airy…
const SCATTER_DENSE_INK = 1.3 // …and at dense
const SCATTER_AIRY_LOOSE = 0.24 // share of grains free of a clump at airy…
const SCATTER_DENSE_LOOSE = 0.66 // …and at dense, where the patch evens out

// ── Length → ink tail ─────────────────────────────────────────────────────
// LENGTH is Sound Intent's second dimension: how long a sound rings on after it
// is struck. On this canvas time IS the angle around the circle, so length gets
// drawn literally — the tail is an ARC OF THE RING, sweeping clockwise from the
// mark for as long as the sound lasts, never scattering outward in all
// directions. Set it high enough and neighbouring marks' tails merge into one
// continuous band, which is what a bar of long notes actually sounds like.
//
// This effect was FX's REVERB slider, and the move is more than a rename: a
// length belongs to the SOUND, so it is snapshotted per tap exactly like Energy
// — dragging the slider changes the next tap and never edits the marks already
// on the ring. (FX's REVERB keeps its Live macro and is due a visual of its own,
// one that does re-render the whole field, because that is what a property of
// the room should do.)
//
// One 0..100 slider drives the three quantities a ring-out has. All three are
// tuned here, at the endpoints; the slider itself never learns about them.
// Insert Math.pow(v, k) below to bend any of the three curves.
const TAIL_PER_TAP = 4000 // nominal tail ink per tap, before energy/body
const MAX_TAIL_PARTICLES = 80000
// DURATION — how far around the ring the tail carries, in radians. The loop is
// 2π, so 1.2 rad ≈ 19% of the loop ≈ six sixteenths. MIN is 0 by contract: at
// length 0 the sound stops dead and nothing leaves the mark.
const LENGTH_MIN_ARC = 0
const LENGTH_MAX_ARC = 1.2
// DURATION — lateral scatter either side of the ring, as a fraction of minDim.
// A sound that carries also loosens as it goes, instead of staying a hairline.
const LENGTH_MAX_SPREAD = 0.03
// …and how wide the tail starts, as a share of that: it leaves the mark narrow
// and opens out as it dies away.
const TAIL_HEAD_WIDTH = 0.2
// BODY — share of TAIL_PER_TAP that becomes tail ink at length 100. This is the
// only thing it scales; head alpha stays put so a low setting reads as "a short
// sound" rather than "nearly invisible".
const LENGTH_MAX_BODY = 0.9
// BODY — ink strength where the tail leaves the mark, as a multiple of BASE_ALPHA.
const TAIL_HEAD_ALPHA = 0.55
// DECAY — exponential alpha falloff along the arc: alpha ∝ exp(-rate · s). A
// steep rate dies within the first fraction of the arc (a note cut short); a
// gentle one carries ink all the way to the end (one that rings out).
const LENGTH_DECAY_STEEP = 7 // just above length 0
const LENGTH_DECAY_GENTLE = 1.6 // at length 100
// Ink density along the arc, biased toward the head. >1 concentrates near the
// mark; 1 is uniform.
const TAIL_BIAS = 1.6
// How long a fresh tail takes to sweep out, in seconds, and the shape of that
// sweep (<1 = fast off the mark, slowing as it decays).
const TAIL_GROWTH_S = 0.9
const TAIL_SWEEP_EASE = 0.75

// ── Tick → a ring ○ ───────────────────────────────────────────────────────
// The hat's mark: HIT's own outline with nothing inside it. One contour, no
// repeats — the whole point of the pair is that ● and ○ are the same mark in
// two states.
//
// Sized a shade wider than the blot at the same Energy, because an outline
// reads smaller than a filled shape of equal radius; ENERGY scales it exactly
// as it scales HIT, so the two stay a matched pair right across the slider.
const TICK_RADIUS = 0.048 // ring radius, as a fraction of minDim
const TICK_BAND = 0.0035 // outline thickness (gaussian sigma), fraction of minDim
const TICK_SPECKS = 1100 // ink in the outline at full density
// TICK, SPLASH and HIT all draw into `cores`, at the same BASE_ALPHA. That is
// on purpose: the three are one graphic system, and what separates them is
// shape alone — filled, hollow, radiating. A hollow mark that were also faint
// would read as a weak HIT rather than as its own thing.

// ── Splash → one solid burst ✳ ────────────────────────────────────────────
// The clap's sharp transient: eight long strokes out of a small, very dense
// middle. Deliberately NOT rings and NOT anything that expands — a clap is one
// instant, so its mark is one shape, complete the moment it lands.
//
// The strokes carry most of the ink and hold their width along their length,
// which is what makes the mark read as something thrown outward rather than as
// a star glyph stamped on the ring.
const SPLASH_CORE_RADIUS = 0.011 // the dense centre, as a fraction of minDim
const SPLASH_RAYS = 8
const SPLASH_REACH = 0.088 // how far a stroke throws, fraction of minDim
const SPLASH_RAY_WIDTH = 0.0038 // stroke half-width at the core (gaussian sigma)
const SPLASH_RAY_TAPER = 0.3 // share of that width lost by the tip
const SPLASH_SPECKS = 2600
const SPLASH_CORE_SHARE = 0.18 // share of the ink held in the centre
// Ink along a stroke: barely biased, so the ray reads as an even line that ends
// rather than as a spike thinning from the moment it leaves.
const SPLASH_RAY_BIAS = 1.15
// Reach varies a little per stroke — a burst is energetic, not engineered.
const SPLASH_REACH_JITTER = 0.22

// ── Scatter → a spattered patch on the ring ───────────────────────────────
// SCATTER is an event like the other three: it lands at its own point of the
// bar circle, as a patch of spattered grain rather than a defined shape. It is
// the same texture the Selector shows, at the same sort of density — a handful
// of soft clumps with grain thrown between them, wider and looser than any of
// the other marks but still plainly a mark AT a time.
//
// Its specks keep their own alpha (unlike the other three) and are drawn first,
// under everything: a patch is atmosphere that happens to have a moment, so it
// should sit behind whatever else shares that corner of the ring.
const SCATTER_PATCH_RADIUS = 0.062 // the patch's extent, as a fraction of minDim
const SCATTER_BLOBS = 8 // soft clumps inside it…
const SCATTER_BLOB_SPREAD = 0.019 // …each this wide (gaussian sigma), fraction of minDim
const SCATTER_GRAINS = 2400 // grains per patch at full density
const MAX_GRAIN_PARTICLES = 44000
// Subtle by contract: the patch has to read as texture rather than as a second
// kind of blot. Each grain also varies within this, so it stays spatter.
const SCATTER_ALPHA = 0.42 // multiple of BASE_ALPHA, at a grain's strongest

// ── The beat grid → where the whole beats are ─────────────────────────────
// The bottom layer, drawn for as long as the loop is open — which is exactly as
// long as you can still play into it. One spoke per beat of the loop, crossing
// the ring the marks sit on, so a tap can be placed against the pulse instead
// of by feel alone. Hairline and nearly white: a guide under the ink, never a
// thing in the picture. It IS part of the picture as far as FX is concerned
// (the tone map runs over it), because it is drawn into the frame rather than
// over it — unlike the playhead, which is an overlay on top of everything.
const GRID_ALPHA = 0.08

// ── Playhead → a light travelling the ring ────────────────────────────────
// The one thing on this canvas that is not a record of what was played: where
// the loop is RIGHT NOW. It is the same playhead Rhythmic Intent draws as a
// vertical line on its 1/16 strip, read from the same session — that strip's
// left-to-right is this ring's clockwise, so the two always point at the same
// moment of the loop.
//
// Not a mark travelling the ring but an ANGULAR gradient over the whole
// canvas: the surface itself is what turns. Its leading edge is the playhead —
// one crisp radius at the current position, the conic gradient's own seam —
// and the tint falls away behind it around the turn, so the frame reads as a
// shadow being dragged clockwise rather than as one more thing on the ring.
//
// Drawn as the last thing in the frame, after the tone map, because it is an
// overlay on the picture and not ink in the room: FX describes where the sound
// is, and the playhead is not a sound.
const PLAYHEAD_ALPHA = 0.05 // tint immediately behind the leading edge
const PLAYHEAD_SWEEP = 0.62 // how far back the tint reaches, in turns

// ── FX → the room, applied at draw time ───────────────────────────────────
// FX is the one thing here that is NOT snapshotted per tap: it describes the
// space every mark sits in, so it is read live and re-renders the whole field
// at once. All three effects are applied while drawing (an offset per speck) or
// straight after (a tone map over the finished frame) — never at spawn. That is
// what lets a slider move re-render the bar without disturbing a single piece
// of the geometry the taps laid down.

// REVERB — how far a speck strays from where it was struck, along its own fixed
// direction. At 100 the marks dissolve into cloud: enough to still read the
// rough shape that was played, not enough to read any of its detail.
const REVERB_MAX_SCATTER = 0.045 // gaussian sigma at reverb 100, fraction of minDim

// HIGH PASS FILTER and SATURATE are gradient maps in the Photoshop sense: the
// finished frame's luminance goes in, a re-mapped luminance comes out. Ink here
// is black at some alpha over the white surface, so luminance is just 1 - alpha
// and the whole map collapses into one 256-entry alpha→alpha lookup.
//
// HIGH PASS FILTER — stops are white at 0, BLACK at the pivot, white at 1, and
// the slider slides that pivot from the shadow end to the highlight end. At 0
// the black stop sits on the shadow end and the map is the identity; halfway it
// is a V (both ends white, midtones black — a solarize); at 100 the black stop
// has reached the highlight end and the map is a straight inversion.
const HIGHPASS_MAX_PIVOT = 0.8
// For ANY pivot below 1 — no matter how close — the highlight end (l=1) still
// resolves to that fixed white stop exactly: the right segment's formula is
// (1-pivot)/(1-pivot), which is 1 regardless of how small (1-pivot) gets. Only
// pivot=1 itself, the coincident-stop case, maps l=1 to black. On a photograph
// that coincidence is invisible — almost no pixel sits at exactly l=1. On this
// canvas it is not: the untouched surface around every mark IS l=1, a solid
// spike covering most of the frame, so the coincidence would flip nearly the
// whole canvas on the slider's very last step. HIGHPASS_INVERT_FROM eases that
// final approach into a plain crossfade toward full inversion instead, so the
// surface itself darkens gradually rather than snapping black from 99 to 100.
const HIGHPASS_INVERT_FROM = 0.85
// SATURATE — stops are black at 0, BLACK at the floor, white at 1. Raising the
// floor swallows more and more of the midtones into solid black, so every mark's
// faint edges darken and the darks bleed outward.
const SATURATE_MAX_FLOOR = 0.75

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** HIGH PASS FILTER's map: white → black → white, with the black stop at
    `pivot`. Both degenerate ends are exact, not approximated: pivot 0 is the
    identity and pivot 1 is a full inversion. Above HIGHPASS_INVERT_FROM the
    raw V-shape is crossfaded toward that full inversion (see the constant's
    comment) — everywhere below it, this is the literal 3-stop gradient. */
function highpassMap(l: number, pivot: number): number {
  const vShape =
    pivot <= 0
      ? l
      : pivot >= 1
        ? 1 - l
        : l <= pivot
          ? 1 - l / pivot
          : (l - pivot) / (1 - pivot)
  if (pivot <= HIGHPASS_INVERT_FROM) return vShape
  const u = clamp01((pivot - HIGHPASS_INVERT_FROM) / (1 - HIGHPASS_INVERT_FROM))
  const eased = u * u * (3 - 2 * u) // smoothstep — flat at both ends, so it
  // joins the plain V-shape below HIGHPASS_INVERT_FROM without a kink.
  return lerp(vShape, 1 - l, eased)
}

/** SATURATE's map: everything up to `floor` is crushed to black, the rest ramps
    to white. Floor 0 is the identity. */
function saturateMap(l: number, floor: number): number {
  if (floor <= 0) return l
  if (floor >= 1) return 0
  return l <= floor ? 0 : (l - floor) / (1 - floor)
}

/**
 * Both tone maps folded into one alpha→alpha table, applied in panel order
 * (HIGH PASS FILTER first, then SATURATE). Returns null when neither slider is
 * engaged — the frame then skips the post-process entirely, which is what makes
 * "0 changes nothing" literally true rather than just visually true.
 */
function buildToneLut(highpass: number, saturate: number): Uint8Array | null {
  const pivot = HIGHPASS_MAX_PIVOT * clamp01((highpass - FX_MIN) / (FX_MAX - FX_MIN))
  const floor = SATURATE_MAX_FLOOR * clamp01((saturate - FX_MIN) / (FX_MAX - FX_MIN))
  if (pivot <= 0 && floor <= 0) return null
  const lut = new Uint8Array(256)
  for (let a = 0; a < 256; a++) {
    const l = 1 - a / 255 // black ink at alpha a over white reads as this grey
    const mapped = saturateMap(highpassMap(l, pivot), floor)
    lut[a] = Math.round(clamp01(1 - mapped) * 255)
  }
  return lut
}

/** Standard-normal sample (Box–Muller) drawn from `rand`. */
function gaussianFrom(rand: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** mulberry32 — a small seeded PRNG. Every tap carries a seed so its mark and
    its tail are reproducible: a resize re-rolls the geometry but not the
    randomness, and the bar redraws as itself instead of reshuffling. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Canvas-owned diffusion visual. React owns the page/state; the canvas owns all
 * drawing, animation, and the particle sim. Each tap lands on a big circle —
 * the bar's timeline bent into a ring (12 o'clock is the bar start, clockwise)
 * — as the mark of whichever of the four sound identities fired it:
 *
 *   HIT     ● a solid ink blot          (the kick)
 *   TICK    ○ a ring, whole or broken   (the hat)
 *   SPLASH  ✳ one solid radial burst    (the clap)
 *   SCATTER · a spattered patch of grain (the noise)
 *
 * All four are marks at a moment. What separates SCATTER is only that it is
 * texture rather than a shape — a wider, looser patch, drawn underneath the
 * others where they overlap. Sound Intent's LENGTH then smears each mark but
 * that one into a clockwise tail — how long the sound rings on.
 *
 * Marks persist; the ring only clears on RESET or on the tap that begins a
 * fresh loop. Over all of it turns the playhead: the same position Rhythmic
 * Intent's line marks, drawn here as an angular gradient sweeping the whole
 * canvas clockwise.
 *
 * The split that runs through the whole canvas: what a tap laid down belongs to
 * the tap — Energy sizes the mark, Length carries it forward, both read from
 * that tap's own snapshot, so moving a Sound Intent slider changes the next tap
 * and nothing already on the ring. FX is the other half: it belongs to the room,
 * is read live, and re-renders every mark at once (scatter while drawing, tone
 * map straight after) without touching the geometry underneath.
 */
/** What a tap sounded like, kept here and keyed by the tap's id. Rhythmic
    Intent owns WHEN each tap is; this owns WHAT it was. */
type Snapshot = {
  energy: number
  length: number
  seed: number
  gesture: PatternId
  character: number | null
}

/** A seed for a tap that arrived without one — a pattern loaded from the
    Collection, or a physical pad tap that never passed through the GUI. Derived
    from the id so the mark still redraws as itself across a resize. */
function seedFromId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return h >>> 0
}

export function SoundVisualScreen() {
  const { onTap, params: soundParams } = useSoundIntent()
  const { params: fx } = useFx()
  const { rendered, playhead, removeTap, undoTap, canUndo, clearPattern } = useRhythmicIntent()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Bridges from the sim (inside the effect) out to React.
  const setMarksRef = useRef<((marks: readonly Tap[]) => void) | null>(null)
  const setFxRef = useRef<((params: FxParams) => void) | null>(null)
  const scheduleRef = useRef<(() => void) | null>(null)

  // ── What each tap sounded like ──────────────────────────────────────
  // Filled the moment a tap fires and read back for as long as that tap is in
  // the loop, so an edit or a knob move re-places the mark it already drew
  // instead of restyling it with whatever the sliders say now.
  const snapshotsRef = useRef(new Map<string, Snapshot>())
  const soundParamsRef = useRef(soundParams)
  soundParamsRef.current = soundParams

  useEffect(
    () =>
      onTap((tap) => {
        snapshotsRef.current.set(tap.id, {
          energy: tap.params.d1,
          length: tap.params.d2,
          seed: (Math.random() * 0xffffffff) >>> 0,
          gesture: tap.gesture,
          character: tap.character,
        })
      }),
    [onTap],
  )

  // The field the canvas draws: Rhythmic Intent's transformed pattern, joined
  // with the snapshots. Every knob turn produces a new `rendered`, so the marks
  // move with TIGHTNESS and PHASE, and DENSITY simply drops the ones it silences
  // — the image and the loop are the same pattern, always.
  const marks = useMemo(
    () =>
      rendered
        .filter((t) => t.kept)
        .slice(-MAX_TAPS)
        .map((t) => {
          let snapshot = snapshotsRef.current.get(t.id)
          if (!snapshot) {
            const p = soundParamsRef.current
            snapshot = {
              energy: p.d1,
              length: p.d2,
              seed: seedFromId(t.id),
              // The tap itself remembers which identity and character it was
              // played with — that is what survives a Collection entry being
              // loaded back, so a reloaded pattern draws the marks it was
              // played with rather than four identical blots. A tap with
              // neither came from a hardware pad.
              gesture: t.voice ?? 'hit',
              character: t.character ?? null,
            }
            snapshotsRef.current.set(t.id, snapshot)
          }
          return { id: t.id, pos: t.finalPos, ...snapshot }
        }),
    [rendered],
  )

  const marksRef = useRef(marks)
  marksRef.current = marks

  useEffect(() => {
    setMarksRef.current?.(marks)
  }, [marks])
  // Read once when the sim starts; after that the effect below pushes changes.
  const fxRef = useRef(fx)
  fxRef.current = fx

  // The session's one playhead, mirrored into a ref rather than read at draw
  // time: it moves every frame, and the canvas — not React — is what redraws it.
  const playheadRef = useRef(playhead)
  playheadRef.current = playhead
  const playheadOn = playhead !== null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // The field is drawn into this and blitted from it thereafter. Left on the
    // default (accelerated) backing on purpose: the blit happens every frame
    // and the pixel read-back only when a tone map is engaged, so this is the
    // way round that keeps the frequent operation the cheap one.
    const buffer = document.createElement('canvas')
    const field = buffer.getContext('2d')
    if (!field) return

    const taps: Tap[] = []
    // HIT's blot, TICK's ring and SPLASH's burst all live here: three shapes,
    // one kind of speck, one draw pass.
    const cores: CoreSpeck[] = []
    const tails: TailSpeck[] = []
    // SCATTER's patches, kept apart because they are drawn first and faintest.
    const grains: GrainSpeck[] = []
    let width = 0
    let height = 0
    let dpr = 1
    let rafId = 0
    // The canvas redraws while this is still in the future — tails are being
    // swept out. Once it passes, every mark is fixed and the last frame simply
    // stays. Nothing else here animates: all four marks land complete.
    let revealUntil = 0
    // Was the last frame one of those? Kept so the frame *after* an animation
    // ends still repaints the field once, at its finished state.
    let wasAnimating = false
    // The buffered field is stale and must be re-painted before the next blit —
    // and `fieldGrid` remembers whether it was painted with the beat grid, which
    // comes and goes with the loop.
    let fieldDirty = true
    let fieldGrid = false
    // A pattern waiting to be placed, applied at the top of the next frame.
    let pendingMarks: readonly Tap[] | null = null
    // The room, read live rather than snapshotted (see the FX block above).
    // `scatter` is REVERB's 0..1 amount; `toneLut` is null while both tone
    // sliders are at 0, and the post-process is skipped entirely.
    let scatter = 0
    let toneLut: Uint8Array | null = null

    const minDim = () => Math.min(width, height)
    /** Ink correction for a canvas bigger than the reference; 1 at or below it.
        Read in CSS px so device pixel ratio stays out of the look. */
    const ink = () => Math.min(MAX_INK, Math.max(1, minDim() / dpr / REF_MIN_DIM))

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width * dpr))
      height = Math.max(1, Math.round(rect.height * dpr))
      canvas.width = width
      canvas.height = height
      buffer.width = width
      buffer.height = height
      // Geometry is in device pixels, so a resize invalidates every speck.
      // Seeded taps make this a faithful redraw, not a reshuffle.
      rebuildAll()
    }

    // ── Spawning ────────────────────────────────────────────────────────

    /** Where a mark sits: the bar bent into a ring, 0 at 12 o'clock, clockwise
        around. Shared by the three marks that have a moment; SCATTER, which has
        none, never calls it. */
    const markCentre = (tap: Tap, dim: number) => {
      const theta = tap.pos * Math.PI * 2 - Math.PI / 2
      return { ox: Math.cos(theta) * CIRCLE_RADIUS * dim, oy: Math.sin(theta) * CIRCLE_RADIUS * dim }
    }

    /** Make room for `count` more core specks by shedding the oldest ink. Every
        mark lands complete: a bar denser than the cap loses its earliest marks
        rather than spawning a late tap with nothing in it. The cap rides the
        ink correction, so it still means "a full 1/16 bar of marks" rather than
        "fewer taps the bigger the window gets". */
    const makeRoom = (count: number, inkScale: number) => {
      const overflow = cores.length + count - Math.round(MAX_CORE_PARTICLES * inkScale)
      if (overflow > 0) cores.splice(0, overflow)
    }

    /** The tap's ENERGY as 0..1 — how hard the whole instrument is being
        played, read from its snapshot. */
    const energyOf = (tap: Tap) => clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))

    /** The tap's character as 0..1, or 0.5 for an identity that has no axis —
        SPLASH, which is drawn the same way every time by design. */
    const characterOf = (tap: Tap) => (tap.character === null ? 0.5 : clamp01(tap.character))

    /** TICK's ring radius: ENERGY sizes it as it sizes every mark, and ROUNDED
        → CRISPY widens it on top. Shared with the tail, which has to know where
        the hollow is in order to keep out of it. */
    const tickRingRadius = (tap: Tap, dim: number) =>
      TICK_RADIUS *
      lerp(ENERGY_MIN_RADIUS, ENERGY_MAX_RADIUS, energyOf(tap)) *
      lerp(TICK_ROUND_SCALE, TICK_CRISP_SCALE, characterOf(tap)) *
      dim

    /**
     * The HIT blot, SOFT ←→ HARD.
     *
     * Its character IS Energy, so a hit that carries one uses it in place of
     * the global ENERGY and inherits that dimension's size and density
     * treatment unchanged — which is what "map the existing parameter onto the
     * slider" has to mean if it is to mean anything. On top of that the
     * character redistributes the ink: soft spreads evenly and bleeds at the
     * edge, hard pulls into a dark core behind a tighter one.
     *
     * FX never re-spawns this, only re-draws it.
     */
    const spawnCore = (tap: Tap) => {
      const dim = minDim()
      const rand = makeRng(tap.seed)
      // Character replaces ENERGY for a hit rather than multiplying it: one
      // quantity, one control. A hit with no character (a hardware pad's) still
      // reads the global dimension, exactly as before.
      const e = tap.character === null ? energyOf(tap) : clamp01(tap.character)
      const coreR = CORE_RADIUS * lerp(ENERGY_MIN_RADIUS, ENERGY_MAX_RADIUS, e) * dim
      const cluster = lerp(HIT_SOFT_CLUSTER, HIT_HARD_CLUSTER, e)
      const edge = EDGE_SOFT * lerp(HIT_SOFT_EDGE, HIT_HARD_EDGE, e) * dim
      const inkScale = ink()
      const count = Math.max(
        1,
        Math.round(
          PARTICLES_PER_TAP *
            CORE_FRACTION *
            lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e) *
            inkScale,
        ),
      )
      const { ox, oy } = markCentre(tap, dim)
      makeRoom(count, inkScale)
      for (let i = 0; i < count; i++) {
        // The exponent is the whole soft/hard distribution: 0.5 is sqrt
        // sampling, i.e. uniform 2D density with no centre spike, and anything
        // below it gathers ink toward the middle. The gaussian softener then
        // lets the boundary bleed — a lot when soft, barely at all when hard.
        const angle = rand() * Math.PI * 2
        const radius = Math.max(
          0,
          coreR * Math.pow(rand(), cluster) + gaussianFrom(rand) * edge,
        )
        cores.push({
          x: ox + Math.cos(angle) * radius,
          y: oy + Math.sin(angle) * radius,
          jx: gaussianFrom(rand),
          jy: gaussianFrom(rand),
        })
      }
    }

    /**
     * The TICK mark, ROUNDED ←→ CRISPY: a ring on the tap's point of the bar
     * circle.
     *
     * The same specks and the same alpha as the blot, placed on a circle
     * instead of through a disc — which is the whole relationship between the
     * two sounds, drawn. Nothing repeats: what a hat has is an outline and an
     * inside that stays empty.
     *
     * Character widens that circle and BREAKS it. Rounded is one small
     * unbroken contour; crispy is a larger one divided into separate arcs. The
     * break is done by choosing which arc each speck belongs to rather than by
     * masking a finished ring — same cost, and the arcs come out with definite
     * ends instead of feathered ones, which is what "crisp" means here.
     */
    const spawnTickRing = (tap: Tap) => {
      const dim = minDim()
      const rand = makeRng(tap.seed)
      const e = energyOf(tap)
      const c = characterOf(tap)
      const ringR = tickRingRadius(tap, dim)
      const band = TICK_BAND * dim
      // How broken the contour is. Solid until TICK_BREAK_FROM: a hat that is
      // only slightly crisp should not already be a dotted line.
      const b = clamp01((c - TICK_BREAK_FROM) / (1 - TICK_BREAK_FROM))
      const segments = Math.round(lerp(TICK_MIN_SEGMENTS, TICK_MAX_SEGMENTS, b))
      const duty = lerp(1, TICK_MIN_DUTY, b)
      const step = (Math.PI * 2) / segments
      const inkScale = ink()
      const count = Math.max(
        1,
        Math.round(TICK_SPECKS * lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e) * inkScale),
      )
      const { ox, oy } = markCentre(tap, dim)
      makeRoom(count, inkScale)
      for (let i = 0; i < count; i++) {
        // Pick an arc, then a place inside the share of it that is still ink.
        // At duty 1 this is exactly a uniform angle round the whole circle.
        const angle = (Math.floor(rand() * segments) + 0.5 + (rand() - 0.5) * duty) * step
        // The band is what keeps the outline ink rather than a drawn stroke —
        // a hairline of specks scattered either side of the true circle.
        const radius = ringR + gaussianFrom(rand) * band
        if (radius <= 0) continue
        cores.push({
          x: ox + Math.cos(angle) * radius,
          y: oy + Math.sin(angle) * radius,
          jx: gaussianFrom(rand),
          jy: gaussianFrom(rand),
        })
      }
    }

    /**
     * The SPLASH mark: a solid impact throwing eight spikes, all of it landing
     * at once. Most of the ink goes into the spikes, biased toward the centre
     * and narrowing to points, so the mark reads as energy leaving one place
     * rather than as a drawn star.
     */
    const spawnSplash = (tap: Tap) => {
      const dim = minDim()
      const rand = makeRng(tap.seed)
      const e = clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))
      const scale = lerp(ENERGY_MIN_RADIUS, ENERGY_MAX_RADIUS, e)
      const coreR = SPLASH_CORE_RADIUS * scale * dim
      const reach = SPLASH_REACH * scale * dim
      const inkScale = ink()
      const total = Math.max(
        1,
        Math.round(SPLASH_SPECKS * lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e) * inkScale),
      )
      const coreCount = Math.round(total * SPLASH_CORE_SHARE)
      const { ox, oy } = markCentre(tap, dim)
      makeRoom(total, inkScale)

      // The impact itself — the same uniform disc HIT uses, at a fraction of
      // the size, so the centre of a SPLASH is unmistakably solid.
      for (let i = 0; i < coreCount; i++) {
        const angle = rand() * Math.PI * 2
        const radius = coreR * Math.sqrt(rand())
        cores.push({
          x: ox + Math.cos(angle) * radius,
          y: oy + Math.sin(angle) * radius,
          jx: gaussianFrom(rand),
          jy: gaussianFrom(rand),
        })
      }

      // …and the strokes out of it. Each speck picks a ray, a distance along it
      // and a lateral offset. The width is held nearly constant along the
      // stroke rather than closing to a point, which is what makes it read as a
      // thrown line instead of a spike.
      for (let i = coreCount; i < total; i++) {
        const ray = Math.floor(rand() * SPLASH_RAYS)
        // One stroke points straight up, matching the Selector icon.
        const angle = (ray / SPLASH_RAYS) * Math.PI * 2 - Math.PI / 2
        const t = Math.pow(rand(), SPLASH_RAY_BIAS)
        const along = t * reach * (1 + (rand() - 0.5) * SPLASH_REACH_JITTER)
        const width = SPLASH_RAY_WIDTH * dim * (1 - SPLASH_RAY_TAPER * t) * scale
        const lateral = gaussianFrom(rand) * width
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        cores.push({
          // Along the ray, then off it at right angles.
          x: ox + cos * along - sin * lateral,
          y: oy + sin * along + cos * lateral,
          jx: gaussianFrom(rand),
          jy: gaussianFrom(rand),
        })
      }
    }

    /**
     * The SCATTER mark: a spattered patch at the tap's own point of the bar
     * circle.
     *
     * An event like the other three, and placed like them — but where they are
     * shapes, this is texture: a handful of soft clumps with grain thrown
     * between them, the same thing the Selector shows and at about the same
     * density. Wider and looser than any other mark, so it still reads as noise
     * rather than as a fourth kind of blot, but it has a moment and sits at it.
     *
     * AIRY ←→ DENSE is how occupied the patch is, moved three ways at once: how
     * many grains, how strongly each prints, and how much of it lies outside
     * the clumps. Airy is a few separated specklings; dense closes it up. It
     * stays a spatter at both ends — many things, never one thing.
     */
    const spawnScatter = (tap: Tap) => {
      const dim = minDim()
      const rand = makeRng(tap.seed)
      const c = characterOf(tap)
      const inkScale = ink()
      // Character owns this patch's density outright; ENERGY is deliberately
      // absent (see the constants above).
      const count = Math.max(
        1,
        Math.round(SCATTER_GRAINS * lerp(SCATTER_AIRY_COUNT, SCATTER_DENSE_COUNT, c) * inkScale),
      )
      const strength = SCATTER_ALPHA * lerp(SCATTER_AIRY_INK, SCATTER_DENSE_INK, c)
      const loose = lerp(SCATTER_AIRY_LOOSE, SCATTER_DENSE_LOOSE, c)
      const overflow = grains.length + count - Math.round(MAX_GRAIN_PARTICLES * inkScale)
      if (overflow > 0) grains.splice(0, overflow)

      const { ox, oy } = markCentre(tap, dim)
      const patchR = SCATTER_PATCH_RADIUS * dim

      // The clumps the grain gathers into. Without them the patch is evenly
      // seeded and reads as a soft disc; with them it has thin and thick
      // passages, which is what a spatter actually looks like — and at the airy
      // end those passages ARE the negative space.
      const blobs = new Array<{ cx: number; cy: number; sigma: number }>(SCATTER_BLOBS)
      for (let k = 0; k < SCATTER_BLOBS; k++) {
        // sqrt keeps the clumps evenly spread through the patch rather than
        // piled at its middle.
        const angle = rand() * Math.PI * 2
        const radius = patchR * Math.sqrt(rand())
        blobs[k] = {
          cx: ox + Math.cos(angle) * radius,
          cy: oy + Math.sin(angle) * radius,
          sigma: (0.45 + rand()) * SCATTER_BLOB_SPREAD * dim,
        }
      }

      for (let i = 0; i < count; i++) {
        let x: number
        let y: number
        if (rand() < loose) {
          // Free grain, anywhere in the patch — the spatter between the clumps.
          const angle = rand() * Math.PI * 2
          const radius = patchR * Math.sqrt(rand())
          x = ox + Math.cos(angle) * radius
          y = oy + Math.sin(angle) * radius
        } else {
          const blob = blobs[Math.floor(rand() * SCATTER_BLOBS)]
          x = blob.cx + gaussianFrom(rand) * blob.sigma
          y = blob.cy + gaussianFrom(rand) * blob.sigma
        }
        grains.push({
          x,
          y,
          // Varied per grain: an even alpha over thousands of specks is a grey
          // wash, and this has to stay grain.
          alpha: BASE_ALPHA * strength * (0.3 + 0.7 * rand()),
          jx: gaussianFrom(rand),
          jy: gaussianFrom(rand),
        })
      }
    }

    /** One tap, one mark — which one is the sound identity's business. All four
        land complete, so none of them needs the clock. */
    const spawnMark = (tap: Tap) => {
      switch (tap.gesture) {
        case 'tick':
          spawnTickRing(tap)
          break
        case 'splash':
          spawnSplash(tap)
          break
        case 'scatter':
          spawnScatter(tap)
          break
        default:
          spawnCore(tap)
      }
    }

    /**
     * The tail: Length's territory, read from the tap's own snapshot. `sweep`
     * is true for a live tap (the tail rings out of the mark over
     * TAIL_GROWTH_S) and false for a rebuild, where every speck is placed at
     * once because the canvas changed size, not the sound.
     */
    const spawnTail = (tap: Tap, sweep: boolean, now: number) => {
      // SCATTER is already a spread of ink across a patch; a tail smeared out
      // of it would run into whatever shares that stretch of the ring and stop
      // both marks reading. Its length is heard, not drawn.
      if (tap.gesture === 'scatter') return
      const v = clamp01((tap.length - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))
      if (v <= 0) return // length 0 — the sound stops dead, nothing leaves the mark

      const dim = minDim()
      // Tail randomness is its own stream, so re-placing tails leaves the mark
      // untouched and vice versa.
      const rand = makeRng(tap.seed ^ 0x9e3779b9)
      const e = clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))

      const body = LENGTH_MAX_BODY * v
      const arc = lerp(LENGTH_MIN_ARC, LENGTH_MAX_ARC, v)
      const spread = LENGTH_MAX_SPREAD * v
      const decay = lerp(LENGTH_DECAY_STEEP, LENGTH_DECAY_GENTLE, v)

      const inkScale = ink()
      const count = Math.round(
        TAIL_PER_TAP * lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e) * body * inkScale,
      )
      if (count <= 0) return

      const overflow = tails.length + count - Math.round(MAX_TAIL_PARTICLES * inkScale)
      if (overflow > 0) tails.splice(0, overflow)

      const theta0 = tap.pos * Math.PI * 2 - Math.PI / 2
      const ringR = CIRCLE_RADIUS * dim
      // TICK is the one mark whose inside is part of what it means. The tail is
      // densest at its head, so left alone it fills that inside with ink and
      // the circle stops reading as hollow — the whole distinction from HIT,
      // lost to an unrelated slider. So for TICK alone the tail leaves from the
      // outline outward: nothing lands within the circle.
      const { ox, oy } = markCentre(tap, dim)
      const hollowR = tap.gesture === 'tick' ? tickRingRadius(tap, dim) : 0
      for (let i = 0; i < count; i++) {
        // s is 0..1 along the tail, biased toward the head.
        const s = Math.pow(rand(), TAIL_BIAS)
        // Clockwise along the ring — theta increases clockwise on screen.
        const theta = theta0 + s * arc
        // Lateral scatter opens out as the tail decays; it is measured off the
        // ring, so the smear stays wrapped around the circle.
        const lateral =
          gaussianFrom(rand) * spread * (TAIL_HEAD_WIDTH + (1 - TAIL_HEAD_WIDTH) * s) * dim
        const radius = ringR + lateral
        const x = Math.cos(theta) * radius
        const y = Math.sin(theta) * radius
        if (hollowR > 0 && Math.hypot(x - ox, y - oy) < hollowR) continue
        tails.push({
          x,
          y,
          alpha: BASE_ALPHA * TAIL_HEAD_ALPHA * Math.exp(-decay * s),
          revealAt: sweep ? now + TAIL_GROWTH_S * 1000 * Math.pow(s, TAIL_SWEEP_EASE) : 0,
          jx: gaussianFrom(rand),
          jy: gaussianFrom(rand),
        })
      }
      if (sweep) revealUntil = Math.max(revealUntil, now + TAIL_GROWTH_S * 1000)
    }

    // ── Rebuilds ────────────────────────────────────────────────────────
    // Only the canvas geometry can invalidate what is drawn now that every
    // dimension is snapshotted per tap: no slider rebuilds anything.
    const scheduleDraw = () => {
      if (!rafId) rafId = requestAnimationFrame(frame)
    }

    /** The canvas geometry changed: everything must be re-placed. */
    const rebuildAll = () => {
      cores.length = 0
      tails.length = 0
      grains.length = 0
      revealUntil = 0
      const now = performance.now()
      for (const tap of taps) {
        spawnMark(tap)
        spawnTail(tap, false, now)
      }
      fieldDirty = true
      scheduleDraw()
    }

    /** The room changed: same marks, drawn differently. No geometry is touched
        — only the stray distance and the tone table, both read by `frame`. */
    const setFx = (params: FxParams) => {
      scatter = clamp01((params.reverb - FX_MIN) / (FX_MAX - FX_MIN))
      toneLut = buildToneLut(params.highpass, params.saturate)
      fieldDirty = true
      scheduleDraw()
    }

    /**
     * The pattern changed: a tap added, one deleted or undone, a knob turned.
     * Everything is re-placed from the new list — seeded per tap id, so a mark
     * that only moved redraws as itself at its new angle. Only marks that were
     * not here a moment ago animate (the tail sweeping out); the rest arrive
     * already finished, because nothing about THEM just happened.
     */
    const applyMarks = (next: readonly Tap[], now: number) => {
      const before = new Set(taps.map((t) => t.id))
      taps.length = 0
      taps.push(...next)
      cores.length = 0
      tails.length = 0
      grains.length = 0
      revealUntil = 0
      for (const tap of taps) {
        const fresh = !before.has(tap.id)
        spawnMark(tap)
        spawnTail(tap, fresh, now)
      }
      fieldDirty = true
    }

    /** Re-placing every speck is the expensive thing here, and a knob being
        dragged asks for it faster than the screen can show it. So the list is
        only remembered, and the work happens once, in the next frame. */
    const setMarks = (next: readonly Tap[]) => {
      pendingMarks = next
      scheduleDraw()
    }

    setMarksRef.current = setMarks
    setFxRef.current = setFx
    scheduleRef.current = scheduleDraw

    // ── Drawing ─────────────────────────────────────────────────────────

    /**
     * The field — grid, marks, tails, ripples, tone map — painted into the
     * buffer rather than onto the screen. It only has to be re-painted when
     * something in it actually changes, which is what keeps the playhead's 60 Hz
     * off the back of a hundred thousand specks: a frame that only turns the
     * gradient blits this instead of re-laying the ink.
     */
    const paintField = (now: number) => {
      field.clearRect(0, 0, width, height)

      const cx = width / 2
      const cy = height / 2
      // One speck. It carries the square root of the ink correction (the count
      // carries the other half), and stays fractional on purpose: rounding it
      // would step the whole field's density 4× at the crossover while a window
      // is being dragged.
      const dot = Math.max(1, Math.round(dpr)) * Math.sqrt(ink())
      // REVERB, in device px: every speck is offset along its own fixed stray
      // direction by this much. 0 draws each speck exactly where it was struck.
      const stray = scatter * REVERB_MAX_SCATTER * minDim()

      if (playheadRef.current !== null) {
        // Spokes run past the corners rather than stopping at the ring: the
        // beat is a direction from the centre, not a segment of the circle.
        const reach = Math.hypot(width, height) / 2
        field.globalAlpha = 1
        field.strokeStyle = `rgba(0, 0, 0, ${GRID_ALPHA})`
        field.lineWidth = Math.max(1, Math.round(dpr))
        field.beginPath()
        for (let beat = 0; beat < BEATS_PER_LOOP; beat++) {
          const theta = (beat / BEATS_PER_LOOP) * Math.PI * 2 - Math.PI / 2
          field.moveTo(cx, cy)
          field.lineTo(cx + Math.cos(theta) * reach, cy + Math.sin(theta) * reach)
        }
        field.stroke()
        field.beginPath()
        field.arc(cx, cy, CIRCLE_RADIUS * minDim(), 0, Math.PI * 2)
        field.stroke()
      }

      field.fillStyle = '#000000'

      // SCATTER patches first, under everything: they are the widest and
      // loosest of the marks, so anything sharing their stretch of the ring
      // should sit on top rather than behind.
      for (const p of grains) {
        field.globalAlpha = p.alpha
        field.fillRect(cx + p.x + p.jx * stray, cy + p.y + p.jy * stray, dot, dot)
      }

      // HIT, TAP and SPLASH — three shapes at one strength.
      field.globalAlpha = BASE_ALPHA
      for (const p of cores) {
        field.fillRect(cx + p.x + p.jx * stray, cy + p.y + p.jy * stray, dot, dot)
      }

      for (const p of tails) {
        if (p.revealAt > now) continue // the sweep hasn't reached this speck yet
        field.globalAlpha = p.alpha
        field.fillRect(cx + p.x + p.jx * stray, cy + p.y + p.jy * stray, dot, dot)
      }
      field.globalAlpha = 1

      // HIGH PASS FILTER + SATURATE, as one pass over the finished field. The
      // ink is black at some alpha, so re-mapping luminance is re-mapping alpha
      // and the RGB bytes can be left alone — including on pixels the taps never
      // touched, which is how an inverting map turns the surface itself black.
      // It also means the tone map lives IN the canvas, so whatever gets
      // snapshotted later is what is on screen — which an SVG/CSS filter, the
      // cheaper way to do this, could not promise. The cost is the read-modify-
      // write over every pixel: ~8ms on a 1116×940 canvas versus ~0.8ms for the
      // ink itself, which is why `toneLut` is null (and this whole block
      // skipped) whenever both sliders sit at 0 — and why this runs on a change
      // rather than on a frame.
      if (toneLut) {
        const image = field.getImageData(0, 0, width, height)
        const d = image.data
        for (let i = 3; i < d.length; i += 4) d[i] = toneLut[d[i]]
        field.putImageData(image, 0, 0)
      }
    }

    /**
     * One frame: the field, then the playhead over it. The field is re-painted
     * only when something in it moved — a pattern change, a room change, a
     * resize, or an animation still running — and otherwise blitted from the
     * buffer, so a turning playhead costs one copy and one gradient.
     */
    const frame = (now: number) => {
      if (pendingMarks) {
        applyMarks(pendingMarks, now)
        pendingMarks = null
      }
      const gridOn = playheadRef.current !== null
      const animating = now < revealUntil
      // `wasAnimating` earns the one extra paint after an animation ends —
      // without it the last specks of a tail would never be swept in.
      if (fieldDirty || animating || wasAnimating || gridOn !== fieldGrid) {
        paintField(now)
        fieldDirty = false
        fieldGrid = gridOn
      }
      wasAnimating = animating

      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(buffer, 0, 0)

      // Where the loop is now, over the top of everything else (see the
      // playhead block above for why it sits outside the tone map).
      const head = playheadRef.current
      if (head !== null) {
        // Same mapping the marks use — 0 at 12 o'clock, clockwise around — so
        // the edge crosses each mark exactly when that tap sounds.
        const theta0 = head * Math.PI * 2 - Math.PI / 2
        // Offset 0 sits on the playhead and runs clockwise from there, so the
        // tint is laid from the far side of the turn (1 - PLAYHEAD_SWEEP) up to
        // offset 1 — which is the same radius as offset 0. That wrap IS the
        // leading edge: full tint on one side of it, nothing on the other.
        const g = ctx.createConicGradient(theta0, width / 2, height / 2)
        const back = 1 - PLAYHEAD_SWEEP
        g.addColorStop(0, 'rgba(0, 0, 0, 0)')
        g.addColorStop(back, 'rgba(0, 0, 0, 0)')
        g.addColorStop(lerp(back, 1, 0.6), `rgba(0, 0, 0, ${PLAYHEAD_ALPHA * 0.3})`)
        g.addColorStop(1, `rgba(0, 0, 0, ${PLAYHEAD_ALPHA})`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#000000'
      }

      // Keep animating while a tail is still sweeping out or the playhead is
      // running; once both have stopped the last frame stays on screen
      // untouched — that frame is the pattern.
      rafId = animating || gridOn ? requestAnimationFrame(frame) : 0
    }

    setFx(fxRef.current) // the room the sim starts in
    setMarks(marksRef.current) // …and the pattern it starts on
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    return () => {
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      setMarksRef.current = null
      setFxRef.current = null
      scheduleRef.current = null
    }
    // The sim is built once and fed through the refs above; nothing it closes
    // over is allowed to re-create it, or every mark would be re-rolled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A room change re-renders the whole field — that is what makes FX an effect
  // rather than one more per-tap dimension.
  useEffect(() => {
    setFxRef.current?.(fx)
  }, [fx])

  // Wake the canvas when the playhead starts (it keeps itself running from
  // there) and once more when it stops, so the last light is wiped off.
  useEffect(() => {
    scheduleRef.current?.()
  }, [playheadOn])

  /** Double-click a mark to take that note out of the loop. The hit test runs
      on the same geometry the canvas draws with — the transformed position, not
      where the tap originally fell — so what you click is what you get. */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    // Client px → device px, measured from the canvas centre, which is where
    // the ring is centred and where every mark's position is measured from.
    const scale = canvas.width / rect.width
    const x = (event.clientX - rect.left) * scale - canvas.width / 2
    const y = (event.clientY - rect.top) * scale - canvas.height / 2
    const dim = Math.min(canvas.width, canvas.height)

    let hit: string | null = null
    let best = HIT_RADIUS * dim
    for (const mark of marksRef.current) {
      const theta = mark.pos * Math.PI * 2 - Math.PI / 2
      const dx = x - Math.cos(theta) * CIRCLE_RADIUS * dim
      const dy = y - Math.sin(theta) * CIRCLE_RADIUS * dim
      const distance = Math.hypot(dx, dy)
      if (distance < best) {
        best = distance
        hit = mark.id
      }
    }
    if (hit) removeTap(hit)
  }

  const handleReset = () => {
    clearPattern()
    snapshotsRef.current.clear()
  }

  return (
    <div className="sv-screen">
      <canvas ref={canvasRef} className="sv-canvas" onDoubleClick={handleDoubleClick} />
      {marks.length === 0 && <div className="sv-hint">Tap to sound</div>}
      <button type="button" className="sv-reset" onClick={handleReset}>
        RESET
      </button>
      <button type="button" className="sv-undo" onClick={undoTap} disabled={!canUndo}>
        UNDO
      </button>
    </div>
  )
}
