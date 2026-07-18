import { useCallback, useEffect, useMemo, useState } from 'react'
import { Knob } from './Knob.tsx'
import { RhythmVisualization } from './RhythmVisualization.tsx'
import { TapButton } from './TapButton.tsx'
import { transformPattern } from './transform.ts'
import { useTapCapture } from './useTapCapture.ts'
import { BAR_DURATION, DEFAULT_PARAMS, type TransformParams } from './types.ts'
import { useBridge } from '../transport/useBridge.ts'
import type { LinkState } from '../transport/bridge.ts'
import './rhythmic-intent.css'

const PROJECT_DESCRIPTION =
  'Rhythmic Intent captures a one-bar rhythm tapped by the audience and translates it into an editable MIDI pattern. The performer can adjust its tightness, phase, and density while preserving the recognizable character of the original gesture.'

/** Turn the bridge link state into the status-bar label + a connected flag. */
function linkStatus(state: LinkState): { label: string; connected: boolean } {
  switch (state.link) {
    case 'connected':
      return { label: state.instrument ?? 'No instrument selected', connected: true }
    case 'live-offline':
      return {
        label:
          state.reason === 'live_down'
            ? 'Live not running'
            : state.reason === 'not_installed'
              ? 'AbletonOSC not installed'
              : 'Live not responding',
        connected: false,
      }
    default:
      return { label: 'Bridge offline', connected: false }
  }
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

export function RhythmicIntentScreen() {
  const capture = useTapCapture(BAR_DURATION)
  const bridge = useBridge()
  const [params, setParams] = useState<TransformParams>(DEFAULT_PARAMS)

  const link = linkStatus(bridge.state)

  // Every tap both records into the GUI and fires a live MIDI note through the
  // bridge to the selected Live instrument.
  const { tap } = capture
  const { sendTap } = bridge
  const handleTap = useCallback(() => {
    tap()
    sendTap(1)
  }, [tap, sendTap])

  const setParam = <K extends keyof TransformParams>(key: K, value: number) =>
    setParams((prev) => ({ ...prev, [key]: value }))

  const rendered = useMemo(
    () => transformPattern(capture.taps, BAR_DURATION, params),
    [capture.taps, params],
  )

  const hasPattern = capture.taps.length > 0

  const handleReset = () => {
    capture.reset()
    setParams(DEFAULT_PARAMS)
  }

  // Global Space → tap, unless focus is in a text input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (isTextInput(document.activeElement)) return
      e.preventDefault()
      handleTap()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleTap])

  const statusLabel =
    capture.state === 'ready'
      ? 'Ready'
      : capture.state === 'recording'
        ? 'Recording'
        : 'Captured'

  return (
    <div className="ri-screen">
      <header className="ri-header">
        <div className="ri-statusbar">
          <span
            className={`ri-dot${link.connected ? ' ri-dot--on' : ''}`}
            aria-hidden
          />
          <span className="ri-status" title={link.connected ? 'Selected instrument' : undefined}>
            {link.label}
          </span>
          <span className="ri-substatus">{statusLabel}</span>
        </div>
        <button
          type="button"
          className="ri-reset"
          onClick={handleReset}
          // Space is reserved for tapping (even when this button holds focus);
          // native Space activation fires on keyup, so block it there. Enter
          // still activates Reset.
          onKeyUp={(e) => {
            if (e.key === ' ') e.preventDefault()
          }}
        >
          RESET
        </button>
      </header>

      <section className="ri-vis" aria-label="One-bar tap visualization">
        <RhythmVisualization
          taps={rendered}
          state={capture.state}
          progress={capture.progress}
        />
      </section>

      <section className="ri-controls">
        <TapButton onTap={handleTap} recording={capture.state === 'recording'} />
        <div className="ri-knobs">
          <Knob
            label="TIGHTNESS"
            value={params.tightness}
            min={0}
            max={100}
            step={1}
            formatValue={(v) => `${v}%`}
            onChange={(v) => setParam('tightness', v)}
            idle={!hasPattern}
          />
          <Knob
            label="PHASE"
            value={params.phase}
            min={0}
            max={15}
            step={1}
            formatValue={(v) => (v === 0 ? '0' : `+${v}`)}
            onChange={(v) => setParam('phase', v)}
            idle={!hasPattern}
          />
          <Knob
            label="DENSITY"
            value={params.density}
            min={0}
            max={100}
            step={1}
            formatValue={(v) => `${v}%`}
            onChange={(v) => setParam('density', v)}
            idle={!hasPattern}
          />
        </div>
      </section>

      <footer className="ri-description">{PROJECT_DESCRIPTION}</footer>
    </div>
  )
}
