/**
 * The Sound Visual as one three.js scene, in both of its modes.
 *
 * The loop is a helix lying on its side: one turn per pass of the loop, time
 * running left to right along the axis, 12 o'clock at the top of every turn,
 * clockwise. The ring the 2D canvas drew is this helix seen straight down its
 * axis — which is what CREATE is: a camera on the axis with a
 * near-orthographic lens, framing the current turn exactly as the canvas
 * framed its ring, every other turn faded out. ARRANGE swings the same camera
 * round to the side, a little above, at the same scale: the song runs off
 * both edges, and is scrolled along and pinched tighter or looser (the
 * turns' spacing, never the lens) to show three to eight of its passes.
 * Every mark collapses into a small solid dot sized by how hard it was
 * played, hung on the helix. Switching modes is one swing of the camera
 * between those two poses, with the marks morphing on the way. The lens is
 * orthographic throughout — no perspective, as the canvas had none.
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
/** Radius of the ball a mark becomes, in ring radii, before the mark's size.
    Only ARRANGE's: a mark in CREATE is drawn at its full size regardless. */
const BALL_RADIUS = 0.03
/** The share of a mark's specks that print its ball — most of them, packed
    into that small a disc, so it prints solid. */
const BALL_SHARE = 0.6
/** The section the finger is over on the stack: a sheet of this much white
    through that turn. */
const HIGHLIGHT_ALPHA = 0.1
/** The playhead's light, in CSS px across. */
const HEAD_PX = 14
/** The camera move, and the morph with it. */
const TRANSITION_MS = 650
/** The canvas's ink was tuned at this shorter side, in CSS px; a larger
    canvas buys more specks. */
const REF_MIN_DIM = 500
const MAX_INK = 4
/** The speck the canvas's ink was tuned with, at a device pixel and the ink
    correction's square root — see `inkScale`. */
const SPECK_SCALE = 0.6

/** A camera pose: `yaw` swings the camera off the axis, round the vertical;
    `elevation` lifts it. The lens is orthographic, so there is no distance. */
type Pose = { yaw: number; elevation: number }

const CREATE: Pose = { yaw: 0, elevation: 0 }
/** Not quite side-on, so a turn reads as a narrow loop rather than a line. */
const ARRANGE: Pose = { yaw: (78 * Math.PI) / 180, elevation: (10 * Math.PI) / 180 }
/** The view's height in ring radii, both poses: the ring at CIRCLE_RADIUS of
    the shorter side, as the canvas drew it. */
const FRAME = 1 / CIRCLE_RADIUS
/** Where the camera sits along its line of sight; only has to clear the song. */
const CAMERA_DISTANCE = 30

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
    // Orthographic: uProj is simply pixels per ring radius.
    float px = uDot * uProj;
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

/** The beat grid's spokes, CREATE's alone: gone by the time the camera is
    round the side. */
const SPOKE_VERT = /* glsl */ `
  uniform float uMorph;
  varying float vAlpha;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vAlpha = ${GRID_ALPHA} * (1.0 - uMorph);
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
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 2 + 40)
  private points: THREE.Points | null = null
  private pointMaterial: THREE.ShaderMaterial
  private lineMaterial: THREE.ShaderMaterial
  private spokeMaterial: THREE.ShaderMaterial
  private helix: THREE.Line
  private spokes: THREE.LineSegments | null = null
  private beats = 8
  private sheet: THREE.Mesh
  private highlight: number | null = null
  private head: THREE.Points
  private headMaterial: THREE.ShaderMaterial
  private headPosition: THREE.BufferAttribute

  private marks: readonly MarkTap[] = []
  private onCurrent: ((turn: number) => void) | null = null
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
    this.spokeMaterial = new THREE.ShaderMaterial({
      vertexShader: SPOKE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: { uMorph: { value: 0 } },
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
    this.buildSpokes()

    // The sheet through a turn that the stack's finger is over: a square of
    // glass a little larger than the ring, in the turn's plane.
    const sheetGeometry = new THREE.PlaneGeometry(2.6, 2.6)
    sheetGeometry.rotateY(Math.PI / 2)
    this.sheet = new THREE.Mesh(
      sheetGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: HIGHLIGHT_ALPHA,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.sheet.visible = false
    this.sheet.renderOrder = -1
    this.scene.add(this.sheet)

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

  /** The beat grid: spokes from the axis, in the current turn's plane, as the
      canvas drew them — reaching past the ring to the edge of the glass. */
  private buildSpokes(): void {
    if (this.spokes) {
      this.scene.remove(this.spokes)
      this.spokes.geometry.dispose()
    }
    const reach = 3.2
    const positions = new Float32Array(this.beats * 6)
    for (let beat = 0; beat < this.beats; beat++) {
      const theta = (beat / this.beats) * Math.PI * 2 - Math.PI / 2
      // Screen-right is -Z and screen-up +Y, as everywhere here.
      positions.set([0, 0, 0, 0, -Math.sin(theta) * reach, -Math.cos(theta) * reach], beat * 6)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.spokes = new THREE.LineSegments(geometry, this.spokeMaterial)
    this.spokes.frustumCulled = false
    this.scene.add(this.spokes)
  }

  /**
   * How many times its nominal count each mark is printed with — the 2D
   * canvas's own correction, kept so a mark prints as solid as it did there.
   * The ink correction for a canvas larger than the reference, times the
   * tuned speck's area over the real one's: the speck the look was tuned
   * with is at least a device pixel, while a mark's grain cell is usually
   * smaller, so the finer grain is printed with that many more specks.
   */
  private inkScale(): number {
    const minDim = Math.min(this.width, this.height)
    const ink = Math.min(MAX_INK, Math.max(1, minDim / this.dpr / REF_MIN_DIM))
    const speckDot = SPECK_SIZE * CIRCLE_RADIUS * minDim
    const tunedDot = Math.max(1, Math.max(1, Math.round(this.dpr)) * Math.sqrt(ink) * SPECK_SCALE)
    const r = tunedDot / speckDot
    return ink * r * r
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

  setBeats(beats: number): void {
    if (beats === this.beats) return
    this.beats = beats
    this.buildSpokes()
  }

  /** Which pass of the song is shown in CREATE and lit on the helix. Set by
      the stack; advanced by the playhead; reported back through `onCurrent`. */
  setCurrent(turn: number): void {
    this.current = clamp(Math.round(turn), 0, TURNS - 1)
  }

  getCurrent(): number {
    return this.current
  }

  setOnCurrent(listener: ((turn: number) => void) | null): void {
    this.onCurrent = listener
  }

  /** The section the stack's finger is over, or none. */
  setHighlight(turn: number | null): void {
    this.highlight = turn
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

  /** The view's height in ring radii: FRAME spans the SHORTER side. */
  private frameHeight(): number {
    const aspect = this.width / this.height
    return aspect < 1 ? FRAME / aspect : FRAME
  }

  /** The width of the screen, in ring radii. */
  private frameWidth(): number {
    return this.frameHeight() * (this.width / this.height)
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

  /** Ring radii per canvas px. */
  private worldPerPixel(): number {
    return this.frameHeight() / this.height
  }

  // ── Frames ────────────────────────────────────────────────────────────

  /** True while the camera is still moving. */
  isAnimating(now: number): boolean {
    return this.blend !== this.blendTarget && now - this.blendStart < TRANSITION_MS + 50
  }

  private placeCamera(): void {
    const u = easeInOut(this.blend)
    const yaw = lerp(CREATE.yaw, ARRANGE.yaw, u)
    const elevation = lerp(CREATE.elevation, ARRANGE.elevation, u)
    const pitch = this.pitch()
    // CREATE looks at the current turn; ARRANGE at wherever the song is
    // scrolled to.
    const targetX = lerp((this.current + 0.5) * pitch, this.scroll, u)

    const vFrame = this.frameHeight()
    const hFrame = this.frameWidth()
    this.camera.left = -hFrame / 2
    this.camera.right = hFrame / 2
    this.camera.top = vFrame / 2
    this.camera.bottom = -vFrame / 2
    this.camera.updateProjectionMatrix()
    const target = new THREE.Vector3(targetX, 0, 0)
    // On the axis (+X) at yaw 0; swung round toward +Z as the yaw opens.
    this.camera.position.set(
      targetX + Math.cos(elevation) * Math.cos(yaw) * CAMERA_DISTANCE,
      Math.sin(elevation) * CAMERA_DISTANCE,
      Math.cos(elevation) * Math.sin(yaw) * CAMERA_DISTANCE,
    )
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(target)
    this.camera.updateMatrixWorld()
    // Pixels per ring radius, for the specks' size.
    this.pointMaterial.uniforms.uProj.value = this.height / vFrame
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
      this.onCurrent?.(this.current)
    }
    this.lastHead = head

    const morph = easeInOut(this.blend)
    const pitch = this.pitch()
    this.pointMaterial.uniforms.uMorph.value = morph
    this.pointMaterial.uniforms.uCurrent.value = this.current
    this.pointMaterial.uniforms.uPitch.value = pitch
    this.lineMaterial.uniforms.uMorph.value = morph
    this.lineMaterial.uniforms.uCurrent.value = this.current
    this.spokeMaterial.uniforms.uMorph.value = morph
    this.helix.scale.x = pitch
    // The grid sits in the plane the playhead is passing through; stopped,
    // mid-turn, where the canvas drew it.
    if (this.spokes) this.spokes.position.x = (this.current + (head ?? 0.5)) * pitch
    this.sheet.visible = this.highlight !== null
    if (this.highlight !== null) this.sheet.position.x = (this.highlight + 0.5) * pitch

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
    this.spokes?.geometry.dispose()
    this.sheet.geometry.dispose()
    ;(this.sheet.material as THREE.Material).dispose()
    this.head.geometry.dispose()
    this.pointMaterial.dispose()
    this.lineMaterial.dispose()
    this.spokeMaterial.dispose()
    this.headMaterial.dispose()
    this.renderer.dispose()
  }
}
