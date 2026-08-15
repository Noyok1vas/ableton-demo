import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { MAX_PHRASE_BARS, previewBars } from './grammar.ts'
import { useMarch } from './session.tsx'
import { useHeldSeconds, useMarchPlayhead } from './useMarchClocks.ts'
import './march.css'

const DESCRIPTION =
  'March is the rhythm behind the rhythm. You say when it starts and how long it lasts; it writes itself from there — an opening, however much running it needs, and an ending. It then keeps going, in step with whatever else is playing, until you ask for another one.'

/**
 * March Intent — the audience window.
 *
 * One button, one gesture: press, hold, release. Nothing here names a bar, a
 * step, a pattern or a group, because the thing being tested is whether an
 * intended *duration* is enough of an instruction on its own. Everything the
 * system decided is visible in the March Family window instead.
 */
export function MarchIntentScreen() {
  const { holding, beginGesture, endGesture, cancelGesture, barDuration, loop, stop } = useMarch()
  const held = useHeldSeconds()
  const playhead = useMarchPlayhead()

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    // Capture, so a release that wanders off the button still ends the gesture
    // where it happened rather than leaving it stuck down. Not every pointer
    // can be captured (a synthetic event, a pointer already gone), and failing
    // to capture is no reason to refuse the gesture.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* uncaptured — the button's own pointerup still ends it */
    }
    beginGesture()
  }

  // Enter holds and releases like the pointer does. Space is the app's global
  // tap key, so it is refused here rather than quietly doing two things.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ') e.preventDefault()
    if (e.key !== 'Enter' || e.repeat) return
    e.preventDefault()
    beginGesture()
  }

  const onKeyUp = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ') e.preventDefault()
    if (e.key !== 'Enter') return
    e.preventDefault()
    endGesture()
  }

  // A phrase that has been asked for but has not reached its downbeat yet is
  // waiting on the loop already playing — worth saying, since the gesture is
  // over and nothing is audible yet.
  const state = holding ? 'HOLDING' : loop ? (playhead ? 'MARCHING' : 'QUEUED') : 'READY'

  return (
    <div className="mi-screen">
      <header className="mi-header">
        <span className="mi-state">{state}</span>
        {loop && (
          <button
            type="button"
            className="mi-end"
            onClick={stop}
            onKeyUp={(e) => {
              if (e.key === ' ') e.preventDefault()
            }}
          >
            END
          </button>
        )}
      </header>

      <section className="mi-stage">
        <button
          type="button"
          className={`mi-button${holding ? ' mi-button--held' : ''}`}
          aria-pressed={holding}
          onPointerDown={onPointerDown}
          onPointerUp={endGesture}
          onPointerCancel={cancelGesture}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={cancelGesture}
        >
          MARCH
        </button>

        <GestureMeter
          holding={holding}
          held={held}
          barDuration={barDuration}
          runBars={loop?.bars ?? null}
          progress={playhead?.progress ?? null}
        />
      </section>

      <footer className="mi-description">{DESCRIPTION}</footer>
    </div>
  )
}

const METER_W = 1000
const METER_H = 64

type GestureMeterProps = {
  holding: boolean
  /** Seconds held so far — 0 unless `holding`. */
  held: number
  barDuration: number
  /** Length of what is looping, in the meter's own units, or null. */
  runBars: number | null
  /** 0..1 through the looping phrase, or null. */
  progress: number | null
}

/**
 * The growing gesture, and then the phrase it became, going round.
 *
 * The full width is the longest March the grammar can spell, so a hold is felt
 * against a real ceiling rather than an arbitrary one. The divisions are drawn
 * but never labelled: they make the snapping legible without teaching anyone to
 * count bars.
 */
function GestureMeter({ holding, held, barDuration, runBars, progress }: GestureMeterProps) {
  const span = MAX_PHRASE_BARS * barDuration
  const unit = METER_W / MAX_PHRASE_BARS

  const raw = Math.min(1, held / span)
  const snapped = previewBars(held, barDuration) / MAX_PHRASE_BARS
  const looping = !holding && runBars !== null

  return (
    <svg className="mi-meter" viewBox={`0 0 ${METER_W} ${METER_H}`} aria-hidden>
      <rect className="mi-meter-track" x={0} y={0} width={METER_W} height={METER_H} />

      {Array.from({ length: MAX_PHRASE_BARS - 1 }, (_, i) => (
        <line
          key={i}
          className="mi-meter-tick"
          x1={(i + 1) * unit}
          y1={0}
          x2={(i + 1) * unit}
          y2={METER_H}
        />
      ))}

      {holding && (
        <>
          {/* Where the gesture would land if released now… */}
          <rect className="mi-meter-snap" x={0} y={0} width={snapped * METER_W} height={METER_H} />
          {/* …over exactly how long it has been held, un-rounded. */}
          <rect
            className="mi-meter-raw"
            x={0}
            y={METER_H / 2 - 5}
            width={raw * METER_W}
            height={10}
          />
        </>
      )}

      {looping && (
        <>
          {/* The phrase's length, held as an outline while it repeats inside it. */}
          <rect className="mi-meter-run" x={0} y={0} width={runBars * unit} height={METER_H} />
          {progress !== null && (
            <rect
              className="mi-meter-play"
              x={0}
              y={0}
              width={progress * runBars * unit}
              height={METER_H}
            />
          )}
        </>
      )}

      {!holding && !looping && (
        <text className="mi-meter-hint" x={METER_W / 2} y={METER_H / 2} textAnchor="middle">
          PRESS AND HOLD
        </text>
      )}
    </svg>
  )
}
