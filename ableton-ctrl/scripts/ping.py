#!/usr/bin/env python3
"""Minimal round-trip check against AbletonOSC.

    python scripts/ping.py

Sends /live/test to 127.0.0.1:11000, listens on 127.0.0.1:11001, and prints a
specific diagnosis if nothing comes back within 3 seconds.
"""

from __future__ import annotations

import sys

from osc_common import (
    RECV_PORT,
    SEND_PORT,
    AbletonOSC,
    AbletonOSCError,
    ResponseTimeout,
)

TIMEOUT_SECONDS = 3.0


def main() -> int:
    print(f"→ 发送 /live/test 到 127.0.0.1:{SEND_PORT}")
    print(f"← 监听 127.0.0.1:{RECV_PORT}(超时 {TIMEOUT_SECONDS:.0f}s)")
    print()

    try:
        with AbletonOSC() as osc:
            # The handshake itself. If this comes back, OSC is working.
            reply = osc.gather(
                [("/live/test", ())],
                timeout=TIMEOUT_SECONDS,
                attempts=1,
                label="/live/test",
            )
            status = reply[("/live/test", ())]

            print("✓ OSC 通信正常。")
            print(f"  /live/test → {status[0]!r}")

            # Nice to have, but a dropped datagram here must not fail the ping.
            try:
                version = osc.gather(
                    [("/live/application/get/version", ())],
                    timeout=1.0,
                    label="version",
                )[("/live/application/get/version", ())]
                print(f"  Live 版本  → {version[0]}.{version[1]}")
            except ResponseTimeout:
                print("  Live 版本  → (没拿到,不影响)")

    except AbletonOSCError as exc:
        for line in exc.explain():
            print(line)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
