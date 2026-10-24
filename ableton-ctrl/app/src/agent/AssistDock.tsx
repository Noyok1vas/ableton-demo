import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { IconMic } from '../main-screen/icons.tsx'
import { readGroove, type GrooveContext } from './groove.ts'
import { listenOnce, speechSupported } from './speech.ts'

const swallowSpace = (e: KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/**
 * The assistant, as a short block along the bottom of the screen. One question
 * at a time — spoken, shown as text, answered in a few lines — then it waits.
 * It is not a thread. Guiding mode's hints keep working above it.
 */
export function AssistDock({ context }: { context: GrooveContext }) {
  const [listening, setListening] = useState(false)
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState<string | null>(null)
  const [reply, setReply] = useState<string | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const heard = useRef('')
  const canSpeak = speechSupported()
  const contextRef = useRef(context)
  contextRef.current = context

  useEffect(
    () => () => {
      stopRef.current?.()
    },
    [],
  )

  const ask = (text: string) => {
    const q = text.trim()
    if (!q) return
    setQuestion(q)
    setDraft('')
    setReply(readGroove(q, contextRef.current))
  }

  const toggleListen = () => {
    if (listening) {
      stopRef.current?.()
      stopRef.current = null
      setListening(false)
      if (heard.current) ask(heard.current)
      return
    }
    heard.current = ''
    setQuestion(null)
    setReply(null)
    setListening(true)
    stopRef.current = listenOnce(
      (text, final) => {
        heard.current = text
        setDraft(text)
        if (final) ask(text)
      },
      () => {
        stopRef.current = null
        setListening(false)
      },
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    ask(draft)
  }

  const shown = listening ? draft : question
  return (
    <form className="ms-assist" onSubmit={onSubmit} role="dialog" aria-label="Assistant">
      <button
        type="button"
        className={`ms-circle ms-assist-mic${listening ? ' ms-circle--on' : ''}`}
        aria-label={listening ? 'Stop and ask' : 'Ask aloud'}
        aria-pressed={listening}
        onClick={toggleListen}
        onKeyUp={swallowSpace}
        data-hint="Ask — speak a question about this bar"
      >
        <IconMic />
      </button>
      <div className="ms-assist-body">
        {(canSpeak || shown) && (
          <p className={`ms-assist-line${shown ? '' : ' ms-assist-line--quiet'}`}>
            {shown || 'Ask about this bar'}
          </p>
        )}
        {reply && <p className="ms-assist-reply">{reply}</p>}
        {!canSpeak && (
          <input
            className="ms-assist-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Ask the assistant"
            placeholder="Type a question"
          />
        )}
      </div>
    </form>
  )
}
