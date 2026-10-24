/**
 * The Sound Visual as one three.js scene, in both of its modes.
 *
 * The loop is a helix: one turn per pass of the loop, 12 o'clock at the top,
 * clockwise, each turn sinking PITCH along the axis. The ring the 2D canvas
 * drew is this helix seen straight down its axis — which is what CREATE is: a
 * camera on the axis with a near-orthographic lens, framing the current turn
 * exactly as the canvas framed its ring, every other turn faded out. ARRANGE
 * tilts the same camera off the axis, opens the lens, and pulls back until the
 * whole song is in frame; every mark collapses into a flat grainy dot sized by
 * how hard it was played. Switching modes is one camera move between those
 * two poses, with the marks morphing on the way.
 *
 * Drawn flat on purpose: white specks on the glass, the same ink as the 2D
 * canvas and the pads — nothing lit, no volume.
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
/** How far a turn sinks along the axis, in ring radii. */
const PITCH = 0.7

const BASE_ALPHA = 0.7
/** The grid's ink; brighter than the canvas's 0.08 because here it is white
    on black, where the same alpha reads fainter. */
const GRID_ALPHA = 0.12
const PLAYHEAD_ALPHA = 0.06
const PLAYHEAD_SWEEP = 0.62
/** Radius of the ball a mark becomes, in ring radii, before the mark's size. */
const BALL_RADIUS = 0.085
/** The share of a mark's specks that print its ball. */
const BALL_SHARE = 0.18
/** The camera move, and the morph with it. */
const TRANSITION_MS = 650
/** The canvas's ink was tuned at this shorter side, in CSS px; a larger
    canvas buys more specks. */
const REF_MIN_DIM = 500
const MAX_INK = 4

/** A camera pose. `frame` is the height of the view at the target, in ring
    radii; the distance follows from it and the lens, so a pose can open its
    lens without the target plane changing size. */
type Pose = { fov: number; elevation: number; targetZ: number; frame: number }

const CREATE_FOV = 8
const ARRANGE_FOV = 42
const ARRANGE_ELEVATION = (54 * Math.PI) / 180
/** The ring at CIRCLE_RADIUS of the shorter side: that side is this many radii. */
const CREATE_FRAME = 1 / CIRCLE_RADIUS
const ARRANGE_FRAME = 7.2

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/** The helix: a loop position on turn `k`, in world units. Screen y is down
    in the canvas convention and up in three, so y is flipped. */
export function helixPoint(pos: number, turn: number, out = new THREE.Vector3()): THREE.Vector3 {
  const theta = pos * Math.PI * 2 - Math.PI / 2
  return out.set(Math.cos(theta), -Math.sin(theta), -(turn + pos) * PITCH)
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
    vec3 center = aCenter + vec3(0.0, 0.0, -aTurn * uPitch);
    vec2 mark = aOffset + aJitter * uScatter;
    vec4 mv = modelViewMatrix * vec4(center + vec3(mark * (1.0 - uMorph), 0.0), 1.0);
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

/** The playhead: the canvas's conic gradient, tinting the sweep behind the
    leading edge, on a disc in the current turn's plane. */
const HEAD_VERT = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const HEAD_FRAG = /* glsl */ `
  uniform float uHead;
  varying vec2 vPos;
  void main() {
    // Clockwise on screen is increasing angle with y down.
    float theta = atan(-vPos.y, vPos.x);
    float f = fract((theta - (uHead * 6.2831853 - 1.5707963)) / 6.2831853);
    float back = 1.0 - ${PLAYHEAD_SWEEP};
    float mid = mix(back, 1.0, 0.6);
    float a = 0.0;
    if (f > mid) a = mix(0.3, 1.0, (f - mid) / (1.0 - mid));
    else if (f > back) a = mix(0.0, 0.3, (f - back) / (mid - back));
    gl_FragColor = vec4(1.0, 1.0, 1.0, a * ${PLAYHEAD_ALPHA});
  }
`

export class SpiralScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(CREATE_FOV, 1, 0.1, 100)
  private points: THREE.Points | null = null
  private pointMaterial: THREE.ShaderMaterial
  private lineMaterial: THREE.ShaderMaterial
  private spokes: THREE.LineSegments | null = null
  private head: THREE.Mesh
  private headMaterial: THREE.ShaderMaterial

  private marks: readonly MarkTap[] = []
  private beats = 8
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
    this.renderer.autoClear = true

    this.pointMaterial = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        uMorph: { value: 0 },
        uScatter: { value: 0 },
        uPitch: { value: PITCH },
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
      uniforms: { uHead: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    this.scene.add(this.buildHelix())
    this.head = new THREE.Mesh(new THREE.CircleGeometry(3.2, 96), this.headMaterial)
    this.head.visible = false
    this.head.renderOrder = -1
    this.scene.add(this.head)
    this.buildSpokes()
  }

  // ── Building ──────────────────────────────────────────────────────────

  /** The helix itself, every turn: seen down the axis it is the ring. */
  private buildHelix(): THREE.Line {
    const steps = 192 * TURNS
    const positions = new Float32Array((steps + 1) * 3)
    const turns = new Float32Array(steps + 1)
    const p = new THREE.Vector3()
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * TURNS
      const turn = Math.min(TURNS - 1, Math.floor(t))
      helixPoint(t - turn, turn, p)
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

  /** The beat grid: spokes from the axis, in the current turn's plane. */
  private buildSpokes(): void {
    if (this.spokes) {
      this.scene.remove(this.spokes)
      this.spokes.geometry.dispose()
    }
    const reach = 3.2
    const positions = new Float32Array(this.beats * 6)
    const turns = new Float32Array(this.beats * 2)
    for (let beat = 0; beat < this.beats; beat++) {
      const theta = (beat / this.beats) * Math.PI * 2 - Math.PI / 2
      positions.set([0, 0, 0, Math.cos(theta) * reach, -Math.sin(theta) * reach, 0], beat * 6)
      // Always the current turn's: the spokes move with it (see frame).
      turns[beat * 2] = -1
      turns[beat * 2 + 1] = -1
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aTurn', new THREE.BufferAttribute(turns, 1))
    // Its own material so it never fades: `aTurn` of -1 would otherwise hide it.
    const material = this.lineMaterial.clone()
    material.uniforms.uMorph.value = 1
    this.spokes = new THREE.LineSegments(geometry, material)
    this.spokes.frustumCulled = false
    this.scene.add(this.spokes)
  }

  /** Ink correction for a canvas larger than the reference; 1 at or below. */
  private inkScale(): number {
    const css = Math.min(this.width, this.height) / this.dpr
    return Math.min(MAX_INK, Math.max(1, css / REF_MIN_DIM))
  }

  /**
   * Every mark's specks, one geometry, drawn once per turn of the song. Each
   * speck knows where its mark sits on the helix, where it lies in the mark,
   * and where it goes when the mark collapses into its ball.
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
      helixPoint(tap.pos, 0, c)
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
        // Screen convention (y down) as the canvas placed them, then flipped.
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

  setBeats(beats: number): void {
    if (beats === this.beats) return
    this.beats = beats
    this.buildSpokes()
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
    if (this.inkScale() !== inkBefore) this.buildPoints()
  }

  // ── Frames ────────────────────────────────────────────────────────────

  /** True while the camera is still moving. */
  isAnimating(now: number): boolean {
    return this.blend !== this.blendTarget && now - this.blendStart < TRANSITION_MS + 50
  }

  private pose(): Pose {
    const u = easeInOut(this.blend)
    const mid = -((TURNS - 1) * PITCH) / 2
    return {
      fov: lerp(CREATE_FOV, ARRANGE_FOV, u),
      elevation: lerp(0, ARRANGE_ELEVATION, u),
      targetZ: lerp(-(this.current + 0.5) * PITCH, mid, u),
      frame: lerp(CREATE_FRAME, ARRANGE_FRAME, u),
    }
  }

  private placeCamera(): void {
    const { fov, elevation, targetZ, frame } = this.pose()
    const aspect = this.width / this.height
    // `frame` spans the SHORTER side, as the canvas's ring did.
    const vFrame = aspect < 1 ? frame / aspect : frame
    const half = (fov * Math.PI) / 360
    const distance = vFrame / 2 / Math.tan(half)
    this.camera.fov = fov
    this.camera.aspect = aspect
    this.camera.near = Math.max(0.05, distance * 0.05)
    this.camera.far = distance * 4 + TURNS * PITCH
    this.camera.updateProjectionMatrix()
    const target = new THREE.Vector3(0, 0, targetZ)
    this.camera.position.set(
      0,
      Math.sin(elevation) * distance,
      targetZ + Math.cos(elevation) * distance,
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
    this.pointMaterial.uniforms.uMorph.value = morph
    this.pointMaterial.uniforms.uCurrent.value = this.current
    this.lineMaterial.uniforms.uMorph.value = morph
    this.lineMaterial.uniforms.uCurrent.value = this.current

    // The spokes and the sweep sit in the plane the playhead is passing
    // through; stopped, they rest mid-turn where the canvas drew them.
    const planeZ = -(this.current + (head ?? 0.5)) * PITCH
    if (this.spokes) this.spokes.position.z = planeZ
    this.head.position.z = planeZ
    this.head.visible = head !== null
    this.headMaterial.uniforms.uHead.value = head ?? 0

    this.placeCamera()
    this.renderer.render(this.scene, this.camera)
  }

  // ── Hit testing ───────────────────────────────────────────────────────

  /** Where a loop position on the current turn lands on the canvas, in
      canvas px from the top-left. */
  project(pos: number): { x: number; y: number } {
    const p = helixPoint(pos, this.current).project(this.camera)
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
    this.spokes?.geometry.dispose()
    this.head.geometry.dispose()
    this.pointMaterial.dispose()
    this.lineMaterial.dispose()
    this.headMaterial.dispose()
    this.renderer.dispose()
  }
}
