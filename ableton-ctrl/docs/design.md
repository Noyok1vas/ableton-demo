# Design System

> Status: v0 (2026-07-17). Derived from a live inspection of **sonar.es/en** using
> computed styles, not from the site's name or memory. No existing `design.md` was present
> in the repo, so this is a new document.
>
> Every rule below is tagged:
> **[Observed]** = measured directly from the reference site's computed styles/DOM ·
> **[Inferred]** = reasoned from partial evidence, exact value not guaranteed ·
> **[Project adaptation]** = a deliberate change for this live-performance instrument, not
> present on the reference site.
>
> This document is a **design-system analysis and token set only**. It does not implement the
> GUI and must not be treated as approval to start building. See §13 for open questions that
> need a human decision before implementation.

---

## 1. Product and Interface Context

This repository is a **desktop GUI instrument** for a live electronic-music performance
workflow. It is **not** a website, dashboard, admin panel, or a collection of cards. During a
performance it:

- receives audience-generated rhythm patterns into an **incoming queue**,
- lets the performer **browse and preview** patterns,
- lets them **edit** patterns on a 16-step sequencer and a timeline,
- lets them **transform** patterns with parameter controls,
- and **commits** chosen patterns into a running Ableton Live set over OSC
  (see [osc-reference.md](osc-reference.md), [plugin-host-spec.md](plugin-host-spec.md)).

The interface is operated in low light, under time pressure, while music is playing. Reading is
often peripheral and glance-based. A mistaken **Commit** is expensive and audible. These
realities drive every "Project adaptation" tag below and override any reference-site behaviour
that would compromise them.

The reference site provides the **structural and visual foundation**: typography, hierarchy,
density, grid logic, dividers, colour, navigation, labelling, and interaction states. It does
not dictate the interaction model — a festival marketing site and a live instrument have
different jobs.

---

## 2. Reference Sources and Method

**Reference site:** https://sonar.es/en (Sónar Barcelona festival site).

**Pages / states inspected (2026-07-17):**

| Page / state | URL | What it informed |
|---|---|---|
| Homepage (post-festival hero) | `/en` | Display type, nav, logo geometry, colour, buttons |
| News list | `/en/news` | Content grid, list rows, metadata, dividers, card treatment |
| Navigation | (global) | Utility + main nav, active/hover states, search |
| Viewport 1280 & 1600 | (both above) | Fixed vs fluid layout behaviour |

**Method:** Ran `getComputedStyle` probes over the live DOM for font families, sizes, weights,
line-heights, letter-spacing, colours, borders, radii, padding, gaps, grid templates, and
transitions. Preferred computed values over visual guesses. Resized the viewport to distinguish
fixed from fluid layout. Hovered navigation to sample interaction state. A news article detail
page (`/en/news/preventa-2027`) failed to load in time (nav timeout) and was **not** inspected;
article long-form body hierarchy is therefore marked Inferred where it appears.

**Explicitly excluded as non-system (third-party / campaign):**
- **UserWay accessibility widget** — `uw-*` classes, the yellow `#FFF300` 3px "reading guide"
  outline, and the round accessibility button (bottom-left). This is an injected third-party
  overlay, **not** Sónar's design language. Do not treat `#FFF300` as a system token.
- **Estrella Damm sponsor logo** (red, top-right) — sponsor brand asset, not a system colour.
- A one-off navy `#34394D` surface (single occurrence) — treated as campaign, excluded from base.

No proprietary fonts, logos, images, or other copyrighted assets were downloaded or are
redistributed here. Type recommendations below use open-source substitutes.

---

## 3. Core Design Principles

Each principle is an actionable rule, not an adjective.

1. **Fixed editorial measure, not fluid stretch.** [Observed] The reference content column is a
   fixed **1200px max-width, centred**; at 1600px viewport it stayed 1200px and the extra space
   became margin. → In the app, lay out on a fixed content measure and let the window chrome
   absorb extra width; do not let panels stretch arbitrarily wide.

2. **Big type is medium-weight; small type is heavy.** [Observed] Display/hero text is weight
   **500** at 48px, while 12px micro-labels are weight **900**. The contrast is inverted from the
   usual. → Reserve heavy weights (700–900) for *small* labels and status tags; keep large
   titles at medium (500). Never bold a 40px title to 900 "for emphasis."

3. **Square geometry.** [Observed] Corner radius is effectively **0** everywhere (only two
   incidental 50% icon circles). → All panels, buttons, steps, chips, and inputs are
   rectangular, radius 0. No rounded SaaS cards.

4. **Fine lines do the dividing, not shadows or fills.** [Observed] Separation is a **1px solid
   `#ECEDED`** hairline (light contexts) or a 1px near-black line (strong contexts). No drop
   shadows were observed. → Use 1px lines and shared edges to structure regions; avoid elevation
   shadows and filled container backgrounds where a line suffices.

5. **Sentence case, always.** [Observed] **0 of 789** text elements used `text-transform:
   uppercase`. → Labels, nav, buttons, and metadata are sentence case. Do not uppercase labels.

6. **Compressed, grid-aligned density.** [Observed] Padding and gaps snap to an **8px grid**
   (4/8/16/24/32/40/48/56/64), with 24px the default gap between content blocks. → Compose on an
   8px grid; prefer the tighter end of the scale for metadata clusters.

7. **Strong contrast between display graphics and small metadata.** [Observed] Large media and
   display type sit directly beside 12–14px metadata with no decorative framing. → Let one large
   focal element (waveform, active pattern, step grid) dominate, surrounded by small dense
   metadata; don't equalise their visual weight.

8. **Edge-to-edge media, hairline-bordered slots.** [Observed] News images fill their grid slot
   full-bleed inside a 1px `#ECEDED` rectangle with 0 padding and 0 radius. → Media (waveforms,
   pattern thumbnails) fills its cell to the hairline; framing is a line, not padding.

---

## 4. Design Tokens

All hex values are transcribed from computed `rgb()` values unless marked Inferred/estimate.

### 4.1 Color

| Token | Value | Tag | Source / use |
|---|---|---|---|
| `--ink` | `#171A1D` | [Observed] | `rgb(23,26,29)` — primary text & dark surfaces (dominant) |
| `--ink-pure` | `#000000` | [Observed] | Nav links, logo blocks, filled buttons |
| `--surface` | `#FFFFFF` | [Observed] | Content/body surface |
| `--canvas` | `#ECEDED` | [Observed] | `rgb(236,237,237)` — light grey page field behind content |
| `--canvas-2` | `#F3F4F5` | [Observed] | `rgb(243,244,245)` — slightly lighter grey surface |
| `--line-fine` | `#ECEDED` | [Observed] | 1px hairline dividers / slot borders |
| `--line-strong` | `#171A1D` | [Observed] | 1px strong borders, button outlines |
| `--accent` | `#E73E1C` | [Observed] | `rgb(231,62,28)` — Sónar red; used sparingly as accent fill. Verify systemic vs campaign before heavy use (§13) |
| `--overlay-hover` | `rgba(0,0,0,0.10)` | [Observed] | Subtle hover background wash |
| `--text-muted` | `#6B6F72` | [Inferred] | The site muted via **weight 300**, not a grey. A grey muted token is a Project adaptation for glance-reading; value is an estimate |

**Dark-mode / live surface [Project adaptation]:** The reference is a light-canvas site. A live
instrument in a dark room must not blast a white field. Invert the neutrals into a dark
operating theme while keeping the *relationships*:

| Token (dark) | Value | Tag | Note |
|---|---|---|---|
| `--canvas` | `#0E1012` | [Project adaptation] | Near-black room background, derived from `--ink` family |
| `--surface` | `#171A1D` | [Project adaptation] | Panel surface = the reference ink colour |
| `--line-fine` | `#2A2E31` | [Project adaptation] | Hairline at low contrast for dark |
| `--line-strong` | `#4A4F53` | [Project adaptation] | Structural lines |
| `--text` | `#ECEDED` | [Project adaptation] | Primary text = reference canvas grey |
| `--text-muted` | `#8A8F93` | [Project adaptation] | Muted metadata |
| `--accent` | `#E73E1C` | [Observed→adapted] | Sónar red carries over as the single accent |

> Rule: ship **one** accent (`--accent`), not a rainbow. State meaning (selected, live, armed)
> is carried by the accent + line-weight + fill, not by many hues. Exact dark values are a
> starting point to be tuned against a real screen in a dark room (§13).

### 4.2 Typography

**Family.** [Observed] Reference uses `"Helvetica Neue", -apple-system, system-ui, sans-serif`.
Helvetica Neue is proprietary and must not be bundled. **Substitutes:**
- Primary UI: **Inter** (open-source grotesque, neutral, full 300–900 weights incl. the heavy
  900 the micro-labels need). [Project adaptation]
- Metric-compatible alternative: **Arimo** (metrically matches Helvetica/Arial) if line-breaks
  must match the reference feel. [Project adaptation]
- Do not claim any substitute is Helvetica Neue.

**Numeric.** [Project adaptation] Use **tabular (monospaced) figures** for all step indices,
BPM, bar/beat counters, timers, and velocities so digits don't jitter during playback. The
reference did not require this; a live instrument does.

**Type roles** — sizes/weights/line-heights are [Observed] from the reference; role *names* and
their mapping to the instrument are [Project adaptation].

| Role | Size | Weight | Line-height | Letter-spacing | Case | Tag |
|---|---|---|---|---|---|---|
| Display (rare, hero) | 48px | 500 | 64px (1.33) | normal | sentence | [Observed] |
| Section title | 40px | 500 | 60px (1.5) | normal | sentence | [Observed] |
| Panel / item headline | 24px | 500 | 36px (1.5) | normal | sentence | [Observed] |
| Body | 16px | 400 | ~1.4 | normal | sentence | [Observed] |
| Nav / control label | 14px | 500 | ~1.3 | normal | sentence | [Observed] |
| Metadata / value | 14px | 300 | ~1.3 | normal | sentence | [Observed] |
| Caption | 12px | 400 | 16.8px (1.4) | normal | sentence | [Observed] |
| Micro-label / tag | 12px | 900 | ~1.3 | −0.2px | sentence | [Observed] |

**Conventions:**
- Case: sentence case only. No uppercase. [Observed]
- Weight discipline: heavy (900) only ≤12px; medium (500) for titles; light (300) for
  secondary metadata. [Observed]
- Alignment: left-aligned text; numeric columns right-align on the decimal for scan-reading.
  (left [Observed]; numeric right-align [Project adaptation])
- **Dates:** `DD/MM/YYYY` (e.g. `22/06/2026`). [Observed]
- **Times / bars [Project adaptation]:** `bar.beat` (e.g. `04.3`) and `mm:ss.mmm` for absolute
  time; step indices `01`–`16` zero-padded, tabular figures.

### 4.3 Spacing

[Observed] 8px base grid. Reusable scale:

```
--space-0: 0     --space-3: 16px   --space-6: 40px
--space-1: 4px   --space-4: 24px   --space-7: 48px
--space-2: 8px   --space-5: 32px   --space-8: 64px    --space-xl: 120px
```

- Default gap between content blocks: **24px** (`--space-4`). [Observed]
- Metadata clusters: **4–8px** internal gaps. [Observed]
- Section separation: 40–64px, or a hairline where space is tight. [Observed]
- Media slot padding: **0** (media goes to the hairline). [Observed]
- **Minimum interaction target [Project adaptation]:** 28×28px for dense controls (steps),
  36px min height for primary actions, despite the compressed look. Compression applies to
  *spacing and metadata*, never to a target the performer must hit reliably mid-set.

### 4.4 Grid

- Content measure: **1200px fixed, centred**; extra viewport width → side margins. [Observed]
- Reference content grid: **2 × 588px columns, 24px gap** (= 1200). [Observed]
- Page side margin at 1280 viewport: ~40px. [Observed]
- **App translation [Project adaptation]:** treat the workspace as a **fixed 12-column grid on a
  24px gutter** inside a fixed content measure. Regions (queue, timeline, sequencer, params,
  commit) occupy whole column spans and share hairline edges. Do not reflow region order
  responsively during a set — control positions must stay put (§9).

### 4.5 Borders and Geometry

- Corner radius: **0** on all system components. [Observed]
- Border width: **1px** standard. [Observed]
- Fine divider: 1px solid `--line-fine`. [Observed]
- Strong divider / outline: 1px solid `--line-strong`. [Observed]
- Buttons: **solid filled rectangle** (`--ink-pure` fill, white text) or 1px outlined
  rectangle; radius 0; no gradient, no shadow. [Observed]
- Focus ring [Project adaptation]: 2px `--accent` outline offset 1px (the reference's visible
  yellow ring was the excluded UserWay widget, so the app defines its own — see §9).

### 4.6 Motion

- Transition durations in use: **0.2s ease-in-out** and **0.3s ease-out**. [Observed]
- Hover: background wash to `rgba(0,0,0,0.10)` / underline on active nav. [Observed]
- No parallax, blur, or bloom in the base system. [Observed] (Atmospheric effects are deferred
  to §12.)
- **Live-state feedback [Project adaptation]:** playback/active indicators use a steady or
  1-bar-synced pulse, never a free-running animation that competes with the music. Respect
  `prefers-reduced-motion` (§9).

---

## 5. Information Hierarchy

[Observed] on the reference, [Project adaptation] in mapping:

1. **One focal display element** per view (reference: hero image/title; app: the active
   pattern's step grid or waveform), rendered large and full-bleed to a hairline.
2. **Headline** (24px/500) names the current object (pattern name, destination track).
3. **Metadata row** (12–14px, light or heavy micro-labels) carries dense attributes: source,
   bars, BPM, velocity range, timestamp — sentence case, tabular numbers.
4. **Controls** sit in their own bordered region, visually subordinate to the focal element but
   with full-size targets.
5. Contrast is achieved by **size and weight**, not colour. Colour (`--accent`) is reserved for
   *state* (selected / live / armed), not for hierarchy.

Rule: a state title (active pattern name) may span several grid columns and use a display scale
**≥4× the metadata label size** (e.g. 48px title vs 12px label). [Observed ratio: 48/12 = 4×.]

---

## 6. Layout Rules

- Fixed content measure; regions are whole-column, hairline-separated, edge-sharing. [Observed]
- Full-bleed media inside hairline slots; 0 slot padding. [Observed]
- 24px default gutter; 8px grid for everything else. [Observed]
- No rounded containers, no shadows, no nested card stacks. [Observed]
- Large type and media may cross column boundaries deliberately (the reference lets 48px
  headlines and images span multiple columns) — use this for the active pattern to make it
  unmistakably the focus. [Observed]
- **App translation:** persistent region skeleton (queue / overview / timeline / sequencer /
  params / commit / status) that never reflows during use; only the *contents* of a region
  change. [Project adaptation]

---

## 7. Component Rules

### 7.1 Navigation
- [Observed] Two tiers: a small **utility bar** (12px/400 links, secondary destinations) above a
  **main bar** (14px/500 links with dropdown chevrons) beside a logo block and a search field.
  Active item = underline. Hover = subtle wash. Sentence case.
- [Project adaptation] The app's equivalent is a **fixed top command strip**: mode/section
  switches (Browse / Edit / Commit), global transport/status, and OSC-connection indicator.
  Active mode = underline + `--accent`; positions are fixed, keyboard-selectable. No dropdowns
  for anything needed mid-performance (dropdowns hide state).

### 7.2 Pattern Queue
- Model on the reference **news list**: [Observed] a column of hairline-bordered slots, each
  with a full-bleed thumbnail (here: a mini step/velocity preview), a light metadata line
  (`DD/MM/YYYY`, source), and a 24px/500 headline (pattern name).
- [Project adaptation] Incoming items get an **Incoming** state treatment (§8.1). Rows are dense
  (8–16px internal), fixed-height, keyboard-navigable, and never reorder under the cursor.
  Selected row = 1px `--line-strong` left edge + `--accent`; do not rely on hue alone (add the
  edge weight).

### 7.3 Timeline
- No direct reference analog. [Project adaptation grounded in reference geometry]: a full-width
  region on the fixed grid, hairline-ruled at bar boundaries (1px `--line-fine`), heavier line
  (`--line-strong`) at section boundaries. Selection range = `--accent` fill at low opacity with
  1px `--accent` edges. Playhead = 1px solid `--accent`, no glow (base). Numbers tabular.

### 7.4 Sequencer (16-step)
- [Project adaptation grounded in reference geometry]: 16 **square, radius-0** cells on the 8px
  grid, separated by 1px hairlines, grouped 4+4+4+4 with a slightly heavier line every 4 steps
  (beat grouping) — mirrors the reference's fine-grid + occasional strong-line logic.
- Step states: empty (surface), active (filled `--ink`/`--accent`), accent/velocity (fill
  intensity or a top hairline), current-step (1px `--accent` border). Minimum cell 28×28px.
- No rounded steps, no drop shadow, no skeuomorphic pads.

### 7.5 Parameter Controls
- [Project adaptation]: labels 14px/500 sentence case; live value 14px tabular, right-aligned;
  label-to-control gap 8px. Controls are rectangular (linear sliders / numeric fields), radius
  0, 1px border. Follows the Plugin Host `ParamHandle` model
  ([plugin-host-spec.md](plugin-host-spec.md)): display string from Live, raw value for
  position. Compact rows (32–36px) but full-size hit targets.

### 7.6 Buttons and Actions
- [Observed]: solid filled rectangle, `--ink-pure` bg + white text, radius 0, no shadow; or 1px
  outlined rectangle for secondary. Sentence case label.
- [Project adaptation] **Commit** is the one destructive/irreversible action and gets deliberate
  friction (§8.5): distinct fill (`--accent`), larger target (≥36px), and an armed→confirm
  two-step. Never a bare one-click button adjacent to browse controls.

### 7.7 Status and Feedback
- [Project adaptation]: a persistent status strip. **OSC connection** shows one of
  connected / disconnected / live-down / not-installed (mirrors the diagnostics in
  [osc-reference.md](osc-reference.md)). Connected = `--text-muted` dot + label; error =
  `--accent` + explicit text (never a bare red dot). 12px/900 micro-label + 12px value.

---

## 8. Interaction States

### 8.1 Incoming
[Project adaptation] New queue items arrive with a brief 0.2–0.3s ease entrance (reference
durations) and an **Incoming** micro-label (12px/900). No blur/bloom in base (that is the §12
extension point). Unread/incoming = 1px `--accent` left edge until browsed.

### 8.2 Browsing
[Observed→adapted] Hover = subtle wash (`--overlay-hover` in light / a low-opacity `--accent`
wash in dark); keyboard focus = 2px `--accent` ring. Selected row is persistent and distinct
from hover (edge weight + accent, not wash alone).

### 8.3 Previewing
[Project adaptation] Previewing a pattern marks it with a steady `--accent` indicator and a
**Preview** micro-label; playback position may animate on the mini-preview but syncs to the beat,
not free-running. Preview must be visually distinct from Committed/live.

### 8.4 Editing
[Project adaptation] Edit mode shows the focal step grid/timeline at full size; edited-but-
uncommitted state = a 1px `--accent` dashed edge or a "modified" micro-label so the performer
knows changes are not yet live.

### 8.5 Committing
[Project adaptation] Two-step: **Arm** (button enters armed state, `--accent` fill, target grows
to ≥36px) → **Confirm**. On commit, a brief confirming flash (≤0.3s) and the destination row
updates. This is the single most important safeguard (§9). Never auto-commit on selection.

### 8.6 Error and Disconnected
[Project adaptation] Maps to real OSC failure modes from
[osc-reference.md](osc-reference.md): Live not running / AbletonOSC not installed / installed but
unresponsive / port in use. Each shows an **explicit sentence-case message** in the status strip
with the concrete next step, `--accent` marker, and disables Commit until resolved. No silent
failure, no bare icon.

---

## 9. Accessibility and Live-Use Requirements

- **Low-light:** default to the dark operating theme (§4.1); avoid large white fields.
  [Project adaptation]
- **Peripheral / glance reading:** state is legible from size + weight + accent, not hue alone;
  every colour-coded state also carries a shape/weight/label cue (colour-blind safe).
  [Project adaptation]
- **Stable control positions:** regions never reflow or reorder during a set; controls keep
  fixed screen positions. [Project adaptation, contra responsive web behaviour]
- **Unambiguous selected/active/live states:** selected ≠ hover ≠ live ≠ committed; each has a
  distinct, persistent treatment (§8). [Project adaptation]
- **Focus indication:** 2px `--accent` focus ring, offset 1px, on every interactive element.
  (The reference's visible ring was a third-party widget; the app owns its focus style.)
  [Project adaptation]
- **Keyboard navigation:** full keyboard operation of queue, steps, params, and the
  arm→commit flow. [Project adaptation]
- **Reduced motion:** honour `prefers-reduced-motion`; disable entrance/pulse animations, keep
  instant state changes. [Project adaptation]
- **Legibility during playback:** tabular figures; no animation on numeric readouts that would
  blur them; contrast target ≥ 4.5:1 for text, ≥ 3:1 for UI lines against their surface.
  [Project adaptation]
- **Avoiding accidental Commit:** arm→confirm two-step, enlarged target, spatial separation from
  browse controls, disabled while disconnected. [Project adaptation]

---

## 10. Responsive and Window-Sizing Behavior

- The reference uses a **fixed 1200px content measure**; width beyond that becomes margin, and
  the display type does **not** scale up. [Observed]
- **App translation [Project adaptation]:** design for a fixed content measure (target
  ~1280–1600px window). Extra width → margins/side rails, not stretched regions. Below the
  target width, prefer scrolling a region or collapsing *secondary* metadata over reflowing the
  primary layout. Never reorder primary regions on resize (control-position stability, §9). No
  mobile/touch breakpoint is in scope.

---

## 11. Do / Do Not

**Do**
- Use 1px hairlines and shared edges to structure the interface. [Observed]
- Keep radius 0 and geometry square. [Observed]
- Use sentence case everywhere. [Observed]
- Put heavy weight on *small* labels, medium weight on large titles. [Observed]
- Snap spacing to the 8px grid; default 24px block gap. [Observed]
- Reserve the single accent for *state*, not decoration. [Project adaptation]
- Use tabular figures for all numerics. [Project adaptation]

**Do Not**
- Do not use rounded "SaaS cards," drop shadows, or elevation. [Observed contra]
- Do not uppercase labels. [Observed]
- Do not bold large titles to 900. [Observed]
- Do not add blur/bloom/WebGL to base components (see §12). [Project constraint]
- Do not treat `#FFF300` (UserWay) or the sponsor red as system colours. [Method]
- Do not let regions reflow/reorder or controls move during a performance. [Project adaptation]
- Do not one-click Commit. [Project adaptation]
- Do not describe or build this as a website/dashboard/card grid. [Project constraint]

---

## 12. Future Style Extensions

These are named influences to layer **on top of** the sharp base system later. They are **not**
part of the base component rules and must not soften the operational interface in this pass.

- **MIRA** (compressed editorial): tighter padding, finer grid lines, sharper layout
  interruptions, narrower metadata columns. Extends §3/§4.3 by pushing density further. Extension
  point: a "compact" density variant of the spacing scale.
- **The Infinite Now** (atmospheric): blur, bloom, exposure shifts, light leaks, and
  transitional glows — tied specifically to **Incoming**, **Preview**, and **Commit** state
  transitions (§8.1/§8.3/§8.5). Extension point: a state-transition effect layer that reads the
  same state tokens but renders atmospheric feedback. **Base components stay flat and sharp;**
  atmosphere is an optional overlay keyed to those three moments only, and must respect
  `prefers-reduced-motion`.

Structural system first; atmosphere as a clearly-scoped, reduced-motion-aware overlay.

---

## 13. Evidence, Inferences, and Open Questions

**Directly observed (high confidence):** font family (Helvetica Neue stack), the full type scale
(48/40/24/16/14/12 with weights 300–900), sentence-case rule (0/789 uppercase), square geometry
(radius 0), 1px `#ECEDED` hairlines and near-black strong lines, filled square buttons, fixed
1200px centred measure with 2×588+24 grid, 8px spacing grid, colours `#171A1D`/`#000`/`#FFF`/
`#ECEDED`/`#F3F4F5`/`#E73E1C`, hover wash `rgba(0,0,0,.1)`, transitions 0.2s/0.3s, date format
`DD/MM/YYYY`.

**Inferred (needs confirmation):**
- The exact page-canvas grey — root elements reported white/transparent while a grey field is
  clearly visible; used `#ECEDED` from the surface scan as best estimate.
- A distinct muted-grey *text* token — the reference muted via weight 300, not a grey; the grey
  muted value is an app estimate.
- Article/long-form body hierarchy — the detail page failed to load; body role values come from
  list-page paragraphs.
- Whether `#E73E1C` red is a systemic accent or campaign-specific (seen only on 2 elements).

**Open questions requiring a design decision before implementation:**
1. **Theme:** confirm the dark operating theme (§4.1) and tune the exact dark values against a
   real screen in a dark room. The reference is light; the inversion is a Project adaptation.
2. **Accent semantics:** is `--accent` (Sónar red) acceptable as the single state colour, or do
   selected/live/armed/error need to be distinguishable from each other (they currently share
   hue and differ by weight/shape/label)? A live tool may want live vs armed vs error visually
   separated.
3. **Condensed type:** the reference is not condensed; do we want a condensed face (MIRA
   direction, §12) for dense metadata, or keep Inter throughout?
4. **Density variant:** confirm minimum target sizes (28px steps / 36px actions) against the
   real performance surface and pointer (mouse vs trackpad vs controller).
5. **Numeric formats:** confirm bar/beat and time formats (§4.2) against the sequencer/timeline
   model.
6. **File location:** this doc lives at `ableton-ctrl/docs/design.md` alongside the other specs;
   confirm whether it should instead sit at repo root.

No implementation should begin until these are resolved and this `design.md` is approved.
