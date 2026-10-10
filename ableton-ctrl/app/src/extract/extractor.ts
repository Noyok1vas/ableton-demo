import type { ExtractionResult, MonoClip, RhythmExtractor } from './types.ts'

type Reply = { id: number; result?: ExtractionResult; error?: string }

/**
 * The in-page extractor: the analysis (analyze.ts) in a worker. One worker,
 * started on first use and kept, since a learner tends to extract several
 * selections in a row.
 */
export class WorkerExtractor implements RhythmExtractor {
  private worker: Worker | null = null
  private next = 0
  private readonly pending = new Map<
    number,
    { resolve: (r: ExtractionResult) => void; reject: (e: Error) => void }
  >()

  extract(clip: MonoClip, options: { bars: number; bpm?: number }): Promise<ExtractionResult> {
    const worker = this.ensureWorker()
    const id = ++this.next
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // A copy is sent, not the original: the caller keeps its clip.
      worker.postMessage({ id, samples: clip.samples, sampleRate: clip.sampleRate, ...options })
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    for (const { reject } of this.pending.values()) reject(new Error('Extractor closed'))
    this.pending.clear()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const job = this.pending.get(event.data.id)
      if (!job) return
      this.pending.delete(event.data.id)
      if (event.data.result) job.resolve(event.data.result)
      else job.reject(new Error(event.data.error ?? 'Analysis failed'))
    }
    worker.onerror = (event) => {
      for (const { reject } of this.pending.values()) reject(new Error(event.message || 'Analysis failed'))
      this.pending.clear()
      worker.terminate()
      this.worker = null
    }
    this.worker = worker
    return worker
  }
}
