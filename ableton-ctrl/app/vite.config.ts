import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const TONE_FILE = fileURLToPath(new URL('./src/transport/outputTone.defaults.ts', import.meta.url))
const TONE_KEYS = [
  'volume',
  'lowGain',
  'lowFreq',
  'midGain',
  'midFreq',
  'midQ',
  'highGain',
  'highFreq',
] as const

/**
 * The workbench's (/?bench) one write: "Save as device default" rewrites
 * src/transport/outputTone.defaults.ts, which the Pi build then plays with.
 * Dev server only — a build has no such endpoint. It takes numbers for the
 * known keys and nothing else, so it can only ever write that one small file.
 */
function benchSave(): Plugin {
  return {
    name: 'bench-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bench/output-tone', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
          if (body.length > 4096) req.destroy()
        })
        req.on('end', () => {
          try {
            const raw = JSON.parse(body) as Record<string, unknown>
            const lines = TONE_KEYS.map((key) => {
              const v = raw[key]
              if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`bad ${key}`)
              return `  ${key}: ${Math.round(v * 100) / 100},`
            })
            writeFileSync(
              TONE_FILE,
              [
                "// The device's saved output tone — written by the workbench's \"Save as device",
                '// default" (/?bench, dev server only). Committed, so the Pi build plays with it.',
                "import type { OutputTone } from './outputTone.ts'",
                '',
                'export const OUTPUT_TONE_DEFAULTS: OutputTone = {',
                ...lines,
                '}',
                '',
              ].join('\n'),
            )
            res.statusCode = 204
            res.end()
          } catch (err) {
            res.statusCode = 400
            res.end(String(err))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), benchSave()],
})
