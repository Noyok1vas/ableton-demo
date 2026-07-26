import { useEffect, useRef, useState } from 'react'
import { useSoundIntent } from './session.tsx'
import { SOUND_MAX, SOUND_MIN } from './types.ts'
import { useFx } from '../fx/session.tsx'
import { FX_MAX, FX_MIN } from '../fx/types.ts'
import './sound-intent.css'

/** One speck of the blot's solid body — the direct sound. Coordinates are
    device pixels, offset from the canvas centre. Cores never move and never
    change with FX: turning the room up must not disturb the sound itself. */
type CoreSpeck = { x: number; y: number }

/** One speck of a reverb tail — a reflection. Its final position is computed
    analytically at spawn (polar, on the ring), so the only animation is the
    moving reveal front that sweeps the tail into existence: `revealAt` is when
    this speck arrives. A rebuilt tail spawns with `revealAt = 0`, i.e. already
    fully swept, so dragging the FX slider re-renders instantly. */
type TailSpeck = { x: number; y: number; alpha: number; revealAt: number }

/** The bar's record: everything on screen is a pure function of this list and
    the current reverb value, which is what makes a global re-render possible. */
type Tap = { pos: number; energy: number; seed: number }

// Tuning for the ink-drop look (see reference image 2): a tap lands as a
// defined-radius disc of ink.
const PARTICLES_PER_TAP = 6000
// Cap must cover a dense bar: MAX / PER_TAP ≈ how many blots can coexist.
// At 6k each, 96k holds ~16 taps (a full 1/16 grid); beyond that, spawn
// drops the oldest ink so a new tap never silently draws nothing.
const MAX_CORE_PARTICLES = 96000
const CORE_RADIUS = 0.04 // the circle's radius, as a fraction of min viewport dim
// Share of a tap's nominal ink that forms the disc. Not a wet/dry split any
// more — the diffusing rim is gone, replaced by the reverb tail below — just
// how dense the body reads.
const CORE_FRACTION = 0.55
// Body uses sqrt sampling (uniform 2D density) + a tiny gaussian edge softener so
// the boundary reads as organic ink rather than a hard-cut circle. This is the
// ink's material quality, not diffusion, so it survives at reverb 0; set it to
// 0 for a hard-stamped disc.
const EDGE_SOFT = 0.02 // gaussian sigma for body-edge softness, as fraction of minDim
const BASE_ALPHA = 0.7
// The bar mapped as a circle: a tap's 0..1 position becomes an angle, and its
// blot lands on this ring (radius as a fraction of the min viewport dimension).
const CIRCLE_RADIUS = 0.3
// Beyond this many taps the oldest is forgotten — bounds the cost of the
// full-field rebuild that every FX change triggers.
const MAX_TAPS = 64

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

// ── Reverb → ink tail ─────────────────────────────────────────────────────
// One 0..100 FX slider drives the three quantities a reverb actually has. All
// three are tuned here, at the endpoints; the slider itself never learns about
// them. Insert Math.pow(v, k) below to bend any of the three curves.
//
// The tail is an ARC OF THE RING, not an isotropic bloom: reflections are drawn
// as the sound smearing forward in time, and on this canvas time is the angle
// around the circle. So a tail always sweeps clockwise from its blot, hugging
// the ring — never scattering outward in all directions. Turn reverb up far
// enough and neighbouring blots' tails merge into one continuous band, which is
// exactly what a wet room does to a rhythm.
const TAIL_PER_TAP = 4000 // nominal reflection ink per tap, before energy/mix
const MAX_TAIL_PARTICLES = 80000
// SIZE — how far around the ring the tail sweeps, in radians. The bar is 2π, so
// 1.2 rad ≈ 19% of a bar ≈ three sixteenths. MIN is 0 by contract: at reverb 0
// there is no spread of any kind.
const REVERB_MIN_ARC = 0
const REVERB_MAX_ARC = 1.2
// SIZE — lateral scatter either side of the ring, as a fraction of minDim. A
// bigger room is a wider smear, not just a longer one.
const REVERB_MAX_WIDTH = 0.03
// …and how wide the tail starts, as a share of that: it leaves the blot narrow
// and opens out as it decays.
const TAIL_HEAD_WIDTH = 0.2
// MIX — share of TAIL_PER_TAP that actually becomes reflections at reverb 100.
// This is the only thing scaled by mix; head alpha stays put so a low setting
// reads as "a little reverb" rather than "nearly invisible".
const REVERB_MAX_MIX = 0.9
// MIX — ink strength where the tail leaves the blot, as a multiple of BASE_ALPHA.
const REVERB_HEAD_ALPHA = 0.55
// DECAY — exponential alpha falloff along the arc: alpha ∝ exp(-rate · s).
// A steep rate dies within the first fraction of the arc (a small, damped
// room); a gentle one carries ink all the way to the end (a long tail).
const REVERB_DECAY_STEEP = 7 // just above reverb 0
const REVERB_DECAY_GENTLE = 1.6 // at reverb 100
// Ink density along the arc, biased toward the head. >1 concentrates near the
// blot; 1 is uniform.
const TAIL_BIAS = 1.6
// How long a fresh tail takes to sweep out, in seconds, and the shape of that
// sweep (<1 = fast off the blot, slowing as it decays).
const TAIL_GROWTH_S = 0.9
const TAIL_SWEEP_EASE = 0.75

const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Standard-normal sample (Box–Muller) drawn from `rand`. */
function gaussianFrom(rand: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** mulberry32 — a small seeded PRNG. Every tap carries a seed so its blot and
    its tail are reproducible: an FX change then re-rolls the geometry but not
    the randomness, and the ring morphs in place instead of reshuffling. */
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
 * drawing, animation, and the particle sim. Each tap lands as an ink blot on a
 * big circle — the bar's timeline bent into a ring (12 o'clock is the bar
 * start, clockwise) — and the FX module's REVERB slider smears each blot into a
 * clockwise tail along that ring. Blots persist; the ring only clears on RESET
 * or on the tap that begins a fresh bar.
 *
 * The split that matters: the blot is the sound, the tail is the room. Energy
 * (per tap, snapshotted) owns the blot and is never touched by FX. Reverb
 * (global, live) owns the tail, and changing it rebuilds every tail on the ring
 * at once — an effect is a property of the space, not of one event.
 */
export function SoundVisualScreen() {
  const { onTap } = useSoundIntent()
  const { params: fx } = useFx()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tapped, setTapped] = useState(false)
  // Bridges from the sim (inside the effect) out to React.
  const clearRef = useRef<(() => void) | null>(null)
  const rebuildTailsRef = useRef<(() => void) | null>(null)
  // Read by the sim at spawn time; kept in a ref so slider moves don't tear
  // down and rebuild the canvas effect.
  const reverbRef = useRef(fx.reverb)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const taps: Tap[] = []
    const cores: CoreSpeck[] = []
    const tails: TailSpeck[] = []
    let width = 0
    let height = 0
    let dpr = 1
    let rafId = 0
    // The sweep is done once every tail speck has been revealed; until then the
    // canvas keeps redrawing. Nothing else animates.
    let revealUntil = 0

    const minDim = () => Math.min(width, height)

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.round(rect.width * dpr))
      height = Math.max(1, Math.round(rect.height * dpr))
      canvas.width = width
      canvas.height = height
      // Geometry is in device pixels, so a resize invalidates every speck.
      // Seeded taps make this a faithful redraw, not a reshuffle.
      rebuildAll()
    }

    const clear = () => {
      taps.length = 0
      cores.length = 0
      tails.length = 0
      revealUntil = 0
      ctx.clearRect(0, 0, width, height)
    }

    // ── Spawning ────────────────────────────────────────────────────────

    /** The blot: Energy's territory, untouched by FX. */
    const spawnCore = (tap: Tap) => {
      const dim = minDim()
      const rand = makeRng(tap.seed)
      const e = clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))
      const coreR = CORE_RADIUS * lerp(ENERGY_MIN_RADIUS, ENERGY_MAX_RADIUS, e) * dim
      const count = Math.max(
        1,
        Math.round(
          PARTICLES_PER_TAP * CORE_FRACTION * lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e),
        ),
      )
      // The bar bent into a ring: 0 at 12 o'clock, clockwise around.
      const theta = tap.pos * Math.PI * 2 - Math.PI / 2
      const ox = Math.cos(theta) * CIRCLE_RADIUS * dim
      const oy = Math.sin(theta) * CIRCLE_RADIUS * dim
      // Always land a full blot. If the bar is denser than the cap, shed the
      // oldest ink first — never spawn 0 particles and "lose" a late tap.
      const overflow = cores.length + count - MAX_CORE_PARTICLES
      if (overflow > 0) cores.splice(0, overflow)
      for (let i = 0; i < count; i++) {
        // sqrt sampling gives uniform 2D density (no centre spike, no hard
        // ring); the gaussian softener lets the boundary bleed a hair.
        const angle = rand() * Math.PI * 2
        const radius = Math.max(0, coreR * Math.sqrt(rand()) + gaussianFrom(rand) * EDGE_SOFT * dim)
        cores.push({ x: ox + Math.cos(angle) * radius, y: oy + Math.sin(angle) * radius })
      }
    }

    /**
     * The tail: Reverb's territory. `sweep` is true for a live tap (the tail
     * grows out of the blot over TAIL_GROWTH_S) and false for a rebuild, where
     * every speck is placed at once because the room changed, not the sound.
     */
    const spawnTail = (tap: Tap, sweep: boolean, now: number) => {
      const v = clamp01((reverbRef.current - FX_MIN) / (FX_MAX - FX_MIN))
      if (v <= 0) return // reverb 0 — a dry room, nothing leaves the blot

      const dim = minDim()
      // Tail randomness is its own stream, so rebuilding tails leaves the blot
      // untouched and vice versa.
      const rand = makeRng(tap.seed ^ 0x9e3779b9)
      const e = clamp01((tap.energy - SOUND_MIN) / (SOUND_MAX - SOUND_MIN))

      const mix = REVERB_MAX_MIX * v
      const arc = lerp(REVERB_MIN_ARC, REVERB_MAX_ARC, v)
      const spread = REVERB_MAX_WIDTH * v
      const decay = lerp(REVERB_DECAY_STEEP, REVERB_DECAY_GENTLE, v)

      const count = Math.round(
        TAIL_PER_TAP * lerp(ENERGY_MIN_DENSITY, ENERGY_MAX_DENSITY, e) * mix,
      )
      if (count <= 0) return

      const overflow = tails.length + count - MAX_TAIL_PARTICLES
      if (overflow > 0) tails.splice(0, overflow)

      const theta0 = tap.pos * Math.PI * 2 - Math.PI / 2
      const ringR = CIRCLE_RADIUS * dim
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
        tails.push({
          x: Math.cos(theta) * radius,
          y: Math.sin(theta) * radius,
          alpha: BASE_ALPHA * REVERB_HEAD_ALPHA * Math.exp(-decay * s),
          revealAt: sweep ? now + TAIL_GROWTH_S * 1000 * Math.pow(s, TAIL_SWEEP_EASE) : 0,
        })
      }
      if (sweep) revealUntil = Math.max(revealUntil, now + TAIL_GROWTH_S * 1000)
    }

    // ── Rebuilds ────────────────────────────────────────────────────────
    // Coalesced into one frame: a slider drag fires many changes per frame and
    // each rebuild walks every tap.
    let rebuildQueued = false
    let disposed = false
    const scheduleDraw = () => {
      if (!rafId) rafId = requestAnimationFrame(frame)
    }

    /** Reverb changed: the room is different, the sounds are not. */
    const rebuildTails = () => {
      if (rebuildQueued) return
      rebuildQueued = true
      requestAnimationFrame(() => {
        rebuildQueued = false
        if (disposed) return
        tails.length = 0
        revealUntil = 0
        const now = performance.now()
        for (const tap of taps) spawnTail(tap, false, now)
        scheduleDraw()
      })
    }

    /** The canvas geometry changed: everything must be re-placed. */
    const rebuildAll = () => {
      cores.length = 0
      tails.length = 0
      revealUntil = 0
      const now = performance.now()
      for (const tap of taps) {
        spawnCore(tap)
        spawnTail(tap, false, now)
      }
      scheduleDraw()
    }

    clearRef.current = clear
    rebuildTailsRef.current = rebuildTails

    // ── Drawing ─────────────────────────────────────────────────────────

    const frame = (now: number) => {
      ctx.clearRect(0, 0, width, height)

      const cx = width / 2
      const cy = height / 2
      const dot = Math.max(1, Math.round(dpr))

      ctx.fillStyle = '#000000'
      ctx.globalAlpha = BASE_ALPHA
      for (const p of cores) ctx.fillRect(cx + p.x, cy + p.y, dot, dot)

      for (const p of tails) {
        if (p.revealAt > now) continue // the sweep hasn't reached this speck yet
        ctx.globalAlpha = p.alpha
        ctx.fillRect(cx + p.x, cy + p.y, dot, dot)
      }
      ctx.globalAlpha = 1

      // Keep animating only while a tail is still sweeping out; once every
      // speck has landed the last frame stays on screen untouched.
      rafId = now < revealUntil ? requestAnimationFrame(frame) : 0
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    // Display only — the shared TAP button (its own window) drives every tap.
    // The tap carries its own Energy snapshot; reverb is read live, because the
    // room a sound lands in is whatever the room is right now.
    const unsubscribe = onTap((tap) => {
      setTapped(true)
      if (tap.newBar) clear()
      const record: Tap = {
        pos: tap.pos,
        energy: tap.params.d1,
        seed: (Math.random() * 0xffffffff) >>> 0,
      }
      if (taps.length >= MAX_TAPS) taps.shift()
      taps.push(record)
      spawnCore(record)
      spawnTail(record, true, performance.now())
      scheduleDraw()
    })

    return () => {
      disposed = true
      unsubscribe()
      observer.disconnect()
      if (rafId) cancelAnimationFrame(rafId)
      clearRef.current = null
      rebuildTailsRef.current = null
    }
  }, [onTap])

  // The whole field re-renders when the room changes — this is what makes FX an
  // effect rather than one more per-note dimension.
  useEffect(() => {
    reverbRef.current = fx.reverb
    rebuildTailsRef.current?.()
  }, [fx.reverb])

  const handleReset = () => {
    clearRef.current?.()
    setTapped(false)
  }

  return (
    <div className="sv-screen">
      <canvas ref={canvasRef} className="sv-canvas" />
      {!tapped && <div className="sv-hint">Tap to sound</div>}
      <button type="button" className="sv-reset" onClick={handleReset}>
        RESET
      </button>
    </div>
  )
}
