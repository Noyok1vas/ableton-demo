import { PatternGrid } from './PatternGrid.tsx'
import { GROUPS, noteCount, patternsIn } from './patterns.ts'
import { useMarch } from './session.tsx'
import { useMarchPlayhead } from './useMarchClocks.ts'
import './march.css'

const DESCRIPTION =
  'March Family is backstage. It exists so the generator can be watched rather than trusted: every block the audience could be given, and the exact sentence the last gesture produced. Auditioning a single block takes the March track over until the phrase is put back.'

/**
 * March Family — the designer window.
 *
 * Makes the whole chain legible in one place: how long the gesture was, what
 * musical length it rounded to, which grammar that picked, which blocks were
 * drawn, and what each of them actually contains. Every block here is
 * auditionable on its own, so a groove that sounds wrong can be traced back to
 * the bar that made it.
 */
export function MarchFamilyScreen() {
  const { phrase, loop, playPhrase, playPattern, stop } = useMarch()
  const playhead = useMarchPlayhead()

  // Which block is sounding right now — used to light up both the chain and the
  // card the block came from.
  const soundingId = loop && playhead ? (loop.ids[playhead.barIndex] ?? null) : null
  const soundingStep = playhead?.step ?? null
  /** True for the block of the *phrase* at `index`, so an audition of some
      other block doesn't light up the chain. */
  const phraseBlockSounding = (index: number) =>
    loop !== null && !loop.audition && playhead?.barIndex === index

  return (
    <div className="mf-screen">
      <section className="mf-current">
        <header className="mf-section-head">
          <h2 className="mf-title">Current phrase</h2>
          <div className="mf-actions">
            <button
              type="button"
              className="mf-action"
              disabled={!phrase}
              onClick={playPhrase}
              onKeyUp={(e) => {
                if (e.key === ' ') e.preventDefault()
              }}
            >
              PLAY FULL PHRASE
            </button>
            <button
              type="button"
              className="mf-action"
              disabled={!loop}
              onClick={stop}
              onKeyUp={(e) => {
                if (e.key === ' ') e.preventDefault()
              }}
            >
              STOP
            </button>
          </div>
        </header>

        {!phrase ? (
          <p className="mf-empty">Nothing generated yet — hold the March button.</p>
        ) : (
          <>
            <p className="mf-readout num">{phrase.label}</p>

            <div className="mf-chain">
              {phrase.patterns.map((pattern, index) => (
                <div className="mf-link" key={`${pattern.id}-${index}`}>
                  {index > 0 && <span className="mf-connector" aria-hidden />}
                  <button
                    type="button"
                    className={`mf-block${phraseBlockSounding(index) ? ' mf-block--sounding' : ''}`}
                    onClick={() => playPattern(pattern.id)}
                    onKeyUp={(e) => {
                      if (e.key === ' ') e.preventDefault()
                    }}
                    title={pattern.note}
                  >
                    <span className="mf-block-id">{pattern.id}</span>
                    <PatternGrid
                      pattern={pattern}
                      activeStep={phraseBlockSounding(index) ? soundingStep : null}
                    />
                  </button>
                </div>
              ))}
            </div>

            {/* The pipeline, in the order it ran. */}
            <dl className="mf-trace">
              <div>
                <dt>Held</dt>
                <dd className="num">{phrase.gesture.heldSeconds.toFixed(2)} s</dd>
              </div>
              <div>
                <dt>Musical time</dt>
                <dd className="num">
                  {phrase.gesture.rawBars.toFixed(2)} → {phrase.gesture.bars}{' '}
                  {phrase.gesture.bars === 1 ? 'bar' : 'bars'}
                </dd>
              </div>
              <div>
                <dt>Duration band</dt>
                <dd>{phrase.gesture.tier.name}</dd>
              </div>
              <div>
                <dt>Grammar</dt>
                <dd>{phrase.gesture.tier.shape.join(' + ')}</dd>
              </div>
              <div>
                <dt>Track</dt>
                <dd>
                  {!loop
                    ? 'Stopped'
                    : loop.audition
                      ? `Auditioning ${loop.ids[0]}`
                      : playhead
                        ? 'Looping'
                        : 'Queued for the downbeat'}
                </dd>
              </div>
            </dl>
          </>
        )}
      </section>

      {GROUPS.map((group) => (
        <section className="mf-group" key={group.id}>
          <header className="mf-section-head">
            <h2 className="mf-title">{group.name}</h2>
            <p className="mf-group-note">{group.note}</p>
          </header>
          <div className="mf-cards">
            {patternsIn(group.id).map((pattern) => (
              <button
                key={pattern.id}
                type="button"
                className={`mf-card${soundingId === pattern.id ? ' mf-card--sounding' : ''}`}
                onClick={() => playPattern(pattern.id)}
                onKeyUp={(e) => {
                  if (e.key === ' ') e.preventDefault()
                }}
              >
                <div className="mf-card-head">
                  <span className="mf-card-id">{pattern.id}</span>
                  <span className="mf-card-count num">{noteCount(pattern)}</span>
                </div>
                <PatternGrid
                  pattern={pattern}
                  showLabels
                  activeStep={soundingId === pattern.id ? soundingStep : null}
                />
                <p className="mf-card-note">{pattern.note}</p>
              </button>
            ))}
          </div>
        </section>
      ))}

      <footer className="mf-description">{DESCRIPTION}</footer>
    </div>
  )
}
