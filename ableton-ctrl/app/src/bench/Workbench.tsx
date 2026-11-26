import { useEffect, useState, type ComponentType } from 'react'
import { SoundTool } from './SoundTool.tsx'
import './bench.css'

/**
 * The workbench (/?bench, on the Mac): the instrument's screen at its real
 * size beside a panel of tools for tuning it. The preview is the app itself in
 * an iframe — the same build the Pi runs — so what a tool changes is heard and
 * seen exactly as it will be there.
 *
 * Add a tool by adding an entry to TOOLS.
 */

/** The panel on the device: a 72.5 mm square, 720 × 720 px (≈ 252 ppi). */
const SCREEN_MM = 72.5
const SCREEN_PX = 720

interface Tool {
  id: string
  label: string
  Component: ComponentType
}

const TOOLS: Tool[] = [{ id: 'sound', label: '声音', Component: SoundTool }]

/** A credit card, the ruler everyone carries: ISO/IEC 7810 ID-1. */
const CARD_MM = { w: 85.6, h: 53.98 }

/** CSS px per mm on this display. A Mac's Retina panels at their default
    "looks like" setting sit near 127 px per inch; the calibration corrects it. */
const DEFAULT_PX_PER_MM = 127 / 25.4
const CAL_KEY = 'bench.pxPerMm'
const TOOL_KEY = 'bench.tool'
const ZOOM_KEY = 'bench.zoom'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // per-viewer convenience only
  }
}

export function Workbench() {
  const [pxPerMm, setPxPerMm] = useState(() => load(CAL_KEY, DEFAULT_PX_PER_MM))
  const [zoom, setZoom] = useState(() => load(ZOOM_KEY, 1))
  const [toolId, setToolId] = useState(() => load(TOOL_KEY, TOOLS[0].id))
  const [calibrating, setCalibrating] = useState(false)

  useEffect(() => save(CAL_KEY, pxPerMm), [pxPerMm])
  useEffect(() => save(ZOOM_KEY, zoom), [zoom])
  useEffect(() => save(TOOL_KEY, toolId), [toolId])
  useEffect(() => {
    document.title = 'Ephnim 工作台'
  }, [])

  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0]
  const side = SCREEN_MM * pxPerMm * zoom
  const ppi = Math.round((SCREEN_PX / SCREEN_MM) * 25.4)

  return (
    <div className="bench">
      <main className="bench-stage">
        <div className="bench-stage__bar">
          <span className="bench-meta">
            {SCREEN_MM} × {SCREEN_MM} mm · {SCREEN_PX} × {SCREEN_PX} px · {ppi} ppi
          </span>
          <div className="bench-seg" role="group" aria-label="预览大小">
            {[1, 2, 3].map((z) => (
              <button
                key={z}
                type="button"
                className="bench-seg__btn"
                aria-pressed={zoom === z}
                onClick={() => setZoom(z)}
              >
                {z === 1 ? '实际大小' : `${z}×`}
              </button>
            ))}
          </div>
          <button type="button" className="bench-btn" aria-pressed={calibrating} onClick={() => setCalibrating((c) => !c)}>
            校准尺寸
          </button>
        </div>

        <div className="bench-stage__canvas">
          <div className="bench-screen" style={{ width: side, height: side }}>
            <iframe className="bench-screen__frame" src="/" title="设备屏幕预览" allow="autoplay" />
          </div>
        </div>

        {calibrating && (
          <div className="bench-cal">
            <p className="bench-note">
              把一张银行卡贴在屏幕上，拖动滑块直到灰色框和卡片一样大。之后“实际大小”就是真实的 {SCREEN_MM} mm。
            </p>
            <div
              className="bench-cal__card"
              style={{ width: CARD_MM.w * pxPerMm, height: CARD_MM.h * pxPerMm }}
            />
            <label className="bench-slider">
              <span className="bench-slider__label">px / mm</span>
              <input
                type="range"
                min={2.5}
                max={8}
                step={0.01}
                value={pxPerMm}
                onChange={(e) => setPxPerMm(Number(e.target.value))}
              />
              <span className="bench-slider__value">{pxPerMm.toFixed(2)}</span>
            </label>
            <button type="button" className="bench-btn" onClick={() => setPxPerMm(DEFAULT_PX_PER_MM)}>
              恢复默认
            </button>
          </div>
        )}
      </main>

      <aside className="bench-panel">
        <nav className="bench-tabs" aria-label="工具">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="bench-tabs__tab"
              aria-pressed={t.id === tool.id}
              onClick={() => setToolId(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="bench-panel__body">
          <tool.Component />
        </div>
      </aside>
    </div>
  )
}
