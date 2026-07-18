import { useEffect, useRef, useState } from 'react'
import type React from 'react'

type TapButtonProps = {
  onTap: () => void
  recording: boolean
}

const FLASH_MS = 90

/**
 * Pointer-driven tap surface. Uses pointerdown (not click) so the tap lands at
 * press time — click fires on release, which is too late for rhythm capture.
 * Keyboard Space is handled globally by the screen, not here.
 */
export function TapButton({ onTap, recording }: TapButtonProps) {
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    onTap()
    setFlash(true)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(false), FLASH_MS)
  }

  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    },
    [],
  )

  return (
    <button
      type="button"
      className={[
        'tap-button',
        flash ? 'tap-button--flash' : '',
        recording ? 'tap-button--recording' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={handlePointerDown}
      // Suppress keyboard activation: Space is captured globally and Enter
      // would double-report a tap.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
      }}
    >
      TAP
    </button>
  )
}
