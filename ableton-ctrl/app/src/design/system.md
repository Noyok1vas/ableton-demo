# Design system — the iPad instrument

The demo is one fixed device, upright: a square **screen** over a **deck** of
eight square pads, heights 2:1. The deck never changes. Everything that
changes happens on the screen. Values live in `tokens.css`; this file is the
rules.

## 1. The device

```
┌──────────── 1024u ────────────┐
│                               │
│   Screen   1024 × 1024u       │  software: black frame
│                               │
├───────────────────────────────┤
│ pad │ pad │ pad │ pad │ 512u  │  hardware: grey frame
│ pad │ pad │ pad │ pad │       │  pads 224u, square
└───────────────────────────────┘
```

- **Device units (u):** CSS px on the 1024×1536 device. `DeviceShell` scales
  the whole device as one piece to fit the viewport inside the safe area, and
  centres it.
- **Scale:** 11" iPad Pro ≈ 0.78 (1u ≈ 0.78pt). 13" ≈ 0.89. 10th-gen iPad ≈ 0.77.
- **Portrait only.** On a touch device in landscape the device is hidden and a
  "turn upright" note shows instead. A desktop browser always sees the device,
  fitted.
- **No canvas.** Nothing pans, zooms or drags. Pinch and double-tap zoom are
  blocked.

## 2. Tokens

The whole device is **white on black**. Marks (the ring, the pad sounds) are
still drawn as black ink and shown through `filter: invert(1)` on their
canvases, so the drawing code is untouched.

| Group | Tokens |
|---|---|
| Colour | `--surface` black · `--surface-2` dark-grey fill · `--line-fine` hairline · `--line-strong` / `--text` / `--ink-pure` white · `--text-muted` · `--hw-line` hardware frame |
| Touch | `--hit-min` 56u (44pt) · `--hit-gap` 12u · `--circle` 72u · `--pill-h` 80u · `--edge` 24u |
| Type | `--type-xs` 18u (the smallest) · `-s` 22 · `-m` 28 · `-l` 40 · `-xl` 72 |
| Space | `--space-1…8`: 4 / 8 / 16 / 24 / 32 / 40 / 48 / 64u |
| Stroke, radius | 1u hairline · 1.5u for outer shapes · 0 inside · 40u pills and panels |
| Motion | press 90ms · fast 150ms · base 250ms · quiet 400ms · long-press 400ms |

**Colour is state, never decoration.** White filled = on. Grey fill = selected
or auditioning. Muted = disabled. Nothing is coloured.

## 3. Comfort and reach

- Nothing pressable is smaller than **56u**. Neighbours that aren't joined are
  at least **12u** apart.
- Joined controls (− value +, ‹ meter ›, /2 /4 /8 /16) share one hairline
  border and count as one target per segment.
- Every action fires on **press** for pads and on **release** for screen
  buttons. A pad must land on time; a screen button can be slid off.
- Nothing depends on hover: a touch leaves hover stuck. Hover styles go in
  `@media (hover: hover)` only.
- The screen's top and bottom rows sit `--edge` inside the frame, away from
  the edges where iPadOS gestures start. The deck sits inside the safe area.
- Several pads can be held at once. The deck uses `touch-action: none`.

## 4. Components

| Component | Shape | States |
|---|---|---|
| `CircleButton` (`.ms-circle`) | 72u circle, 1.5u ink | default · pressed · on (filled) · disabled (grey) |
| `PillBar` (`.tp-bar`) | 80u pill, 1.5u ink | quiet (20%) while you play |
| `Square` (`.tp-btn`) | 56u square, 1u ink | default · on · disabled |
| `Stepper` | square − value square +, joined | — |
| `Segmented` | joined squares, one on | — |
| `ScreenPanel` (`.ms-panel`) | 400u wide, 40u radius, floats in the screen | one open at a time |
| `TouchStrip` (`.mod-track`) | 72u wide pill, filled from the bottom | disabled when the sound has no axis |
| `Pad` (`.sel-button`) | 224u square, grey hairline | selected · flash (inverted) · recording · audition (grey) |
| `Toast` (`.ms-toast`) | small inverted bar on the screen | — |

## 5. How the screen changes

```
L0  Ring sequencer — always underneath
     top row     +  new pattern · [transport] · ↶ undo
     bottom row  ≡  Collection ·············· ⚙ Settings · ✦ guide
L1  One panel at a time: Collection (left) · Settings (right)
     or the audition view (the sound large, a strip on each side)
L2  Guide hints · toasts
```

- The circle buttons are the fixed anchors. Pressing a lit one closes its
  panel. Escape closes it too.
- **Pads always play.**
  - A tap records into the loop.
  - A **long press** (400ms) auditions instead: the note it already played is
    taken back out of the loop. The screen shows that sound large, with a
    velocity strip on the left and a character strip on the right. The loop
    pauses.
  - While the audition view is up, any pad press auditions. The view stays
    for 2s after the last touch of a pad or strip, then the loop resumes.
- Master Control and FX are not drawn. Their sessions still run.
