/// <reference types="vite/client" />
/**
 * Output tone — volume and a three-band EQ at the very end of the built-in
 * engine, in front of the safety limiter. It tunes the sound to the speaker
 * it comes out of, not to the music, so it is not a macro and no module above
 * the engine knows about it.
 *
 *   … ─▶ sat ─▶ HP ─▶ low shelf ─▶ mid bell ─▶ high shelf ─▶ limiter ─▶ volume ─▶ out
 *
 * Where the values come from:
 *   1. OUTPUT_TONE_DEFAULTS (outputTone.defaults.ts) — committed, what the Pi plays
 *   2. a localStorage override — what the workbench (/?bench) is trying right now
 * The workbench writes the override and every page on this origin — its own
 * preview iframe included — hears it through the `storage` event and retunes
 * live. "Save as device default" rewrites the defaults file through the dev
 * server and drops the override.
 */
import { OUTPUT_TONE_DEFAULTS } from './outputTone.defaults.ts'

export interface OutputTone {
  /** dB, applied after the limiter. */
  volume: number
  /** Low shelf: gain in dB, corner in Hz. */
  lowGain: number
  lowFreq: number
  /** Mid bell: gain in dB, centre in Hz, width as Q. */
  midGain: number
  midFreq: number
  midQ: number
  /** High shelf: gain in dB, corner in Hz. */
  highGain: number
  highFreq: number
}

export type OutputToneKey = keyof OutputTone

/** Ranges for the workbench's controls and for clamping anything loaded. */
export const OUTPUT_TONE_RANGES: Record<
  OutputToneKey,
  { min: number; max: number; step: number; log?: boolean }
> = {
  volume: { min: -30, max: 6, step: 0.5 },
  lowGain: { min: -12, max: 12, step: 0.5 },
  lowFreq: { min: 40, max: 400, step: 1, log: true },
  midGain: { min: -12, max: 12, step: 0.5 },
  midFreq: { min: 200, max: 5000, step: 1, log: true },
  midQ: { min: 0.3, max: 4, step: 0.05 },
  highGain: { min: -12, max: 12, step: 0.5 },
  highFreq: { min: 2000, max: 16000, step: 10, log: true },
}

export const OUTPUT_TONE_FLAT: OutputTone = {
  volume: 0,
  lowGain: 0,
  lowFreq: 120,
  midGain: 0,
  midFreq: 1000,
  midQ: 0.8,
  highGain: 0,
  highFreq: 6000,
}

const STORAGE_KEY = 'drumsynth.v1.outputTone'

let defaults: OutputTone = sanitize(OUTPUT_TONE_DEFAULTS)
const listeners = new Set<(tone: OutputTone) => void>()

function sanitize(raw: unknown, base: OutputTone = OUTPUT_TONE_FLAT): OutputTone {
  const out = { ...base }
  if (!raw || typeof raw !== 'object') return out
  for (const key of Object.keys(OUTPUT_TONE_RANGES) as OutputToneKey[]) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const { min, max } = OUTPUT_TONE_RANGES[key]
    out[key] = Math.min(max, Math.max(min, v))
  }
  return out
}

function readOverride(): OutputTone | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw == null ? null : sanitize(JSON.parse(raw), defaults)
  } catch {
    return null
  }
}

/** The tone to play with now: the workbench's override, else the device default. */
export function getOutputTone(): OutputTone {
  return readOverride() ?? defaults
}

export function getOutputToneDefaults(): OutputTone {
  return defaults
}

/** True while the workbench is trying something the defaults file doesn't hold. */
export function hasOutputToneOverride(): boolean {
  return readOverride() != null
}

function notify(): void {
  const tone = getOutputTone()
  for (const fn of listeners) fn(tone)
}

/** Try a tone on this browser (and every tab/iframe of this origin). */
export function setOutputToneOverride(tone: OutputTone): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(tone)))
  } catch {
    // Storage unavailable — this page still hears it below.
  }
  notify()
}

export function clearOutputToneOverride(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // nothing to clear
  }
  notify()
}

export function subscribeOutputTone(fn: (tone: OutputTone) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Other documents of this origin (the workbench and its preview iframe) tell
// each other through storage events.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) notify()
  })
}

/** Rewrite outputTone.defaults.ts through the dev server (vite.config.ts). */
export async function saveOutputToneDefaults(tone: OutputTone): Promise<void> {
  const res = await fetch('/__bench/output-tone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sanitize(tone)),
  })
  if (!res.ok) throw new Error(`save failed (${res.status}): ${await res.text()}`)
}

// A saved defaults file arrives by HMR: take it without reloading the page.
if (import.meta.hot) {
  import.meta.hot.accept('./outputTone.defaults.ts', (mod) => {
    if (!mod) return
    defaults = sanitize(mod.OUTPUT_TONE_DEFAULTS)
    notify()
  })
}

export const dbToGain = (db: number) => Math.pow(10, db / 20)
