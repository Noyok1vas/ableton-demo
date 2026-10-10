# Drum Machine Block Study

An interactive Three.js tool for exploring the **3D topology, proportions and hardware layout** of a compact
professional drum machine / synth. Everything is modelled at real scale in millimetres. You can export the chosen
layout to **Rhino (.3dm)** as separate, layered, editable solids.

The device always has four fixed feature groups:

| Group | What it is | Rhino layer |
|---|---|---|
| Screen | Square display, active area ≥ 100 × 100 mm, with cover glass and bezel | `SCREEN` |
| Drum pads | 8 pads in one fixed **4 × 2 block** (moves and rotates as one, never split) | `DRUM_PADS` |
| Shape control | One continuous control: **touch strip** or **physical slider** | `SHAPE_CONTROL` |
| Mode buttons | Persistent transport / mode keys (Play, Rec, Metro, Undo, Shift, …) | `MODE_BUTTONS` |

The look is a neutral CAD block study (grey chassis, dark screen, plain controls), not a rendering.

## Running it

`index.html` is a single self-contained file. **Double-click it** to open it in a browser, or serve the folder
(`npx serve .`). It needs an internet connection the first time, because it loads
[three.js r180](https://www.npmjs.com/package/three/v/0.180.0) and
[rhino3dm.js 8.17.0](https://www.npmjs.com/package/rhino3dm/v/8.17.0) from `cdn.jsdelivr.net`.
rhino3dm (≈ 2.6 MB WASM) loads only when you first export.

Your last layout and view settings are kept in the browser's local storage.

## Using it

- **Panel (left).** Each section edits one group: slider + exact number field, all in mm.
  Hover a dotted label to see the reasoning behind its default.
- **Presets.** Pick one of five layouts. The thumbnails are drawn from the same geometry model.
  - *Screen above pads* (default, 230 × 240): portrait; screen and vertical strip over the pads, transport row between them
  - *Screen left / pads right* (300 × 160): landscape; pads, horizontal strip and transport row on the right
  - *Pads left / screen right* (300 × 160): mirror of the above
  - *Compact stacked* (180 × 200 × 24): 100 mm screen; strip and button column beside it; 28 mm pads
  - *Asymmetric* (260 × 190 × 34): 120 mm screen top-left, vertical 90 mm fader as a divider, pads rotated to 2 × 4

  **Mirror layout L ↔ R** flips any layout. **Shrink-wrap chassis to parts** resizes the chassis to fit the parts
  plus margins, and re-centres them.
- **Viewport.**
  - Drag a part to move it (snaps to 0.5–10 mm). Drag the background to orbit, right-drag to pan, scroll to zoom.
  - Arrow keys nudge the selected part 1 mm (⇧ 10 mm). Ctrl/⌘ Z and ⇧ Z undo and redo.
  - Views: Iso / Top / Front / Right, with a perspective ↔ orthographic toggle.
  - **X-ray** makes the chassis see-through so you can inspect the mechanical envelopes. **Cut-outs** shows the
    panel opening curves. You can also toggle dimensions, labels and the grid.
- **Checks (top right).** These update live:
  - visible parts closer to the chassis edge than *Edge margin*
  - envelopes closer to the skin than *Wall thickness*
  - parts that overlap, or sit closer together than *Min. part gap*, on the panel
  - envelopes that collide under the panel
  - envelopes deeper than *height − wall*
  - panel webs between pad or button openings thinner than *Min. panel web*

  Parts with problems get red (error) or amber (warning) edges. Click an item to select the part.
- **Top bar.** Undo / Redo · Reset (default layout) · Load JSON · Save JSON · **Export .3DM**.

## Coordinates and conventions

These match Rhino:

- **X** = width (left → right), **Y** = depth (front → back), **Z** = up. The origin is the chassis centre; the chassis bottom is at Z = 0 and the top surface at Z = height.
- Each part's `x` / `y` is its centre relative to the chassis centre. +Y is towards the back, so in the Top view the back is at the top.
- Shape-control `angle`: 0° = horizontal (along X), 90° = vertical (along Y).
- Pads are numbered MPC-style: pad 1 is front-left, then left → right and front → back (in both orientations).

## Visible vs. mechanical geometry

For each part the model keeps what you see on the panel separate from what it needs underneath:

| Part | Visible (on panel) | Mechanical envelope (below panel) |
|---|---|---|
| Screen | Cover glass = active area + 2 × bezel; active-area outline | Display module = active + 2 × *module margin*, *module depth* deep |
| Pad | Cap (w × h, radius, *cap rise*); opening = cap + *panel gap* | Footprint = cap + 2 × *skirt / sensor* (silicone skirt + FSR), *footprint depth* deep |
| Touch strip | Strip L × W (visible = active length) | (L + 2 × *extra per end*) × *envelope width* × *envelope depth* |
| Physical slider | Slot (L + slot width), knob, knob sweep (L + knob length) | Slide-pot body (L + 2 × *extra per end*) × *envelope width* × *envelope depth* |
| Mode button | Cap; opening = cap + *panel gap* | Switch envelope = cap + 2 × *switch margin*, *switch depth* deep |

Pad cap geometry presets set the corner radius:

| Choice | Corner radius |
|---|---|
| Square | 0 |
| Rounded | 12.5 % of the short side (editable) |
| Very soft | 32 % of the short side (editable) |
| Circle | Diameter = pad width |
| Pill | Half the short side |

## Rhino export (.3dm)

Export uses rhino3dm.js in the browser. The file contains:

- **Units:** millimetres; absolute tolerance 0.01 mm. Every position and dimension matches the tool 1 : 1.
- **Geometry:** every part is its own **closed solid**, built as an exact planar profile (true lines and arcs, or a
  circle) and extruded to its height. Choose Breps (closed polysurfaces, the default) or lightweight Extrusion
  objects. No meshes are exported.
- **Layers:**
  ```
  CHASSIS
  SCREEN          ::ACTIVE_AREA  ::PANEL_OPENINGS  ::MECH_ENVELOPE
  DRUM_PADS       ::PANEL_OPENINGS  ::MECH_ENVELOPE
  SHAPE_CONTROL   ::PANEL_OPENINGS  ::TRAVEL  ::MECH_ENVELOPE
  MODE_BUTTONS    ::PANEL_OPENINGS  ::MECH_ENVELOPE
  ```
- **Names:** `CHASSIS_BODY`, `SCREEN_GLASS`, `PAD_01` … `PAD_08`, `PAD_03_FOOTPRINT`, `SHAPE_TOUCH_STRIP` /
  `SHAPE_FADER_CAP`, `BTN_01_PLAY`, `BTN_01_PLAY_SWITCH_ENVELOPE`, …
- **Groups:** `DRUM_PAD_BLOCK_4x2` (the 8 pads), `MODE_BUTTON_GROUP`, `SHAPE_CONTROL`.
- **Panel openings** are closed curves on the top surface. rhino3dm has no booleans, so the chassis isn't cut.
  In Rhino, extrude the opening curves through the panel and `BooleanDifference`, or `Split` the top face.
- **Traceability:** the full JSON configuration is stored as document user text `DrumBlockStudy.config`
  (see `GetDocumentUserText` in Rhino).
- **File version:** Rhino 7 by default (opens in Rhino 7 and 8); Rhino 8 is available.
- Mechanical envelopes, opening curves and guide curves can each be switched off in the panel's *Rhino export*
  section.

## Configuration JSON

**Save JSON** writes:

```json
{
  "format": "drum-block-study", "version": 1, "units": "mm", "savedAt": "…",
  "config": {
    "chassis": { "width": 230, "depth": 240, "height": 32, "cornerRadius": 14, "wall": 2.5, "edgeMargin": 8 },
    "screen":  { "size": 110, "bezel": 4, "cornerRadius": 3, "x": -12.5, "y": 45, "rise": 0.8, "moduleMargin": 6, "moduleDepth": 6 },
    "pads":    { "x": 0, "y": -75, "orientation": "landscape", "padW": 32, "padH": 32, "spacing": 5,
                 "capShape": "rounded", "cornerRadius": 4, "rise": 3.5, "clearance": 0.5, "flange": 2.5, "depth": 8 },
    "shape":   { "type": "strip", "x": 65.5, "y": 45, "angle": 90, "length": 80, "width": 12, "…": "…" },
    "buttons": { "labels": "PLAY, REC, METRO, UNDO, SHIFT", "arrangement": "row", "w": 12, "h": 12, "…": "…" },
    "rules":   { "minGap": 4, "minWeb": 1.2 }
  }
}
```

**Load JSON** accepts this file or a bare `config` object. Missing keys fall back to the defaults, and out-of-range
values are clamped to the slider ranges. Enums: `capShape` ∈ `square | rounded | soft | circle | pill`;
`orientation` ∈ `landscape | portrait`; `shape.type` ∈ `strip | fader`; `arrangement` ∈ `row | column | grid`.

## Dimension research → ranges and defaults

The brief's starting ranges are kept as slider limits. The defaults and envelope allowances come from these
reference parts and products. Values marked *assumed* are engineering estimates, not sourced figures; check them
against your chosen supplier parts.

| Item | Reference data | How it is used |
|---|---|---|
| Chassis | Elektron Digitakt 215 × 176 × 63 mm incl. knobs and feet ([midiamsterdam](https://midiamsterdam.nl/elektron-digitakt.html)); Akai MPC One 272 × 272 × 53 mm ([Chicago Music Exchange](https://www.chicagomusicexchange.com/en-mx/products/akai-professional-mpc-one-sampler-and-sequencer-1462111)) | W 180–320, D 140–240, H 15–45 |
| Square screen | 4.0″ 720 × 720 TFT: active 71.93 × 71.93 mm, module 84 × 85.99 × 3.76 mm ([displaymodule.com](https://www.displaymodule.com/products/products-4inch-720x720-tft-lcd-dmkdi0400s0ca)). Stock 5.6″ panels are 4:3: 112.9 × 84.7 active, 126.5 × 100 outline ([DLC0560AIG datasheet](https://www.digimax.it/media_import/DISPLAY/DLC%20DISPLAY/TFT%20LCD/DLC0560AIG-T/DLC0560AIG-T_DS_DLC0560AIG-T_001.pdf)) | Active area 100–140 mm. Module margin defaults to 6 mm per side (range 2–12), depth 6 mm (LCD ≈ 3.8 mm + touch / bonding, *assumed*). A ≥ 100 mm square screen (≈ 5.6″ diagonal) is larger than the stock square TFTs found and probably needs a custom or semi-custom panel. |
| Drum pads | Classic MPC pads ≈ 30 × 30 mm (forum measurement, not calipered — [MPC-Forums](https://www.mpc-forums.com/viewtopic.php?f=41&t=158889)). a Bax-shop review notes the MPC One pads are a touch smaller than earlier MPCs ([Bax-shop](https://bax-shop.co.uk/samplers/akai-professional-mpc-one-music-production-console)) | Pad 25–45 mm (default 32), spacing 3–10 mm (default 5). Silicone skirt / FSR margin 2.5 mm per side and depth 8 mm are *assumed* |
| Physical slider | Bourns PTA6043: 60 mm travel, 75 mm body length ([PTA datasheet mirror](https://www.alldatasheet.co.uk/html-pdf/160713/BOURNS/PTA/430/2/PTA.html)); distributor part listings give 9 mm width and 6.5 mm body height → body = travel + 2 × 7.5 mm. ALPS RS60N: 88 mm long for 60 mm travel, 132.6 mm for 100 mm, incl. mounting tabs ([RS](https://ph.rs-online.com/web/p/potentiometers/1727698)) | Travel 40–100 mm. Envelope defaults: 7.5 mm per end, 10 mm wide, 18 mm deep (lever + body + PCB, *assumed*). The panel shows the nearest stock travel (20 / 30 / 45 / 60 / 100 mm). |
| Touch strip | Spectra Symbol SoftPot 100 mm: 100 mm active, 140.6–146 mm overall incl. tail, 20–20.5 mm wide, 0.46 mm thick ([Cool Components](https://coolcomponents.co.uk/products/softpot-membrane-potentiometer-100mm), [SoftPot datasheet](https://www.mouser.com/datasheet/2/381/SOFTPOTDATASHEETREV%20F2-1203957.pdf)) | Visible 40–100 × 8–20 mm. Envelope defaults: 6 mm per end, width = strip + 6 mm, 3 mm deep (sensor + PCB, *assumed*). A membrane pot's tail needs a larger per-end allowance than a capacitive PCB strip. |
| Mode buttons | 12 × 12 mm tactile switches under ≈ 12 mm caps are common (*assumed*) | Cap 8–18 mm (default 12), gap 2–15 mm, switch envelope = cap + 2 mm per side, 6 mm deep |

## Limitations

- The chassis is a flat-topped slab with plan-view corner radii. It has no sloped top, edge fillets or feet.
- Parts are prismatic blocks: no cap top fillets, and the fader knob sits directly on the panel.
- Openings are exported as curves, not cut into the chassis (see *Rhino export*).
- rhino3dm's own `getBoundingBox()` on a Brep returns a padded box. The geometry itself is exact; Rhino's
  `BoundingBox` command gives the tight values.
