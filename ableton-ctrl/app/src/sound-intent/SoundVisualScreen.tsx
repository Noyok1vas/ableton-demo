import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useSoundIntent } from './session.tsx'
import { useSession as useRhythmicIntent } from '../rhythmic-intent/session.tsx'
import { SOUND_MAX, SOUND_MIN } from './types.ts'
import { useFx } from '../fx/session.tsx'
import { FX_MAX, FX_MIN, type FxParams } from '../fx/types.ts'
import {
  PATTERNS,
  type Bounds,
  type Pattern,
  type PatternId,
  type Ringing,
} from '../selector/patterns.ts'
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

/** One speck of a ride's ringing tail. Beyond what a tail speck knows, it
    knows when the ringing reaches it — `at`, as a share of the loop past the
    strike — and how much ringing it takes to show (`needs`, 0..1), so the tail
    can thicken and thin as the ride rings without re-placing a thing. */
type RingSpeck = { x: number; y: number; at: number; needs: number; revealAt: number } & Stray

/** A ride's ringing tail: where in the loop the strike is, how much of the
    loop the ringing covers, and its specks. */
type RingTail = { pos: number; reach: number; specks: RingSpeck[] }

/** The loop's record: everything on screen is a pure function of this list,
    which is what makes a full re-place possible whenever it changes — a knob
    turned in Rhythmic Intent, a tap added, one deleted, the canvas resized.
    `id` is Rhythmic Intent's tap id, so a mark keeps its identity (and its
    seed, and its snapshot) while `pos` moves underneath it. `energy` and
    `length` are the two mapped Sound Dimensions, `gesture` is the sound
    identity that decides WHICH of the eight marks the tap draws and `character`
    is that identity's axis, which decides what that mark LOOKS LIKE within its
    own kind — all snapshotted at the tap, so a later slider move never edits a
    mark that has already sounded. */
type Tap = {
  id: string
  pos: number
  /** How hard it was played, 0..1 — the tap's own, like its position. */
  velocity: number
  energy: number
  length: number
  seed: number
  gesture: PatternId
  character: number | null
}

/** One tap's mark, sampled from its sound's field: every speck the draws so
    far have kept, in field units relative to the mark's origin, with its
    REVERB stray and the draw (`at`) that produced it. `tried` is how many
    draws have been made; `rand` carries on from there when more are needed. */
type SpeckPool = {
  key: string
  pattern: Pattern
  /** The field the specks are drawn from: the pattern's own, or for a mark
      that rings on, the mark without its tail. */
  shape: Pattern['field']
  c: number
  bounds: Bounds
  rand: () => number
  tried: number
  xs: number[]
  ys: number[]
  jxs: number[]
  jys: number[]
  at: number[]
}

const PATTERN_BY_ID = new Map(PATTERNS.map((pattern) => [pattern.id, pattern]))

// Cap on the specks every mark together may hold. A mark holds up to about 2k
// of them at resting ENERGY and velocity and up to about 6k at full, so this
// keeps a whole 1/16 bar of marks; beyond it, spawn drops the oldest ink so a
// new tap never silently draws nothing.
const MAX_CORE_PARTICLES = 128000
const BASE_ALPHA = 0.7
// The loop mapped as a circle: a tap's 0..1 position becomes an angle, and its
// blot lands on this ring (radius as a fraction of the min viewport dimension).
// Sized by the crowding, not by taste: the loop is eight beats now, so eight
// marks a sixteenth apart have 2π·R/8 of ring between their centres, and a
// full-Energy RIPPLE mark is 2·0.14 wide — they only stay separable from about
// R = 0.35 up. 0.36 is also the ceiling: any further and that same mark, at 12
// or 6 o'clock, would cross the edge of a square canvas (0.36 + 0.14 = 0.5).
// Speck size is deliberately untouched — a bigger ring, the same grain.
//
// Brought in to 0.29 once the Main Screen put its controls over the canvas:
// at 0.36 the marks at 12 and 6 o'clock ran under the top and bottom bars.
// Neighbouring sixteenths now touch at full Energy; eighths still separate.
const CIRCLE_RADIUS = 0.29

// ── Mark size and grain ───────────────────────────────────────────────────
// Every mark's extent — and the width of its tail — is multiplied by
// MARK_SCALE; the ring the marks sit on is not. SPECK_SCALE
// shrinks each speck the same way. The two are set together: marks at 0.62 of
// their old size hold the same number of specks in 0.38 of the area, and
// specks at 0.6 of their old size cover 0.36 of theirs, so a mark keeps its
// darkness while its grain gets finer.
const MARK_SCALE = 0.62
const SPECK_SCALE = 0.6
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

// ── Velocity → how much of the mark there is ──────────────────────────────
// How hard a tap was played, from the Selector's VELOCITY or ACCENT. It scales
// every mark the same two ways: a softer tap is a smaller mark printed
// lighter, a harder one a larger mark printed solid — so an accent reads as
// the heaviest thing on its stretch of the ring. The floors keep a quiet tap a
// mark rather than a smudge. Same size range as the pads (SoundPreview).
const VELOCITY_MIN_SIZE = 0.45 // size multiplier at velocity 0…
const VELOCITY_MAX_SIZE = 1.3 // …and at full velocity
const VELOCITY_MIN_DENSITY = 0.75 // how densely a mark prints at velocity 0; 1 at full
const VELOCITY_MIN_INK = 0.35 // share of its tail a tap leaves at velocity 0; 1 at full

// ── Marks → the Selector's own fields, as specks ──────────────────────────
// A mark here is not a shape of its own. It is the same ink field the
// Selector's pad shows for that sound (patterns.ts), at the character the tap
// was played with, scattered into specks: each candidate point is kept with
// the probability the field gives it, so a solid region prints solid and an
// edge thins out into loose grain — the pad's particle diffusion, on the ring.
// One definition of what a sound looks like, so the canvas and the pads can
// never drift apart.
//
// Character is therefore not a set of numbers here at all: what a tighter
// snare or an opener hat looks like is decided in patterns.ts, and only there.
// Every number below is about the canvas — how big a field is drawn and how
// densely it prints — and applies to all eight sounds alike.
//
// How big one unit of a field is drawn, as a fraction of minDim, at ENERGY and
// velocity 1 and before MARK_SCALE. Set so a kick at its resting hardness
// lands the size the solid blot always has.
const MARK_UNIT = 0.11
// Candidate points per square unit of field, at full ENERGY and velocity: how
// densely a solid region prints. Matched to the blot's old density — about
// 3300 specks in a full-ENERGY kick — so the field reads as the same ink.
const SPECK_DENSITY = 8000

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

// ── Ringing → RIDE's own tail ─────────────────────────────────────────────
// The ride is the sound that keeps on sounding long after it is struck, so its
// tail is not LENGTH's smear but its own: the trace from its pad (patterns.ts)
// bent along the ring and drawn out for as long as the ride rings — a wisp of
// grains, heaviest where it leaves the body and thinning to a point. LENGTH
// stretches it exactly as it stretches the sound, and a higher tune shortens
// it, since a higher ride rings shorter.
//
// And it is alive. Each time the playhead strikes the ride the ringing runs
// along the tail behind the playhead, filling it to full density, and thins
// away again as the ring-out dies — so the tail breathes once per pass of the
// loop. Stopped, it rests at RING_REST: the record of the ringing.
const RING_ARC = 0.85 // radians of ring per unit of the ride's ring-out…
const RING_MAX_ARC = 2 // …never more than about a third of the loop
// How densely the tail prints, against its mark: lighter, so it reads as what
// is left in the air rather than as more of the body.
const RING_INK = 0.55
// LENGTH's stretch on every sound's decay, mirrored from the engine: a decay
// times 0.45 at LENGTH 0, up to times 2.15 at LENGTH 100.
const LENGTH_STRETCH_MIN = 0.45
const LENGTH_STRETCH_RANGE = 1.7
// How much shorter the ride rings at its highest tune than at its lowest —
// the ratio of the two ends' decays in the engine.
const RING_HIGH_TUNE_REACH = 0.72
// Share of a tail's specks showing between strikes, and while stopped.
const RING_REST = 0.32
// How fast the ringing thins again once it has passed a speck, per length of
// the tail: at 2.5 it is down to a tenth of its swell by the tail's end.
const RING_FADE = 2.5
const MAX_RING_PARTICLES = 60000

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
/** Fold a position into one turn of the loop, [0, 1). */
const wrapPos = (p: number) => ((p % 1) + 1) % 1
/** The shorter of the two ways round from one position to another, signed,
    in (-0.5, 0.5] — a step forward past the seam is a step forward, not a
    near-complete lap backwards. */
const shortestStep = (d: number) => {
  const w = wrapPos(d)
  return w > 0.5 ? w - 1 : w
}
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
 * — as the mark of whichever of the eight sound identities fired it: the
 * same mark its pad shows (see patterns.ts), at the character it was played
 * with, printed in specks.
 *
 * Every mark lands complete, at its moment. Sound Intent's LENGTH then smears
 * each one into a clockwise tail — how long the sound rings on — except the
 * ride, which grows its own heavier tail and rings it again on every pass.
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

/** `controls` draws the canvas's own RESET and UNDO. The Main Screen turns
    them off and puts its + and undo buttons around the canvas instead. */
export function SoundVisualScreen({ controls = true }: { controls?: boolean }) {
  const { onTap, params: soundParams } = useSoundIntent()
  const { params: fx } = useFx()
  const {
    rendered,
    playhead,
    removeTap,
    moveTap,
    undoTap,
    canUndo,
    clearPattern,
    beatsPerLoop,
  } = useRhythmicIntent()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Bridges from the sim (inside the effect) out to React.
  const setMarksRef = useRef<((marks: readonly Tap[]) => void) | null>(null)
  const setFxRef = useRef<((params: FxParams) => void) | null>(null)
  const setBeatsRef = useRef<((beats: number) => void) | null>(null)
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
              // played with rather than eight identical blots. A tap with
              // neither came from a hardware pad, and draws as a kick.
              gesture: t.voice ?? 'kick',
              character: t.character ?? null,
            }
            snapshotsRef.current.set(t.id, snapshot)
          }
          return { id: t.id, pos: t.finalPos, velocity: t.velocity, ...snapshot }
        }),
    [rendered],
  )

  const marksRef = useRef(marks)
  marksRef.current = marks
  // A drag edits a tap's RAW position, which `marks` no longer carries —
  // they hold the transformed one the canvas draws at. The pattern is the
  // only place both live side by side.
  const renderedRef = useRef(rendered)
  renderedRef.current = rendered

  useEffect(() => {
    setMarksRef.current?.(marks)
  }, [marks])
  // Read once when the sim starts; after that the effect below pushes changes.
  const fxRef = useRef(fx)
  fxRef.current = fx
  const beatsRef = useRef(beatsPerLoop)
  beatsRef.current = beatsPerLoop

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
    // The ink the marks and tails lay down, kept apart from the field so that
    // a ride's ringing can be recomposed over it every frame without the
    // hundred thousand specks under it being laid again.
    const inkBuffer = document.createElement('canvas')
    const inkLayer = inkBuffer.getContext('2d')
    if (!inkLayer) return

    const taps: Tap[] = []
    // Every mark's specks live here: eight shapes, one kind of speck, one
    // draw pass.
    const cores: CoreSpeck[] = []
    const tails: TailSpeck[] = []
    // The rides' ringing tails, drawn per frame — see `spawnRinging`.
    const rings: RingTail[] = []
    // Each tap's mark, sampled from its field and kept by tap id — see
    // `speckPool`.
    const pools = new Map<string, SpeckPool>()
    let width = 0
    let height = 0
    let dpr = 1
    let rafId = 0
    // The canvas redraws while this is still in the future — tails are being
    // swept out. Once it passes, every mark is fixed and the last frame simply
    // stays. Nothing else here animates: every mark lands complete.
    let revealUntil = 0
    // Was the last frame one of those? Kept so the frame *after* an animation
    // ends still repaints the field once, at its finished state.
    let wasAnimating = false
    // Was the last frame a ride ringing? The frame after the loop stops still
    // recomposes once, to settle every tail back to rest.
    let wasRinging = false
    // The buffered field is stale and must be re-painted before the next blit.
    let fieldDirty = true
    // A pattern waiting to be placed, applied at the top of the next frame.
    let pendingMarks: readonly Tap[] | null = null
    // The room, read live rather than snapshotted (see the FX block above).
    // `scatter` is REVERB's 0..1 amount; `toneLut` is null while both tone
    // sliders are at 0, and the post-process is skipped entirely.
    let scatter = 0
    let toneLut: Uint8Array | null = null
    // Spokes of the beat grid — the meter's beats, twice (the loop is two bars).
    let beats = beatsRef.current

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
      inkBuffer.width = width
      inkBuffer.height = height
      // Geometry is in device pixels, so a resize invalidates every speck.
      // Seeded taps make this a faithful redraw, not a reshuffle.
      rebuildAll()
    }

    // ── Spawning ────────────────────────────────────────────────────────

    /** Where a mark sits: the bar bent into a ring, 0 at 12 o'clock, clockwise
        around. A mark's field is drawn with its origin here. */
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
        played, read from its snapshot. A kick's character IS its energy (see
        kit.ts), so a kick that carries one is sized by that instead — one
        quantity, one control. One with none (a hardware pad's) reads the
        global dimension. */
    const energyOf = (tap: Tap) =>
      tap.gesture === 'kick' && tap.character !== null
        ? clamp01(tap.character)
        : clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))

    /** How much of a mark a tap's velocity leaves: `size` scales its extent,
        `density` how solidly it prints and `ink` how much tail it leaves. */
    const velocityOf = (tap: Tap) => {
      const v = clamp01(tap.velocity)
      return {
        size: lerp(VELOCITY_MIN_SIZE, VELOCITY_MAX_SIZE, v),
        density: lerp(VELOCITY_MIN_DENSITY, 1, v),
        ink: lerp(VELOCITY_MIN_INK, 1, v),
      }
    }

    /** The tap's character as 0..1, or 0.5 for an identity that has none —
        RIM, which is drawn the same way every time by design. */
    const characterOf = (tap: Tap) => (tap.character === null ? 0.5 : clamp01(tap.character))

    const patternOf = (tap: Tap) => PATTERN_BY_ID.get(tap.gesture) ?? PATTERNS[0]

    /** How many times its field's own size the tap's mark is drawn: ENERGY
        and velocity size every mark the same way, and a mark too small to
        read on the ring at its pad size (RIM) is drawn larger still. */
    const scaleOf = (tap: Tap) =>
      lerp(ENERGY_MIN_RADIUS, ENERGY_MAX_RADIUS, energyOf(tap)) *
      velocityOf(tap).size *
      (patternOf(tap).ringScale ?? 1)

    /** Device px per unit of the tap's field. */
    const unitOf = (tap: Tap, dim: number) => MARK_UNIT * scaleOf(tap) * dim * MARK_SCALE

    /**
     * The tap's specks, in field units, sampled from its pattern at its
     * character. A pool depends only on the sound, its character and the
     * tap's seed — never on where the tap sits or how big the canvas is — so
     * it is kept across re-placings: a knob turned or a mark dragged moves the
     * same specks rather than sampling the field again. A pool is replaced
     * only when the tap itself changes into something else.
     */
    const speckPool = (tap: Tap): SpeckPool => {
      const c = characterOf(tap)
      const key = `${tap.gesture}|${c}|${tap.seed}`
      const kept = pools.get(tap.id)
      if (kept && kept.key === key) return kept
      const pattern = patternOf(tap)
      // A mark that rings on is drawn here without its tail; spawnRinging
      // grows the tail along the ring instead.
      const shape = pattern.ringing ?? pattern
      const pool: SpeckPool = {
        key,
        pattern,
        shape: shape.field,
        c,
        bounds: shape.bounds(c),
        rand: makeRng(tap.seed),
        tried: 0,
        xs: [],
        ys: [],
        jxs: [],
        jys: [],
        at: [],
      }
      pools.set(tap.id, pool)
      return pool
    }

    /**
     * How many of a pool's specks `candidates` draws produce, drawing more
     * first if the pool has not got that far. Draws come off the tap's seeded
     * stream in order, so asking for more always ADDS specks to the ones
     * already there: a mark grows denser as ENERGY or the canvas rises, rather
     * than being re-rolled.
     */
    const fillPool = (pool: SpeckPool, candidates: number): number => {
      const { shape, c, rand, bounds: b } = pool
      const w = b.x1 - b.x0
      const h = b.y1 - b.y0
      while (pool.tried < candidates) {
        const x = b.x0 + rand() * w
        const y = b.y0 + rand() * h
        const keep = rand()
        pool.tried++
        // Kept with the probability the field gives this point — which is all
        // it takes for a solid region to print solid and an edge to diffuse.
        if (keep >= shape(x, y, c)) continue
        pool.xs.push(x)
        pool.ys.push(y)
        pool.jxs.push(gaussianFrom(rand))
        pool.jys.push(gaussianFrom(rand))
        pool.at.push(pool.tried)
      }
      // Specks are stored in draw order, so the ones the first `candidates`
      // draws produced are a prefix: find where it ends.
      let lo = 0
      let hi = pool.at.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (pool.at[mid] <= candidates) lo = mid + 1
        else hi = mid
      }
      return lo
    }

    /**
     * One tap, one mark: its sound's field, printed in specks at its point of
     * the ring. ENERGY and velocity set how large it is drawn and how densely
     * it prints; the sound and its character set everything else. All of them
     * land complete, so none needs the clock.
     *
     * A mark whose meaning has a direction (see `radial` in patterns.ts) is
     * turned to face out along the ring's normal at its moment, so a clap
     * closes on the line from both sides and a ride's trace streams outward
     * wherever it lands. Every other mark keeps its pad's orientation.
     *
     * FX never re-spawns this, only re-draws it.
     */
    const spawnMark = (tap: Tap) => {
      const dim = minDim()
      const pool = speckPool(tap)
      const vel = velocityOf(tap)
      const inkScale = ink()
      const { x0, y0, x1, y1 } = pool.bounds
      // ENERGY's count already allows for the size ENERGY gives a mark. The
      // size velocity and a ring scale add on top is paid for in draws here,
      // so a mark drawn larger is not printed lighter.
      const grown = vel.size * (pool.pattern.ringScale ?? 1)
      const candidates = Math.round(
        SPECK_DENSITY *
          (x1 - x0) *
          (y1 - y0) *
          lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, energyOf(tap)) *
          vel.density *
          grown *
          grown *
          inkScale,
      )
      const count = fillPool(pool, candidates)
      const unit = unitOf(tap, dim)
      const { ox, oy } = markCentre(tap, dim)
      const radial = pool.pattern.radial
      const turn = radial === undefined ? 0 : tap.pos * Math.PI * 2 - Math.PI / 2 - radial
      const cos = Math.cos(turn) * unit
      const sin = Math.sin(turn) * unit
      makeRoom(count, inkScale)
      for (let i = 0; i < count; i++) {
        const fx = pool.xs[i]
        const fy = pool.ys[i]
        cores.push({
          x: ox + fx * cos - fy * sin,
          y: oy + fx * sin + fy * cos,
          jx: pool.jxs[i],
          jy: pool.jys[i],
        })
      }
    }

    /**
     * The tail: Length's territory, read from the tap's own snapshot. `sweep`
     * is true for a live tap (the tail rings out of the mark over
     * TAIL_GROWTH_S) and false for a rebuild, where every speck is placed at
     * once because the canvas changed size, not the sound.
     */
    const spawnTail = (tap: Tap, sweep: boolean, now: number) => {
      // A sound that rings on draws its own tail instead (see below), one
      // that LENGTH already stretches.
      const ringing = patternOf(tap).ringing
      if (ringing) {
        spawnRinging(tap, ringing, sweep, now)
        return
      }
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
        TAIL_PER_TAP *
          lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e) *
          body *
          velocityOf(tap).ink *
          inkScale,
      )
      if (count <= 0) return

      const overflow = tails.length + count - Math.round(MAX_TAIL_PARTICLES * inkScale)
      if (overflow > 0) tails.splice(0, overflow)

      const theta0 = tap.pos * Math.PI * 2 - Math.PI / 2
      const ringR = CIRCLE_RADIUS * dim
      // Most marks are drawn as much by their empty space as by their ink — a
      // tom's hollow, the gaps between a snare's grains, the space inside a
      // hat. The tail is densest at its head, so left alone it fills that space
      // and the mark stops reading as itself, lost to an unrelated slider. So
      // the tail keeps out of each mark's own clearance (see patterns.ts) and
      // leaves from its edge; only a solid mark lets it start in the middle.
      const { ox, oy } = markCentre(tap, dim)
      const hollowR = patternOf(tap).clear(characterOf(tap)) * unitOf(tap, dim)
      for (let i = 0; i < count; i++) {
        // s is 0..1 along the tail, biased toward the head.
        const s = Math.pow(rand(), TAIL_BIAS)
        // Clockwise along the ring — theta increases clockwise on screen.
        const theta = theta0 + s * arc
        // Lateral scatter opens out as the tail decays; it is measured off the
        // ring, so the smear stays wrapped around the circle.
        const lateral =
          gaussianFrom(rand) *
          spread *
          (TAIL_HEAD_WIDTH + (1 - TAIL_HEAD_WIDTH) * s) *
          dim *
          MARK_SCALE
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

    /**
     * A ride's own tail: the trace from its pad, bent along the ring and drawn
     * out for as long as the ride rings. Sampled the way a mark is — draws
     * through the tail's box, each kept with the probability the tail's field
     * gives it — and placed by laying the tail's axis along the circle:
     * distance along the tail is distance along the ring, distance across it
     * is distance off it. How much of it shows at any moment is decided while
     * drawing, from where the playhead is (see `compose`).
     */
    const spawnRinging = (tap: Tap, ringing: Ringing, sweep: boolean, now: number) => {
      const dim = minDim()
      // Its own stream, like LENGTH's tail, so the mark is untouched by it.
      const rand = makeRng(tap.seed ^ 0x51ed270b)
      const v = clamp01((tap.length - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))
      const c = characterOf(tap)
      const arc = Math.min(
        RING_MAX_ARC,
        RING_ARC *
          (LENGTH_STRETCH_MIN + LENGTH_STRETCH_RANGE * v) *
          lerp(1, RING_HIGH_TUNE_REACH, c),
      )
      const unit = unitOf(tap, dim)
      const ringR = CIRCLE_RADIUS * dim
      // Where the tail ends along its own axis, in field units: as far round
      // the ring as the ringing lasts, however large the mark is drawn.
      const reach = (arc * ringR) / unit - ringing.start
      if (reach <= 0) return

      const vel = velocityOf(tap)
      const inkScale = ink()
      // Printed like the mark it leaves (see spawnMark), only lighter.
      const grown = vel.size * (patternOf(tap).ringScale ?? 1)
      const candidates = Math.round(
        SPECK_DENSITY *
          RING_INK *
          reach *
          2 *
          ringing.width *
          lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, energyOf(tap)) *
          vel.density *
          grown *
          grown *
          inkScale,
      )
      const theta0 = tap.pos * Math.PI * 2 - Math.PI / 2
      const { ox, oy } = markCentre(tap, dim)
      const hollowR = patternOf(tap).clear(c) * unit
      const specks: RingSpeck[] = []
      for (let i = 0; i < candidates; i++) {
        const along = ringing.start + rand() * reach
        const across = (rand() * 2 - 1) * ringing.width
        const keep = rand()
        if (keep >= ringing.tail(along, across, reach)) continue
        // Radians past the strike: distance along the tail, as arc.
        const turn = (along * unit) / ringR
        const radius = ringR + across * unit
        const x = Math.cos(theta0 + turn) * radius
        const y = Math.sin(theta0 + turn) * radius
        if (hollowR > 0 && Math.hypot(x - ox, y - oy) < hollowR) continue
        const t = (along - ringing.start) / reach
        specks.push({
          x,
          y,
          at: turn / (Math.PI * 2),
          needs: rand(),
          revealAt: sweep ? now + TAIL_GROWTH_S * 1000 * Math.pow(t, TAIL_SWEEP_EASE) : 0,
          jx: gaussianFrom(rand),
          jy: gaussianFrom(rand),
        })
      }
      if (specks.length === 0) return
      // Room for it: past the cap, the oldest ringing goes first.
      let total = specks.length
      for (const ring of rings) total += ring.specks.length
      while (rings.length > 0 && total > MAX_RING_PARTICLES * inkScale) {
        total -= rings.shift()?.specks.length ?? 0
      }
      rings.push({ pos: tap.pos, reach: arc / (Math.PI * 2), specks })
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
      rings.length = 0
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
      // A tap no longer in the loop has no use for its specks.
      const live = new Set(next.map((t) => t.id))
      for (const id of pools.keys()) if (!live.has(id)) pools.delete(id)
      cores.length = 0
      tails.length = 0
      rings.length = 0
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

    /** The meter changed: same marks, a different number of spokes under them. */
    const setBeats = (next: number) => {
      beats = next
      fieldDirty = true
      scheduleDraw()
    }

    setMarksRef.current = setMarks
    setFxRef.current = setFx
    setBeatsRef.current = setBeats
    scheduleRef.current = scheduleDraw

    // ── Drawing ─────────────────────────────────────────────────────────

    /** Where specks are drawn from and how: the canvas centre, one speck's
        size, and REVERB's stray. */
    const speckFrame = () => ({
      cx: width / 2,
      cy: height / 2,
      // One speck. It carries the square root of the ink correction (the
      // count carries the other half), and stays fractional on purpose:
      // rounding it would step the whole field's density 4× at the crossover
      // while a window is being dragged.
      dot: Math.max(1, Math.max(1, Math.round(dpr)) * Math.sqrt(ink()) * SPECK_SCALE),
      // REVERB, in device px: every speck is offset along its own fixed stray
      // direction by this much. 0 draws each speck exactly where it was struck.
      stray: scatter * REVERB_MAX_SCATTER * minDim(),
    })

    /**
     * The ink — grid, marks, tails — painted into its own buffer rather than
     * onto the screen. It only has to be re-painted when something in it
     * actually changes, which is what keeps the playhead's 60 Hz off the back
     * of a hundred thousand specks: a frame that only turns the gradient, or
     * only rings a ride, reuses this instead of re-laying it.
     */
    const paintInk = (now: number) => {
      inkLayer.clearRect(0, 0, width, height)
      const { cx, cy, dot, stray } = speckFrame()

      // The beat grid is always there, playing or not — an empty canvas shows
      // the meter it will be played in, and redraws when the meter changes.
      {
        // Spokes run past the corners rather than stopping at the ring: the
        // beat is a direction from the centre, not a segment of the circle.
        const reach = Math.hypot(width, height) / 2
        inkLayer.globalAlpha = 1
        inkLayer.strokeStyle = `rgba(0, 0, 0, ${GRID_ALPHA})`
        inkLayer.lineWidth = Math.max(1, Math.round(dpr))
        inkLayer.beginPath()
        for (let beat = 0; beat < beats; beat++) {
          const theta = (beat / beats) * Math.PI * 2 - Math.PI / 2
          inkLayer.moveTo(cx, cy)
          inkLayer.lineTo(cx + Math.cos(theta) * reach, cy + Math.sin(theta) * reach)
        }
        inkLayer.stroke()
        inkLayer.beginPath()
        inkLayer.arc(cx, cy, CIRCLE_RADIUS * minDim(), 0, Math.PI * 2)
        inkLayer.stroke()
      }

      inkLayer.fillStyle = '#000000'

      // Every mark — eight shapes at one strength.
      inkLayer.globalAlpha = BASE_ALPHA
      for (const p of cores) {
        inkLayer.fillRect(cx + p.x + p.jx * stray, cy + p.y + p.jy * stray, dot, dot)
      }

      for (const p of tails) {
        if (p.revealAt > now) continue // the sweep hasn't reached this speck yet
        inkLayer.globalAlpha = p.alpha
        inkLayer.fillRect(cx + p.x + p.jx * stray, cy + p.y + p.jy * stray, dot, dot)
      }
      inkLayer.globalAlpha = 1
    }

    /**
     * The field as it is shown: the ink, the rides ringing over it, and the
     * tone map over both. `head` is where the playhead is, or null when the
     * loop is stopped.
     */
    const compose = (now: number, head: number | null) => {
      field.globalAlpha = 1
      field.clearRect(0, 0, width, height)
      field.drawImage(inkBuffer, 0, 0)

      // Each ride's tail, at the density its ringing has right now. A speck
      // shows while the ringing at it is above what it `needs`: always at
      // RING_REST, and up to everything as the playhead's strike runs past
      // it, thinning back as the ring-out dies. Stopped, nothing rings.
      if (rings.length > 0) {
        const { cx, cy, dot, stray } = speckFrame()
        field.fillStyle = '#000000'
        field.globalAlpha = BASE_ALPHA
        for (const ring of rings) {
          // How far past this ride's strike the playhead is, as a share of
          // the loop; -1 while stopped, which no speck is ever past.
          const since = head === null ? -1 : wrapPos(head - ring.pos)
          for (const p of ring.specks) {
            if (p.revealAt > now) continue
            let level = RING_REST
            if (since >= p.at) {
              level += (1 - RING_REST) * Math.exp(((p.at - since) / ring.reach) * RING_FADE)
            }
            if (p.needs >= level) continue
            field.fillRect(cx + p.x + p.jx * stray, cy + p.y + p.jy * stray, dot, dot)
          }
        }
        field.globalAlpha = 1
      }

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
      // rather than on a frame, unless a ride is ringing.
      if (toneLut) {
        const image = field.getImageData(0, 0, width, height)
        const d = image.data
        for (let i = 3; i < d.length; i += 4) d[i] = toneLut[d[i]]
        field.putImageData(image, 0, 0)
      }
    }

    /**
     * One frame: the field, then the playhead over it. The ink is re-painted
     * only when something in it moved — a pattern change, a room change, a
     * resize, or a tail still sweeping out — and the field recomposed over it
     * when the ink changed or a ride is ringing; otherwise the frame blits the
     * buffer, so a turning playhead costs one copy and one gradient.
     */
    const frame = (now: number) => {
      if (pendingMarks) {
        applyMarks(pendingMarks, now)
        pendingMarks = null
      }
      const head = playheadRef.current
      const running = head !== null
      const animating = now < revealUntil
      const ringing = running && rings.length > 0
      // `wasAnimating` earns the one extra paint after an animation ends —
      // without it the last specks of a tail would never be swept in.
      let inkChanged = false
      if (fieldDirty || animating || wasAnimating) {
        paintInk(now)
        fieldDirty = false
        inkChanged = true
      }
      // A ride's tail changes with every move of the playhead, so while one
      // is ringing the field is recomposed every frame — over ink that is only
      // copied, never laid again.
      if (inkChanged || ringing || wasRinging) compose(now, head)
      wasAnimating = animating
      wasRinging = ringing

      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(buffer, 0, 0)

      // Where the loop is now, over the top of everything else (see the
      // playhead block above for why it sits outside the tone map).
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
      rafId = animating || running ? requestAnimationFrame(frame) : 0
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
      setBeatsRef.current = null
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

  useEffect(() => {
    setBeatsRef.current?.(beatsPerLoop)
  }, [beatsPerLoop])

  // Wake the canvas when the playhead starts (it keeps itself running from
  // there) and once more when it stops, so the last light is wiped off.
  useEffect(() => {
    scheduleRef.current?.()
  }, [playheadOn])

  /** Where a pointer is, in the canvas's own terms: device px measured from the
      centre, which is where the ring is centred and where every mark's position
      is measured from. Null when the canvas has no area to measure against. */
  const pointerAt = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const scale = canvas.width / rect.width
    return {
      x: (event.clientX - rect.left) * scale - canvas.width / 2,
      y: (event.clientY - rect.top) * scale - canvas.height / 2,
      dim: Math.min(canvas.width, canvas.height),
    }
  }

  /** Which mark is under a point, or null. The hit test runs on the same
      geometry the canvas draws with — the transformed position, not where the
      tap originally fell — so what you grab is what you see. */
  const markAt = ({ x, y, dim }: { x: number; y: number; dim: number }) => {
    let hit: string | null = null
    // Forgiving, but shrunk with the marks so a click in open space between
    // two of them no longer reaches either.
    let best = HIT_RADIUS * Math.max(MARK_SCALE, 0.75) * dim
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
    return hit
  }

  /** The inverse of `markCentre`: a point on the canvas back to its position
      around the loop, 0 at 12 o'clock, clockwise. Only the angle is read — a
      mark is dragged along the ring, so how far from it the cursor strays does
      not matter, and the mark cannot be pulled off the circle. */
  const loopPosAt = ({ x, y }: { x: number; y: number }) =>
    wrapPos(Math.atan2(y, x) / (Math.PI * 2) + 0.25)

  /** Drag a mark to move that note around the loop. What moves is the tap's own
      moment; TIGHTNESS and PHASE still apply on top, so a dragged mark feels the
      same grid pull as a played one and the image never claims a timing the loop
      will not play.

      The tap's position is carried forward a step at a time rather than measured
      from where the drag began, so a mark can be walked the whole way round the
      ring — an absolute measure would read three-quarters forward as a quarter
      back the moment the drag passed the halfway mark. */
  const dragRef = useRef<{ pointerId: number; id: string; pos: number; cursor: number } | null>(
    null,
  )
  const [grabbing, setGrabbing] = useState(false)
  const [hovering, setHovering] = useState(false)

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = pointerAt(event)
    if (!point) return
    const id = markAt(point)
    if (!id) return
    const tap = renderedRef.current.find((t) => t.id === id)
    if (!tap) return
    dragRef.current = { pointerId: event.pointerId, id, pos: tap.rawPos, cursor: loopPosAt(point) }
    setGrabbing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointerAt(event)
    if (!point) return
    const drag = dragRef.current
    if (!drag) {
      setHovering(markAt(point) !== null)
      return
    }
    if (event.pointerId !== drag.pointerId) return
    const cursor = loopPosAt(point)
    drag.pos = wrapPos(drag.pos + shortestStep(cursor - drag.cursor))
    drag.cursor = cursor
    moveTap(drag.id, drag.pos)
  }

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setGrabbing(false)
  }

  /** Double-click a mark to take that note out of the loop. */
  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const point = pointerAt(event)
    if (!point) return
    const hit = markAt(point)
    if (hit) removeTap(hit)
  }

  const handleReset = () => {
    clearPattern()
    snapshotsRef.current.clear()
  }

  // An empty loop has nothing left to remember, whoever emptied it — RESET
  // here, the Main Screen's +, or undoing the last tap.
  const empty = rendered.length === 0
  useEffect(() => {
    if (empty) snapshotsRef.current.clear()
  }, [empty])

  return (
    <div className="sv-screen">
      <canvas
        ref={canvasRef}
        className={`sv-canvas${grabbing ? ' sv-canvas--grabbing' : hovering ? ' sv-canvas--grab' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHovering(false)}
        onDoubleClick={handleDoubleClick}
      />
      {controls && (
        <>
          <button type="button" className="sv-reset" onClick={handleReset}>
            RESET
          </button>
          <button type="button" className="sv-undo" onClick={undoTap} disabled={!canUndo}>
            UNDO
          </button>
        </>
      )}
    </div>
  )
}
