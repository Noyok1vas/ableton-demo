#!/usr/bin/env python3
"""Find which MIDI port your controller's pads send on.

    uv run bridge/midi_monitor.py

Opens every MIDI input (except our own virtual port) and prints each incoming
message with the port it came from. Hit a pad on your Move (or any controller)
and note which port shows a "note on" — then start the bridge pinned to it:

    RHYTHM_MIDI_PORT="<that port name>" uv run bridge/bridge.py

Ableton Move exposes several ports (Live / User / External / Standalone); this
tells you which one carries pad notes in your current Move mode.
"""

from __future__ import annotations

import time

import rtmidi

SELF_PORT = "Rhythmic Intent"  # our own virtual output — skip it


def describe(message: list[int]) -> str:
    status = message[0] & 0xF0
    if status == 0x90 and len(message) >= 3 and message[2] > 0:
        return f"note on  pitch={message[1]} vel={message[2]}"
    if status == 0x80 or (status == 0x90 and len(message) >= 3 and message[2] == 0):
        return f"note off pitch={message[1]}"
    if status == 0xB0 and len(message) >= 3:
        return f"cc {message[1]}={message[2]}"
    return f"raw {message}"


def main() -> None:
    ports = rtmidi.MidiIn().get_ports()
    targets = [(i, name) for i, name in enumerate(ports) if SELF_PORT not in name]
    if not targets:
        print("No external MIDI inputs found. Plug in your controller and retry.")
        return

    print("Listening on:")
    handles = []
    for index, name in targets:
        mi = rtmidi.MidiIn()
        mi.open_port(index)
        mi.ignore_types(sysex=True, timing=True, active_sense=True)
        mi.set_callback(lambda event, data, n=name: print(f"  [{n}]  {describe(event[0])}"))
        handles.append(mi)
        print(f"  - {name!r}")
    print("\nHit a pad… (Ctrl-C to quit)\n")

    try:
        while True:
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        for mi in handles:
            mi.close_port()


if __name__ == "__main__":
    main()
