#!/usr/bin/env python3
"""Dump the structure of the currently open Live set.

    python scripts/discover.py

Walks song → tracks → devices → parameters, writes docs/session_dump.json, and
prints a readable tree.

Each layer is a single batched request/response round, because you cannot know
the requests for layer N+1 until layer N has answered (you need num_tracks
before you can ask for track names). Within a layer everything is in flight at
once and the collector waits on the set of outstanding replies.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from osc_common import (
    AbletonOSC,
    AbletonOSCError,
    Payload,
    Request,
)

TIMEOUT_SECONDS = 5.0
DUMP_PATH = Path(__file__).resolve().parent.parent / "docs" / "session_dump.json"

NUM_TRACKS = "/live/song/get/num_tracks"
TRACK_NAME = "/live/track/get/name"
TRACK_NUM_DEVICES = "/live/track/get/num_devices"
DEVICE_NAME = "/live/device/get/name"
DEVICE_CLASS_NAME = "/live/device/get/class_name"
DEVICE_NUM_PARAMETERS = "/live/device/get/num_parameters"
PARAMS_NAME = "/live/device/get/parameters/name"
PARAMS_VALUE = "/live/device/get/parameters/value"
PARAMS_MIN = "/live/device/get/parameters/min"
PARAMS_MAX = "/live/device/get/parameters/max"
PARAMS_IS_QUANTIZED = "/live/device/get/parameters/is_quantized"


@dataclass
class Parameter:
    index: int
    name: str
    value: float
    min: float
    max: float
    is_quantized: bool


@dataclass
class Device:
    index: int
    name: str
    class_name: str
    num_parameters: int
    parameters: list[Parameter] = field(default_factory=list)


@dataclass
class Track:
    index: int
    name: str
    num_devices: int
    devices: list[Device] = field(default_factory=list)


@dataclass
class SessionDump:
    num_tracks: int
    tracks: list[Track] = field(default_factory=list)


def _fetch_tracks(osc: AbletonOSC, num_tracks: int) -> list[Track]:
    requests: list[Request] = []
    for index in range(num_tracks):
        requests.append((TRACK_NAME, (index,)))
        requests.append((TRACK_NUM_DEVICES, (index,)))

    replies = osc.gather(requests, timeout=TIMEOUT_SECONDS, label="track metadata")

    return [
        Track(
            index=index,
            name=str(replies[(TRACK_NAME, (index,))][0]),
            num_devices=int(replies[(TRACK_NUM_DEVICES, (index,))][0]),
        )
        for index in range(num_tracks)
    ]


def _build_parameters(replies: dict[Request, Payload], key: tuple[int, int]) -> list[Parameter]:
    names = replies[(PARAMS_NAME, key)]
    values = replies[(PARAMS_VALUE, key)]
    minima = replies[(PARAMS_MIN, key)]
    maxima = replies[(PARAMS_MAX, key)]
    quantized = replies[(PARAMS_IS_QUANTIZED, key)]

    count = min(len(names), len(values), len(minima), len(maxima), len(quantized))
    if len({len(names), len(values), len(minima), len(maxima), len(quantized)}) > 1:
        print(
            f"  ! track {key[0]} device {key[1]}: parameter 数组长度不一致 "
            f"(name={len(names)} value={len(values)} min={len(minima)} "
            f"max={len(maxima)} quantized={len(quantized)}),按最短的 {count} 个截断",
            file=sys.stderr,
        )

    return [
        Parameter(
            index=i,
            name=str(names[i]),
            value=float(values[i]),
            min=float(minima[i]),
            max=float(maxima[i]),
            is_quantized=bool(quantized[i]),
        )
        for i in range(count)
    ]


def _fetch_devices(osc: AbletonOSC, track: Track) -> list[Device]:
    """One batched round per track, to keep the UDP burst small."""
    if track.num_devices == 0:
        return []

    addresses = (
        DEVICE_NAME,
        DEVICE_CLASS_NAME,
        DEVICE_NUM_PARAMETERS,
        PARAMS_NAME,
        PARAMS_VALUE,
        PARAMS_MIN,
        PARAMS_MAX,
        PARAMS_IS_QUANTIZED,
    )
    requests: list[Request] = [
        (address, (track.index, device_index))
        for device_index in range(track.num_devices)
        for address in addresses
    ]

    replies = osc.gather(
        requests, timeout=TIMEOUT_SECONDS, label=f"track {track.index} devices"
    )

    devices: list[Device] = []
    for device_index in range(track.num_devices):
        key = (track.index, device_index)
        devices.append(
            Device(
                index=device_index,
                name=str(replies[(DEVICE_NAME, key)][0]),
                class_name=str(replies[(DEVICE_CLASS_NAME, key)][0]),
                num_parameters=int(replies[(DEVICE_NUM_PARAMETERS, key)][0]),
                parameters=_build_parameters(replies, key),
            )
        )
    return devices


def discover(osc: AbletonOSC) -> SessionDump:
    # Layer 1: how many tracks? Note this endpoint does NOT echo request args.
    reply = osc.gather([(NUM_TRACKS, ())], timeout=TIMEOUT_SECONDS, label="num_tracks")
    num_tracks = int(reply[(NUM_TRACKS, ())][0])

    dump = SessionDump(num_tracks=num_tracks)
    if num_tracks == 0:
        return dump

    # Layer 2: track names and device counts.
    dump.tracks = _fetch_tracks(osc, num_tracks)

    # Layer 3: devices and their parameters, one track at a time.
    for track in dump.tracks:
        track.devices = _fetch_devices(osc, track)

    return dump


def print_tree(dump: SessionDump) -> None:
    print(f"Session: {dump.num_tracks} track(s)")
    if dump.num_tracks == 0:
        print("  (工程里没有 track。在 Live 里建一个 MIDI track 并丢一个 device 进去。)")
        return

    for track in dump.tracks:
        print(f"├─ [{track.index}] {track.name}  —  {track.num_devices} device(s)")
        if not track.devices:
            print("│    (没有 device)")
            continue

        for device in track.devices:
            print(
                f"│  ├─ [{device.index}] {device.name} "
                f"(class={device.class_name}, {device.num_parameters} params)"
            )
            for param in device.parameters:
                mark = "Q" if param.is_quantized else " "
                print(
                    f"│  │    {mark} [{param.index:>3}] {param.name:<28} "
                    f"{param.value:>10.4f}  [{param.min:.4f} .. {param.max:.4f}]"
                )


def main() -> int:
    try:
        with AbletonOSC() as osc:
            dump = discover(osc)
    except AbletonOSCError as exc:
        for line in exc.explain():
            print(line)
        return 1

    print_tree(dump)

    DUMP_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = asdict(dump)
    DUMP_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    total_devices = sum(len(t.devices) for t in dump.tracks)
    total_params = sum(len(d.parameters) for t in dump.tracks for d in t.devices)
    print()
    print(f"✓ {dump.num_tracks} tracks / {total_devices} devices / {total_params} parameters")
    print(f"✓ 写入 {DUMP_PATH}")

    if total_devices == 0:
        print()
        print("! 一个 device 都没找到。discover.py 能跑通,但没东西可 dump。")
        print("  在 Live 里往某个 track 上拖一个 device(比如 Operator 或 EQ Eight)再试。")

    return 0


if __name__ == "__main__":
    sys.exit(main())
