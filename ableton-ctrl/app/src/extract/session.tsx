import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  analysisClip,
  cutBacking,
  decodeAudio,
  MicRecorder,
  overview,
  RECORD_MAX_S,
  SELECTION_MAX_S,
  SELECTION_MIN_S,
  SOURCE_MIN_S,
} from './audio.ts'
import { WorkerExtractor } from './extractor.ts'
import { DRUM_TO_VOICE, type ExtractionResult, type PatternHit } from './types.ts'
import { useSoundEngine } from '../transport/session.tsx'
import { DEFAULT_METER } from '../transport/meter.ts'
import { useSession, type ImportedHit } from '../rhythmic-intent/session.tsx'
import { BARS_PER_LOOP } from '../rhythmic-intent/types.ts'
import { useSelector } from '../selector/session.tsx'
import type { CharacterState } from '../selector/character.ts'

/** Buckets in the waveform overview. */
const OVERVIEW_BUCKETS = 900

export type SourceAudio = {
  kind: 'file' | 'mic'
  name: string
  buffer: AudioBuffer
  duration: number
  /** 0..1 peaks, OVERVIEW_BUCKETS across the whole source. */
  peaks: Float32Array
}

export type Selection = { start: number; end: number }

export type ExtractPhase =
  | 'empty' // nothing loaded
  | 'loading' // decoding a file or a take
  | 'recording'
  | 'ready' // a source and a selection, not yet extracted
  | 'analyzing'
  | 'done' // a result, on the ring
  | 'error'

/** Where the mix sits: the three places a learner moves between. */
export type MixPreset = 'song' | 'both' | 'kit'
const MIX_PRESETS: Record<MixPreset, { backing: number; main: number }> = {
  song: { backing: 100, main: 25 },
  both: { backing: 70, main: 100 },
  kit: { backing: 0, main: 100 },
}

export type ExtractSessionValue = {
  phase: ExtractPhase
  /** What went wrong, in words, while phase is 'error' (or a note alongside a
      result, like a clip too short to repeat). */
  message: string | null
  source: SourceAudio | null
  selection: Selection
  setSelection: (next: Selection) => void
  /** Shortest and longest selection allowed for the current source. */
  selectionLimits: { min: number; max: number }
  loadFile: (file: File) => void
  /** Recording state: seconds so far and the input level history (0..1),
      newest last. */
  recording: { elapsed: number; levels: number[] } | null
  micSupported: boolean
  startRecording: () => void
  stopRecording: () => void
  /** Analyse the selection and put the result on the ring. `bpm` forces the
      tempo (HALF / DOUBLE). */
  extract: (bpm?: number) => void
  result: ExtractionResult | null
  /** The selection the result came from, and the backing clip cut from it. */
  extracted: { selection: Selection; loops: number; loopSeconds: number } | null
  /** Hear the selection on its own, before extracting. */
  previewing: boolean
  togglePreview: () => void
  /** Glide both faders to one of the three mixes. */
  applyMix: (preset: MixPreset) => void
  /** The result as the structured data the brief asks for. */
  exportJson: () => string
}

const ExtractContext = createContext<ExtractSessionValue | null>(null)

export function useExtract(): ExtractSessionValue {
  const value = useContext(ExtractContext)
  if (!value) throw new Error('useExtract must be used inside <ExtractSession>')
  return value
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Where a selection opens on a new source: all of a short one; ten seconds
    of a long one, a third of the way in — past most intros, before most
    breakdowns. */
function defaultSelection(duration: number): Selection {
  if (duration <= SELECTION_MAX_S) return { start: 0, end: duration }
  const length = 10
  const start = clamp(duration * 0.3, 0, duration - length)
  return { start, end: start + length }
}

/** The sound a hit is played with: this kit's own sound for that category, at
    the character the Selector has it at — the learner's kit, not the song's.
    An open hat is the one place the song's detail carries over. */
function toImported(hit: PatternHit, steps: number, character: CharacterState): ImportedHit {
  const voice = DRUM_TO_VOICE[hit.drum]
  let c: number | undefined = character[voice]
  if (voice === 'hat') c = hit.open ? Math.max(c, 0.75) : Math.min(c, 0.35)
  return { pos: hit.step / steps, velocity: hit.velocity, voice, character: c }
}

/**
 * The extract window's state: a source (a file or a microphone take), the
 * part of it being studied, the analysis, and handing the result over — the
 * pattern to the ring, the tempo to the transport, the selection itself to
 * the engine as the backing track.
 */
export function ExtractSession({ children }: { children: ReactNode }) {
  const engine = useSoundEngine()
  const { setBpm, setMeter, setBacking, setTrackLevel, trackLevel } = engine
  const rhythm = useSession()
  const { importPattern, playing, togglePlay } = rhythm
  const { character } = useSelector()

  const [phase, setPhase] = useState<ExtractPhase>('empty')
  const [message, setMessage] = useState<string | null>(null)
  const [source, setSource] = useState<SourceAudio | null>(null)
  const [selection, setSelectionState] = useState<Selection>({ start: 0, end: 0 })
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [extracted, setExtracted] = useState<ExtractSessionValue['extracted']>(null)
  const [recording, setRecording] = useState<ExtractSessionValue['recording']>(null)
  const [previewing, setPreviewing] = useState(false)

  const extractorRef = useRef<WorkerExtractor | null>(null)
  const recorderRef = useRef<MicRecorder | null>(null)
  const previewRef = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode } | null>(null)
  const characterRef = useRef(character)
  characterRef.current = character
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(
    () => () => {
      extractorRef.current?.dispose()
      recorderRef.current?.cancel()
      void previewRef.current?.ctx.close()
    },
    [],
  )

  const selectionLimits = {
    min: source ? Math.min(SELECTION_MIN_S, source.duration) : SELECTION_MIN_S,
    max: source ? Math.min(SELECTION_MAX_S, source.duration) : SELECTION_MAX_S,
  }

  const setSelection = useCallback(
    (next: Selection) => {
      if (!source) return
      const min = Math.min(SELECTION_MIN_S, source.duration)
      const max = Math.min(SELECTION_MAX_S, source.duration)
      let { start, end } = next
      start = clamp(start, 0, source.duration)
      end = clamp(end, 0, source.duration)
      if (end - start < min) end = Math.min(source.duration, start + min)
      if (end - start < min) start = Math.max(0, end - min)
      if (end - start > max) end = start + max
      setSelectionState({ start, end })
      setPhase((p) => (p === 'done' || p === 'error' ? 'ready' : p))
    },
    [source],
  )

  const stopPreview = useCallback(() => {
    const preview = previewRef.current
    if (!preview) return
    previewRef.current = null
    try {
      preview.source.stop()
    } catch {
      /* already over */
    }
    void preview.ctx.close()
    setPreviewing(false)
  }, [])

  const adopt = useCallback(
    (kind: SourceAudio['kind'], name: string, buffer: AudioBuffer) => {
      if (buffer.duration < SOURCE_MIN_S) {
        setPhase('error')
        setMessage(`That is only ${buffer.duration.toFixed(1)} s — at least ${SOURCE_MIN_S} s is needed to hear a rhythm.`)
        return
      }
      stopPreview()
      setSource({ kind, name, buffer, duration: buffer.duration, peaks: overview(buffer, OVERVIEW_BUCKETS) })
      setSelectionState(defaultSelection(buffer.duration))
      setResult(null)
      setExtracted(null)
      setMessage(null)
      setPhase('ready')
    },
    [stopPreview],
  )

  const loadFile = useCallback(
    (file: File) => {
      setPhase('loading')
      setMessage(null)
      void file
        .arrayBuffer()
        .then(decodeAudio)
        .then((buffer) => adopt('file', file.name, buffer))
        .catch(() => {
          setPhase('error')
          setMessage(`Could not read “${file.name}”. Try an MP3, WAV, M4A or OGG file.`)
        })
    },
    [adopt],
  )

  // ── Microphone ────────────────────────────────────────────────────
  const meterRaf = useRef(0)
  const startRecording = useCallback(() => {
    if (!MicRecorder.supported()) {
      setPhase('error')
      setMessage('This browser cannot record from the microphone.')
      return
    }
    // The loop would be recorded along with the room.
    if (playingRef.current) togglePlay()
    stopPreview()
    const recorder = new MicRecorder()
    recorderRef.current = recorder
    setMessage(null)
    recorder
      .start()
      .then(({ take }) => {
        setPhase('recording')
        const began = performance.now()
        const levels: number[] = []
        const tick = () => {
          if (recorderRef.current !== recorder) return
          levels.push(recorder.level())
          setRecording({ elapsed: Math.min(RECORD_MAX_S, (performance.now() - began) / 1000), levels: [...levels] })
          meterRaf.current = requestAnimationFrame(tick)
        }
        meterRaf.current = requestAnimationFrame(tick)
        return take
      })
      .then(async (blob) => {
        cancelAnimationFrame(meterRaf.current)
        recorderRef.current = null
        setRecording(null)
        setPhase('loading')
        const buffer = await decodeAudio(await blob.arrayBuffer())
        adopt('mic', 'Microphone take', buffer)
      })
      .catch((error: unknown) => {
        cancelAnimationFrame(meterRaf.current)
        recorderRef.current = null
        setRecording(null)
        setPhase('error')
        const denied = error instanceof DOMException && error.name === 'NotAllowedError'
        setMessage(
          denied
            ? 'Microphone access was refused. Allow it in the browser’s site settings to record.'
            : 'Recording failed — no microphone, or the take could not be read.',
        )
      })
  }, [adopt, stopPreview, togglePlay])

  const stopRecording = useCallback(() => recorderRef.current?.stop(), [])

  // ── Preview ───────────────────────────────────────────────────────
  const togglePreview = useCallback(() => {
    if (previewRef.current) {
      stopPreview()
      return
    }
    if (!source) return
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const node = ctx.createBufferSource()
    node.buffer = source.buffer
    node.connect(ctx.destination)
    node.onended = () => {
      if (previewRef.current?.source === node) stopPreview()
    }
    node.start(0, selection.start, selection.end - selection.start)
    previewRef.current = { ctx, source: node }
    setPreviewing(true)
  }, [source, selection, stopPreview])

  // ── Extraction ────────────────────────────────────────────────────
  const extract = useCallback(
    (bpm?: number) => {
      if (!source) return
      stopPreview()
      const sel = selection
      setPhase('analyzing')
      setMessage(null)
      const extractor = (extractorRef.current ??= new WorkerExtractor())
      void analysisClip(source.buffer, sel.start, sel.end - sel.start)
        .then((clip) => extractor.extract(clip, { bars: BARS_PER_LOOP, bpm }))
        .then((res) => {
          const loopSeconds = (BARS_PER_LOOP * 4 * 60) / res.bpm
          const span = sel.end - sel.start - res.downbeat
          const loops = Math.max(1, Math.floor(span / loopSeconds + 0.02))
          const backing = cutBacking(source.buffer, sel.start + res.downbeat, loops, loopSeconds)
          // Tempo and meter first, then the pattern: the ring re-times what it
          // was handed when the loop length moves, so the order is safe.
          setBpm(Math.round(res.bpm))
          setMeter(() => DEFAULT_METER)
          importPattern(res.pattern.map((h) => toImported(h, res.steps, characterRef.current)))
          setBacking({ buffer: backing, loops })
          setResult(res)
          setExtracted({ selection: sel, loops, loopSeconds })
          setPhase('done')
          if (res.pattern.length === 0) {
            setMessage('No repeating drum hits were found in this selection. Try a part where the drums are clearer.')
          } else if (span < loopSeconds) {
            setMessage(
              `The selection is shorter than one ${BARS_PER_LOOP}-bar loop at ${Math.round(res.bpm)} BPM, so the end of the loop has no original audio under it.`,
            )
          }
        })
        .catch((error: unknown) => {
          setPhase('error')
          setMessage(error instanceof Error ? `Analysis failed: ${error.message}` : 'Analysis failed.')
        })
    },
    [source, selection, stopPreview, setBpm, setMeter, importPattern, setBacking],
  )

  // ── Mix ───────────────────────────────────────────────────────────
  const glide = useRef(0)
  const levelRef = useRef(trackLevel)
  levelRef.current = trackLevel
  const applyMix = useCallback(
    (preset: MixPreset) => {
      cancelAnimationFrame(glide.current)
      const from = { backing: levelRef.current.backing, main: levelRef.current.main }
      const to = MIX_PRESETS[preset]
      const began = performance.now()
      const step = () => {
        const u = Math.min(1, (performance.now() - began) / 450)
        const e = u * u * (3 - 2 * u)
        setTrackLevel('backing', from.backing + (to.backing - from.backing) * e)
        setTrackLevel('main', from.main + (to.main - from.main) * e)
        if (u < 1) glide.current = requestAnimationFrame(step)
      }
      glide.current = requestAnimationFrame(step)
    },
    [setTrackLevel],
  )
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  const exportJson = useCallback(() => {
    if (!result) return ''
    return JSON.stringify(
      {
        bpm: result.bpm,
        tempoConfidence: result.tempoConfidence,
        meter: `${result.meter.beats}/${result.meter.unit}`,
        bars: result.bars,
        steps: result.steps,
        source: source ? { name: source.name, kind: source.kind } : null,
        selection: extracted
          ? { start: +extracted.selection.start.toFixed(3), end: +extracted.selection.end.toFixed(3) }
          : null,
        downbeat: result.downbeat,
        loopsAnalysed: result.loopsAnalysed,
        pattern: result.pattern,
        hits: result.hits,
        separation: result.separation,
        elapsedMs: result.elapsedMs,
      },
      null,
      2,
    )
  }, [result, source, extracted])

  const value: ExtractSessionValue = {
    phase,
    message,
    source,
    selection,
    setSelection,
    selectionLimits,
    loadFile,
    recording,
    micSupported: MicRecorder.supported(),
    startRecording,
    stopRecording,
    extract,
    result,
    extracted,
    previewing,
    togglePreview,
    applyMix,
    exportJson,
  }

  return <ExtractContext.Provider value={value}>{children}</ExtractContext.Provider>
}
