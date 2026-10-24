import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { BPM_MAX, BPM_MIN, useSoundEngine } from './session.tsx'
import { METER_BEATS_MAX, METER_BEATS_MIN, METER_UNITS, type MeterUnit } from './meter.ts'
import { useSession } from '../rhythmic-intent/session.tsx'
import { IconMetronome, IconPlay, IconStop } from '../main-screen/icons.tsx'
import { isRecord, loadSaved, useSaved } from '../persist.ts'
import './transport.css'

/** Space must stay the tap key everywhere: a focused button here must not
    also be pressed by it. */
const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

const DEFAULT_NAME = 'Project.01'
const NAME_MAX = 32

/** How far a finger travels up or down a value, in the bar's own units, for
    the value to move one step. */
const DRAG_STEP = 8

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function restoreName(): string {
  const saved = loadSaved('project')
  const name = isRecord(saved) ? saved.name : undefined
  return typeof name === 'string' && name.trim() ? name.slice(0, NAME_MAX) : DEFAULT_NAME
}

/**
 * A line of text that turns into a field on a double-click (or Enter): Enter
 * or leaving it commits, Escape puts it back.
 */
function EditField({
  initial,
  label,
  onDone,
  className,
}: {
  initial: string
  label: string
  /** The typed text, or null when the edit was abandoned. */
  onDone: (text: string | null) => void
  className?: string
}) {
  const [draft, setDraft] = useState(initial)
  const done = useRef(false)
  const finish = (text: string | null) => {
    if (done.current) return
    done.current = true
    onDone(text)
  }
  return (
    <input
      className={`tp-input num ${className ?? ''}`}
      autoFocus
      aria-label={label}
      // As wide as what is typed, so the highlight hugs the text.
      // (plus the block's padding, which the width includes).
      style={{ width: `calc(${Math.max(2, draft.length) + 0.5}ch + 12px)` }}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(draft)
        else if (e.key === 'Escape') finish(null)
        else return
        e.preventDefault()
      }}
      onKeyUp={(e) => e.stopPropagation()}
    />
  )
}

/**
 * A value dragged up and down to change — up is more — or double-clicked to
 * type: the tempo, and the beats of the meter.
 */
function DragValue({
  value,
  display,
  onStep,
  onCommit,
  label,
  hint,
  className,
  suffix,
}: {
  value: number
  display: string
  onStep: (delta: number) => void
  onCommit: (text: string) => void
  label: string
  hint: string
  className?: string
  suffix?: string
}) {
  const [editing, setEditing] = useState(false)
  const drag = useRef<{ id: number; y: number; carried: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, y: e.clientY, carried: 0 }
    setDragging(true)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    // Counted in the bar's own units, so the feel is the same however small
    // the device is drawn.
    const el = e.currentTarget
    const scale = el.offsetHeight / (el.getBoundingClientRect().height || 1)
    const travel = (d.y - e.clientY) * scale + d.carried
    const steps = Math.trunc(travel / DRAG_STEP)
    d.y = e.clientY
    d.carried = travel - steps * DRAG_STEP
    if (steps !== 0) onStep(steps)
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    setDragging(false)
  }

  return (
    <div
      className={`tp-cell tp-drag${dragging ? ' tp-drag--on' : ''} ${className ?? ''}`}
      role="spinbutton"
      tabIndex={editing ? -1 : 0}
      aria-label={label}
      aria-valuenow={value}
      onPointerDown={editing ? undefined : onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (editing) return
        if (e.key === 'ArrowUp') onStep(1)
        else if (e.key === 'ArrowDown') onStep(-1)
        else if (e.key === 'Enter') setEditing(true)
        else return
        e.preventDefault()
      }}
      data-hint={hint}
    >
      {editing ? (
        <EditField
          initial={display}
          label={label}
          onDone={(text) => {
            setEditing(false)
            if (text !== null) onCommit(text)
          }}
        />
      ) : (
        <span className="tp-value tp-mark num">{display}</span>
      )}
      {suffix && <span className="tp-suffix">{suffix}</span>}
    </div>
  )
}

/**
 * Transport — the clock, as the bar across the top of the Main Screen,
 * engraved into the glass like the round buttons either side of it, in
 * three groups held apart by space rather than rules:
 *
 *   PROJECT          TRANSPORT          CLOCK
 *   Project.01   |    ●○  |  ▶     |   148 BPM   4/4   /4
 *
 * The project's name (double-click to rename); the metronome and PLAY /
 * STOP, the group in the middle of the bar; then the tempo and the beats of
 * the meter — each dragged up and down, or double-clicked and typed — and
 * the division, the note value that counts as a beat, which a click moves
 * on through /2 /4 /8 /16. Whatever is being changed is lit, and so are
 * the metronome while it is on and PLAY while the loop plays.
 *
 * PLAY restarts the pattern from its top and STOP keeps it, so stopping is
 * never destructive — the + beside this bar is what starts a new one.
 */
export function TransportBar() {
  const { bpm, setBpm, meter, setMeter, metronome, setMetronome } = useSoundEngine()
  const { playing, togglePlay, hasPattern, playhead, beatsPerLoop } = useSession()

  const [name, setName] = useState(restoreName)
  const saved = useMemo(() => ({ name }), [name])
  useSaved('project', saved)
  const [naming, setNaming] = useState(false)

  // The metronome's two dots trade places on every beat. While the loop
  // plays they are read off the playhead, so they swap exactly when the
  // click sounds; stopped (but armed) they keep time on their own.
  const beat = playing && playhead !== null ? Math.floor(playhead * beatsPerLoop) : null
  const lit: 0 | 1 = metronome && beat !== null ? ((beat % 2) as 0 | 1) : 0
  const freeRunning = metronome && beat === null
  const beatSeconds = (60 / bpm) * (4 / meter.unit)

  const commitBpm = (text: string) => {
    const next = Number.parseInt(text, 10)
    if (!Number.isNaN(next)) setBpm(clamp(next, BPM_MIN, BPM_MAX))
  }
  const stepBeats = (delta: number) =>
    setMeter((m) => ({ ...m, beats: clamp(m.beats + delta, METER_BEATS_MIN, METER_BEATS_MAX) }))
  /** "7" sets the beats; "7/8" sets the division too, when it is one of ours. */
  const commitMeter = (text: string) => {
    const match = /^\s*(\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(text)
    if (!match) return
    const beats = clamp(Number.parseInt(match[1], 10), METER_BEATS_MIN, METER_BEATS_MAX)
    const unit = match[2] ? (Number.parseInt(match[2], 10) as MeterUnit) : null
    setMeter((m) => ({ beats, unit: unit && METER_UNITS.includes(unit) ? unit : m.unit }))
  }
  const nextUnit = () =>
    setMeter((m) => ({
      ...m,
      unit: METER_UNITS[(METER_UNITS.indexOf(m.unit) + 1) % METER_UNITS.length],
    }))

  return (
    <div className="tp-bar" role="toolbar" aria-label="Transport">
      <div className="tp-group tp-group--project" role="group" aria-label="Project">
        <div
          className="tp-cell tp-cell--name"
          title={naming ? undefined : name}
          onDoubleClick={() => setNaming(true)}
          data-hint="The project — double-click to rename it"
        >
          {naming ? (
            <EditField
              initial={name}
              label="Project name"
              onDone={(text) => {
                setNaming(false)
                const next = text?.trim().slice(0, NAME_MAX)
                if (next) setName(next)
              }}
            />
          ) : (
            <span className="tp-name tp-mark">{name}</span>
          )}
        </div>
      </div>

      <span className="tp-sep" aria-hidden />

      <div className="tp-group tp-group--transport" role="group" aria-label="Transport">
        <button
          type="button"
          className={`tp-btn tp-metronome${metronome ? ' tp-btn--on' : ''}${
            freeRunning ? ' tp-metronome--free' : ''
          }`}
          style={{ '--beat': `${beatSeconds}s` } as CSSProperties}
          aria-label="Metronome"
          aria-pressed={metronome}
          onClick={() => setMetronome(!metronome)}
          onKeyUp={swallowSpace}
          data-hint={
            metronome
              ? 'Metronome on — a click on every beat while the loop plays'
              : 'Metronome — a click on every beat while the loop plays'
          }
        >
          <span className="tp-mark tp-mark--icon">
            <IconMetronome lit={lit} size={30} />
          </span>
        </button>
        <span className="tp-sep" aria-hidden />
        <button
          type="button"
          className={`tp-btn tp-play${playing ? ' tp-btn--on' : ''}`}
          aria-label={playing ? 'Stop' : 'Play'}
          aria-pressed={playing}
          disabled={!hasPattern}
          onClick={togglePlay}
          onKeyUp={swallowSpace}
          data-hint={
            playing ? 'Stop — the pattern stays. Key: Enter' : 'Play the loop from the top. Key: Enter'
          }
        >
          <span className="tp-mark tp-mark--icon">
            {playing ? <IconStop size={22} /> : <IconPlay size={26} />}
          </span>
        </button>
      </div>

      <span className="tp-sep" aria-hidden />

      <div className="tp-group tp-group--clock" role="group" aria-label="Clock">
        <DragValue
          value={bpm}
          display={String(bpm)}
          suffix="BPM"
          onStep={(d) => setBpm(clamp(bpm + d, BPM_MIN, BPM_MAX))}
          onCommit={commitBpm}
          label="Tempo in BPM"
          hint="Tempo — drag up or down, or double-click to type it"
          className="tp-bpm"
        />
        <DragValue
          value={meter.beats}
          display={`${meter.beats}/${meter.unit}`}
          onStep={stepBeats}
          onCommit={commitMeter}
          label="Time signature"
          hint="Time signature — drag up or down for more or fewer beats, or double-click to type it"
          className="tp-meter"
        />
        <button
          type="button"
          className="tp-btn tp-division num"
          aria-label={`Division /${meter.unit}`}
          onClick={nextUnit}
          onKeyUp={swallowSpace}
          data-hint={`Division /${meter.unit} — a 1/${meter.unit} note counts as one beat. Click for the next`}
        >
          <span className="tp-mark">/{meter.unit}</span>
        </button>
      </div>
    </div>
  )
}
