import { useEffect, useRef, useState } from 'react'

/** Fingers that must rest on the glass together, and for how long. Three
    still fingers for three seconds is nothing a player does by accident — the
    pads are physical, and the screen's own gestures use one or two. */
const FINGERS = 3
const HOLD_MS = 3000
/** An unanswered question goes away by itself. */
const DISMISS_MS = 10000

/** Asks the local server (ableton-ctrl/pi/serve.mjs) to close the kiosk; the
    launcher then brings up the desktop. The header keeps any other page from
    asking: a cross-site request carrying it would need a preflight the
    server never answers. */
const EXIT_URL = '/__ephnim/desktop'

type Phase = 'idle' | 'asking' | 'leaving' | 'failed'

/**
 * The kiosk's one way out from the screen itself (only rendered under
 * ?kiosk): hold three fingers on the glass for three seconds, then confirm.
 * Nothing on the screen shows it; nothing about playing changes.
 *
 * Getting back: the desktop has an Ephnim icon (and a menu entry) that starts
 * the kiosk again — see ableton-ctrl/pi/README.md.
 */
export function KioskExit() {
  const [phase, setPhase] = useState<Phase>('idle')
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // Touch events rather than pointers: `touches` is the whole hand at once,
  // and the count is all that matters here.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const cancel = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }
    const onTouches = (e: TouchEvent) => {
      if (phaseRef.current !== 'idle') return
      if (e.touches.length >= FINGERS) {
        if (timer === null) {
          timer = setTimeout(() => {
            timer = null
            setPhase('asking')
          }, HOLD_MS)
        }
      } else {
        cancel()
      }
    }
    const opts = { passive: true, capture: true }
    window.addEventListener('touchstart', onTouches, opts)
    window.addEventListener('touchend', onTouches, opts)
    window.addEventListener('touchcancel', onTouches, opts)
    return () => {
      cancel()
      window.removeEventListener('touchstart', onTouches, opts)
      window.removeEventListener('touchend', onTouches, opts)
      window.removeEventListener('touchcancel', onTouches, opts)
    }
  }, [])

  // Every state but idle ends by itself: an unanswered question goes away, a
  // failure note fades, and a leave that has not closed the page within a
  // few seconds did not work.
  useEffect(() => {
    if (phase === 'idle') return
    const timer =
      phase === 'leaving'
        ? setTimeout(() => setPhase('failed'), 6000)
        : setTimeout(() => setPhase('idle'), phase === 'failed' ? 2500 : DISMISS_MS)
    return () => clearTimeout(timer)
  }, [phase])

  const leave = async () => {
    setPhase('leaving')
    try {
      const res = await fetch(EXIT_URL, { method: 'POST', headers: { 'X-Ephnim': '1' } })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setPhase('failed')
    }
  }

  if (phase === 'idle') return null

  return (
    <div className="kx" role="dialog" aria-label="Leave Ephnim">
      {phase === 'asking' && (
        <>
          <p className="kx-title">Leave Ephnim for the desktop?</p>
          <div className="kx-actions">
            <button type="button" className="kx-btn" onClick={() => setPhase('idle')}>
              Stay
            </button>
            <button type="button" className="kx-btn kx-btn--go" onClick={() => void leave()}>
              Desktop
            </button>
          </div>
          <p className="kx-note">The Ephnim icon on the desktop brings it back</p>
        </>
      )}
      {phase === 'leaving' && <p className="kx-title">Opening the desktop…</p>}
      {phase === 'failed' && <p className="kx-title">Can't leave from here</p>}
    </div>
  )
}
