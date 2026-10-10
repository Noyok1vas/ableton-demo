import { useEffect, useRef } from 'react'
import type React from 'react'
import { ShapeCanvas, type ShapeCanvasHandle } from './ShapeCanvas.tsx'
import { useShapeEditor } from './session.tsx'
import { PATTERNS } from '../selector/patterns.ts'
import type { SoundVoiceId } from '../transport/engine.ts'
import './chladni-editor.css'

const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

function Slot({ id, label }: { id: SoundVoiceId; label: string }) {
  const { rack, target, tap, hit, saveTo, loadFrom, clearSlot } = useShapeEditor()
  const slot = rack[id]
  const canvas = useRef<ShapeCanvasHandle>(null)

  useEffect(() => {
    if (hit.n > 0 && hit.id === id) canvas.current?.pulse()
  }, [hit, id])

  return (
    <div className="ce-slot">
      <button
        type="button"
        className={`ce-slot-pad${target === id ? ' ce-slot-pad--target' : ''}`}
        aria-label={`Play ${label}`}
        onPointerDown={(e) => {
          e.preventDefault()
          tap(id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
        }}
      >
        {slot ? (
          <ShapeCanvas ref={canvas} shape={slot.shape} pourPx={110} className="ce-slot-canvas" />
        ) : (
          <span className="ce-slot-empty">EMPTY</span>
        )}
        <span className="ce-slot-name">{label.toUpperCase()}</span>
      </button>
      <div className="ce-slot-actions">
        <button type="button" className="ce-mini" onClick={() => saveTo(id)} onKeyUp={swallowSpace}>
          SAVE
        </button>
        <button
          type="button"
          className="ce-mini"
          disabled={!slot}
          onClick={() => loadFrom(id)}
          onKeyUp={swallowSpace}
        >
          LOAD
        </button>
        <button
          type="button"
          className="ce-mini"
          disabled={!slot}
          onClick={() => clearSlot(id)}
          onKeyUp={swallowSpace}
        >
          CLEAR
        </button>
      </div>
    </div>
  )
}

/**
 * The drum rack: the eight sounds, each with the figure saved for it. A pad
 * plays its sound (and makes it the one the viewport plays); SAVE puts the
 * editor's figure in the slot, LOAD brings a slot's figure back to the
 * sliders, CLEAR empties it.
 */
export function ShapeRack() {
  return (
    <div className="ce-rack" data-no-pinch>
      {PATTERNS.map((p) => (
        <Slot key={p.id} id={p.id} label={p.label} />
      ))}
    </div>
  )
}
