import { useState } from 'react'
import type React from 'react'
import { DRUM_PARAMS } from '../chladni2/params.ts'
import { useDrum } from '../chladni2/session.tsx'
import { SOUND_VOICES } from '../transport/engine.ts'
import { ShapeSlider } from './ShapeSlider.tsx'
import { Steps } from './ShapeControls.tsx'
import { SHAPE_GROUPS, inactiveControls, type ShapeControl, type ShapeGroup } from './shape.ts'
import { useShapeEditor } from './session.tsx'

const swallowSpace = (e: React.KeyboardEvent) => {
  if (e.key === ' ') e.preventDefault()
}

/** Graphic controls, folded. Two may be open; opening a third closes the oldest. */
const MODULES: { id: string; title: string; groups: readonly string[] }[] = [
  { id: 'timbre', title: 'TIMBRE', groups: ['MODE A — PITCH', 'MODE B — SECOND MODE'] },
  { id: 'geometry', title: 'GEOMETRY', groups: ['BODY'] },
  { id: 'texture', title: 'TEXTURE', groups: ['TEXTURE — TONE'] },
  { id: 'noise', title: 'NOISE', groups: ['SAND — NOISE'] },
  { id: 'decay', title: 'DECAY', groups: ['DECAY — AFTERGLOW'] },
  { id: 'pitch', title: 'PITCH ENV', groups: ['PITCH ENV — TWIST'] },
  { id: 'centre', title: 'CENTRE', groups: ['CENTRE — CLICK / BELL'] },
  { id: 'drive', title: 'DRIVE', groups: ['DRIVE · SPREAD'] },
  { id: 'copies', title: 'COPIES', groups: ['COPIES — REPEATS'] },
  { id: 'ink', title: 'INK', groups: ['INK'] },
]

const GROUP_BY_TITLE = new Map(SHAPE_GROUPS.map((group) => [group.title, group]))

const SHORT: Record<string, string> = {
  'MODE A — PITCH': 'MODE A',
  'MODE B — SECOND MODE': 'MODE B',
}

type Panel = 'sound' | 'visual'

const asControl = (def: { id: string; label: string; initial: number; steps?: readonly string[] }): ShapeControl => ({
  id: def.id,
  label: def.label,
  min: 0,
  max: def.steps ? def.steps.length - 1 : 1,
  step: def.steps ? 1 : 0.01,
  initial: def.initial,
  steps: def.steps,
})

function Control({
  control,
  value,
  onChange,
  off,
}: {
  control: ShapeControl
  value: number
  onChange: (value: number) => void
  off?: string
}) {
  const props = { control, value, onChange, off }
  return control.steps ? <Steps {...props} /> : <ShapeSlider {...props} />
}

function GroupBlock({ group, heading }: { group: ShapeGroup; heading?: string }) {
  const { shape, setControl } = useShapeEditor()
  const off = inactiveControls(shape)
  return (
    <div className="lab-block">
      {heading && <h4 className="lab-subhead">{heading}</h4>}
      {group.note && <p className="lab-note">{group.note}</p>}
      <div className="ce-group-controls">
        {group.controls.map((control) => (
          <Control
            key={control.id}
            control={control}
            value={shape[control.id]}
            onChange={(v) => setControl(control.id, v)}
            off={off.get(control.id)}
          />
        ))}
      </div>
    </div>
  )
}

function SoundPanel() {
  const { target } = useShapeEditor()
  const { params, setParam } = useDrum()
  const values = params[target]
  const off = target === 'fx' && values.amnt === 0 ? 'AMNT is 0' : undefined
  return (
    <div className="lab-sound">
      {DRUM_PARAMS[target].map((def) => (
        <Control
          key={def.id}
          control={asControl(def)}
          value={values[def.id]}
          onChange={(v) => setParam(target, def.id, v)}
          off={def.id === 'mod' ? off : undefined}
        />
      ))}
    </div>
  )
}

function VisualPanel({ open, onToggle }: { open: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="lab-modules">
      {MODULES.map((mod, index) => {
        const expanded = open.includes(mod.id)
        const groups = mod.groups.map((title) => GROUP_BY_TITLE.get(title)).filter((g): g is ShapeGroup => !!g)
        return (
          <section key={mod.id} className={`lab-module${expanded ? ' lab-module--open' : ''}`}>
            <button
              type="button"
              className="lab-module-head"
              aria-expanded={expanded}
              onClick={() => onToggle(mod.id)}
              onKeyUp={swallowSpace}
            >
              <span className="lab-module-index num">{String(index + 1).padStart(2, '0')}</span>
              <span className="lab-module-title">{mod.title}</span>
              <span className="lab-module-mark" aria-hidden>
                {expanded ? '–' : '+'}
              </span>
            </button>
            {expanded && (
              <div className="lab-module-body">
                {groups.map((group) => (
                  <GroupBlock
                    key={group.title}
                    group={group}
                    heading={groups.length > 1 ? (SHORT[group.title] ?? group.title) : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/**
 * The inspector. SOUND is the slot's few knobs. VISUAL is every graphic
 * control, opened a module or two at a time.
 */
export function Inspector() {
  const { target, labels, kitName, resetShape, randomize, clearSlot } = useShapeEditor()
  const { resetSound } = useDrum()
  const [panel, setPanel] = useState<Panel>('visual')
  const [open, setOpen] = useState<string[]>(['geometry'])
  const index = SOUND_VOICES.indexOf(target)

  const toggle = (id: string) => {
    setOpen((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id)
      const next = [...prev, id]
      return next.length > 2 ? next.slice(-2) : next
    })
  }

  return (
    <aside className="lab-inspector" data-no-pinch>
      <header className="lab-inspector-head">
        <span className="lab-kicker">{kitName}</span>
        <h2 className="lab-voice">
          <span className="num">{String(index + 1).padStart(2, '0')}</span>
          {labels[target]}
        </h2>
      </header>
      <div className="lab-tabs" role="tablist" aria-label="Inspector">
        {(['sound', 'visual'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`lab-tab${panel === id ? ' lab-tab--on' : ''}`}
            aria-selected={panel === id}
            onClick={() => setPanel(id)}
            onKeyUp={swallowSpace}
          >
            {id === 'sound' ? 'SOUND' : 'VISUAL'}
          </button>
        ))}
      </div>
      <div className="lab-inspector-body" role="tabpanel">
        {panel === 'sound' ? <SoundPanel /> : <VisualPanel open={open} onToggle={toggle} />}
      </div>
      <footer className="lab-inspector-foot">
        {panel === 'visual' ? (
          <>
            <button type="button" className="lab-quiet" onClick={randomize} onKeyUp={swallowSpace}>
              RANDOM
            </button>
            <button type="button" className="lab-quiet" onClick={resetShape} onKeyUp={swallowSpace}>
              RESET
            </button>
          </>
        ) : (
          <button type="button" className="lab-quiet" onClick={() => resetSound(target)} onKeyUp={swallowSpace}>
            RESET
          </button>
        )}
        <button type="button" className="lab-quiet" onClick={() => clearSlot(target)} onKeyUp={swallowSpace}>
          CLEAR
        </button>
      </footer>
    </aside>
  )
}
