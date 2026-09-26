import { useEffect, useRef, useState, type FormEvent } from 'react'
import { askAgent } from './agent.ts'
import { IconSparkle } from '../main-screen/icons.tsx'
import './agent.css'

/** How long the "not connected" reply stays in the bar. */
const NOTICE_MS = 2200

/**
 * The agent bar — a placeholder for now. It takes a prompt like the real
 * thing will, hands it to `askAgent`, and says plainly that no agent is
 * connected yet. Space and Enter type as usual here: the instrument's global
 * keys step aside for text fields.
 */
export function AgentBar() {
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = prompt.trim()
    if (!text) return
    setPrompt('')
    const reply = await askAgent(text)
    setNotice(reply.ok ? reply.text : 'Agent not connected yet')
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }

  return (
    <form
      className={`ag-bar${prompt || notice ? ' ag-bar--typed' : ''}`}
      onSubmit={submit}
      data-hint="Agent — describe a rhythm or a sound in words (not connected yet)"
    >
      <input
        className="ag-input"
        type="text"
        value={notice ?? prompt}
        readOnly={notice !== null}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What’s up in your mind?"
        aria-label="Ask the agent"
        enterKeyHint="send"
      />
      <span className="ag-icon" aria-hidden>
        <IconSparkle size={22} />
      </span>
    </form>
  )
}
