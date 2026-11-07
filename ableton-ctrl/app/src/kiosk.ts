/**
 * Kiosk mode — the app as the screen of a standalone instrument (the
 * Raspberry Pi build, see ableton-ctrl/pi/README.md). Turned on by `?kiosk`
 * in the URL, which only the Pi's launcher adds, so development on the Mac
 * and the Vercel deploy are untouched. Open localhost:5173/?kiosk to preview
 * it anywhere.
 *
 * Only what a browser-as-appliance needs, nothing about the music:
 *   - no pointer arrow over the touch screen
 *   - no long-press context menu anywhere (the pads already block their own)
 *   - the sound engine starts as the page loads instead of on the first tap
 *     (webAudioEngine.ts) — the launcher runs Chromium with an autoplay
 *     policy that allows it, so there is no "tap once to start sound" step
 */
export const KIOSK =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('kiosk')

/** Applies the kiosk's page-level behaviour. Call once, before rendering. */
export function applyKiosk(): void {
  if (!KIOSK) return
  document.documentElement.classList.add('kiosk')
  document.addEventListener('contextmenu', (e) => e.preventDefault())
}
