import { useEffect } from 'react'

/**
 * Saving the instrument between visits.
 *
 * Everything is kept in this browser's localStorage, one key per session, and
 * read back once when that session mounts. Storage can be missing or throw (a
 * private window, blocked site data), so every access is guarded and the app
 * simply starts fresh when it can't remember — nothing here is allowed to stop
 * the instrument from loading.
 *
 * The version in the prefix is the escape hatch: change the stored shape in a
 * way the parsers below can't absorb, bump it, and old saves are ignored.
 */
const PREFIX = 'drumsynth.v1.'

/** How long after the last change a save is written. A dragged slider changes
    state every frame; the save only needs to land once it settles. */
const SAVE_DELAY_MS = 300

export function loadSaved(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw == null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeSaved(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Full or unavailable — this visit simply won't be remembered.
  }
}

/** Keep `value` saved under `key`, written a moment after it stops changing. */
export function useSaved(key: string, value: unknown): void {
  useEffect(() => {
    const timer = window.setTimeout(() => writeSaved(key, value), SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [key, value])
}

/** Whether this browser will keep anything at all — the Sound Source screen
    says so rather than promising a save that won't happen. */
export function storageAvailable(): boolean {
  try {
    const probe = `${PREFIX}probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

// ── Parsing helpers ──────────────────────────────────────────────────────
// Stored data is untrusted: an old save, a hand edit, another version. Each
// helper takes the defaults and keeps only what is valid, so a partial or
// broken save degrades to the defaults field by field instead of all at once.

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function finiteIn(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null
}

/** A record of numbers, each clamped to [min, max], defaults for anything else. */
export function mergeNumbers<K extends string>(
  defaults: Record<K, number>,
  raw: unknown,
  min: number,
  max: number,
): Record<K, number> {
  const out = { ...defaults }
  if (!isRecord(raw)) return out
  for (const key of Object.keys(defaults) as K[]) {
    const value = finiteIn(raw[key], min, max)
    if (value !== null) out[key] = value
  }
  return out
}
