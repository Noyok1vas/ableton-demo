import { BARS_PER_LOOP } from '../rhythmic-intent/types.ts'

/**
 * A local reading of the bar on the ring, for the assistant.
 *
 * There is no model behind it. It looks at where the kit's own hits sit and
 * answers in a few sentences: what the groove resembles, which way the sounds
 * might go, and a push to change it rather than to reconstruct the record.
 */

export type GrooveTap = { pos: number; voice?: string; kept: boolean }

export type GrooveContext = {
  /** CREATE is the ring; ARRANGE is the song. */
  view: 'create' | 'arrange'
  bpm: number
  taps: readonly GrooveTap[]
  /** The extract panel's moment, when it is open. */
  live: 'idle' | 'recording' | 'reading' | 'preview' | null
  /** A take was kept on the ring and not yet cleared. */
  fromTake: boolean
}

type Family = 'hiphop' | 'house' | 'backbeat' | 'trap' | 'dnb' | 'sparse' | 'open'

const zhOf = (q: string) => /[\u3400-\u9fff]/.test(q)

function barStep(pos: number): number {
  const x = (((pos * BARS_PER_LOOP) % 1) + 1) % 1
  return Math.round(x * 16) % 16
}

function steps(taps: readonly GrooveTap[], voice: string): Set<number> {
  const out = new Set<number>()
  for (const tap of taps) {
    if (!tap.kept || tap.voice !== voice) continue
    out.add(barStep(tap.pos))
  }
  return out
}

function classify(taps: readonly GrooveTap[], bpm: number): Family {
  const kick = steps(taps, 'kick')
  const snare = steps(taps, 'snare')
  const hat = steps(taps, 'hat')
  const four = [0, 4, 8, 12].every((s) => kick.has(s))
  const back = snare.has(4) && snare.has(12)
  const busy = hat.size >= 10
  if (taps.filter((t) => t.kept).length < 2) return 'open'
  if (bpm >= 155 && back && !four) return 'dnb'
  if (four && (snare.has(4) || snare.has(12))) return 'house'
  if ((snare.has(8) || snare.has(12)) && busy && !four && bpm >= 120) return 'trap'
  if (back && !four && bpm <= 110) return 'hiphop'
  if (back) return 'backbeat'
  if (kick.size + snare.size <= 2) return 'sparse'
  return 'open'
}

const READING: Record<'zh' | 'en', Record<Family, string>> = {
  zh: {
    hiphop: '九十年代嘻哈的律动。底鼓在正拍，军鼓落在二和四，帽子留着空隙。',
    house: '四拍底鼓，接近浩室。军鼓在后拍上回答。',
    backbeat: '后拍的律动。军鼓守着二和四，底鼓在正拍。',
    trap: '半拍的陷阱律动。帽子很密，军鼓靠后，底鼓很少。',
    dnb: '鼓与贝斯的骨架。军鼓在后拍，底鼓在缝里走。',
    sparse: '很稀的一小节，只有几个落点。',
    open: '一小节还没站稳，落点是散的。',
  },
  en: {
    hiphop: 'A 90s hip-hop groove. The kick sits on the downbeat, the snare on two and four, the hats leave space.',
    house: 'Four on the floor, house-like. The snare answers on the backbeat.',
    backbeat: 'A backbeat. The snare holds two and four, the kick the downbeat.',
    trap: 'A half-time trap groove. Dense hats, the snare late, the kick scarce.',
    dnb: 'A drum-and-bass skeleton. The snare on the backbeat, the kick in the gaps.',
    sparse: 'A sparse bar — only a few hits.',
    open: 'The bar has not settled; the hits are still loose.',
  },
}

const KIT: Record<'zh' | 'en', Record<Family, string>> = {
  zh: {
    hiphop: '用更干的底鼓和更短的军鼓。',
    house: '把帽子稍稍打开，底鼓保持圆。',
    backbeat: '军鼓再硬一点，底鼓收短。',
    trap: '底鼓留稀，军鼓收紧，帽子靠近。',
    dnb: '军鼓保持干，让底鼓去挪位置。',
    sparse: '先补一颗底鼓或一记军鼓，听它往哪边倒。',
    open: '先定底鼓和军鼓，再动帽子。',
  },
  en: {
    hiphop: 'Dry the kick and shorten the snare.',
    house: 'Open the hat a little and keep the kick round.',
    backbeat: 'Harden the snare and shorten the kick.',
    trap: 'Leave the kick sparse, tighten the snare, bring the hats in close.',
    dnb: 'Keep the snare dry and let the kick move.',
    sparse: 'Add one kick or one snare and hear which way it leans.',
    open: 'Set the kick and the snare first, then the hat.',
  },
}

const NUDGE = {
  zh: '接着改它。这是起点，不是那首歌。',
  en: 'Bend it from here. This is a start, not the record.',
}

function intent(q: string): 'groove' | 'kit' | 'next' {
  const s = q.toLowerCase()
  if (/音色|鼓组|配器|kit|timbre|sound|voice|recommend|推荐/.test(s)) return 'kit'
  if (/接下来|怎么改|然后|next|edit|change|what now/.test(s)) return 'next'
  return 'groove'
}

/** One short answer for the question, in the language it was asked. */
export function readGroove(question: string, ctx: GrooveContext): string {
  const lang = zhOf(question) ? 'zh' : 'en'
  if (ctx.live === 'recording') return lang === 'zh' ? '还在听这段。' : 'Still listening to the take.'
  if (ctx.live === 'reading') return lang === 'zh' ? '正在找这一小节。' : 'Still finding the bar.'

  const kept = ctx.taps.filter((t) => t.kept)
  if (kept.length === 0) {
    return lang === 'zh'
      ? '环上还没有节奏。先录一段，或在垫上敲一小节。'
      : 'Nothing on the ring yet. Record a take, or tap a bar in.'
  }

  const family = classify(kept, ctx.bpm)
  const where =
    ctx.view === 'arrange'
      ? lang === 'zh'
        ? '你在看整首歌。'
        : 'You’re looking at the whole song.'
      : ctx.fromTake || ctx.live === 'preview'
        ? lang === 'zh'
          ? '这是刚从那段里抽出的一小节。'
          : 'This is the bar just pulled from the take.'
        : ''
  const ask = intent(question)
  const lines = [where, READING[lang][family], ask === 'next' ? '' : KIT[lang][family], NUDGE[lang]]
  return lines.filter(Boolean).join(lang === 'zh' ? '' : ' ')
}
