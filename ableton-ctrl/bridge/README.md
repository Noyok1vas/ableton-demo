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

## Notes / limits

- Only one process may bind the OSC receive port (11001). Stop `ping.py`/`discover.py` before running the bridge, or you'll get `EADDRINUSE`.
- The bridge re-checks the connection every 2 s and reports `Live not running` / `AbletonOSC not installed` / `Live not responding` to the status bar. The browser auto-reconnects when the bridge (re)starts.
- WebSocket port `8722`, MIDI note `C3`, note length `150 ms` are constants at the top of [bridge.py](bridge.py).
