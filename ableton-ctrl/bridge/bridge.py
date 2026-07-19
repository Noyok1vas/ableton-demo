#!/usr/bin/env python3
"""WebSocket ↔ (virtual MIDI + AbletonOSC) bridge for the Rhythmic Intent GUI.

Run this on the same machine as Ableton Live:

    uv run bridge/bridge.py

It does three things:

  1. Serves a WebSocket to the browser app (default ws://127.0.0.1:8722).
  2. Opens a virtual MIDI output port named "Rhythmic Intent". A TAP in the
     browser becomes a live MIDI note on that port, so whatever Live track is
     armed with this port as its MIDI input plays its instrument in real time.
  3. Talks OSC to AbletonOSC (send 11000 / receive 11001) only to read *which*
     track is selected and report its name to the browser.

Why the split: AbletonOSC has no live "note on" endpoint (verified against the
installed master — device.py/track.py/song.py expose only clip note-writing).
So audible per-tap hits go through the virtual MIDI port; OSC is used solely for
the selected-track name shown in the status bar.

Live-side setup is in bridge/README.md.
"""

from __future__ import annotations

import asyncio
import errno
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path

import rtmidi
import serial
import serial.tools.list_ports
import websockets
from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import AsyncIOOSCUDPServer
from pythonosc.udp_client import SimpleUDPClient

# Reuse the verified OSC constants and diagnostics from the scripts/ helpers.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from osc_common import (  # noqa: E402
    LIVE_HOST,
    RECV_PORT,
    SEND_PORT,
    diagnose,
    live_is_running,
    remote_script_installed,
)

WS_HOST = "127.0.0.1"
WS_PORT = 8722

MIDI_PORT_NAME = "Rhythmic Intent"
NOTE_PITCH = 60  # C3 in Ableton's convention — a fixed audition pitch.
NOTE_MS = 150  # how long each tapped note is held before note-off

HEARTBEAT_S = 2.0  # how often we ping /live/test
OSC_DOWN_S = 5.0  # no pong for this long → treat Live as disconnected

# Arduino tap pad over USB serial. Firmware in bridge/arduino/, protocol below.
SERIAL_BAUD = 115200
SERIAL_RETRY_S = 2.0  # how often to rescan for the pad when absent/unplugged
# Substrings of the serial device path that look like an Arduino, in order.
SERIAL_KEYWORDS = ("usbmodem", "usbserial", "wchusbserial", "ttyACM", "ttyUSB")

# MIDI tap controller (Ableton Move, or any USB-MIDI pad/keyboard). Its pads
# send note-on with velocity, which we treat as taps. Never listen to our own
# virtual output — it appears in the input list and would self-trigger.
MIDI_RETRY_S = 2.0

log = logging.getLogger("bridge")


MAX_LOOP_EVENTS = 128


def pick_midi_input(ports: list[str]) -> tuple[int, str] | None:
    """Choose a MIDI input for taps: RHYTHM_MIDI_PORT (substring match) if set,
    else the first external port. Our own virtual output is always excluded."""
    external = [(i, p) for i, p in enumerate(ports) if MIDI_PORT_NAME not in p]
    override = os.environ.get("RHYTHM_MIDI_PORT")
    if override:
        for i, p in external:
            if override.lower() in p.lower():
                return i, p
        return None
    return external[0] if external else None


def find_serial_port() -> str | None:
    """The pad's serial device: RHYTHM_SERIAL_PORT if set, else the first port
    whose name looks like an Arduino."""
    override = os.environ.get("RHYTHM_SERIAL_PORT")
    if override:
        return override
    try:
        ports = serial.tools.list_ports.comports()
    except Exception:  # noqa: BLE001
        return None
    for port in ports:
        if any(keyword in port.device for keyword in SERIAL_KEYWORDS):
            return port.device
    return None


def parse_serial_line(line: str) -> float | None:
    """Parse one line from the pad. `TAP <0-127>` → velocity 0..1, else None."""
    parts = line.strip().split()
    if len(parts) >= 2 and parts[0].upper() == "TAP":
        try:
            raw = int(parts[1])
        except ValueError:
            return None
        return max(0.0, min(1.0, raw / 127.0))
    return None

class Bridge:
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: set[websockets.ServerConnection] = set()

        self.osc_client = SimpleUDPClient(LIVE_HOST, SEND_PORT)
        self.osc_up = False
        self.last_pong = 0.0
        self.selected_index: int | None = None
        self.selected_name: str | None = None

        self.midi = rtmidi.MidiOut()
        # pitch → pending note-off timer, so a fast retap cancels the old release
        self.pending_off: dict[int, asyncio.TimerHandle] = {}

        # Loop playback. Scheduled here, not in the browser: browser timers are
        # throttled in background tabs, and during performance the browser tab
        # will be behind Live.
        self.loop_task: asyncio.Task[None] | None = None
        self.loop_events: list[tuple[float, float]] = []  # (pos 0..1, velocity), sorted
        self.loop_bar = 2.0  # seconds
        self.loop_t0 = 0.0  # event-loop time anchoring bar phase

        # Arduino tap pad (USB serial), read on a background thread.
        self.serial_thread: threading.Thread | None = None
        self.serial_stop = threading.Event()
        self.pad_connected = False

        # MIDI tap controller (Move / any USB-MIDI pad). Polled on its own thread.
        self.midi_in: rtmidi.MidiIn | None = None
        self.midi_in_thread: threading.Thread | None = None
        self.midi_stop = threading.Event()
        self.midi_in_name: str | None = None

    # ── MIDI ──────────────────────────────────────────────────────────

    def open_midi(self) -> None:
        self.midi.open_virtual_port(MIDI_PORT_NAME)
        log.info("virtual MIDI port open: %r", MIDI_PORT_NAME)

    def close_midi(self) -> None:
        self.stop_loop()
        for pitch in list(self.pending_off):
            self._note_off(pitch)
        if self.midi.is_port_open():
            self.midi.close_port()

    def tap(self, velocity: float, source: str = "tap") -> None:
        # velocity 0..1 → MIDI 1..127. GUI taps are uniform 1.0; a hardware pad
        # will supply real values later.
        vel = max(1, min(127, round(velocity * 126) + 1))
        # Retrigger cleanly: release any note still sounding on this pitch first.
        self._note_off(NOTE_PITCH)
        self.midi.send_message([0x90, NOTE_PITCH, vel])
        if self.loop is not None:
            self.pending_off[NOTE_PITCH] = self.loop.call_later(
                NOTE_MS / 1000, self._note_off, NOTE_PITCH
            )
        log.info("%s → note %d vel %d", source, NOTE_PITCH, vel)

    def _note_off(self, pitch: int) -> None:
        handle = self.pending_off.pop(pitch, None)
        if handle is not None:
            handle.cancel()
        self.midi.send_message([0x80, pitch, 0])

    # ── Loop playback ─────────────────────────────────────────────────

    def set_loop(self, events: list[tuple[float, float]], bar_duration: float) -> None:
        """Start looping, or swap the pattern mid-loop keeping bar phase."""
        assert self.loop is not None
        was_playing = self.loop_task is not None and not self.loop_task.done()
        self.loop_events = sorted(events)[:MAX_LOOP_EVENTS]
        self.loop_bar = min(30.0, max(0.25, bar_duration))
        if was_playing:
            self.loop_task.cancel()  # type: ignore[union-attr]  # restart against the new pattern
        else:
            self.loop_t0 = self.loop.time()  # fresh loop starts at the bar top
        self.loop_task = self.loop.create_task(self._run_loop())
        log.info("loop set: %d events, bar %.3fs", len(self.loop_events), self.loop_bar)

    def stop_loop(self) -> None:
        if self.loop_task is not None:
            self.loop_task.cancel()
            self.loop_task = None
            log.info("loop stopped")

    async def _run_loop(self) -> None:
        assert self.loop is not None
        events = self.loop_events
        bar = self.loop_bar
        if not events:
            return
        # Resume mid-bar (pattern swaps keep loop_t0): skip to the first event
        # still ahead of the current phase.
        now = self.loop.time()
        cycle = max(0, int((now - self.loop_t0) // bar))
        index = 0
        while index < len(events) and self.loop_t0 + (cycle + events[index][0]) * bar <= now:
            index += 1
        if index >= len(events):
            cycle += 1
            index = 0
        while True:
            pos, velocity = events[index]
            target = self.loop_t0 + (cycle + pos) * bar
            delay = target - self.loop.time()
            if delay > 0:
                await asyncio.sleep(delay)
            self.tap(velocity, source="loop")
            index += 1
            if index >= len(events):
                index = 0
                cycle += 1

    # ── Tap pad (USB serial) ──────────────────────────────────────────

    def _post(self, fn, *args: object) -> None:
        """Hand work from the serial thread back to the event loop thread."""
        if self.loop is not None:
            self.loop.call_soon_threadsafe(fn, *args)

    def serial_loop(self) -> None:
        """Background thread: find the pad, read `TAP` lines, hand them to the
        loop. Reconnects on unplug; scans again when no port is present."""
        while not self.serial_stop.is_set():
            port = find_serial_port()
            if port is None:
                self.serial_stop.wait(SERIAL_RETRY_S)
                continue
            try:
                ser = serial.Serial(port, SERIAL_BAUD, timeout=1.0)
            except (serial.SerialException, OSError) as exc:
                log.warning("pad: cannot open %s: %s", port, exc)
                self.serial_stop.wait(SERIAL_RETRY_S)
                continue

            log.info("pad connected on %s", port)
            self._post(self._set_pad_connected, True)
            try:
                while not self.serial_stop.is_set():
                    try:
                        raw = ser.readline()
                    except (serial.SerialException, OSError):
                        break  # unplugged mid-read
                    if not raw:
                        continue  # 1s read timeout — loop back to check the stop flag
                    velocity = parse_serial_line(raw.decode("ascii", "ignore"))
                    if velocity is not None:
                        self._post(self._on_pad_tap, velocity)
            finally:
                ser.close()
                log.info("pad disconnected (%s)", port)
                self._post(self._set_pad_connected, False)

    def _on_pad_tap(self, velocity: float) -> None:
        # Runs in the loop thread. The pad already carries a real velocity, so
        # the bridge both plays the note and tells the GUI to record the tap
        # (the GUI must NOT echo a tap back — that would double the note).
        self.tap(velocity, source="pad")
        self._send_soon({"type": "tap", "velocity": velocity, "source": "pad"})

    def _set_pad_connected(self, connected: bool) -> None:
        if self.pad_connected != connected:
            self.pad_connected = connected
            self._broadcast_soon()

    # ── MIDI tap controller (Move / USB-MIDI pad) ─────────────────────

    def midi_in_loop(self) -> None:
        """Background thread: (re)attach to a MIDI input and stay attached.
        rtmidi has no hot-plug event, so we poll the port list. Every iteration
        is guarded so a transient rtmidi error can't permanently kill the poll."""
        while not self.midi_stop.is_set():
            try:
                # Fresh client each scan — robust against enumeration quirks.
                chosen = pick_midi_input(rtmidi.MidiIn().get_ports())
                if chosen is None:
                    if self.midi_in is not None:
                        self._close_midi_in()
                        self._post(self._set_midi_connected, None)
                else:
                    index, name = chosen
                    if name != self.midi_in_name:
                        self._close_midi_in()
                        port = rtmidi.MidiIn()
                        port.open_port(index)
                        # Drop clock/sysex/active-sensing so they can't look like taps.
                        port.ignore_types(sysex=True, timing=True, active_sense=True)
                        port.set_callback(self._on_midi_message)
                        self.midi_in = port
                        self.midi_in_name = name
                        log.info("midi tap controller connected: %r", name)
                        self._post(self._set_midi_connected, name)
            except Exception as exc:  # noqa: BLE001
                log.warning("midi: scan/attach error: %s", exc)
            self.midi_stop.wait(MIDI_RETRY_S)
        self._close_midi_in()

    def _close_midi_in(self) -> None:
        if self.midi_in is not None:
            try:
                self.midi_in.close_port()
            except Exception:  # noqa: BLE001
                pass
            self.midi_in = None
        self.midi_in_name = None

    def _on_midi_message(self, event: tuple, _data: object = None) -> None:
        # Runs on rtmidi's thread. Any note-on with velocity → a tap.
        message, _delta = event
        if len(message) < 3:
            return
        status, _pitch, velocity = message[0], message[1], message[2]
        if (status & 0xF0) == 0x90 and velocity > 0:
            self._post(self._on_pad_tap, velocity / 127.0)

    def _set_midi_connected(self, name: str | None) -> None:
        # name is the connected controller, or None when it disconnects.
        self._broadcast_soon()

    # ── OSC ───────────────────────────────────────────────────────────

    def dispatcher(self) -> Dispatcher:
        d = Dispatcher()
        d.map("/live/test", self._on_test)
        d.map("/live/view/get/selected_track", self._on_selected_track)
        d.map("/live/track/get/name", self._on_track_name)
        d.set_default_handler(lambda *_: None)
        return d

    def _on_test(self, _address: str, *_args: object) -> None:
        self.last_pong = time.monotonic()
        if not self.osc_up:
            self.osc_up = True
            log.info("AbletonOSC connected")
            # (Re)subscribe: this immediately pushes the current selection.
            self.osc_client.send_message("/live/view/start_listen/selected_track", [])
            self._broadcast_soon()

    def _on_selected_track(self, _address: str, *args: object) -> None:
        if not args:
            return
        self.selected_index = int(args[0])  # type: ignore[arg-type]
        self.selected_name = None
        # The push carries only the index; fetch the human-readable name.
        self.osc_client.send_message("/live/track/get/name", [self.selected_index])

    def _on_track_name(self, _address: str, *args: object) -> None:
        if len(args) < 2:
            return
        index = int(args[0])  # type: ignore[arg-type]
        if index == self.selected_index:
            self.selected_name = str(args[1])
            log.info("selected track [%d] %s", index, self.selected_name)
            self._broadcast_soon()

    # ── WebSocket ─────────────────────────────────────────────────────

    def status_message(self) -> dict[str, object]:
        if self.osc_up:
            return {
                "type": "status",
                "connected": True,
                "instrument": self.selected_name,
                "trackIndex": self.selected_index,
                "pad": self.pad_connected,
                "midi": self.midi_in_name,
            }
        return {
            "type": "status",
            "connected": False,
            "reason": self._down_reason(),
            "pad": self.pad_connected,
            "midi": self.midi_in_name,
        }

    def _down_reason(self) -> str:
        if not live_is_running():
            return "live_down"
        if not remote_script_installed():
            return "not_installed"
        return "unresponsive"

    async def _send_all(self, payload: str) -> None:
        if not self.clients:
            return
        await asyncio.gather(
            *(self._safe_send(ws, payload) for ws in list(self.clients)),
            return_exceptions=True,
        )

    @staticmethod
    async def _safe_send(ws: websockets.ServerConnection, payload: str) -> None:
        try:
            await ws.send(payload)
        except websockets.ConnectionClosed:
            pass

    def _send_soon(self, message: dict[str, object]) -> None:
        if self.loop is not None:
            self.loop.create_task(self._send_all(json.dumps(message)))

    def _broadcast_soon(self) -> None:
        self._send_soon(self.status_message())

    async def ws_handler(self, ws: websockets.ServerConnection) -> None:
        self.clients.add(ws)
        peer = ws.remote_address
        log.info("client connected: %s (%d total)", peer, len(self.clients))
        try:
            await ws.send(json.dumps(self.status_message()))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                op = msg.get("op")
                if op == "tap":
                    self.tap(float(msg.get("velocity", 1.0)))
                elif op == "loop":
                    try:
                        events = [
                            (float(e["pos"]) % 1.0, float(e.get("velocity", 1.0)))
                            for e in msg.get("events", [])
                        ]
                        bar = float(msg.get("barDuration", 2.0))
                    except (KeyError, TypeError, ValueError):
                        continue
                    self.set_loop(events, bar)
                elif op == "stopLoop":
                    self.stop_loop()
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(ws)
            log.info("client disconnected: %s (%d left)", peer, len(self.clients))
            # Nobody is listening any more — don't keep looping into Live.
            if not self.clients:
                self.stop_loop()

    # ── Liveness heartbeat ────────────────────────────────────────────

    async def heartbeat(self) -> None:
        while True:
            self.osc_client.send_message("/live/test", [])
            await asyncio.sleep(HEARTBEAT_S)
            if self.osc_up and (time.monotonic() - self.last_pong) > OSC_DOWN_S:
                self.osc_up = False
                self.selected_index = None
                self.selected_name = None
                log.warning("AbletonOSC unresponsive — marking disconnected")
                await self._send_all(json.dumps(self.status_message()))


async def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")

    bridge = Bridge()
    bridge.loop = asyncio.get_running_loop()

    try:
        bridge.open_midi()
    except Exception as exc:  # noqa: BLE001
        log.error("could not open virtual MIDI port: %s", exc)
        return 1

    server = AsyncIOOSCUDPServer((LIVE_HOST, RECV_PORT), bridge.dispatcher(), bridge.loop)
    try:
        transport, _protocol = await server.create_serve_endpoint()
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            log.error(
                "UDP port %d is in use — another OSC client (ping.py/discover.py) "
                "is probably still running. Stop it and retry.",
                RECV_PORT,
            )
        else:
            log.error("could not bind OSC receive port %d: %s", RECV_PORT, exc)
        bridge.close_midi()
        return 1

    if not live_is_running():
        log.warning("Ableton Live does not appear to be running yet.")
        for line in diagnose():
            log.warning("%s", line)

    heartbeat = asyncio.create_task(bridge.heartbeat())
    bridge.osc_client.send_message("/live/test", [])  # kick off connection probe

    bridge.serial_thread = threading.Thread(
        target=bridge.serial_loop, name="tap-pad-serial", daemon=True
    )
    bridge.serial_thread.start()

    bridge.midi_in_thread = threading.Thread(
        target=bridge.midi_in_loop, name="tap-midi-in", daemon=True
    )
    bridge.midi_in_thread.start()

    async with websockets.serve(bridge.ws_handler, WS_HOST, WS_PORT):
        log.info("bridge up — ws://%s:%d, MIDI port %r", WS_HOST, WS_PORT, MIDI_PORT_NAME)
        try:
            await asyncio.Future()  # run until cancelled
        finally:
            heartbeat.cancel()
            bridge.serial_stop.set()
            bridge.midi_stop.set()
            transport.close()
            bridge.close_midi()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass
