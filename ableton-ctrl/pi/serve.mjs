#!/usr/bin/env node
/**
 * Ephnim's local web server on the Raspberry Pi: serves the built app
 * (ableton-ctrl/app/dist) to the kiosk browser on the same machine. No
 * dependencies, nothing but Node's own http — the app is static, the sound
 * is synthesized in the browser, so there is nothing else to run.
 *
 *   node ableton-ctrl/pi/serve.mjs            127.0.0.1:4173
 *   EPHNIM_PORT=8080 EPHNIM_HOST=0.0.0.0 ...  (e.g. to open it from the Mac)
 *
 * Run by systemd as ephnim-web.service (see ./ephnim), which restarts it if
 * it ever exits. It exits on purpose when there is no build yet, so the
 * service keeps retrying until `ephnim update` has produced one.
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(process.env.EPHNIM_DIST ?? join(HERE, '..', 'app', 'dist'))
const HOST = process.env.EPHNIM_HOST ?? '127.0.0.1'
const PORT = Number(process.env.EPHNIM_PORT ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
}

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`ephnim-web: no build at ${ROOT} — run \`ableton-ctrl/pi/ephnim update\``)
  process.exit(1)
}

/** The file a URL path names inside ROOT, or null if it leaves ROOT. */
function fileFor(urlPath) {
  let path
  try {
    path = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    return null
  }
  const full = normalize(join(ROOT, path))
  return full === ROOT || full.startsWith(ROOT + sep) ? full : null
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  let file = fileFor(req.url ?? '/')
  if (!file) {
    res.writeHead(400).end()
    return
  }
  let stat = existsSync(file) ? statSync(file) : null
  if (stat?.isDirectory()) {
    file = join(file, 'index.html')
    stat = existsSync(file) ? statSync(file) : null
  }
  // A missing file is a 404; any other path is the page (one page app).
  if (!stat && extname(file)) {
    res.writeHead(404).end()
    return
  }
  if (!stat) {
    file = join(ROOT, 'index.html')
    stat = statSync(file)
  }
  // Vite fingerprints everything under assets/, so those never change under
  // the same name; the page itself is always re-read, so an update shows on
  // the next reload.
  const immutable = file.startsWith(join(ROOT, 'assets') + sep)
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
})

server.on('error', (err) => {
  console.error(`ephnim-web: ${err.message}`)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`ephnim-web: serving ${ROOT} on http://${HOST}:${PORT}`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
