"""Shared OSC plumbing and diagnostics for the AbletonOSC client scripts.

Both ping.py and discover.py import this. It is not a package -- the scripts
add their own directory to sys.path[0], so `python scripts/ping.py` works from
anywhere.
"""

from __future__ import annotations

import errno
import subprocess
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

from pythonosc.dispatcher import Dispatcher
from pythonosc.osc_server import BlockingOSCUDPServer
from pythonosc.udp_client import SimpleUDPClient

LIVE_HOST = "127.0.0.1"
SEND_PORT = 11000
RECV_PORT = 11001

REMOTE_SCRIPT_DIR = (
    Path.home() / "Music" / "Ableton" / "User Library" / "Remote Scripts" / "AbletonOSC"
)

# A request is (address, args). AbletonOSC echoes the request args back at the
# head of every reply, so (address, args) also uniquely identifies the reply.
Request = tuple[str, tuple[Any, ...]]
Payload = tuple[Any, ...]


class AbletonOSCError(Exception):
    """Base class for errors that carry an actionable explanation."""

    def explain(self) -> list[str]:
        return [str(self)]


class PortInUseError(AbletonOSCError):
    def __init__(self, port: int) -> None:
        super().__init__(f"UDP port {port} is already in use")
        self.port = port

    def explain(self) -> list[str]:
        return [
            f"✗ 端口被占用:UDP {self.port} 已经被别的进程绑定了。",
            "",
            "  这个端口是我们用来接收 Live 回复的。常见原因:",
            "    - 另一个 ping.py / discover.py 还在跑",
            "    - 之前的脚本崩了但进程没退",
            "",
            "  找出是谁占着:",
            f"    lsof -nP -iUDP:{self.port}",
            "  然后 kill 掉对应的 PID。",
        ]


class ResponseTimeout(AbletonOSCError):
    def __init__(self, label: str, missing: Sequence[Request], timeout: float) -> None:
        super().__init__(f"timed out waiting for {label} after {timeout:.1f}s")
        self.label = label
        self.missing = list(missing)
        self.timeout = timeout

    def explain(self) -> list[str]:
        lines = [
            f"✗ 等 {self.label} 超时({self.timeout:.1f}s),没有收到 Live 的回复。",
            "",
        ]
        lines.extend(diagnose())
        if self.missing:
            lines.append("")
            lines.append(f"  没收到回复的请求({len(self.missing)} 个,最多列 5 条):")
            for address, args in self.missing[:5]:
                shown = " ".join(str(a) for a in args)
                lines.append(f"    {address} {shown}".rstrip())
        return lines


class _Deadline:
    """Monotonic countdown. Used instead of sleeping so we stay responsive."""

    def __init__(self, seconds: float) -> None:
        self._end = time.monotonic() + seconds

    @property
    def remaining(self) -> float:
        return max(0.0, self._end - time.monotonic())

    @property
    def expired(self) -> bool:
        return self.remaining <= 0.0


def live_is_running() -> bool:
    """True if an Ableton Live process is up. macOS-specific (pgrep)."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", "/Ableton Live"],
            capture_output=True,
            timeout=5.0,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def remote_script_installed() -> bool:
    return REMOTE_SCRIPT_DIR.is_dir()


def diagnose() -> list[str]:
    """Walk the failure modes in dependency order and report the first one that fits."""
    if not live_is_running():
        return [
            "  诊断:Ableton Live 没有在运行。",
            "    → 打开 Live,载入一个工程,再跑一次。",
        ]

    if not remote_script_installed():
        return [
            "  ✓ Ableton Live 进程在运行。",
            f"  ✗ 找不到 Remote Script 目录:",
            f"      {REMOTE_SCRIPT_DIR}",
            "",
            "  诊断:AbletonOSC 没有安装。",
            "    → 照 README 的「安装 AbletonOSC」一节装好,然后重启 Live。",
        ]

    return [
        "  ✓ Ableton Live 进程在运行。",
        f"  ✓ Remote Script 目录存在:{REMOTE_SCRIPT_DIR}",
        "",
        "  诊断:Live 开着、脚本也在,但它没有应答。按顺序排查:",
        "    1. Live > Settings > Link/Tempo/MIDI,把某个 Control Surface 槽位设成 "
        "AbletonOSC。",
        "       (Input / Output 留空即可,AbletonOSC 不走 MIDI。)",
        "    2. 装完 / 改完之后必须完整重启 Live,Remote Script 只在启动时加载。",
        "    3. 看 Live 的日志确认脚本有没有报错:",
        "         tail -n 50 ~/Library/Preferences/Ableton/Live*/Log.txt",
        "       正常加载会看到 'AbletonOSC: Listening for OSC on port 11000'。",
        f"    4. 确认没有防火墙拦掉本机 UDP {SEND_PORT}/{RECV_PORT}。",
    ]


class AbletonOSC:
    """Request/response client for AbletonOSC.

    Single-threaded. `gather` sends a batch of requests, then pumps the blocking
    server one datagram at a time until every reply has landed or the deadline
    passes -- no sleeps, no background threads.
    """

    def __init__(
        self,
        host: str = LIVE_HOST,
        send_port: int = SEND_PORT,
        recv_port: int = RECV_PORT,
    ) -> None:
        self.dispatcher = Dispatcher()
        try:
            self.server = BlockingOSCUDPServer((host, recv_port), self.dispatcher)
        except OSError as exc:
            if exc.errno == errno.EADDRINUSE:
                raise PortInUseError(recv_port) from exc
            raise
        self.client = SimpleUDPClient(host, send_port)

    def __enter__(self) -> AbletonOSC:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        self.server.server_close()

    def gather(
        self,
        requests: Iterable[Request],
        timeout: float = 3.0,
        attempts: int = 2,
        label: str = "response",
    ) -> dict[Request, Payload]:
        """Send every request, collect every reply, return {request: payload}.

        `payload` is the reply with the echoed request args stripped off the front.

        Live's OSC server can drop datagrams under a burst, so each attempt
        re-sends only what is still outstanding.
        """
        requests = list(requests)
        if not requests:
            return {}

        pending: set[Request] = {(addr, tuple(args)) for addr, args in requests}
        results: dict[Request, Payload] = {}
        # How many leading reply args to treat as the echoed request args.
        arity: dict[str, int] = {addr: len(args) for addr, args in requests}

        def on_reply(address: str, *reply_args: Any) -> None:
            echo_len = arity.get(address)
            if echo_len is None:
                return
            key = (address, tuple(reply_args[:echo_len]))
            if key in pending:
                pending.discard(key)
                results[key] = tuple(reply_args[echo_len:])

        handlers = [self.dispatcher.map(addr, on_reply) for addr in arity]
        try:
            for _ in range(attempts):
                if not pending:
                    break
                for address, args in requests:
                    if (address, tuple(args)) in pending:
                        self.client.send_message(address, list(args))

                deadline = _Deadline(timeout)
                while pending and not deadline.expired:
                    # handle_request() returns after one datagram, or after
                    # `timeout` seconds with nothing received.
                    self.server.timeout = deadline.remaining
                    self.server.handle_request()
        finally:
            for address, handler in zip(arity, handlers):
                self.dispatcher.unmap(address, handler)

        if pending:
            raise ResponseTimeout(label, sorted(pending, key=repr), timeout)
        return results
