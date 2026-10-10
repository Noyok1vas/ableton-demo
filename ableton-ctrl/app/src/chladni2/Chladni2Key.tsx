import { CHANNELS } from './params.ts'
import './chladni2.css'

/** The five bodies — the silhouettes that tell the sounds apart at a glance. */
const BODIES: { name: string; sounds: string; figure: string; literal: boolean }[] = [
  {
    name: 'MEMBRANE',
    sounds: 'KICK · TOM · SNARE',
    figure:
      'A drum head with a fixed edge — the edge is itself a line of sand. Kick: struck dead centre, only rings (0,n). Tom: struck off centre, diameters (m,1). Snare: two oscillators, two modes at once.',
    literal: true,
  },
  {
    name: 'BAR',
    sounds: 'RIM',
    figure:
      'A short free-free bar: stripes across it at 0.224 / 0.776, then 0.132 / 0.5 / 0.868, then 0.094 / 0.356 / 0.644 / 0.906 of its length; partials 1 : 2.756 : 5.404, which the sound plays too.',
    literal: true,
  },
  {
    name: 'PLATE',
    sounds: 'HAT · RIDE',
    figure:
      'Metal with a free edge: no outline. Hat is two cymbals, so two copies of one pattern turned against each other — the moiré is literal. Ride is one big plate with its bell.',
    literal: true,
  },
  {
    name: 'SAND',
    sounds: 'CLAP',
    figure: 'No body at all — only the air between hands. One ring of sand per burst, offset: the ghosting is a metaphor.',
    literal: false,
  },
  {
    name: 'FM',
    sounds: 'FX',
    figure: 'ψ = J_m(j_m1·r)·cos(mθ + I·sin kθ): the angle is frequency-modulated, so AMNT (I) and MOD (k) bunch the spokes as sidebands bunch.',
    literal: true,
  },
]

/**
 * The key to Chladni 2: what each body is, what each channel draws, and which
 * of those mappings the physics gives versus which are chosen to read.
 */
export function Chladni2Key() {
  return (
    <div className="c2-key">
      <section className="c2-key-col">
        <h3 className="c2-key-title">BODIES — one per kind of sound</h3>
        <ul className="c2-key-list">
          {BODIES.map((b) => (
            <li key={b.name}>
              <span className="c2-key-name">{b.name}</span>
              <span className="c2-key-sounds">{b.sounds}</span>
              <span className={`c2-key-flag${b.literal ? ' c2-key-flag--on' : ''}`}>
                {b.literal ? 'LITERAL' : 'METAPHOR'}
              </span>
              <p className="c2-key-text">{b.figure}</p>
            </li>
          ))}
        </ul>
        <p className="c2-key-note">
          Approximation: a cymbal is a free plate (a fourth-order problem). Here it borrows the
          membrane's Bessel modes with the edge an antinode — the zeros of J′ₘ — so no sand
          collects at the edge. The figure is right in kind, not in detail.
        </p>
      </section>
      <section className="c2-key-col">
        <h3 className="c2-key-title">CHANNELS — the number after each knob</h3>
        <ul className="c2-key-list c2-key-list--channels">
          {CHANNELS.map((c) => (
            <li key={c.id}>
              <span className="c2-key-num num">{c.id}</span>
              <span className="c2-key-name">{c.name}</span>
              <span className={`c2-key-flag${c.literal ? ' c2-key-flag--on' : ''}`}>
                {c.literal ? 'LITERAL' : 'METAPHOR'}
              </span>
              <p className="c2-key-text">{c.figure}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
