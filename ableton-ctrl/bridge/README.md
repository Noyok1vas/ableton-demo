# Rhythmic Intent bridge

Connects the browser GUI to Ableton Live. It runs on the **same machine** as Live and does two independent jobs:

| Job | How | Purpose |
|---|---|---|
| Play the selected instrument | Virtual MIDI port `Rhythmic Intent` | A TAP in the browser → a live MIDI note (C3) into Live |
| Show the selected instrument's name | AbletonOSC (UDP 11000/11001) | Reads the selected track and pushes its name to the status bar |

The split exists because **AbletonOSC has no live "note on" endpoint** (verified against the installed master — only clip note-writing exists), so audible per-tap hits must go over a real MIDI port instead.

```
browser app  ──WebSocket (8722)──▶  bridge.py  ──virtual MIDI──▶  Ableton (instrument sounds)
                                          └──────OSC 11000/11001──▶  Ableton (selected-track name)
```

## Run it

From the `ableton-ctrl/` directory:

```bash
uv run bridge/bridge.py
```

You should see:

```
virtual MIDI port open: 'Rhythmic Intent'
AbletonOSC connected
selected track [0] 1-AG Techno Kit
bridge up — ws://127.0.0.1:8722, MIDI port 'Rhythmic Intent'
```

Then open the app (`npm run dev` in `app/`). The status bar shows a filled dot and the selected track name once connected.

Prerequisites (already set up in this repo): AbletonOSC installed and enabled as a Control Surface, and `uv sync` has installed `websockets` + `python-rtmidi`.

## Live-side setup (needed to actually hear the taps)

The bridge creates the MIDI port, but Live has to be told to listen to it and route it to an instrument:

1. **Live → Settings → Link, Tempo & MIDI.** Under **MIDI Ports**, find the input **`Rhythmic Intent`** and turn its **Track** switch **On**. (It appears once the bridge is running.)
2. On the track whose instrument you want to play, set **MIDI From → `Rhythmic Intent`**, and channel to **All** (or Ch. 1).
3. Set that track's **Monitor** to **In** (always plays), or **Auto** and **arm** the track (record-enable).
4. Tap in the browser (or press Space) — you should hear the instrument on C3.

The status bar always reflects Live's **selected** track. To make "the selected instrument sounds when I tap", select + arm the track you want (Monitor = Auto). Notes always play on **C3 (MIDI 60)**; a future hardware pad will supply real pitch/velocity.

## Physical tap pad (Arduino, USB serial)

An Arduino running [arduino/rhythmic_tap/rhythmic_tap.ino](arduino/rhythmic_tap/rhythmic_tap.ino)
turns a piezo strike into a **velocity-sensitive** tap. Each hit plays a live
MIDI note *with the real velocity* and records a tap in the GUI (the dot size
tracks how hard you hit).

```
piezo ──▶ Arduino ──USB serial "TAP <1-127>"──▶ bridge ──▶ MIDI note (real velocity)
                                                     └────▶ WebSocket "tap" ──▶ GUI records it
```

Setup:

1. **Wire** a piezo: `+ → A0`, `- → GND`, a 1 MΩ resistor across it (A0–GND).
   (A 5.1 V zener from A0 to GND protects the ADC on hard hits.) A plain button
   to GND with `INPUT_PULLUP` works too — see the sketch header.
2. **Upload** `arduino/rhythmic_tap/rhythmic_tap.ino` (115200 baud). Tune
   `THRESHOLD` / `MAX_READING` to your piezo (enable `DEBUG` to watch raw peaks).
3. **Plug in** — the bridge auto-detects the board (`usbmodem`/`usbserial`/`ttyACM`…)
   and reconnects if you unplug it. Override the port with
   `RHYTHM_SERIAL_PORT=/dev/cu.xxxxx uv run bridge/bridge.py` if detection picks
   the wrong device.

When detected, the app's status bar shows a **PAD** tag. The GUI's on-screen TAP
button still works (uniform velocity); the pad is the velocity-sensitive input.
Needs `pyserial` (already in `uv sync`).

## MIDI tap controller (Ableton Move / any USB-MIDI pad)

Any USB-MIDI controller can drive taps instead of (or alongside) the Arduino:
each **note-on** becomes a tap, with the MIDI velocity as the hit strength. This
covers **Ableton Move** — connect it over USB-C and its velocity-sensitive pads
send note-on. Verified end-to-end (a note-on → a captured tap whose dot size
tracks velocity).

```
Move pad ──USB-MIDI note-on──▶ bridge ──▶ MIDI note (real velocity) + WebSocket "tap" ──▶ GUI
```

- The bridge **auto-attaches** to the first external MIDI input (it always
  skips its own `Rhythmic Intent` virtual port to avoid a feedback loop) and
  reconnects on unplug. When attached, the app shows a **MOVE** (or **MIDI**) tag.
- **Move exposes several ports** (Live / User / External / Standalone). Which one
  carries pad notes depends on Move's mode, and the bridge may not pick the right
  one by default. Find it with:

  ```bash
  uv run bridge/midi_monitor.py     # hit a pad, see which port shows "note on"
  ```

  then pin it:

  ```bash
  RHYTHM_MIDI_PORT="Ableton Move Live Port" uv run bridge/bridge.py
  ```

  (`RHYTHM_MIDI_PORT` matches any substring of the port name.)
- In Live's **Link/Tempo/MIDI** settings, leave the Move input's **Track** switch
  **off** — the bridge already routes taps to Live through `Rhythmic Intent`;
  enabling Track too would double the notes.

## WebSocket protocol

Browser → bridge:

```jsonc
{ "op": "tap",  "velocity": 1.0 }                       // one live note, velocity 0..1
{ "op": "loop", "events": [{ "pos": 0.0, "velocity": 1.0 }, …], "barDuration": 2.0 }
{ "op": "stopLoop" }
{ "op": "setPitch", "pitch": 36 }                       // MIDI pitch for future notes
{ "op": "setMacro", "name": "Energy", "value": 64, "scope": "selected" }
{ "op": "setMacro", "name": "Reverb", "value": 64, "scope": "all" }
```

Bridge → browser (besides `status`):

```jsonc
{ "type": "tap", "velocity": 0.79, "source": "pad" }    // a physical-pad hit; GUI records it
```

The `status` frame carries `"pad": true|false` (is the serial pad connected).
The GUI must **not** echo an `op:"tap"` back for a pad tap — the bridge already
played that note.

`loop` starts looping the given bar (`pos` is 0..1 within the bar) or — if already
looping — swaps the pattern while keeping bar phase, so knob tweaks and
collection loads apply mid-loop. **Note scheduling deliberately lives here, not
in the browser:** browser timers/rAF are throttled in background tabs, and during
a performance the browser sits behind Live. The bridge's asyncio scheduler keeps
firing regardless of tab visibility. The loop stops automatically when the last
client disconnects.

Bridge → browser: the `status` frames described above.

## Macros: mapping a GUI slider to a knob in Live

`setMacro` never assumes a device index or macro slot. The bridge scans the set
once (`num_tracks` → `num_devices` → `parameters/name` + `min`/`max`), caches
every parameter name and its range, and drives whichever parameter is
*literally* called `name` — so renaming a rack macro in Live is the whole
mapping step.

**Any device parameter works, not just rack macros.** The GUI always sends
0..127; the bridge scales that into the target's own range, so a name can point
straight at a stock device knob. FX's `REVERB` uses this: it drives the
parameter named **`Decay Time`** — Live's Reverb Decay knob, a 0..1 parameter —
with no rack around it. Slider 50 lands at 0.50 there, which Live shows as
`3.54 s` (the taper is Live's own, not ours).

`scope` decides what the knob belongs to:

- **`"selected"`** — an instrument property. The first device on the currently
  selected track with a parameter of that name. Sound Intent's `ENERGY` uses
  this: select a different track and the slider follows it.
- **`"all"`** — a property of the room. *Every* track carrying the name, written
  together, so one slider moves the whole set. The FX module's `REVERB` uses
  this.

**Live-side setup for FX / REVERB.** AbletonOSC reaches devices only through
`song.tracks` — it exposes nothing on the master or the return tracks (checked
against the installed master: no `master_track`/`return_tracks` handler exists).
So a "global" effect has to live on regular tracks: drop a **Reverb** on each
track that should share the room, and the slider drives every one of their
`Decay Time` knobs at once (scope `all`).

To move more than decay from the one slider, wrap the Reverb in an **Audio
Effect Rack**, rename a macro to the name the GUI sends, and map that macro to
Dry/Wet + Decay + Size together — the shape of each mapping is yours to draw in
Live. Renaming is only possible on rack macros, which is the only reason the
rack is ever needed.

The scan is refreshed when Live (re)connects and when the selected track
changes. Add a device mid-session and the bridge won't see it until one of those
happens — clicking another track and back is enough.

## Notes / limits

- Only one process may bind the OSC receive port (11001). Stop `ping.py`/`discover.py` before running the bridge, or you'll get `EADDRINUSE`.
- The bridge re-checks the connection every 2 s and reports `Live not running` / `AbletonOSC not installed` / `Live not responding` to the status bar. The browser auto-reconnects when the bridge (re)starts.
- WebSocket port `8722`, MIDI note `C3`, note length `150 ms` are constants at the top of [bridge.py](bridge.py).
