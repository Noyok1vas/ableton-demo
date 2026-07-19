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

## Notes / limits

- Only one process may bind the OSC receive port (11001). Stop `ping.py`/`discover.py` before running the bridge, or you'll get `EADDRINUSE`.
- The bridge re-checks the connection every 2 s and reports `Live not running` / `AbletonOSC not installed` / `Live not responding` to the status bar. The browser auto-reconnects when the bridge (re)starts.
- WebSocket port `8722`, MIDI note `C3`, note length `150 ms` are constants at the top of [bridge.py](bridge.py).
