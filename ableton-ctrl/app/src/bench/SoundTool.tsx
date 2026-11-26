import { useEffect, useMemo, useState } from 'react'
import {
  OUTPUT_TONE_FLAT,
  OUTPUT_TONE_RANGES,
  clearOutputToneOverride,
  getOutputTone,
  getOutputToneDefaults,
  hasOutputToneOverride,
  saveOutputToneDefaults,
  setOutputToneOverride,
  subscribeOutputTone,
  type OutputTone,
  type OutputToneKey,
} from '../transport/outputTone.ts'

/**
 * The sound tool: the output tone (volume + three-band EQ) the speaker plays
 * with. Every move is heard at once in the preview; "Save as device default"
 * writes it into the build the Pi runs.
 */
export function SoundTool() {
  const [tone, setTone] = useState<OutputTone>(getOutputTone)
  const [dirty, setDirty] = useState(hasOutputToneOverride)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | string>('idle')

  useEffect(
    () =>
      subscribeOutputTone((next) => {
        setTone(next)
        setDirty(hasOutputToneOverride() && !sameTone(next, getOutputToneDefaults()))
      }),
    [],
  )

  const change = (key: OutputToneKey, value: number) => {
    setSaveState('idle')
    setOutputToneOverride({ ...tone, [key]: value })
  }

  const save = async () => {
    setSaveState('saving')
    try {
      await saveOutputToneDefaults(tone)
      // The file arrives by HMR; until then the override holds the same values.
      clearOutputToneOverride()
      setSaveState('saved')
    } catch (err) {
      setSaveState(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="bench-tool">
      <ResponseCurve tone={tone} />

      <Group title="音量">
        <Slider k="volume" label="总音量" unit="dB" tone={tone} onChange={change} />
      </Group>
      <Group title="低频 · 低架">
        <Slider k="lowGain" label="增益" unit="dB" tone={tone} onChange={change} />
        <Slider k="lowFreq" label="转折" unit="Hz" tone={tone} onChange={change} />
      </Group>
      <Group title="中频 · 峰值">
        <Slider k="midGain" label="增益" unit="dB" tone={tone} onChange={change} />
        <Slider k="midFreq" label="中心" unit="Hz" tone={tone} onChange={change} />
        <Slider k="midQ" label="宽度 Q" unit="" tone={tone} onChange={change} />
      </Group>
      <Group title="高频 · 高架">
        <Slider k="highGain" label="增益" unit="dB" tone={tone} onChange={change} />
        <Slider k="highFreq" label="转折" unit="Hz" tone={tone} onChange={change} />
      </Group>

      <div className="bench-actions">
        <button type="button" className="bench-btn bench-btn--primary" disabled={!dirty || saveState === 'saving'} onClick={save}>
          保存为设备默认
        </button>
        <button type="button" className="bench-btn" disabled={!dirty} onClick={clearOutputToneOverride}>
          撤销到已保存
        </button>
        <button type="button" className="bench-btn" onClick={() => setOutputToneOverride(OUTPUT_TONE_FLAT)}>
          全部归零
        </button>
      </div>
      <p className="bench-note">
        {saveState === 'saving'
          ? '保存中…'
          : saveState === 'saved'
            ? '已写入 outputTone.defaults.ts。提交并在 Pi 上运行 ephnim update 后，Pi 就会用它。'
            : saveState !== 'idle'
              ? `保存失败：${saveState}`
              : dirty
                ? '有未保存的修改：只在这台 Mac 的浏览器里生效。'
                : '和设备默认一致。'}
      </p>
      <p className="bench-note bench-note--muted">
        双击滑块回到平直。点一下左边的预览再按 1–8 敲垫子试听。声音从 Mac 出，Pi 的音箱会有所不同。
      </p>
    </div>
  )
}

function sameTone(a: OutputTone, b: OutputTone): boolean {
  return (Object.keys(OUTPUT_TONE_RANGES) as OutputToneKey[]).every(
    (k) => Math.abs(a[k] - b[k]) < 1e-6,
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bench-group">
      <h3 className="bench-group__title">{title}</h3>
      {children}
    </section>
  )
}

const SLIDER_STEPS = 1000

function Slider({
  k,
  label,
  unit,
  tone,
  onChange,
}: {
  k: OutputToneKey
  label: string
  unit: string
  tone: OutputTone
  onChange: (key: OutputToneKey, value: number) => void
}) {
  const { min, max, step, log } = OUTPUT_TONE_RANGES[k]
  const value = tone[k]
  // Frequencies move on a log scale, so every octave gets the same travel.
  const toPos = (v: number) =>
    log ? (Math.log(v / min) / Math.log(max / min)) * SLIDER_STEPS : ((v - min) / (max - min)) * SLIDER_STEPS
  const fromPos = (p: number) => {
    const t = p / SLIDER_STEPS
    const raw = log ? min * Math.pow(max / min, t) : min + t * (max - min)
    return Math.round(raw / step) * step
  }
  const shown =
    unit === 'Hz'
      ? value >= 1000
        ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} k`
        : `${Math.round(value)}`
      : unit === 'dB'
        ? `${value > 0 ? '+' : ''}${value.toFixed(1)}`
        : value.toFixed(2)

  return (
    <label className="bench-slider" onDoubleClick={() => onChange(k, OUTPUT_TONE_FLAT[k])}>
      <span className="bench-slider__label">{label}</span>
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={toPos(value)}
        onChange={(e) => onChange(k, fromPos(Number(e.target.value)))}
      />
      <span className="bench-slider__value">
        {shown}
        {unit && <span className="bench-slider__unit"> {unit}</span>}
      </span>
    </label>
  )
}

/** The EQ's combined magnitude response, 20 Hz–20 kHz, ±15 dB. */
function ResponseCurve({ tone }: { tone: OutputTone }) {
  const W = 320
  const H = 120
  const RANGE = 15
  const N = 160

  const ctx = useMemo(() => {
    try {
      return new OfflineAudioContext(1, 1, 48000)
    } catch {
      return null
    }
  }, [])

  const freqs = useMemo(() => {
    const f = new Float32Array(N)
    for (let i = 0; i < N; i++) f[i] = 20 * Math.pow(1000, i / (N - 1))
    return f
  }, [])

  const path = useMemo(() => {
    if (!ctx) return ''
    const db = new Float32Array(N).fill(tone.volume)
    const mag = new Float32Array(N)
    const phase = new Float32Array(N)
    const bands: [BiquadFilterType, number, number, number][] = [
      ['lowshelf', tone.lowFreq, tone.lowGain, 1],
      ['peaking', tone.midFreq, tone.midGain, tone.midQ],
      ['highshelf', tone.highFreq, tone.highGain, 1],
    ]
    for (const [type, f, g, q] of bands) {
      const node = ctx.createBiquadFilter()
      node.type = type
      node.frequency.value = f
      node.gain.value = g
      node.Q.value = q
      node.getFrequencyResponse(freqs, mag, phase)
      for (let i = 0; i < N; i++) db[i] += 20 * Math.log10(Math.max(mag[i], 1e-6))
    }
    let d = ''
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * W
      const clamped = Math.max(-RANGE, Math.min(RANGE, db[i]))
      const y = H / 2 - (clamped / RANGE) * (H / 2)
      d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    }
    return d
  }, [ctx, freqs, tone])

  const xOf = (f: number) => (Math.log(f / 20) / Math.log(1000)) * W
  const grid = [50, 100, 200, 500, 1000, 2000, 5000, 10000]

  return (
    <svg className="bench-curve" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label="EQ 频率响应">
      {grid.map((f) => (
        <g key={f}>
          <line x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} className="bench-curve__grid" />
          <text x={xOf(f)} y={H + 11} className="bench-curve__label">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      {[-10, -5, 5, 10].map((g) => (
        <line key={g} x1={0} x2={W} y1={H / 2 - (g / RANGE) * (H / 2)} y2={H / 2 - (g / RANGE) * (H / 2)} className="bench-curve__grid" />
      ))}
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="bench-curve__zero" />
      <path d={path} className="bench-curve__line" />
    </svg>
  )
}
