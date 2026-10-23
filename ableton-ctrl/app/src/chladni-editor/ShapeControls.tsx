import type React from 'react'
import { SHAPE_GROUPS, inactiveControls, type ShapeControl } from './shape.ts'
import { useShapeEditor } from './session.tsx'
import { ShapeSlider } from './ShapeSlider.tsx'
import '../sound-intent/sound-intent.css'
import './chladni-editor.css'

/** Space is the global tap key: a focused button must not also press. */
const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

export function Steps({
  control,
  value,
  onChange,
  off,
}: {
  control: ShapeControl
  value: number
  onChange: (value: number) => void
  off?: string
}) {
  return (
    <div
      className={`ce-steps${off ? ' ce-off' : ''}`}
      role="group"
      aria-label={control.label}
      title={off}
    >
      <span className="si-slider-label">{control.label}</span>
      <span className="ce-steps-options">
        {control.steps?.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`ce-step${i === value ? ' ce-step--on' : ''}`}
            aria-pressed={i === value}
            onClick={() => onChange(i)}
            onKeyUp={swallowSpace}
          >
            {label}
          </button>
        ))}
      </span>
    </div>
  )
}

/**
 * Every control of the figure, grouped by what it does — the renderer laid
 * open. A control that does nothing to the figure as it stands is greyed.
 * RANDOM throws the body and its modes somewhere new to search from;
 * RESET goes back to a plain (2,1) membrane.
 */
export function ShapeControls() {
  const { shape, setControl, resetShape, randomize } = useShapeEditor()
  const off = inactiveControls(shape)
  return (
    <div className="ce-controls" data-no-pinch>
      <div className="ce-controls-head">
        <button type="button" className="ce-button" onClick={randomize} onKeyUp={swallowSpace}>
          RANDOM
        </button>
        <button type="button" className="ce-button" onClick={resetShape} onKeyUp={swallowSpace}>
          RESET
        </button>
      </div>
      <div className="ce-groups">
        {SHAPE_GROUPS.map((group) => (
          <section key={group.title} className="ce-group">
            <h3 className="ce-group-title">{group.title}</h3>
            {group.note && <p className="ce-group-note">{group.note}</p>}
            <div className="ce-group-controls">
              {group.controls.map((control) =>
                control.steps ? (
                  <Steps
                    key={control.id}
                    control={control}
                    value={shape[control.id]}
                    onChange={(v) => setControl(control.id, v)}
                    off={off.get(control.id)}
                  />
                ) : (
                  <ShapeSlider
                    key={control.id}
                    control={control}
                    value={shape[control.id]}
                    onChange={(v) => setControl(control.id, v)}
                    off={off.get(control.id)}
                  />
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
