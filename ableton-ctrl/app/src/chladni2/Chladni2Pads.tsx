import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { FigurePreview } from './FigurePreview.tsx'
import { BODY_OF } from './glyphs.ts'
import { DRUM_PARAMS, type DrumParamDef } from './params.ts'
import { useDrum, useDrumPage } from './session.tsx'
import { PATTERNS, type PatternId } from '../selector/patterns.ts'
import { useSelector } from '../selector/session.tsx'
import { useTap } from '../tap/session.tsx'
import { useSoundEngine } from '../transport/session.tsx'
import type { SoundVoiceId } from '../transport/engine.ts'
import { Slider } from '../sound-intent/Slider.tsx'
import '../sound-intent/sound-intent.css'
import './chladni2.css'

const FLASH_MS = 90

/** Space is the global tap key: a focused button must not also press. */
const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** A slider's label: its name, then the channels it drives. */
const labelOf = (def: DrumParamDef) =>
  def.channels.length > 0 ? `${def.label} · ${def.channels.join('+')}` : `${def.label} · FM`

function Steps({
  def,
  value,
  onChange,
}: {
  def: DrumParamDef
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="c2-steps" role="group" aria-label={def.label}>
      <span className="si-slider-label">{labelOf(def)}</span>
      <span className="c2-steps-options">
        {def.steps?.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`c2-step${i === value ? ' c2-step--on' : ''}`}
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
 * Chladni 2's pads: the eight sounds, each with the knobs a 909 or a Drum
 * Synth gives it, and its figure redrawn live as they move. A press plays the
 * sound into the loop — with every knob copied onto the tap — and the ring
 * draws it there as it was.
 */
export function Chladni2Pads() {
  useDrumPage()
  const { params, setParam, resetSound, fill, setFill } = useDrum()
  const { gesture, setGesture, velocity, setVelocity, currentVelocity } = useSelector()
  const { fireTap } = useTap()
  const { status, source } = useSoundEngine()
  const [flashing, setFlashing] = useState<PatternId | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vel = currentVelocity()

  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    },
    [],
  )

  const play = (id: SoundVoiceId) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setGesture(id)
    // `id` explicitly: the selection has not re-rendered yet.
    fireTap(id)
    setFlashing(id)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashing(null), FLASH_MS)
  }

  return (
    <div className="c2-pads" data-no-pinch>
      <div className="c2-controls">
        <div className="c2-velocity">
          <Slider
            label="VELOCITY · 10"
            value={velocity}
            min={1}
            max={100}
            onChange={setVelocity}
          />
        </div>
        <div className="c2-steps" role="group" aria-label="Body fill">
          <span className="si-slider-label">|ψ|² FILL</span>
          <span className="c2-steps-options">
            {(['OFF', 'ON'] as const).map((label) => {
              const on = (label === 'ON') === fill
              return (
                <button
                  key={label}
                  type="button"
                  className={`c2-step${on ? ' c2-step--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setFill(label === 'ON')}
                  onKeyUp={swallowSpace}
                >
                  {label}
                </button>
              )
            })}
          </span>
        </div>
      </div>

      {source === 'builtin' && !status.ready && (
        <p className="c2-unlock" role="status">
          Tap any pad once to start sound
        </p>
      )}

      <div className="c2-grid">
        {PATTERNS.map((pattern) => {
          const id = pattern.id
          const knobs = params[id]
          return (
            <div key={id} className="c2-cell">
              <button
                type="button"
                className={[
                  'c2-pad',
                  gesture === id ? 'c2-pad--selected' : '',
                  flashing === id ? 'c2-pad--flash' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`Play ${pattern.label}`}
                aria-pressed={gesture === id}
                onPointerDown={play(id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
                }}
                data-hint={`${pattern.label.toUpperCase()} — tap to play it into the loop with these knobs`}
              >
                <FigurePreview id={id} params={knobs} velocity={vel} fill={fill} />
                <span className="c2-tag">{BODY_OF[id].toUpperCase()}</span>
              </button>
              <div className="c2-head">
                <span className="c2-name">{pattern.label.toUpperCase()}</span>
                <button
                  type="button"
                  className="c2-reset"
                  onClick={() => resetSound(id)}
                  onKeyUp={swallowSpace}
                  data-hint="Back to the 909's classic setting"
                >
                  909
                </button>
              </div>
              <div className="c2-knobs">
                {DRUM_PARAMS[id].map((def) =>
                  def.steps ? (
                    <Steps
                      key={def.id}
                      def={def}
                      value={knobs[def.id]}
                      onChange={(v) => setParam(id, def.id, v)}
                    />
                  ) : (
                    <Slider
                      key={def.id}
                      label={labelOf(def)}
                      value={Math.round(knobs[def.id] * 100)}
                      min={0}
                      max={100}
                      onChange={(v) => setParam(id, def.id, v / 100)}
                    />
                  ),
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
