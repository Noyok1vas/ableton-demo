import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useExtract, type MixPreset } from './session.tsx'
import { SketchButton, SketchFader, SketchFrame, swallowSpace } from './SketchParts.tsx'
import { StepLanes } from './StepLanes.tsx'
import { Waveform } from './Waveform.tsx'
import { blot, loop, seedOf } from './sketch.ts'
import { RECORD_MAX_S } from './audio.ts'
import { DRUM_LABEL, DRUM_TYPES } from './types.ts'
import { useSession } from '../rhythmic-intent/session.tsx'
import { useSoundEngine, BPM_MAX, BPM_MIN } from '../transport/session.tsx'
import './extract.css'

type Mode = 'upload' | 'record'

const MIXES: { id: MixPreset; label: string; hint: string }[] = [
  { id: 'song', label: 'SONG', hint: 'Song — the original clearly, your kit quietly under it' },
  { id: 'both', label: 'BOTH', hint: 'Both — your kit on top of the original' },
  { id: 'kit', label: 'KIT ONLY', hint: 'Kit only — the original muted, just the extracted pattern' },
]

const fmt = (s: number) => `${s.toFixed(1)} s`

/**
 * Rhythm Extract — take a few seconds of music, find the drum pattern in it,
 * and put that pattern on the ring to be played with this kit and edited.
 *
 *   source    a file (then pick 5–15 s of it) or up to 15 s from the mic
 *   EXTRACT   separate the drums, find the beat, name the hits, fold them
 *             into the two-bar loop — and hand the result to the ring
 *   lanes     the same pattern unrolled, one lane per drum, editable
 *   mix       the original under the loop, on the same grid, with a fader
 *             each for it and for the kit
 *   data      the result as JSON: BPM, drum, step, beat position, confidence
 */
export function ExtractScreen() {
  const x = useExtract()
  const { playing, playhead, togglePlay, hasPattern } = useSession()
  const { trackLevel, setTrackLevel, source: engineSource } = useSoundEngine()
  const [mode, setMode] = useState<Mode>('upload')
  const [showData, setShowData] = useState(false)
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const busy = x.phase === 'loading' || x.phase === 'analyzing' || x.phase === 'recording'
  const selLength = x.selection.end - x.selection.start

  // ── Where the sound is in the source ──────────────────────────────
  // The preview runs from the selection's start; the loop's backing clip from
  // the downbeat it was cut at, one pass of the loop after another.
  const [cursor, setCursor] = useState<number | null>(null)
  const previewStart = useRef(0)
  useEffect(() => {
    if (!x.previewing) return
    previewStart.current = performance.now()
    let raf = 0
    const from = x.selection.start
    const tick = () => {
      setCursor(from + (performance.now() - previewStart.current) / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setCursor(null)
    }
    // Only a new preview restarts the cursor.
  }, [x.previewing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Passes of the loop since PLAY, counted off the playhead wrapping round.
  const [passes, setPasses] = useState(0)
  const lastHead = useRef<number | null>(null)
  useEffect(() => {
    lastHead.current = null
    setPasses(0)
  }, [playing])
  useEffect(() => {
    if (playhead === null) return
    if (lastHead.current !== null && playhead < lastHead.current - 0.5) setPasses((p) => p + 1)
    lastHead.current = playhead
  }, [playhead])
  let loopCursor: number | null = null
  if (playing && playhead !== null && x.extracted && x.result) {
    const { selection, loops, loopSeconds } = x.extracted
    loopCursor = selection.start + x.result.downbeat + ((passes % loops) + playhead) * loopSeconds
  }

  const pickFile = (files: FileList | null) => {
    const file = files?.[0]
    if (file) x.loadFile(file)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    pickFile(e.dataTransfer.files)
  }

  const copy = () => {
    const json = x.exportJson()
    if (!json) return
    void navigator.clipboard?.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  const status = (() => {
    switch (x.phase) {
      case 'empty':
        return 'Upload a song, or record up to 15 seconds of one playing in the room.'
      case 'loading':
        return 'Reading the audio…'
      case 'recording':
        return `Recording — ${fmt(x.recording?.elapsed ?? 0)} of ${RECORD_MAX_S} s`
      case 'ready':
        return `${fmt(selLength)} selected — drag the brackets to choose the part with the clearest drums.`
      case 'analyzing':
        return 'Separating the drums, finding the beat, naming the hits…'
      case 'done':
        return x.result
          ? `${x.result.pattern.length} steps on the ring · voted over ${x.result.loopsAnalysed} loops · ${x.result.elapsedMs} ms`
          : ''
      case 'error':
        return x.message ?? 'Something went wrong.'
    }
  })()

  const counts = x.result
    ? DRUM_TYPES.map((d) => ({ d, n: x.result!.pattern.filter((h) => h.drum === d).length }))
    : []

  return (
    <div className="xp-screen">
      {/* ── 1. Source ───────────────────────────────────── */}
      <section className="xp-section">
        <header className="xp-head">
          <span className="xp-num">1</span>
          <h3>Source</h3>
          <div className="xp-tabs" role="group" aria-label="Source">
            <SketchButton
              ink="tab-upload"
              on={mode === 'upload'}
              onClick={() => setMode('upload')}
              disabled={x.phase === 'recording'}
              data-hint="Upload — a song file; then choose 5–15 seconds of it"
            >
              UPLOAD
            </SketchButton>
            <SketchButton
              ink="tab-record"
              on={mode === 'record'}
              onClick={() => setMode('record')}
              disabled={!x.micSupported || x.phase === 'recording'}
              data-hint="Record — up to 15 seconds from the microphone"
            >
              RECORD
            </SketchButton>
          </div>
        </header>

        {mode === 'upload' ? (
          <div
            className={`xp-drop${dragOver ? ' xp-drop--over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <SketchFrame ink="drop" dashed />
            <span className="xp-drop-text">
              {x.source?.kind === 'file' ? x.source.name : 'Drop a song here'}
            </span>
            <SketchButton
              ink="choose"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              data-hint="Choose an audio file — MP3, WAV, M4A, OGG…"
            >
              CHOOSE FILE
            </SketchButton>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.aif,.aiff"
              hidden
              onChange={(e) => {
                pickFile(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        ) : (
          <div className="xp-rec">
            <RecordButton
              recording={x.phase === 'recording'}
              elapsed={x.recording?.elapsed ?? 0}
              disabled={x.phase === 'loading' || x.phase === 'analyzing'}
              onPress={() => (x.phase === 'recording' ? x.stopRecording() : x.startRecording())}
            />
            <p className="xp-rec-text">
              {x.phase === 'recording'
                ? 'Press again to stop. It stops by itself at 15 s.'
                : 'Play the music near the microphone and press record. Loop playback stops while recording.'}
            </p>
          </div>
        )}
      </section>

      {/* ── 2. Selection ────────────────────────────────── */}
      <section className="xp-section">
        <header className="xp-head">
          <span className="xp-num">2</span>
          <h3>Selection</h3>
          <span className="xp-meta num">
            {x.source ? `${fmt(x.selection.start)} – ${fmt(x.selection.end)} · ${fmt(selLength)}` : '—'}
          </span>
          <SketchButton
            ink="preview"
            on={x.previewing}
            onClick={x.togglePreview}
            disabled={!x.source || busy}
            data-hint="Preview — hear the selected part on its own"
          >
            {x.previewing ? 'STOP' : 'PREVIEW'}
          </SketchButton>
        </header>
        <Waveform
          source={x.source}
          selection={x.selection}
          onSelect={x.setSelection}
          recording={x.recording}
          cursor={x.previewing ? cursor : loopCursor}
          extracted={x.extracted && x.phase === 'done' ? x.extracted.selection : null}
        />
      </section>

      {/* ── 3. Extract ──────────────────────────────────── */}
      <section className="xp-section">
        <div className="xp-extract-row">
          <SketchButton
            ink="extract"
            className="xp-btn--big"
            on={x.phase === 'analyzing'}
            onClick={() => x.extract()}
            disabled={!x.source || busy}
            data-hint="Extract — find the drums in the selection and put the pattern on the ring"
          >
            {x.phase === 'analyzing' ? 'LISTENING…' : 'EXTRACT RHYTHM'}
          </SketchButton>
          <p className={`xp-status${x.phase === 'error' ? ' xp-status--error' : ''}`} role="status">
            {status}
          </p>
        </div>
        {x.phase === 'done' && x.message && <p className="xp-note">{x.message}</p>}
      </section>

      {/* ── 4. Result ───────────────────────────────────── */}
      <section className="xp-section">
        <header className="xp-head">
          <span className="xp-num">3</span>
          <h3>Pattern</h3>
          {x.result && (
            <div className="xp-tempo">
              <span className="xp-bpm num">{Math.round(x.result.bpm)}</span>
              <span className="xp-bpm-unit">
                BPM
                <small className="num">
                  {x.result.bpm.toFixed(1)} · sure {Math.round(x.result.tempoConfidence * 100)}%
                </small>
              </span>
              <SketchButton
                ink="half"
                onClick={() => x.extract(x.result!.bpm / 2)}
                disabled={busy || x.result.bpm / 2 < BPM_MIN}
                data-hint="Half — the beat is counted twice too fast; re-extract at half the tempo"
              >
                ½×
              </SketchButton>
              <SketchButton
                ink="double"
                onClick={() => x.extract(x.result!.bpm * 2)}
                disabled={busy || x.result.bpm * 2 > BPM_MAX}
                data-hint="Double — the beat is counted twice too slow; re-extract at double the tempo"
              >
                2×
              </SketchButton>
            </div>
          )}
        </header>
        {x.result && (
          <ul className="xp-counts">
            {counts.map(({ d, n }) => (
              <li key={d} className={n === 0 ? 'xp-count--none' : undefined}>
                {DRUM_LABEL[d]} <span className="num">{n}</span>
              </li>
            ))}
          </ul>
        )}
        <StepLanes result={x.result} />
        <p className="xp-note">
          Click a step to add or remove it. The same pattern is on the ring in the Main Screen — drag or
          double-click a mark there, or play the pads, to change it.
        </p>
      </section>

      {/* ── 5. Listen ───────────────────────────────────── */}
      <section className="xp-section">
        <header className="xp-head">
          <span className="xp-num">4</span>
          <h3>Listen</h3>
          <SketchButton
            ink="play"
            className="xp-btn--play"
            on={playing}
            onClick={togglePlay}
            disabled={!hasPattern}
            data-hint="Play — the original and the extracted pattern together, on one grid"
          >
            {playing ? '■ STOP' : '▶ PLAY'}
          </SketchButton>
        </header>
        <div className="xp-mix">
          <SketchFader
            ink="fader-original"
            label="ORIGINAL"
            value={trackLevel.backing}
            onChange={(v) => setTrackLevel('backing', v)}
            disabled={!x.extracted || engineSource !== 'builtin'}
            hint="Original — the level of the selected audio, looping under the pattern"
          />
          <SketchFader
            ink="fader-kit"
            label="YOUR KIT"
            value={trackLevel.main}
            onChange={(v) => setTrackLevel('main', v)}
            hint="Your kit — the level of the extracted pattern, played on this instrument's sounds"
          />
          <div className="xp-presets" role="group" aria-label="Mix">
            {MIXES.map((m) => (
              <SketchButton
                key={m.id}
                ink={`mix-${m.id}`}
                onClick={() => x.applyMix(m.id)}
                disabled={!x.extracted}
                data-hint={m.hint}
              >
                {m.label}
              </SketchButton>
            ))}
          </div>
        </div>
        {engineSource !== 'builtin' && x.extracted && (
          <p className="xp-note">
            The original audio plays only with the built-in sound: Ableton keeps the loop on its own clock.
          </p>
        )}
      </section>

      {/* ── 6. Data ─────────────────────────────────────── */}
      <section className="xp-section xp-section--last">
        <header className="xp-head">
          <span className="xp-num">5</span>
          <h3>Data</h3>
          <SketchButton
            ink="show-data"
            on={showData}
            onClick={() => setShowData((s) => !s)}
            disabled={!x.result}
            data-hint="Show the result as structured data"
          >
            {showData ? 'HIDE' : 'SHOW'}
          </SketchButton>
          <SketchButton
            ink="copy"
            onClick={copy}
            disabled={!x.result}
            data-hint="Copy the result as JSON"
          >
            {copied ? 'COPIED' : 'COPY JSON'}
          </SketchButton>
        </header>
        {showData && x.result && (
          <pre className="xp-json" onKeyUp={swallowSpace}>
            {x.exportJson()}
          </pre>
        )}
      </section>
    </div>
  )
}

/** The record button: a pen loop with a blot in it, and the time running out
    drawn around it as a second, growing loop. */
function RecordButton({
  recording,
  elapsed,
  disabled,
  onPress,
}: {
  recording: boolean
  elapsed: number
  disabled: boolean
  onPress: () => void
}) {
  const size = 88
  const c = size / 2
  const seed = seedOf('record')
  const left = 1 - elapsed / RECORD_MAX_S
  return (
    <button
      type="button"
      className={`xp-record${recording ? ' xp-record--on' : ''}`}
      aria-label={recording ? 'Stop recording' : 'Record'}
      aria-pressed={recording}
      disabled={disabled}
      onClick={onPress}
      onKeyUp={swallowSpace}
      data-hint={recording ? 'Stop recording' : 'Record — up to 15 seconds from the microphone'}
    >
      <svg width={size} height={size} aria-hidden>
        <path d={loop(c, c, c - 6, c - 6, seed)} />
        {recording ? (
          <>
            <path className="xp-ink-fill" d={blot(c, c, 13, seed + 2)} />
            <path
              className="xp-ink-bold"
              d={arc(c, c, c - 1.5, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2)}
            />
          </>
        ) : (
          <path className="xp-ink-fill" d={blot(c, c, 20, seed + 1)} />
        )}
      </svg>
      <span className="xp-record-time num">{recording ? `${elapsed.toFixed(1)}s` : 'REC'}</span>
    </button>
  )
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const steps = Math.max(2, Math.ceil(((to - from) / (Math.PI * 2)) * 48))
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    d += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`
  }
  return d
}
