import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { IconAgain, IconCheck } from '../main-screen/icons.tsx'
import { useSession, type ImportedHit } from '../rhythmic-intent/session.tsx'
import { BARS_PER_LOOP, type Tap, type ViewMode } from '../rhythmic-intent/types.ts'
import { useSelector } from '../selector/session.tsx'
import type { CharacterState } from '../selector/character.ts'
import { BPM_MAX, BPM_MIN, useSoundEngine } from '../transport/session.tsx'
import { analysisClip, decodeAudio, MicRecorder, RECORD_MAX_S } from './audio.ts'
import { WorkerExtractor } from './extractor.ts'
import { DRUM_TO_VOICE, type ExtractionResult, type PatternHit } from './types.ts'
import './extract-panel.css'

/** A take has to be long enough to hold a few repeats of one bar. */
const RECORD_MIN_S = 10
/** How long the reading line stays up, even when the analysis is quicker. */
const READ_MIN_MS = 1100

const READ_LINES = ['Listening', 'Finding the bar', 'Placing the hits'] as const

type Phase = 'idle' | 'recording' | 'reading' | 'preview' | 'error'

type Snap = {
  hits: ImportedHit[]
  bpm: number
  phase: number
  density: number
  view: ViewMode
}

const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

function tapsToHits(taps: readonly Tap[], duration: number): ImportedHit[] {
  return taps.map((tap) => ({
    pos: duration > 0 ? tap.time / duration : 0,
    velocity: tap.velocity,
    voice: tap.voice,
    character: tap.character,
  }))
}

/** The one bar, quantized onto the sequencer's own bar and opened on the
    hit the rhythm starts on, then laid once per bar of the loop. */
function toHits(
  result: ExtractionResult,
  character: CharacterState,
  stepsPerBar: number,
): ImportedHit[] {
  const fitted = fitToBar(result, stepsPerBar)
  const hits: ImportedHit[] = []
  for (let bar = 0; bar < BARS_PER_LOOP; bar++) {
    for (const hit of fitted) hits.push(place(hit, stepsPerBar, bar, character))
  }
  return hits
}

const modStep = (n: number, m: number) => ((n % m) + m) % m

/**
 * Fold the analysis onto exactly one bar of `stepsPerBar` sixteenths, then
 * rotate it so the downbeat — the note the rhythm starts on — is step 0.
 * A bar that is a step short or long walks off the beat by the second bar;
 * one that opens on an off-beat kick does the same against the sequencer's
 * own starting point.
 */
function fitToBar(result: ExtractionResult, stepsPerBar: number): PatternHit[] {
  const src = Math.max(1, result.steps)
  const slots = new Map<string, PatternHit>()
  for (const hit of result.pattern) {
    const step = modStep(Math.round((hit.step / src) * stepsPerBar), stepsPerBar)
    const next = { ...hit, step }
    const key = `${hit.drum}:${step}`
    const prev = slots.get(key)
    if (!prev || prev.velocity < hit.velocity) slots.set(key, next)
  }
  const hits = [...slots.values()]
  if (hits.length === 0) return []
  const turn = downbeatOf(hits, stepsPerBar)
  return hits.map((hit) => ({ ...hit, step: modStep(hit.step - turn, stepsPerBar) }))
}

/** How many steps to rotate so the rhythm's start lands on step 0. A kick on
    the one wins; a snare on two and four confirms it; an off-beat kick loses. */
function downbeatOf(hits: readonly PatternHit[], stepsPerBar: number): number {
  let best = 0
  let bestScore = -Infinity
  for (let r = 0; r < stepsPerBar; r++) {
    let score = 0
    for (const hit of hits) {
      const s = modStep(hit.step - r, stepsPerBar)
      const w = 0.5 + hit.velocity
      const beat = Math.floor(s / 4)
      const onBeat = s % 4 === 0
      if (hit.drum === 'kick') {
        if (s === 0) score += 3 * w
        else if (onBeat && beat === 2) score += 1.2 * w
        else if (onBeat) score += 0.5 * w
        else score -= 0.4 * w
      } else if (hit.drum === 'snare') {
        if ((beat === 1 || beat === 3) && onBeat) score += 1.7 * w
        else if (s === 0) score -= 0.5 * w
      } else if (hit.drum === 'cymbal' && s === 0) {
        score += w
      }
    }
    if (score > bestScore + 1e-9) {
      bestScore = score
      best = r
    }
  }
  return best
}

/** The detected tempo, moved by octaves until one bar of it is one bar of
    the tempo already running. A doubled tempo folds two bars into one, and
    the copy laid on the second bar then falls off the beat. */
function tempoForBar(detected: number, current: number): number {
  let bpm = detected
  while (bpm > current * Math.SQRT2 && bpm / 2 >= BPM_MIN) bpm /= 2
  while (bpm * Math.SQRT2 < current && bpm * 2 <= BPM_MAX) bpm *= 2
  return Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)))
}

function place(hit: PatternHit, steps: number, bar: number, character: CharacterState): ImportedHit {
  const voice = DRUM_TO_VOICE[hit.drum]
  let axis = character[voice]
  if (voice === 'hat') axis = hit.open ? Math.max(axis, 0.75) : Math.min(axis, 0.35)
  return {
    pos: (bar + hit.step / steps) / BARS_PER_LOOP,
    velocity: hit.velocity,
    voice,
    character: axis,
  }
}

/**
 * A short block for pulling one bar of drums out of a 10–15 s take. The ring
 * stays where it is: the result is previewed on it, and Keep closes this
 * block with that bar loaded on the current kit.
 */
export function ExtractPanel({
  onClose,
  onKept,
  onLive,
}: {
  onClose: () => void
  onKept: () => void
  onLive: (live: 'idle' | 'recording' | 'reading' | 'preview') => void
}) {
  const { importPattern, setParam, setView, capture, loopDuration, params, view, playing, togglePlay, meter } =
    useSession()
  const { bpm, setBpm } = useSoundEngine()
  const { character } = useSelector()

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [line, setLine] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [tempo, setTempo] = useState<number | null>(null)

  const recorderRef = useRef<MicRecorder | null>(null)
  const extractorRef = useRef<WorkerExtractor | null>(null)
  const undoRef = useRef<Snap | null>(null)
  const playedRef = useRef(false)
  const characterRef = useRef(character)
  characterRef.current = character
  const api = useRef({ importPattern, setBpm, setParam, setView, bpm, loopDuration, params, view, meter })
  api.current = { importPattern, setBpm, setParam, setView, bpm, loopDuration, params, view, meter }

  useEffect(() => {
    onLive(phase === 'error' ? 'idle' : phase)
  }, [phase, onLive])

  // Closing the block without Keep puts the ring back as it was.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel()
      extractorRef.current?.dispose()
      const snap = undoRef.current
      if (!snap) return
      undoRef.current = null
      const now = api.current
      now.importPattern(snap.hits)
      now.setBpm(snap.bpm)
      now.setParam('phase', snap.phase)
      now.setParam('density', snap.density)
      now.setView(snap.view)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'reading') return
    setLine(0)
    const timer = window.setInterval(() => setLine((n) => Math.min(READ_LINES.length - 1, n + 1)), 380)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'preview') {
      playedRef.current = false
      return
    }
    if (playedRef.current || playing) return
    playedRef.current = true
    togglePlay()
  }, [phase, playing, togglePlay])

  useEffect(() => {
    if (phase !== 'recording') return
    const began = performance.now()
    let frame = 0
    const tick = () => {
      setElapsed((performance.now() - began) / 1000)
      setLevel(recorderRef.current?.level() ?? 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase])

  const remember = () => {
    if (undoRef.current) return
    const now = api.current
    undoRef.current = {
      hits: tapsToHits(capture.taps, now.loopDuration),
      bpm: now.bpm,
      phase: now.params.phase,
      density: now.params.density,
      view: now.view,
    }
  }

  const fail = (text: string) => {
    setMessage(text)
    setPhase('error')
  }

  const preview = async (blob: Blob) => {
    setPhase('reading')
    setMessage(null)
    const started = performance.now()
    try {
      const buffer = await decodeAudio(await blob.arrayBuffer())
      if (buffer.duration < RECORD_MIN_S - 0.4) {
        fail('Hold it to 10 seconds')
        return
      }
      const clip = await analysisClip(buffer, 0, Math.min(buffer.duration, RECORD_MAX_S))
      const extractor = extractorRef.current ?? new WorkerExtractor()
      extractorRef.current = extractor
      const result = await extractor.extract(clip, { bars: 1 })
      const wait = Math.max(0, READ_MIN_MS - (performance.now() - started))
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait))
      if (result.pattern.length === 0) {
        fail('No drums in that take')
        return
      }
      remember()
      const now = api.current
      const stepsPerBar = Math.max(1, now.meter.beats * 4)
      const next = tempoForBar(result.bpm, now.bpm)
      const hits = toHits(result, characterRef.current, stepsPerBar)
      // The bar length follows the tempo, and it only updates once React has
      // rendered it. Place the hits after that, or they are measured against
      // the old bar and the second copy lands off the beat.
      now.setBpm(next)
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      })
      api.current.importPattern(hits)
      setTempo(next)
      setPhase('preview')
    } catch {
      fail('Could not read that take')
    }
  }

  const start = async () => {
    if (!MicRecorder.supported()) {
      fail('No microphone')
      return
    }
    if (playing) togglePlay()
    const recorder = new MicRecorder()
    recorderRef.current = recorder
    setElapsed(0)
    setLevel(0)
    setMessage(null)
    try {
      const { take } = await recorder.start()
      setPhase('recording')
      void take.then(
        (blob) => {
          recorderRef.current = null
          void preview(blob)
        },
        () => fail('Could not record'),
      )
    } catch {
      recorderRef.current = null
      fail('No microphone')
    }
  }

  const stop = () => {
    if (elapsed < RECORD_MIN_S) return
    recorderRef.current?.stop()
  }

  const putBack = (snap: Snap) => {
    importPattern(snap.hits)
    setBpm(snap.bpm)
    setParam('phase', snap.phase)
    setParam('density', snap.density)
    setView(snap.view)
  }

  const again = () => {
    const snap = undoRef.current
    undoRef.current = null
    if (snap) putBack(snap)
    setTempo(null)
    setPhase('idle')
  }

  const keep = () => {
    undoRef.current = null
    onKept()
    onClose()
  }

  return (
    <div className="xp">
      {phase === 'idle' && (
        <>
          <p className="xp-title">One bar</p>
          <p className="xp-note">A 10–15 s take</p>
          <button
            type="button"
            className="ms-circle xp-record"
            aria-label="Record"
            onClick={() => void start()}
            onKeyUp={swallowSpace}
            data-hint="Record — 10 to 15 seconds. The drums in it become one bar on the ring"
          >
            <span className="xp-dot" />
          </button>
        </>
      )}

      {phase === 'recording' && (
        <>
          <p className="xp-time num">{elapsed.toFixed(1)}</p>
          <span className="xp-meter" aria-hidden>
            <span style={{ width: `${Math.round(level * 100)}%` }} />
          </span>
          <p className="xp-note">{elapsed < RECORD_MIN_S ? 'Until 10 s' : 'Stop when the bar is there'}</p>
          <button
            type="button"
            className={`ms-circle xp-record${elapsed >= RECORD_MIN_S ? ' ms-circle--on' : ''}`}
            aria-label="Stop recording"
            disabled={elapsed < RECORD_MIN_S}
            onClick={stop}
            onKeyUp={swallowSpace}
            data-hint="Stop — then the bar is pulled onto the ring"
          >
            <span className="xp-dot xp-dot--stop" />
          </button>
        </>
      )}

      {phase === 'reading' && <p className="xp-title">{READ_LINES[line]}</p>}

      {phase === 'preview' && (
        <>
          <p className="xp-title">One bar{tempo !== null ? ` · ${tempo}` : ''}</p>
          <p className="xp-note">On your kit</p>
          <div className="xp-actions">
            <button
              type="button"
              className="ms-circle"
              aria-label="Again"
              onClick={again}
              onKeyUp={swallowSpace}
              data-hint="Again — discard this bar and record another take"
            >
              <IconAgain />
            </button>
            <button
              type="button"
              className="ms-circle ms-circle--on"
              aria-label="Keep"
              onClick={keep}
              onKeyUp={swallowSpace}
              data-hint="Keep — close this. The bar stays on the ring, on your kit"
            >
              <IconCheck />
            </button>
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <p className="xp-title">{message}</p>
          <button
            type="button"
            className="ms-circle xp-record"
            aria-label="Record again"
            onClick={() => setPhase('idle')}
            onKeyUp={swallowSpace}
            data-hint="Record again"
          >
            <span className="xp-dot" />
          </button>
        </>
      )}
    </div>
  )
}
