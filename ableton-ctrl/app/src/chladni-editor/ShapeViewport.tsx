import { useEffect, useRef } from 'react'
import type React from 'react'
import { ShapeCanvas, type ShapeCanvasHandle } from './ShapeCanvas.tsx'
import { useShapeEditor } from './session.tsx'
import { PATTERNS } from '../selector/patterns.ts'
import { useSoundEngine } from '../transport/session.tsx'
import './chladni-editor.css'

const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/**
 * The editor's viewport: the figure on the sliders, large. Tap it to hear the
 * sound it is being tried against — the figure jolts with the note — and when
 * the two belong together, SAVE puts the figure in that sound's rack slot.
 */
export function ShapeViewport() {
  const { shape, target, setTarget, tap, hit, saveTo, rack } = useShapeEditor()
  const { status, source } = useSoundEngine()
  const canvas = useRef<ShapeCanvasHandle>(null)
  const label = PATTERNS.find((p) => p.id === target)?.label.toUpperCase() ?? ''

  useEffect(() => {
    if (hit.n > 0) canvas.current?.pulse()
  }, [hit])

  return (
    <div className="ce-view" data-no-pinch>
      <button
        type="button"
        className="ce-view-stage"
        aria-label={`Play ${label}`}
        onPointerDown={(e) => {
          e.preventDefault()
          tap(target)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
        }}
        data-hint={`Tap the figure to hear ${label}`}
      >
        <ShapeCanvas ref={canvas} shape={shape} pourPx={220} className="ce-view-canvas" />
        <span className="ce-view-tag">TAP TO PLAY {label}</span>
        {source === 'builtin' && !status.ready && (
          <span className="ce-view-unlock">Tap once to start sound</span>
        )}
      </button>
      <div className="ce-view-bar">
        <div className="ce-targets" role="group" aria-label="Sound">
          {PATTERNS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`ce-step${p.id === target ? ' ce-step--on' : ''}`}
              aria-pressed={p.id === target}
              onClick={() => setTarget(p.id)}
              onKeyUp={swallowSpace}
            >
              {p.label.toUpperCase()}
              {rack[p.id] ? ' ●' : ''}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ce-button ce-button--primary"
          onClick={() => saveTo(target)}
          onKeyUp={swallowSpace}
        >
          SAVE TO {label}
        </button>
      </div>
    </div>
  )
}
