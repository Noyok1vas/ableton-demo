import { useEffect, useRef } from 'react'
import type React from 'react'
import { SOUND_VOICES, type SoundVoiceId } from '../transport/engine.ts'
import { ShapeCanvas, type ShapeCanvasHandle } from './ShapeCanvas.tsx'
import { useShapeEditor } from './session.tsx'

const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

function Pad({ id, index }: { id: SoundVoiceId; index: number }) {
  const { rack, target, shape, labels, select, hit } = useShapeEditor()
  const slot = rack[id]
  const canvas = useRef<ShapeCanvasHandle>(null)
  const on = target === id
  const figure = on && slot ? shape : slot?.shape

  useEffect(() => {
    if (hit.n > 0 && hit.id === id) canvas.current?.pulse()
  }, [hit, id])

  return (
    <button
      type="button"
      className={`lab-pad${on ? ' lab-pad--on' : ''}`}
      aria-pressed={on}
      aria-label={`${labels[id]}, slot ${index + 1}`}
      onPointerDown={(e) => {
        e.preventDefault()
        select(id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
      }}
      onKeyUp={(e) => {
        swallowSpace(e)
        if (e.key === 'Enter') select(id)
      }}
    >
      <span className="lab-pad-figure">
        {figure ? (
          <ShapeCanvas ref={canvas} shape={figure} pourPx={96} className="lab-pad-canvas" />
        ) : (
          <span className="lab-pad-empty" />
        )}
      </span>
      <span className="lab-pad-meta">
        <span className="lab-pad-index num">{String(index + 1).padStart(2, '0')}</span>
        <span className="lab-pad-name">{labels[id]}</span>
      </span>
    </button>
  )
}

/** The eight slots, always along the bottom. Choosing one brings its figure
    and its knobs onto the plate. */
export function RackStrip() {
  return (
    <div className="lab-rack" aria-label="Drum rack" data-no-pinch>
      {SOUND_VOICES.map((id, index) => (
        <Pad key={id} id={id} index={index} />
      ))}
    </div>
  )
}
