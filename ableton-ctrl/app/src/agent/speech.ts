/**
 * One spoken question, transcribed by the browser. Nothing is sent anywhere.
 * `stop` ends the listen early; the last transcript is already delivered.
 */

type SpeechResultEvent = {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

type SpeechRec = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type SpeechCtor = new () => SpeechRec

function ctor(): SpeechCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor
    webkitSpeechRecognition?: SpeechCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function speechSupported(): boolean {
  return ctor() !== null
}

export function listenOnce(
  onText: (text: string, final: boolean) => void,
  onEnd: () => void,
): () => void {
  const Ctor = ctor()
  if (!Ctor) {
    onEnd()
    return () => {}
  }
  const rec = new Ctor()
  rec.lang = navigator.language || 'en-US'
  rec.interimResults = true
  rec.continuous = false
  rec.onresult = (event) => {
    let text = ''
    let final = false
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0]?.transcript ?? ''
      final = event.results[i].isFinal
    }
    const spoken = text.trim()
    if (spoken) onText(spoken, final)
  }
  rec.onerror = () => onEnd()
  rec.onend = () => onEnd()
  try {
    rec.start()
  } catch {
    onEnd()
    return () => {}
  }
  return () => {
    try {
      rec.stop()
    } catch {
      /* already ended */
    }
  }
}
