/**
 * The Sound Visual as one three.js scene, in both of its modes.
 *
 * The loop is a helix lying on its side: one turn per pass of the loop, time
 * running left to right along the axis, 12 o'clock at the top of every turn,
 * clockwise. The ring the 2D canvas drew is this helix seen straight down its
 * axis — which is what CREATE is: a camera on the axis with a
 * near-orthographic lens, framing the current turn exactly as the canvas
 * framed its ring, every other turn faded out. ARRANGE swings the same camera
 * round to the side, a little above, and brings it in until a turn nearly
 * fills the screen's height: the song runs off both edges, and is scrolled
 * along and pinched tighter or looser (the turns' spacing, not the lens) to
 * show three to eight of its passes. Every mark collapses into a flat grainy
 * dot sized by how hard it was played. Switching modes is one camera move
 * between those two poses, with the marks morphing on the way.
 *
 * Drawn flat on purpose: white specks on the glass, the same ink as the 2D
 * canvas and the pads — nothing lit, no volume. The playhead is one point of
 * light travelling the helix.
 *
 * Everything is in ring radii: the ring is one world unit across its radius.
 */

import * as THREE from 'three'
import {
  CIRCLE_RADIUS,
  HIT_RADIUS,
  MARK_SCALE,
  REVERB_MAX_SCATTER,
  SPECK_SIZE,
  makeRng,
  sampleSpecks,
  scaleOf,
  turnOf,
  unitOf,
  type MarkTap,
} from './marks.ts'

export type Mode = 'create' | 'arrange'

/** How many passes of the loop the song is, for now: the pattern, repeated. */
export const TURNS = 8
/** How many passes ARRANGE shows across the screen, at most and at least. */
export const MIN_VISIBLE = 3
export const MAX_VISIBLE = TURNS

const BASE_ALPHA = 0.7
/** The helix's own ink; brighter than the canvas's 0.08 because here it is
    white on black, where the same alpha reads fainter. */
const GRID_ALPHA = 0.14
/** Radius of the ball a mark becomes, in ring radii, before the mark's size. */
const BALL_RADIUS = 0.085
/** The share of a mark's specks that print its ball. */
const BALL_SHARE = 0.18
/** The playhead's light, in CSS px across. */
const HEAD_PX = 14
/** The camera move, and the morph with it. */
const TRANSITION_MS = 650
/** The canvas's ink was tuned at this shorter side, in CSS px; a larger
    canvas buys more specks. */
const REF_MIN_DIM = 500
const MAX_INK = 4

/** A camera pose. `frame` is the height of the view at the target, in ring
    radii; the distance follows from it and the lens, so a pose can open its
    lens without the target plane changing size. `yaw` swings the camera off
    the axis, round the vertical; `elevation` lifts it. */
type Pose = { fov: number; yaw: number; elevation: number; frame: number }

const CREATE: Pose = { fov: 8, yaw: 0, elevation: 0, frame: 1 / CIRCLE_RADIUS }
const ARRANGE: Pose = {
  fov: 30,
  yaw: (78 * Math.PI) / 180,
  elevation: (12 * Math.PI) / 180,
  // A turn is two radii tall; this leaves a little glass above and below.
  frame: 2.4,
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The helix: a loop position on turn `k`, in world units, at `pitch` per turn
 * along +X. Seen from +X down the axis with Y up, screen-right is −Z, so the
 * canvas's clockwise ring (x right, y down) lands as z = −cos θ, y = −sin θ.
 */
export function helixPoint(
  pos: number,
  turn: number,
  pitch: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const theta = pos * Math.PI * 2 - Math.PI / 2
  return out.set((turn + pos) * pitch, -Math.sin(theta), -Math.cos(theta))
}

const POINT_VERT = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec2 aOffset;
  attribute vec2 aBall;
  attribute vec2 aJitter;
  attribute float aRank;
  attribute float aTurn;
  uniform float uMorph;
  uniform float uScatter;
  uniform float uPitch;
  uniform float uCurrent;
  uniform float uKeep;
  uniform float uProj;
  uniform float uDot;
  varying float vAlpha;
  void main() {
    vec3 center = vec3((aCenter.x + aTurn) * uPitch, aCenter.y, aCenter.z);
    // The mark lies in its turn's plane: screen-right is -Z, screen-up is +Y.
    vec2 mark = aOffset + aJitter * uScatter;
    vec3 inPlane = vec3(0.0, mark.y, -mark.x) * (1.0 - uMorph);
    vec4 mv = modelViewMatrix * vec4(center + inPlane, 1.0);
    // The ball faces the camera whatever the pose: a flat dot, not a sphere.
    mv.xy += aBall * uMorph;
    gl_Position = projectionMatrix * mv;
    float px = uDot * uProj / -mv.z;
    gl_PointSize = max(1.0, px);
    // A speck smaller than a pixel prints lighter instead of larger.
    float sub = min(1.0, px);
    float onTurn = 1.0 - step(0.5, abs(aTurn - uCurrent));
    float turnAlpha = mix(onTurn, 1.0, uMorph);
    float keep = mix(1.0, uKeep, uMorph);
    float rankAlpha = 1.0 - step(keep, aRank);
    vAlpha = ${BASE_ALPHA} * turnAlpha * rankAlpha * sub * sub;
  }
`

const POINT_FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.002) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
  }
`

const LINE_VERT = /* glsl */ `
  attribute float aTurn;
  uniform float uMorph;
  uniform float uCurrent;
  varying float vAlpha;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    float onTurn = 1.0 - step(0.5, abs(aTurn - uCurrent));
    vAlpha = ${GRID_ALPHA} * mix(onTurn, 1.0, uMorph);
  }
`

const LINE_FRAG = /* glsl */ `
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.002) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
  }
`

/** The playhead: one soft point of light, a fixed size on screen. */
const HEAD_VERT = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }
`

const HEAD_FRAG = /* glsl */ `
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    // A bright core, falling off to nothing at the rim.
    float a = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(1.0, 1.0, 1.0, a * a);
  }
`

export class SpiralScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(CREATE.fov, 1, 0.1, 100)
  private points: THREE.Points | null = null
  private pointMaterial: THREE.ShaderMaterial
  private lineMaterial: THREE.ShaderMaterial
  private helix: THREE.Line
  private head: THREE.Points
  private headMaterial: THREE.ShaderMaterial
  private headPosition: THREE.BufferAttribute

  private marks: readonly MarkTap[] = []
  private width = 1
  private height = 1
  private dpr = 1

  private mode: Mode = 'create'
  /** 0 is CREATE's pose, 1 ARRANGE's; moves toward the mode over TRANSITION_MS. */
  private blend = 0
  private blendFrom = 0
  private blendStart = 0
  private blendTarget = 0

  /** Which pass of the loop the playhead is on, 0..TURNS-1. */
  private current = 0
  private lastHead: number | null = null

  /** ARRANGE's view along the song: how many turns are across the screen,
      and where along the axis (in ring radii) the screen is centred. */
  private visible = 5
  private scroll = 0

  constructor(
    canvas: HTMLCanvasElement,
    /** Read every frame: 0..1 through the loop, or null when stopped. */
    private readonly playhead: () => number | null,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x000000, 0)

    this.pointMaterial = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        uMorph: { value: 0 },
        uScatter: { value: 0 },
        uPitch: { value: 1 },
        uCurrent: { value: 0 },
        uKeep: { value: BALL_SHARE },
        uProj: { value: 1 },
        uDot: { value: SPECK_SIZE },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.lineMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: { uMorph: { value: 0 }, uCurrent: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.headMaterial = new THREE.ShaderMaterial({
      vertexShader: HEAD_VERT,
      fragmentShader: HEAD_FRAG,
      uniforms: { uSize: { value: HEAD_PX } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    this.helix = this.buildHelix()
    this.scene.add(this.helix)

    const headGeometry = new THREE.BufferGeometry()
    this.headPosition = new THREE.BufferAttribute(new Float32Array(3), 3)
    headGeometry.setAttribute('position', this.headPosition)
    this.head = new THREE.Points(headGeometry, this.headMaterial)
    this.head.frustumCulled = false
    this.head.visible = false
    this.scene.add(this.head)
  }

  // ── Building ──────────────────────────────────────────────────────────

  /** The helix itself, every turn, built at unit pitch and stretched along
      the axis to the pitch of the moment. Seen down the axis it is the ring. */
  private buildHelix(): THREE.Line {
    const steps = 192 * TURNS
    const positions = new Float32Array((steps + 1) * 3)
    const turns = new Float32Array(steps + 1)
    const p = new THREE.Vector3()
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * TURNS
      const turn = Math.min(TURNS - 1, Math.floor(t))
      helixPoint(t - turn, turn, 1, p)
      positions.set([p.x, p.y, p.z], i * 3)
      turns[i] = turn
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aTurn', new THREE.BufferAttribute(turns, 1))
    const line = new THREE.Line(geometry, this.lineMaterial)
    line.frustumCulled = false
    return line
  }

  /** Ink correction for a canvas larger than the reference; 1 at or below. */
  private inkScale(): number {
    const css = Math.min(this.width, this.height) / this.dpr
    return Math.min(MAX_INK, Math.max(1, css / REF_MIN_DIM))
  }

  /**
   * Every mark's specks, one geometry, drawn once per turn of the song. Each
   * speck knows where its mark sits on the helix (at unit pitch), where it
   * lies in the mark, and where it goes when the mark collapses into its ball.
   */
  private buildPoints(): void {
    if (this.points) {
      this.scene.remove(this.points)
      this.points.geometry.dispose()
      this.points = null
    }
    const ink = this.inkScale()
    const sampled = this.marks.map((tap) => ({ tap, specks: sampleSpecks(tap, ink) }))
    const total = sampled.reduce((n, s) => n + s.specks.count, 0)
    if (total === 0) return

    const centers = new Float32Array(total * 3)
    const offsets = new Float32Array(total * 2)
    const balls = new Float32Array(total * 2)
    const jitters = new Float32Array(total * 2)
    const ranks = new Float32Array(total)
    const c = new THREE.Vector3()
    let i = 0
    for (const { tap, specks } of sampled) {
      helixPoint(tap.pos, 0, 1, c)
      const unit = unitOf(tap)
      const turn = turnOf(tap)
      const cos = Math.cos(turn) * unit
      const sin = Math.sin(turn) * unit
      // A gaussian stray of REVERB's sigma, in ring radii.
      const stray = REVERB_MAX_SCATTER / CIRCLE_RADIUS
      const ball = BALL_RADIUS * scaleOf(tap)
      // The ball's grains in their own order, so the share that prints it is
      // spread through the mark rather than being one corner of it.
      const rand = makeRng(tap.seed ^ 0x2545f491)
      for (let k = 0; k < specks.count; k++, i++) {
        const fx = specks.xs[k]
        const fy = specks.ys[k]
        // Screen convention (x right, y down) as the canvas placed them; the
        // shader turns that into the turn's plane. Stored as (right, up).
        const x = fx * cos - fy * sin
        const y = fx * sin + fy * cos
        centers[i * 3] = c.x
        centers[i * 3 + 1] = c.y
        centers[i * 3 + 2] = c.z
        offsets[i * 2] = x
        offsets[i * 2 + 1] = -y
        jitters[i * 2] = specks.jxs[k] * stray
        jitters[i * 2 + 1] = -specks.jys[k] * stray
        const r = Math.sqrt(rand()) * ball
        const a = rand() * Math.PI * 2
        balls[i * 2] = Math.cos(a) * r
        balls[i * 2 + 1] = Math.sin(a) * r
        ranks[i] = k / specks.count
      }
    }
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3))
    geometry.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3))
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 2))
    geometry.setAttribute('aBall', new THREE.BufferAttribute(balls, 2))
    geometry.setAttribute('aJitter', new THREE.BufferAttribute(jitters, 2))
    geometry.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1))
    const turns = new Float32Array(TURNS)
    for (let t = 0; t < TURNS; t++) turns[t] = t
    geometry.setAttribute('aTurn', new THREE.InstancedBufferAttribute(turns, 1))
    geometry.instanceCount = TURNS
    this.points = new THREE.Points(geometry, this.pointMaterial)
    this.points.frustumCulled = false
    this.scene.add(this.points)
  }

  // ── Inputs ────────────────────────────────────────────────────────────

  setMarks(marks: readonly MarkTap[]): void {
    this.marks = marks
    if (marks.length === 0) {
      this.current = 0
      this.lastHead = null
    }
    this.buildPoints()
  }

  /** REVERB, 0..1. */
  setScatter(amount: number): void {
    this.pointMaterial.uniforms.uScatter.value = amount
  }

  setMode(mode: Mode, now: number): void {
    if (mode === this.mode) return
    this.mode = mode
    this.blendFrom = this.blend
    this.blendTarget = mode === 'arrange' ? 1 : 0
    this.blendStart = now
    // Arriving in ARRANGE, the screen is centred on the turn you were on.
    if (mode === 'arrange') this.scroll = this.clampScroll((this.current + 0.5) * this.pitch())
  }

  getMode(): Mode {
    return this.mode
  }

  resize(width: number, height: number, dpr: number): void {
    const inkBefore = this.inkScale()
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.dpr = dpr
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(this.width, this.height, false)
    this.headMaterial.uniforms.uSize.value = HEAD_PX * dpr
    if (this.inkScale() !== inkBefore) this.buildPoints()
    this.scroll = this.clampScroll(this.scroll)
  }

  // ── ARRANGE's view along the song ─────────────────────────────────────

  /** The width of the screen at the target, in ring radii, in ARRANGE. */
  private frameWidth(): number {
    const aspect = this.width / this.height
    return aspect < 1 ? ARRANGE.frame : ARRANGE.frame * aspect
  }

  /** The turns' spacing along the axis: `visible` of them across the screen. */
  private pitch(): number {
    return this.frameWidth() / this.visible
  }

  private clampScroll(x: number): number {
    const half = this.frameWidth() / 2
    const length = TURNS * this.pitch()
    if (length <= half * 2) return length / 2
    return clamp(x, half, length - half)
  }

  /** Scroll the song by a drag of `dx` canvas px — the helix follows the
      finger, so a drag to the left shows what comes later. */
  panByPixels(dx: number): void {
    this.scroll = this.clampScroll(this.scroll - dx * this.worldPerPixel())
  }

  /** Pinch: `ratio` > 1 spreads the turns (fewer across the screen), < 1
      packs them. The turn under the middle of the screen stays put. */
  zoomBy(ratio: number): void {
    const before = this.pitch()
    this.visible = clamp(this.visible / ratio, MIN_VISIBLE, MAX_VISIBLE)
    this.scroll = this.clampScroll((this.scroll / before) * this.pitch())
  }

  /** Ring radii per canvas px at the target, in ARRANGE's pose. */
  private worldPerPixel(): number {
    const aspect = this.width / this.height
    const vFrame = aspect < 1 ? ARRANGE.frame / aspect : ARRANGE.frame
    return vFrame / this.height
  }

  // ── Frames ────────────────────────────────────────────────────────────

  /** True while the camera is still moving. */
  isAnimating(now: number): boolean {
    return this.blend !== this.blendTarget && now - this.blendStart < TRANSITION_MS + 50
  }

  private placeCamera(): void {
    const u = easeInOut(this.blend)
    const fov = lerp(CREATE.fov, ARRANGE.fov, u)
    const yaw = lerp(CREATE.yaw, ARRANGE.yaw, u)
    const elevation = lerp(CREATE.elevation, ARRANGE.elevation, u)
    const frame = lerp(CREATE.frame, ARRANGE.frame, u)
    const pitch = this.pitch()
    // CREATE looks at the current turn; ARRANGE at wherever the song is
    // scrolled to.
    const targetX = lerp((this.current + 0.5) * pitch, this.scroll, u)

    const aspect = this.width / this.height
    // `frame` spans the SHORTER side, as the canvas's ring did.
    const vFrame = aspect < 1 ? frame / aspect : frame
    const half = (fov * Math.PI) / 360
    const distance = vFrame / 2 / Math.tan(half)
    this.camera.fov = fov
    this.camera.aspect = aspect
    this.camera.near = Math.max(0.05, distance * 0.05)
    this.camera.far = distance * 4 + TURNS * pitch
    this.camera.updateProjectionMatrix()
    const target = new THREE.Vector3(targetX, 0, 0)
    // On the axis (+X) at yaw 0; swung round toward +Z as the yaw opens.
    this.camera.position.set(
      targetX + Math.cos(elevation) * Math.cos(yaw) * distance,
      Math.sin(elevation) * distance,
      Math.cos(elevation) * Math.sin(yaw) * distance,
    )
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld()
    // Pixels per world unit at unit depth, for the specks' size.
    this.pointMaterial.uniforms.uProj.value = this.height / (2 * Math.tan(half))
  }

  frame(now: number): void {
    // The camera move.
    if (this.blend !== this.blendTarget) {
      const t = Math.min(1, (now - this.blendStart) / TRANSITION_MS)
      this.blend = lerp(this.blendFrom, this.blendTarget, t)
      if (t >= 1) this.blend = this.blendTarget
    }
    // The playhead, and which pass of the song it is on: a wrap is one more
    // turn. Stopping holds the turn; an emptied loop starts over (setMarks).
    const head = this.playhead()
    if (head !== null && this.lastHead !== null && head < this.lastHead - 0.5) {
      this.current = (this.current + 1) % TURNS
    }
    this.lastHead = head

    const morph = easeInOut(this.blend)
    const pitch = this.pitch()
    this.pointMaterial.uniforms.uMorph.value = morph
    this.pointMaterial.uniforms.uCurrent.value = this.current
    this.pointMaterial.uniforms.uPitch.value = pitch
    this.lineMaterial.uniforms.uMorph.value = morph
    this.lineMaterial.uniforms.uCurrent.value = this.current
    this.helix.scale.x = pitch

    // The light on the helix, where the loop is now.
    this.head.visible = head !== null
    if (head !== null) {
      const p = helixPoint(head, this.current, pitch)
      this.headPosition.setXYZ(0, p.x, p.y, p.z)
      this.headPosition.needsUpdate = true
    }

    this.placeCamera()
    this.renderer.render(this.scene, this.camera)
  }

  // ── Hit testing ───────────────────────────────────────────────────────

  /** Where a loop position on the current turn lands on the canvas, in
      canvas px from the top-left. */
  project(pos: number): { x: number; y: number } {
    const p = helixPoint(pos, this.current, this.pitch()).project(this.camera)
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height }
  }

  /** Which mark is under a canvas point, or null. Only the current turn's,
      and only in CREATE: ARRANGE is for looking. */
  markAt(x: number, y: number): string | null {
    if (this.blend !== 0) return null
    let hit: string | null = null
    let best = HIT_RADIUS * Math.max(MARK_SCALE, 0.75) * Math.min(this.width, this.height)
    for (const mark of this.marks) {
      const at = this.project(mark.pos)
      const distance = Math.hypot(x - at.x, y - at.y)
      if (distance < best) {
        best = distance
        hit = mark.id
      }
    }
    return hit
  }

  /** A canvas point back to its position around the current turn, 0 at 12
      o'clock, clockwise — the angle about the ring's centre on screen. */
  loopPosAt(x: number, y: number): number {
    // The axis projects to the canvas's centre in CREATE, the only pose that
    // takes a drag.
    const angle = Math.atan2(y - this.height / 2, x - this.width / 2) / (Math.PI * 2) + 0.25
    return ((angle % 1) + 1) % 1
  }

  dispose(): void {
    this.points?.geometry.dispose()
    this.helix.geometry.dispose()
    this.head.geometry.dispose()
    this.pointMaterial.dispose()
    this.lineMaterial.dispose()
    this.headMaterial.dispose()
    this.renderer.dispose()
  }
}
