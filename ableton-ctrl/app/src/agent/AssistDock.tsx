import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { IconMic } from '../main-screen/icons.tsx'
import { readGroove, type GrooveContext } from './groove.ts'
import { listenOnce, speechSupported } from './speech.ts'

const PLACEHOLDER = 'Need any help with your sound?'
const DEMO_LINE = 'help me understand this rhythm'
const DEMO_REPLY = 'This is a typical 90s boombap, best work with 808 drum machine'

const HOLD_MS = 480
const TYPE_MS = 52
const STAY_MS = 3000

const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

type Mode = 'idle' | 'editing' | 'listening' | 'demo'

/**
 * The assistant, as one bar along the bottom of the screen. The prompt sits
 * in the middle; a click there types. A click on the mic shows a transcript
 * in progress. A long press plays a short, scripted exchange, then the reply
 * above the bar holds for a moment and goes away. Guiding hints keep working
 * above it. It is not a thread.
 */
export function AssistDock({ context }: { context: GrooveContext }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [draft, setDraft] = useState('')
  const [line, setLine] = useState('')
  const [popup, setPopup] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const heard = useRef('')
  const hold = useRef<number | null>(null)
  const longFired = useRef(false)
  const timers = useRef<number[]>([])
  const demoRef = useRef(false)
  const canSpeak = speechSupported()
  const contextRef = useRef(context)
  contextRef.current = context

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
  }

  useEffect(
    () => () => {
      stopRef.current?.()
      if (hold.current) window.clearTimeout(hold.current)
      timers.current.forEach((id) => window.clearTimeout(id))
    },
    [],
  )

  useEffect(() => {
    if (mode === 'editing') inputRef.current?.focus()
  }, [mode])

  const stopListen = () => {
    stopRef.current?.()
    stopRef.current = null
  }

  const ask = (text: string) => {
    const q = text.trim()
    if (!q) return
    stopListen()
    setMode('idle')
    setDraft('')
    setLine(q)
    setPopup(readGroove(q, contextRef.current))
  }

  const startListen = () => {
    if (demoRef.current) return
    clearTimers()
    heard.current = ''
    setDraft('')
    setLine('')
    setPopup(null)
    setMode('listening')
    if (!canSpeak) return
    stopRef.current = listenOnce(
      (text, final) => {
        heard.current = text
        setDraft(text)
        if (final) ask(text)
      },
      () => {
        stopRef.current = null
      },
    )
  }

  const toggleListen = () => {
    if (demoRef.current) return
    if (mode === 'listening') {
      stopListen()
      setMode('idle')
      if (heard.current) ask(heard.current)
      return
    }
    startListen()
  }

  const startDemo = () => {
    stopListen()
    clearTimers()
    demoRef.current = true
    setMode('demo')
    setDraft('')
    setLine('')
    setPopup(null)
    let i = 0
    const typeNext = () => {
      i += 1
      setLine(DEMO_LINE.slice(0, i))
      if (i < DEMO_LINE.length) {
        later(typeNext, TYPE_MS)
        return
      }
      later(() => setPopup(DEMO_REPLY), 320)
      later(() => {
        demoRef.current = false
        setMode('idle')
        setLine('')
        setPopup(null)
      }, 320 + STAY_MS)
    }
    later(typeNext, 420)
  }

  const clearHold = () => {
    if (hold.current) window.clearTimeout(hold.current)
    hold.current = null
  }

  const onMicDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || demoRef.current) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* A press that is not a live pointer still starts the hold. */
    }
    longFired.current = false
    clearHold()
    hold.current = window.setTimeout(() => {
      hold.current = null
      longFired.current = true
      startDemo()
    }, HOLD_MS)
  }

  const onMicUp = () => {
    const wasLong = longFired.current
    longFired.current = false
    clearHold()
    if (wasLong) return
    toggleListen()
  }

  const beginEdit = () => {
    if (mode === 'listening' || mode === 'demo') return
    setPopup(null)
    setLine('')
    setMode('editing')
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    ask(draft)
  }

  const shown = mode === 'listening' ? draft : line
  const quiet = !shown

  return (
    <div className="ms-assist-wrap">
      {popup && (
        <p className="ms-assist-pop" role="status">
          {popup}
        </p>
      )}
      <form className="ms-assist" onSubmit={onSubmit} role="dialog" aria-label="Assistant">
        <button
          type="button"
          className={`ms-circle ms-assist-mic${mode === 'listening' || mode === 'demo' ? ' ms-circle--on' : ''}`}
          aria-label={mode === 'listening' ? 'Stop and ask' : 'Ask aloud. Hold for a demonstration'}
          aria-pressed={mode === 'listening' || mode === 'demo'}
          onPointerDown={onMicDown}
          onPointerUp={onMicUp}
          onPointerCancel={clearHold}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
          }}
          onKeyUp={(e) => {
            swallowSpace(e)
            if (e.key === 'Enter' || e.key === ' ') toggleListen()
          }}
          data-hint="Click to speak. Hold to see it answer"
        >
          <IconMic />
        </button>
        <div className="ms-assist-field">
          {mode === 'editing' ? (
            <input
              ref={inputRef}
              className="ms-assist-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (!draft.trim()) setMode('idle')
              }}
              aria-label="Ask the assistant"
              placeholder={PLACEHOLDER}
            />
          ) : mode === 'listening' && !draft ? (
            <span className="ms-assist-wave" role="status" aria-label="Transcribing">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : mode === 'demo' && !line ? (
            <span className="ms-assist-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <button
              type="button"
              className={`ms-assist-line${quiet ? ' ms-assist-line--quiet' : ''}`}
              onClick={beginEdit}
            >
              {shown || PLACEHOLDER}
              {mode === 'demo' && <span className="ms-assist-caret" aria-hidden="true" />}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
