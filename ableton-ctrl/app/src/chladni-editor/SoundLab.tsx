import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { SOUND_VOICES } from '../transport/engine.ts'
import { useSoundEngine } from '../transport/session.tsx'
import { useDrum } from '../chladni2/session.tsx'
import { ShapeCanvas, type ShapeCanvasHandle } from './ShapeCanvas.tsx'
import { BODIES, type ShapeParams } from './shape.ts'
import { useShapeEditor } from './session.tsx'
import { Inspector } from './Inspector.tsx'
import { ARTIST_KITS } from './library.ts'
import { LibraryPane, type LibraryCategory } from './LibraryPane.tsx'
import { RackStrip } from './RackStrip.tsx'
import '../sound-intent/sound-intent.css'
import './chladni-editor.css'
import './lab.css'

const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

function categoryOf(id: string): LibraryCategory {
  if (id.startsWith('mine-')) return 'mine'
  if (ARTIST_KITS.some((kit) => kit.id === id)) return 'artist'
  return 'classic'
}

function plateLine(shape: ShapeParams): string {
  const body = BODIES[shape.body] ?? 'MEMBRANE'
  if (body === 'BAR') return `BAR  ·  ${shape.barK.toFixed(2)}`
  if (body === 'SAND RING') return `RING  ·  ${shape.ringRadius.toFixed(2)}`
  return `${body}  ·  m ${shape.m.toFixed(2)}  ·  n ${shape.n.toFixed(2)}`
}

/** A hairline circle with twelve ticks — the plate the figure is printed on. */
function Plate() {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2
    const long = i % 3 === 0
    const inner = long ? 45.2 : 47
    const c = Math.cos(a)
    const s = Math.sin(a)
    return <line key={i} x1={50 + c * inner} y1={50 + s * inner} x2={50 + c * 49} y2={50 + s * 49} />
  })
  return (
    <svg className="lab-plate" viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="49" />
      <g>{ticks}</g>
    </svg>
  )
}

/**
 * Ephnim's sound laboratory: a library, the plate, an inspector, and the
 * eight slots. One face, not a set of floating windows.
 */
export function SoundLab() {
  const { shape, target, rack, labels, kitId, kitName, setKitName, tap, hit, keepKit, held, holdForHardware } =
    useShapeEditor()
  const { params } = useDrum()
  const { status, source } = useSoundEngine()
  const canvas = useRef<ShapeCanvasHandle>(null)
  const sendTimer = useRef(0)
  const saveTimer = useRef(0)
  const [category, setCategory] = useState<LibraryCategory>(() => categoryOf(kitId))
  const [sending, setSending] = useState(false)
  const [keptFlash, setKeptFlash] = useState(false)

  const slot = rack[target]
  const index = SOUND_VOICES.indexOf(target)
  const voice = labels[target]?.toUpperCase() ?? ''

  useEffect(() => {
    if (hit.n > 0 && hit.id === target) canvas.current?.pulse()
  }, [hit, target])

  useEffect(
    () => () => {
      window.clearTimeout(sendTimer.current)
      window.clearTimeout(saveTimer.current)
    },
    [],
  )

  const save = () => {
    keepKit(params)
    setCategory('mine')
    setKeptFlash(true)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => setKeptFlash(false), 900)
  }

  const sync = () => {
    holdForHardware()
    setSending(true)
    window.clearTimeout(sendTimer.current)
    sendTimer.current = window.setTimeout(() => setSending(false), 700)
  }

  const holdWord = sending ? 'SENDING' : held ? 'COMMITTED' : 'LOCAL'

  return (
    <div className="lab">
      <header className="lab-head">
        <div className="lab-brand">
          <span className="lab-mark">EPHNIM</span>
          <span className="lab-sub">SOUND LABORATORY</span>
        </div>
        <input
          className="lab-kit"
          aria-label="Kit name"
          value={kitName}
          maxLength={24}
          spellCheck={false}
          onChange={(e) => setKitName(e.target.value.toUpperCase())}
        />
        <div className="lab-actions">
          <span className="lab-hold" aria-live="polite">
            {holdWord}
          </span>
          <button type="button" className="lab-save" onClick={save} onKeyUp={swallowSpace}>
            {keptFlash ? 'KEPT' : 'SAVE KIT'}
          </button>
          <button
            type="button"
            className={`lab-sync${sending ? ' lab-sync--send' : ''}`}
            onClick={sync}
            onKeyUp={swallowSpace}
            title={
              status.connected
                ? 'The bridge is open. Commit this kit for the instrument.'
                : 'Commit this kit for the instrument.'
            }
          >
            SYNC TO HARDWARE
          </button>
        </div>
      </header>

      <LibraryPane category={category} onCategory={setCategory} />

      <button
        type="button"
        className="lab-stage"
        aria-label={`Play ${labels[target] ?? ''}`}
        onPointerDown={(e) => {
          e.preventDefault()
          tap(target)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.preventDefault()
        }}
        onKeyUp={(e) => {
          swallowSpace(e)
          if (e.key === 'Enter') tap(target)
        }}
      >
        <Plate />
        {slot ? (
          <ShapeCanvas ref={canvas} shape={shape} pourPx={280} className="lab-stage-canvas" />
        ) : (
          <span className="lab-stage-empty">EMPTY</span>
        )}
        <span className="lab-stage-top">
          <span className="lab-stage-voice">
            <span className="num">{String(index + 1).padStart(2, '0')}</span>
            {voice}
          </span>
          <span className="lab-stage-kit">{kitName}</span>
        </span>
        <span className="lab-stage-bottom">
          <span>{slot ? plateLine(shape) : 'CLEAR'}</span>
          <span>{source === 'builtin' && !status.ready ? 'TAP TO START' : 'TAP'}</span>
        </span>
      </button>

      <Inspector />
      <RackStrip />
    </div>
  )
}
