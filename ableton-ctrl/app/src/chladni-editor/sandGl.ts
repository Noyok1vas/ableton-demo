/**
 * Sand printed through three.js — the editor's figures in the same ink as
 * the Sound Visual's specks: square white points, one alpha per kind.
 *
 * The editor shows nine figures at once (the viewport and eight rack slots),
 * and a browser allows only so many WebGL contexts, so they share one: an
 * offscreen renderer draws each figure in turn and the result is copied onto
 * that figure's own canvas. Falls back to the 2D printer where WebGL is not
 * to be had.
 */

import * as THREE from 'three'
import { Kind, printSand, type Sand } from '../chladni2/sand.ts'

const VERT = /* glsl */ `
  attribute float aKind;
  uniform vec2 uCenter;
  uniform float uPx;
  uniform float uGrain;
  uniform float uKindAlpha[5];
  uniform float uAlpha;
  varying float vAlpha;
  void main() {
    vec2 at = uCenter + position.xy * uPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 0.0, 1.0);
    gl_PointSize = max(1.0, uGrain);
    // A grain finer than a pixel prints lighter, as a drawn square would.
    float sub = min(1.0, uGrain);
    vAlpha = uKindAlpha[int(aKind + 0.5)] * uAlpha * sub * sub;
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uInk;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.002) discard;
    gl_FragColor = vec4(uInk, vAlpha);
  }
`

/** The 2D printer's strengths per kind, indexed by Kind. */
const KIND_ALPHA: number[] = []
KIND_ALPHA[Kind.Line] = 0.9
KIND_ALPHA[Kind.Faint] = 0.42
KIND_ALPHA[Kind.Halo] = 0.4
KIND_ALPHA[Kind.Solid] = 0.95
KIND_ALPHA[Kind.Fill] = 0.2

type Shared = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  material: THREE.ShaderMaterial
  points: THREE.Points
}

let shared: Shared | null | undefined
const geometries = new WeakMap<Sand, THREE.BufferGeometry>()

function sharedRenderer(): Shared | null {
  if (shared !== undefined) return shared
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas: document.createElement('canvas'),
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(1)
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uPx: { value: 1 },
        uGrain: { value: 1 },
        uKindAlpha: { value: [...KIND_ALPHA] },
        uAlpha: { value: 1 },
        uInk: { value: new THREE.Color(1, 1, 1) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const points = new THREE.Points(new THREE.BufferGeometry(), material)
    points.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(points)
    // Pixel space: x right, y down, as the 2D printer measured it.
    const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1)
    shared = { renderer, scene, camera, material, points }
  } catch {
    shared = null
  }
  return shared
}

function geometryOf(sand: Sand): THREE.BufferGeometry {
  const kept = geometries.get(sand)
  if (kept) return kept
  const positions = new Float32Array(sand.count * 3)
  const kinds = new Float32Array(sand.count)
  for (let i = 0; i < sand.count; i++) {
    positions[i * 3] = sand.xs[i]
    positions[i * 3 + 1] = sand.ys[i]
    kinds[i] = sand.kinds[i]
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1))
  geometries.set(sand, geometry)
  return geometry
}

/**
 * Print `sand` onto `target`, centred at (cx, cy) in its pixels, `px` per
 * body unit — the 2D printer's contract, drawn on the GPU and copied over.
 */
export function printSandGl(
  target: HTMLCanvasElement,
  sand: Sand,
  cx: number,
  cy: number,
  px: number,
  grainPx: number,
  alpha = 1,
  kindAlpha?: Partial<Record<Kind, number>>,
  ink = '#ffffff',
): void {
  const ctx = target.getContext('2d')
  if (!ctx) return
  const gl = sharedRenderer()
  if (!gl) {
    ctx.clearRect(0, 0, target.width, target.height)
    printSand(ctx, sand, cx, cy, px, grainPx, alpha, kindAlpha, ink)
    return
  }
  const { renderer, scene, camera, material, points } = gl
  const w = target.width
  const h = target.height
  renderer.setSize(w, h, false)
  camera.right = w
  camera.bottom = h
  camera.updateProjectionMatrix()

  points.geometry = geometryOf(sand)
  const u = material.uniforms
  u.uCenter.value.set(cx, cy)
  u.uPx.value = px
  u.uGrain.value = grainPx * sand.grain
  u.uAlpha.value = alpha
  u.uInk.value.set(ink)
  const strengths = u.uKindAlpha.value as number[]
  for (let k = 0; k < KIND_ALPHA.length; k++) {
    strengths[k] = kindAlpha?.[k as Kind] ?? KIND_ALPHA[k]
  }

  renderer.render(scene, camera)
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(renderer.domElement, 0, 0)
}
