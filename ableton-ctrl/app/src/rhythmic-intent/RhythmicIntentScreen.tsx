import { Knob } from './Knob.tsx'
import { PitchPad } from './PitchPad.tsx'
import { RhythmVisualization } from './RhythmVisualization.tsx'
import { useSession } from './session.tsx'
import './rhythmic-intent.css'

const PROJECT_DESCRIPTION =
  'Rhythmic Intent captures a one-bar rhythm tapped by the audience and translates it into an editable MIDI pattern. The performer can adjust its tightness, phase, and density while preserving the recognizable character of the original gesture.'

export function RhythmicIntentScreen() {
  const {
    capture,
    params,
    setParam,
    rendered,
    hasPattern,
    status,
    pitch,
    setPitch,
    handleReset,
    playing,
    playPos,
    togglePlay,
  } = useSession()

  const statusLabel = playing
    ? 'Playing'
    : capture.state === 'ready'
      ? 'Ready'
      : capture.state === 'recording'
        ? 'Recording'
        : 'Captured'

  const playhead = playing ? playPos : capture.state === 'recording' ? capture.progress : null

  return (
    <div className="ri-screen">
      <header className="ri-header">
        <div className="ri-statusbar">
          <span className={`ri-dot${status.ready ? ' ri-dot--on' : ''}`} aria-hidden />
          <span className="ri-status" title={status.labelTitle ?? undefined}>
            {status.label}
          </span>
          <span className="ri-substatus">{statusLabel}</span>
          {status.tags.map((tag) => (
            <span key={tag.label} className="ri-pad" title={tag.title}>
              {tag.label}
            </span>
          ))}
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
        <RhythmVisualization taps={rendered} state={capture.state} playhead={playhead} />
      </section>

      <section className="ri-controls">
        <button
          type="button"
          className={[
            'play-button',
            playing ? 'play-button--active' : '',
            !hasPattern ? 'play-button--idle' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-pressed={playing}
          onClick={togglePlay}
          onKeyUp={(e) => {
            if (e.key === ' ') e.preventDefault()
          }}
        >
          {playing ? 'PAUSE' : 'PLAY'}
        </button>
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
          <PitchPad value={pitch} onChange={setPitch} />
        </div>
      </section>

      <footer className="ri-description">{PROJECT_DESCRIPTION}</footer>
    </div>
  )
}
