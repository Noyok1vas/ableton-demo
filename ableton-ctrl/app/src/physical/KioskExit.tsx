import { useEffect, useState } from 'react'
import { IconPower } from '../main-screen/icons.tsx'

/** Asks the local server (ableton-ctrl/pi/serve.mjs) to close the kiosk; the
    launcher then brings up the desktop. The header keeps any other page from
    asking: a cross-site request carrying it would need a preflight the
    server never answers. */
const EXIT_URL = '/__ephnim/desktop'

type Phase = 'idle' | 'leaving' | 'failed'

/**
 * The kiosk's way out from the screen itself (only rendered under ?kiosk): a
 * power button in the free spot at the bottom centre that closes the kiosk
 * straight away.
 *
 * Getting back: the desktop has an Ephnim icon (and a menu entry) that starts
 * the kiosk again — see ableton-ctrl/pi/README.md.
 */
export function KioskExit() {
  const [phase, setPhase] = useState<Phase>('idle')

  // A leave that has not closed the page within a few seconds did not work;
  // the failure note then fades by itself.
  useEffect(() => {
    if (phase === 'idle') return
    const timer =
      phase === 'leaving'
        ? setTimeout(() => setPhase('failed'), 6000)
        : setTimeout(() => setPhase('idle'), 2500)
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

  if (phase === 'idle') {
    return (
      <button
        type="button"
        className="ms-circle kx-exit"
        aria-label="Exit to desktop"
        onClick={() => void leave()}
      >
        <IconPower />
      </button>
    )
  }

  return (
    <div className="kx" role="status">
      <p className="kx-title">
        {phase === 'leaving' ? 'Opening the desktop…' : "Can't leave from here"}
      </p>
    </div>
  )
}
