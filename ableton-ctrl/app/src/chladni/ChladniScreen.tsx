import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { ModalPreview } from './ModalPreview.tsx'
import { DEFAULT_MODAL_OPTIONS, MODAL_GLYPHS, type ModalOptions } from './glyphs.ts'
import { SoundPreview } from '../selector/SoundPreview.tsx'
import { PATTERNS, type PatternId } from '../selector/patterns.ts'
import { CHARACTER } from '../selector/character.ts'
import { useSelector } from '../selector/session.tsx'
import { useSoundEngine } from '../transport/session.tsx'
import { Slider } from '../sound-intent/Slider.tsx'
import '../sound-intent/sound-intent.css'
import './chladni.css'

type ViewMode = 'both' | 'hand' | 'modal'

const FLASH_MS = 90

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="ch-seg" role="group" aria-label={label}>
      <span className="ch-seg-label">{label}</span>
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          className={`ch-seg-option${o.id === value ? ' ch-seg-option--on' : ''}`}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          // Space is the global tap key.
          onKeyUp={(e) => {
            if (e.key === ' ') e.preventDefault()
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The Chladni page — the eight marks made from membrane modes, beside the
 * hand-drawn ones, for checking whether they read. Both versions follow the
 * same character `c` (the Selector's own, so this page and the pads agree)
 * and the same velocity.
 *
 * A press plays the sound and nothing else: these marks are not in the
 * sequencer, so nothing here records.
 */
export function ChladniScreen() {
  const { character, setCharacter, velocity, setVelocity, currentVelocity } = useSelector()
  const { noteOn, status, source } = useSoundEngine()
  const [view, setView] = useState<ViewMode>('both')
  const [options, setOptions] = useState<ModalOptions>(DEFAULT_MODAL_OPTIONS)
  const [flashing, setFlashing] = useState<PatternId | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vel = currentVelocity()

  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    },
    [],
  )

  const play = (id: PatternId) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    noteOn(vel, id, CHARACTER[id] ? character[id] : undefined)
    setFlashing(id)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashing(null), FLASH_MS)
  }

  const setOption = <K extends keyof ModalOptions>(key: K) => (value: ModalOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="ch-screen" data-no-pinch>
      <div className="ch-controls">
        <Segmented
          label="VIEW"
          value={view}
          onChange={setView}
          options={[
            { id: 'both', label: 'BOTH' },
            { id: 'hand', label: 'HAND' },
            { id: 'modal', label: 'MODAL' },
          ]}
        />
        <Segmented
          label="TOM M MAX"
          value={options.tomMax}
          onChange={setOption('tomMax')}
          options={[
            { id: 3, label: '3' },
            { id: 5, label: '5' },
          ]}
        />
        <Segmented
          label="KICK HALO"
          value={options.kickHalo ? 'on' : 'off'}
          onChange={(v) => setOption('kickHalo')(v === 'on')}
          options={[
            { id: 'off', label: 'OFF' },
            { id: 'on', label: 'ON' },
          ]}
        />
        <Segmented
          label="FX"
          value={options.fxVariant}
          onChange={setOption('fxVariant')}
          options={[
            { id: 'modal', label: 'MODAL' },
            { id: 'separable', label: 'SEPARABLE' },
          ]}
        />
        <div className="ch-velocity">
          <Slider label="VELOCITY" value={velocity} min={1} max={100} onChange={setVelocity} />
        </div>
      </div>

      {source === 'builtin' && !status.ready && (
        <p className="ch-unlock" role="status">
          Tap any mark once to start sound
        </p>
      )}

      <div className="ch-grid">
        {PATTERNS.map((pattern, i) => {
          const axis = CHARACTER[pattern.id]
          const c = character[pattern.id]
          return (
            <div key={pattern.id} className="ch-cell">
              <button
                type="button"
                className={`ch-pad${flashing === pattern.id ? ' ch-pad--flash' : ''}`}
                aria-label={`Play ${pattern.label}`}
                onPointerDown={play(pattern.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
                }}
              >
                {view !== 'modal' && (
                  <span className="ch-glyph">
                    <SoundPreview pattern={pattern} character={c} velocity={vel} />
                    {view === 'both' && <span className="ch-tag">HAND</span>}
                  </span>
                )}
                {view !== 'hand' && (
                  <span className="ch-glyph">
                    <ModalPreview
                      glyph={MODAL_GLYPHS[i]}
                      character={c}
                      velocity={vel}
                      options={options}
                    />
                    {view === 'both' && <span className="ch-tag">MODAL</span>}
                  </span>
                )}
              </button>
              {axis ? (
                <Slider
                  label={`${pattern.label.toUpperCase()}  ${axis.ends[0]} → ${axis.ends[1]}`}
                  value={Math.round(c * 100)}
                  min={0}
                  max={100}
                  onChange={(v) => setCharacter(pattern.id, v / 100)}
                />
              ) : (
                <div className="ch-fixed">
                  <span className="si-slider-label">{pattern.label.toUpperCase()}</span>
                  <span className="si-slider-value">FIXED</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
