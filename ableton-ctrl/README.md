# ableton-ctrl

桌面 GUI,用来控制 Ableton Live 里的 device 参数。

```
GUI (Tauri + React)  ←─ OSC/UDP ─→  AbletonOSC (Live Remote Script)  ←→  Live
        (未开始)                            (需你手动安装)
```

当前阶段:**只有 Python 端的通信验证和工程结构 discovery。没有 GUI,没有 Node,没有 Tauri。**

```
ableton-ctrl/
  scripts/
    osc_common.py   # OSC 客户端 + response collector + 故障诊断
    ping.py         # 最小连通性验证
    discover.py     # dump 当前工程的 track / device / parameter 结构
  docs/
    osc-reference.md    # 用到的 AbletonOSC address 和踩坑记录
    session_dump.json   # discover.py 的输出(运行后生成)
```

---

## 1. Python 环境

已确认:macOS,Homebrew Python **3.14.0**,`uv` 0.11.26。

```bash
cd ableton-ctrl
uv sync
```

这会读 `.python-version`(3.14)和 `pyproject.toml`,建出 `.venv/` 并装好
`python-osc`(实测装到 1.10.2,3.14 上无兼容问题)。

之后用 `uv run` 跑脚本,不需要手动 activate:

```bash
uv run python scripts/ping.py
```

也可以传统方式:

```bash
source .venv/bin/activate
python scripts/ping.py
```

两个脚本都能独立运行,且能从任意工作目录调用。

---

## 2. 安装 AbletonOSC

> **当前状态:已安装并跑通。** Live 12.4 + AbletonOSC `0ca6821`,`ping.py` 和 `discover.py`
> 都对真实 Live 验证过。

**AbletonOSC 没有发布过任何 tagged release**,只能从 `master` 分支拿。所以 commit hash 记录在
下面第 6 步,以后出问题好回溯。

1. 从 <https://github.com/ideoforms/AbletonOSC> 下载(clone 或 Download ZIP)。
   要求 Live 11 或以上;你是 Live 12 Standard,满足。

2. 把文件夹重命名为 `AbletonOSC`(ZIP 解压出来叫 `AbletonOSC-master`),放到:

   ```
   ~/Music/Ableton/User Library/Remote Scripts/AbletonOSC
   ```

   `Remote Scripts` 目录不存在的话自己建一个。装完之后 `AbletonOSC/` 里应该能看到
   `__init__.py` 和 `abletonosc/`。

3. **完整退出并重启 Ableton Live。** Remote Script 只在启动时加载。

4. Live > Settings > **Link/Tempo/MIDI**,在 Control Surface 的任意一个空槽位里选 `AbletonOSC`。
   Input / Output 保持 `None` —— AbletonOSC 不走 MIDI。

5. 确认加载成功:

   ```bash
   grep AbletonOSC ~/Library/Preferences/Ableton/Live*/Log.txt | tail -5
   ```

   应该能看到类似 `AbletonOSC: Listening for OSC on port 11000`。

6. 已安装的版本(2026-07-10 clone 自 master):

   ```
   commit: 0ca68214bd62c9b5cb641ca34006cfd70ba94430
   date:   2025-11-19
   ```

   要更新到最新 master:

   ```bash
   cd ~/Music/Ableton/User\ Library/Remote\ Scripts/AbletonOSC && git pull
   ```

   更新后必须重启 Live。

端口:发送 `11000`,接收 `11001`,都是 `127.0.0.1`。

---

## 3. 验证连通性

```bash
uv run python scripts/ping.py
```

成功:

```
✓ OSC 通信正常。
  /live/test → 'ok'
  Live 版本  → 12.1
```

失败时脚本会区分三种情况并给出对应的排查步骤:

| 症状 | 诊断 |
|---|---|
| 找不到 Live 进程 | Live 没开 |
| Live 在跑,但 Remote Script 目录不存在 | AbletonOSC 没装 |
| 两者都有,但 3 秒无回复 | Control Surface 没选 / 装完没重启 / 防火墙 |
| bind 11001 时 `EADDRINUSE` | 端口被占用,附带 `lsof` 命令 |

---

## 4. Dump 工程结构

需要 Live 里打开一个工程,**至少 1 个 track + 1 个 device**。

```bash
uv run python scripts/discover.py
```

终端打印树状结构,同时写出 `docs/session_dump.json`:

```
Session: 2 track(s)
├─ [0] Kick  —  1 device(s)
│  ├─ [0] Operator (class=Operator, 3 params)
│  │    Q [  0] Device On                        1.0000  [0.0000 .. 1.0000]
│  │      [  1] Time                             0.5000  [0.0000 .. 1.0000]
│  │    Q [  2] Wave                             2.0000  [0.0000 .. 4.0000]
```

左边的 `Q` 表示 `is_quantized`(离散档位参数,GUI 里该渲染成开关/下拉框而不是旋钮)。

JSON 结构:

```jsonc
{
  "num_tracks": 2,
  "tracks": [
    {
      "index": 0, "name": "Kick", "num_devices": 1,
      "devices": [
        {
          "index": 0, "name": "Operator", "class_name": "Operator",
          "num_parameters": 3,
          "parameters": [
            { "index": 0, "name": "Device On", "value": 1.0,
              "min": 0.0, "max": 1.0, "is_quantized": true }
          ]
        }
      ]
    }
  ]
}
```

注意 `num_tracks` 不含 return track 和 master track。

---

## 设计说明:为什么没有 threading 和 sleep

OSC 是 fire-and-forget 的,请求和回复之间没有关联 ID。AbletonOSC 的做法是**把请求参数原样
回显在回复开头**,所以 `(address, request_args)` 就是回复的天然 key。

`osc_common.gather()` 基于这一点实现 response collector:

1. 把这一批请求的 key 全部放进 `pending` 集合
2. 给涉及的 address 注册 dispatcher handler
3. 发出所有请求
4. 循环调用 `server.handle_request()`,每次处理一个 datagram,命中就从 `pending` 移除
5. `pending` 空了立刻返回;超时则重发仍然 pending 的请求(默认 2 轮);还不行就抛
   `ResponseTimeout` 并附上缺失的请求列表

超时靠的是 `BlockingOSCUDPServer.timeout` + `handle_request()` 的内置语义,不是 `sleep`。
所以只要回复到齐就马上返回 —— 实测 ping 和 discover 都在 **0.07 秒**内完成,而不是傻等满超时。
全程单线程。

discover.py 分三层往下走,因为下一层的请求依赖上一层的答案(不知道 `num_tracks` 就没法问
track 名字)。层内所有请求并发在途。

详见 [docs/osc-reference.md](docs/osc-reference.md)。

---

## 下一步(尚未开始)

- Tauri + React 脚手架
- Rust 侧的 OSC bridge,或者保留 Python sidecar
- `/live/device/set/parameter/value` 的写入路径 —— 注意它**不返回 ack**
