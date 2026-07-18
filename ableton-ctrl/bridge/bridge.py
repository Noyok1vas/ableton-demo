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
import sys
import time
from pathlib import Path

import rtmidi
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

log = logging.getLogger("bridge")


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

    # ── MIDI ──────────────────────────────────────────────────────────

    def open_midi(self) -> None:
        self.midi.open_virtual_port(MIDI_PORT_NAME)
        log.info("virtual MIDI port open: %r", MIDI_PORT_NAME)

    def close_midi(self) -> None:
        for pitch in list(self.pending_off):
            self._note_off(pitch)
        if self.midi.is_port_open():
            self.midi.close_port()

    def tap(self, velocity: float) -> None:
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
        log.info("tap → note %d vel %d", NOTE_PITCH, vel)

    def _note_off(self, pitch: int) -> None:
        handle = self.pending_off.pop(pitch, None)
        if handle is not None:
            handle.cancel()
        self.midi.send_message([0x80, pitch, 0])

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
            }
        return {
            "type": "status",
            "connected": False,
            "reason": self._down_reason(),
        }

    def _down_reason(self) -> str:
        if not live_is_running():
            return "live_down"
        if not remote_script_installed():
            return "not_installed"
        return "unresponsive"

    async def _broadcast(self) -> None:
        if not self.clients:
            return
        payload = json.dumps(self.status_message())
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

    def _broadcast_soon(self) -> None:
        if self.loop is not None:
            self.loop.create_task(self._broadcast())

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
                if msg.get("op") == "tap":
                    self.tap(float(msg.get("velocity", 1.0)))
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(ws)
            log.info("client disconnected: %s (%d left)", peer, len(self.clients))

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
                await self._broadcast()


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

    async with websockets.serve(bridge.ws_handler, WS_HOST, WS_PORT):
        log.info("bridge up — ws://%s:%d, MIDI port %r", WS_HOST, WS_PORT, MIDI_PORT_NAME)
        try:
            await asyncio.Future()  # run until cancelled
        finally:
            heartbeat.cancel()
            transport.close()
            bridge.close_midi()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass
