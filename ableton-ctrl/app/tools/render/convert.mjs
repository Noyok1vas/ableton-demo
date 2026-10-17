// STEP → GLB with occt-import-js. Usage: node convert.mjs in.stp out.glb
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const occtimportjs = require('occt-import-js')

const [, , input, output] = process.argv
const occt = await occtimportjs()
const result = occt.ReadStepFile(new Uint8Array(readFileSync(input)), {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.0008,
  angularDeflection: 0.25,
})
if (!result.success) throw new Error('STEP import failed')

const meshes = result.meshes
const bufs = []
let byteLength = 0
const views = []
const accessors = []
const gltfMeshes = []
const nodes = []
const bbox = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]

function push(array, target, type, componentType, count, minmax) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  const pad = (4 - (bytes.length % 4)) % 4
  bufs.push(bytes, Buffer.alloc(pad))
  views.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target })
  byteLength += bytes.length + pad
  const acc = { bufferView: views.length - 1, componentType, count, type }
  if (minmax) Object.assign(acc, minmax)
  accessors.push(acc)
  return accessors.length - 1
}

for (const m of meshes) {
  const pos = new Float32Array(m.attributes.position.array)
  const idx = new Uint32Array(m.index.array)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k])
      max[k] = Math.max(max[k], pos[i + k])
    }
  for (let k = 0; k < 3; k++) {
    bbox[k] = Math.min(bbox[k], min[k])
    bbox[k + 3] = Math.max(bbox[k + 3], max[k])
  }
  const p = push(pos, 34962, 'VEC3', 5126, pos.length / 3, { min, max })
  const attributes = { POSITION: p }
  if (m.attributes.normal) {
    const nrm = new Float32Array(m.attributes.normal.array)
    attributes.NORMAL = push(nrm, 34962, 'VEC3', 5126, nrm.length / 3)
  }
  const i = push(idx, 34963, 'SCALAR', 5125, idx.length)
  gltfMeshes.push({ name: m.name, primitives: [{ attributes, indices: i }] })
  nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 })
  console.log(
    `${(m.name || '(unnamed)').padEnd(28)} tris=${String(idx.length / 3).padStart(7)}  ` +
      `x ${min[0].toFixed(1)}..${max[0].toFixed(1)}  y ${min[1].toFixed(1)}..${max[1].toFixed(1)}  z ${min[2].toFixed(1)}..${max[2].toFixed(1)}`,
  )
}
console.log('bbox', bbox.map((v) => v.toFixed(2)).join(' '), 'meshes', meshes.length)

const json = {
  asset: { version: '2.0', generator: 'occt-import-js' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes: gltfMeshes,
  accessors,
  bufferViews: views,
  buffers: [{ byteLength }],
}
const jsonBytes = Buffer.from(JSON.stringify(json))
const jsonPad = (4 - (jsonBytes.length % 4)) % 4
const bin = Buffer.concat(bufs)
const header = Buffer.alloc(12)
header.write('glTF', 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length, 8)
const jsonChunk = Buffer.alloc(8)
jsonChunk.writeUInt32LE(jsonBytes.length + jsonPad, 0)
jsonChunk.write('JSON', 4)
const binChunk = Buffer.alloc(8)
binChunk.writeUInt32LE(bin.length, 0)
binChunk.write('BIN\0', 4)
writeFileSync(
  output,
  Buffer.concat([header, jsonChunk, jsonBytes, Buffer.alloc(jsonPad, 0x20), binChunk, bin]),
)
console.log('wrote', output, Math.round(bin.length / 1024), 'KB')
