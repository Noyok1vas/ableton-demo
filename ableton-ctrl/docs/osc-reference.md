# AbletonOSC Address Reference

只记录本项目实际用到的 address。完整列表见 [AbletonOSC README](https://github.com/ideoforms/AbletonOSC)。

来源:`ideoforms/AbletonOSC` master 分支的 `README.md` / `abletonosc/song.py` / `abletonosc/device.py`,
核对日期 2026-07-10。

---

## 传输层

| 项 | 值 |
|---|---|
| 协议 | OSC over UDP |
| 主机 | `127.0.0.1` |
| 我们发送 → Live 监听 | `11000` |
| Live 回复 → 我们监听 | `11001` |

**回复地址 == 请求地址。** Live 不会用 `/reply/...` 之类的前缀,它把同一个 address 原样发回来。
这意味着 dispatcher 里注册的 handler 地址,和你 `send_message` 的地址是同一个字符串。

回复只按 **IP** 路由,不按源端口。所以接收方必须显式绑定 `11001`,不能指望用发送用的临时端口收包。

---

## 参数回显约定(整个 collector 模式的基础)

除 `/live/song/get/num_tracks` 外,**所有 get 类 address 都会把请求参数原样回显在回复的开头**。

```
请求:  /live/device/get/name          0 1
回复:  /live/device/get/name          0 1 "Operator"
                                      ^^^ 回显      ^^^^^^^^^^ 真正的 payload
```

因此 `(address, request_args)` 是回复的唯一 key:收到回复后,取前 `len(request_args)` 个参数
拼出 key,剩下的就是 payload。`scripts/osc_common.py` 的 `gather()` 就是这么做的。

**例外:`/live/song/get/num_tracks` 不回显任何东西**(它的 handler 是
`lambda _: (len(self.song.tracks),)`),但因为它的请求参数本来就是空的,`len(request_args) == 0`,
上面的规则自动成立。不需要特殊处理。

---

## Application

### `/live/test`
- 参数:无
- 回复:`"ok"` (string)
- 用途:握手。这是唯一一个能确认「Live 开着 + AbletonOSC 已加载 + 端口通」的 address。

### `/live/application/get/version`
- 参数:无
- 回复:`major` (int), `minor` (int) —— 例如 `12, 1`

---

## Song

### `/live/song/get/num_tracks`
- 参数:无
- 回复:`num_tracks` (int)
- ⚠️ 只统计普通 track,**不含 return track 和 master track**。

---

## Track

以下所有 address 的第一个参数都是 `track_index` (int),从 0 开始。

### `/live/track/get/name`
- 参数:`track_index`
- 回复:`track_index`, `name` (string)

### `/live/track/get/num_devices`
- 参数:`track_index`
- 回复:`track_index`, `num_devices` (int)

---

## Device

以下所有 address 的前两个参数都是 `track_index`, `device_index`,均从 0 开始。

### 单值查询

| Address | 回复 |
|---|---|
| `/live/device/get/name` | `track_index`, `device_index`, `name` (string) |
| `/live/device/get/class_name` | `track_index`, `device_index`, `class_name` (string) |
| `/live/device/get/num_parameters` | `track_index`, `device_index`, `num_parameters` (int) |

`name` 是用户可改的显示名(重命名后会变),`class_name` 是 Live 内部的设备类型标识
(如 `Operator`、`Eq8`)。GUI 里做设备类型判断要用 `class_name`,不要用 `name`。

### 批量参数查询

这五个 address 各返回一个**变长数组**,数组长度 == `num_parameters`,顺序即 `parameter_index`。

| Address | 回复 |
|---|---|
| `/live/device/get/parameters/name` | `track_index`, `device_index`, `name₀`, `name₁`, … |
| `/live/device/get/parameters/value` | `track_index`, `device_index`, `value₀`, `value₁`, … |
| `/live/device/get/parameters/min` | `track_index`, `device_index`, `min₀`, `min₁`, … |
| `/live/device/get/parameters/max` | `track_index`, `device_index`, `max₀`, `max₁`, … |
| `/live/device/get/parameters/is_quantized` | `track_index`, `device_index`, `q₀`, `q₁`, … (bool) |

一次 `parameters/*` 调用比 N 次单参数调用便宜得多。discover.py 每个 device 只发 8 个请求
(3 个单值 + 5 个批量),而不是 `3 + 5×num_parameters` 个。

`is_quantized` 为 true 表示该参数是离散档位(开关、波形选择器),GUI 应该渲染成
下拉框或开关而不是连续旋钮。

### 写入

| Address | 参数 | 回复 |
|---|---|---|
| `/live/device/set/parameter/value` | `track_index`, `device_index`, `parameter_index`, `value` | 无 |
| `/live/device/set/parameters/value` | `track_index`, `device_index`, `value₀`, `value₁`, … | 无 |

⚠️ **set 类 address 不返回任何东西。** 没有 ack、没有错误。想确认写入生效,只能反过来
`get` 一次。这对 GUI 的影响:参数拖动不能靠 set 的回复来做 optimistic UI 确认。

`value` 必须落在该参数的 `[min, max]` 区间内。超出范围时 Live 的行为未验证(可能钳制,
可能忽略),GUI 层应该自己钳制。

---

## 踩坑记录

**1. UDP 无重传,突发批量请求可能丢包。**(预防性设计,尚未在本机实测复现)
OSC 走 UDP,而 Live 的 handler 跑在它自己的消息线程上,一次灌太多 datagram 理论上会丢。
`gather()` 的对策:每一轮只重发「还没收到回复」的请求,默认重试 2 轮。
discover.py 另外按 track 分批,把每次突发控制在 `8 × num_devices` 个包以内。
如果实测发现根本不丢,可以把 `attempts` 降到 1。

**2. `set` 之后可能不能立刻 `get` 到新值。**(未验证)
Live 大概需要一个消息循环周期才会把新值反映出来。做 GUI 的读回校验时留意。

**3. Remote Script 只在 Live 启动时加载。**
改了 AbletonOSC 的代码、或第一次在 Link/MIDI 里选上 Control Surface,都必须**完整重启 Live**。
只是切换 Control Surface 下拉框有时也不够。

**4. 端口 11001 必须由我们独占。**
两个客户端脚本不能同时跑。第二个会在 bind 时拿到 `EADDRINUSE`。

**5. AbletonOSC 没有 tagged release。**
只能从 master 拿。装的时候记下 commit hash,否则出问题无从回溯。

---

## 本项目尚未使用、但 GUI 层大概率要用的

- `/live/device/set/parameter/value` —— 核心写入路径,上面已记录格式
- `/live/song/get/track_names` —— 一次拿全部 track 名,比逐个 `track/get/name` 快
- `/live/song/start_listen/beat` —— 事件订阅,Live 会主动推送
- `/live/track/get/volume` / `panning` / `mute` / `solo`
- `/live/device/get/parameter/value` (单数 `parameter`,参数 `track, device, param_index`)

用到时再补进这份文档,并注明是否实测过。
