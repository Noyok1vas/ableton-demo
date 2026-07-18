# Visual Plugin Host — 架构与插件契约 Spec

> 状态:v0 草案(2026-07-17)。这份文档定义**架构和最小插件接口**,不是实现。
> 代码开始前先在这里对齐。标「已验证」的部分有实测支撑(见文末环境),标「待定/待验证」
> 的是设计决策或源码推断,尚未在真机确认。

---

## 0. 目标(一句话)

做一个 **Visual Plugin Host**:一块画布上摆放多个「视觉插件」,每个插件的交互和视觉高度自定义
(不是统一的旋钮滑块),但它们**共享同一套东西**——插件契约、参数模型、Ableton 绑定、生命周期、
设计语言。插件不关心 OSC、WebSocket、track/device 索引;那些全由 Host 负责。

**不做什么(v0 明确排除):**
- Rack 内部设备。AbletonOSC 够不着(见 [osc-reference.md](osc-reference.md) 踩坑 0)。
- 硬件。GUI 测顺了再说。
- 多用户 / 云同步 / 复杂持久化。

---

## 1. 为什么是「Host + 插件」而不是「一个通用渲染器」

AbletonOSC 把参数暴露成扁平列表,所以*技术上*一个 schema 驱动的渲染器能画所有设备。但那样每个
设备长得都一样——一排旋钮。你要的是每个插件有自己的图形语言(XY pad、滤波器曲线、波形显示、
宏矩阵……),同时彼此像一个产品。

解法:把「**参数怎么连到 Live**」和「**参数怎么被画出来 / 交互**」彻底分开。

- 前者是 Host 的职责,所有插件共用一份实现。
- 后者是插件自己的自由,想画成什么样画成什么样。

插件与 Host 之间只通过一个窄接口——**Plugin Contract**——通信。这是整份 spec 的核心(第 4 节)。

---

## 2. 分层架构

```
┌─────────────────────────────────────────────────────────┐
│  L5  设计语言 (design tokens)                             │  颜色/字体/间距/动效/基础控件套件
├─────────────────────────────────────────────────────────┤
│  L4  Host 运行时                                          │  插件注册表、实例化、绑定 UI、
│      registry · instances · binding · layout canvas      │  画布布局、生命周期编排
├─────────────────────────────────────────────────────────┤
│  L3  Plugin Contract  ★核心★                             │  每个视觉插件实现的接口
│      manifest · ports · ParamHandle · Component           │
├─────────────────────────────────────────────────────────┤
│  L2  参数模型                                             │  归一化、乐观写入+对账、
│      ParamModel · subscription · optimistic write         │  订阅引用计数
├─────────────────────────────────────────────────────────┤
│  L1  传输层                                              │  Python bridge:WebSocket↔OSC
│      WS protocol · Python bridge (复用 osc_common.py)     │  复用已验证的 collector/listen
└─────────────────────────────────────────────────────────┘
                          ↕ OSC/UDP
                   AbletonOSC → Ableton Live
```

关键分界:**L3 以上是插件作者的世界(纯前端,React),L3 以下是 Host 的世界。** 插件作者写
Component 时,眼里只有 `ParamHandle` 和 design tokens,看不到 OSC 地址。

---

## 3. 四个已验证的原语(地基)

整套契约建立在这四个原语上,均在 Live 12.4 + AbletonOSC `0ca6821` 实测通过:

| 原语 | OSC address | 验证结果 |
|---|---|---|
| 读原始值 | `/live/device/get/parameter/value` | ✅ |
| 读显示串 | `/live/device/get/parameter/value_string` | ✅ `raw 49 → "290 Hz"`(非线性) |
| 写值 | `/live/device/set/parameter/value` | ✅ `set 100 → Live 确认 100`,无 ack |
| 订阅推送 | `/live/device/start_listen/parameter/value` | ✅ 外部改值 40/60/80 三推全收到 |

**两条由此推出的硬约束,贯穿整个设计:**

1. **写入无 ack。** `set` 不回任何东西。确认写入生效的唯一途径是 `start_listen` 的推送,
   或者主动 `get`。→ 乐观更新 + 推送对账(L2)。
2. **推送只带 raw,不带显示串。** 实测推送是 `(track, device, param, raw_value)`,没有
   `value_string`。→ 显示串必须单独按需拉取,不能指望订阅自动带来(见 L2 显示串策略)。

---

## 4. Plugin Contract(★核心★)

一个视觉插件 = **一份 manifest** + **一个 React 组件**。组件收到的是 Host 已经解析好的
参数句柄,永远不碰传输层。

### 4.1 Manifest —— 插件声明它需要什么

```ts
type PortSpec = {
  key: string           // 插件内稳定标识,如 "cutoff"、"reso"
  label: string         // 绑定 UI 里给人看的名字
  kind: 'continuous' | 'quantized' | 'any'  // 期望的参数类型
  required: boolean     // 没绑上时插件能否降级渲染
}

type PluginManifest = {
  id: string            // 全局唯一,如 "xy-pad"
  name: string
  description: string
  ports: PortSpec[]     // 这个插件要绑几个参数、各是什么类型
  defaultSize?: { w: number; h: number }  // 画布上的建议尺寸
  category?: string     // 调色板里分组用
}
```

「Port」是插件对外声明的**抽象参数插槽**。插件说「我要一个 continuous 叫 cutoff、一个叫 reso」,
至于这俩具体连到工程里哪个 track/device/param,是 Host 在绑定阶段解析的,插件不关心。这就是
「统一绑定」和「自定义视觉」能共存的原因。

### 4.2 ParamHandle —— Host 交给插件的活句柄

绑定解析后,Host 给插件每个 port 一个 `ParamHandle`。它是响应式的(值变了组件重渲染):

```ts
type ParamHandle = {
  // ── 读(响应式)──
  connected: boolean    // 是否真的绑上了一个 Live 参数
  raw: number           // [min, max] 区间内的原始值
  normalized: number    // 0..1,= (raw-min)/(max-min),给 UI 定位用
  display: string       // value_string,带单位的人类可读值,如 "290 Hz"
  min: number
  max: number
  isQuantized: boolean
  quantizedLabels?: string[]  // 若 quantized,各档位的显示串(绑定时探测缓存,见 L2)

  // ── 写 ──
  setNormalized(n: number): void   // 0..1 → 自动映射回 raw 再发 OSC
  setRaw(v: number): void

  // ── 手势(解决写入-推送反馈环,见 L2)──
  beginGesture(): void  // 用户开始拖拽:期间信任本地值,暂缓用推送覆盖
  endGesture(): void    // 松手:接受权威推送值,对账
}
```

`normalized` 是给「旋钮转多少度、滑块在哪」用的;`display` 是给旁边数字标签用的。两者都由
Host 维护——插件既不用自己算归一化,也不用自己拼单位字符串。

### 4.3 Component —— 插件的自定义视觉

```ts
type PluginProps = {
  ports: Record<string, ParamHandle>  // 按 PortSpec.key 索引
  tokens: DesignTokens                // 共享设计语言(L5)
}

type VisualPlugin = {
  manifest: PluginManifest
  Component: React.FC<PluginProps>
}
```

Component 内部爱画什么画什么——canvas、SVG、WebGL 都行——只要:
- 读值走 `ports[key].raw / .normalized / .display`
- 写值走 `ports[key].setNormalized()`,拖拽时用 `beginGesture/endGesture` 包起来
- 颜色/字体/间距尽量取自 `tokens`,这样一堆风格迥异的插件摆在一起仍然像一个产品

**一个插件的完整边界就这么多。** 它不 import WebSocket,不知道 track 索引,不写 OSC 地址。
这让插件可以被独立开发、独立测试(mock 一个 ParamHandle 就行)、独立热更新。

---

## 5. Host 运行时(L4)

Host 负责把抽象插件变成画布上一个连着 Live 的活实例。

**注册表.** 启动时所有插件把 `VisualPlugin` 注册进来,形成一个调色板。

**实例 + 绑定.** 用户从调色板拖一个插件到画布,产生一个**实例**。实例携带一份绑定配置:

```ts
type PluginInstance = {
  instanceId: string
  pluginId: string
  bindings: Record<string /*port key*/, ParamAddress | null>
  layout: { x: number; y: number; w: number; h: number }
}
type ParamAddress = { track: number; device: number; param: number }
```

绑定 UI 让用户把每个 port 连到一个具体 Ableton 参数(从 `discover.py` 的
[session_dump.json](session_dump.json) 里选)。`kind` 用来过滤——continuous 的 port 不该
绑到 quantized 参数上。

**生命周期编排.** 这是 Host 最实的活:

| 时机 | Host 动作 |
|---|---|
| 实例挂载 + 绑定就绪 | 对每个绑定参数:引用计数 +1,首次则 `start_listen`;拉一次初始 `value`+`value_string`;若 quantized 则探测档位标签 |
| 运行中收到推送 | 更新对应 ParamModel;非手势期广播给订阅的句柄 → 重渲染 |
| 插件调用 setNormalized | 乐观更新本地 + 发 `set`(见 L2 对账) |
| 实例卸载 / 改绑 | 引用计数 -1,归零则 `stop_listen` |

**画布布局.** 实例的位置/尺寸。v0 可以简单——网格或自由拖拽,持久化到本地 JSON。

---

## 6. 参数模型(L2)

Host 内部对每个「正在被绑定的 Ableton 参数」维护一个 `ParamModel`。多个插件句柄可能指向同一个
ParamModel(比如两个插件都绑了 Filter Cutoff)——所以订阅要**引用计数**,不能谁先卸载就把
`stop_listen` 发了。

### 6.1 归一化

```
normalized = (raw - min) / (max - min)
raw        = min + normalized * (max - min)
```

注意:`normalized` 是**线性**位置,而 `display` 是 Live 给的**非线性**映射结果。插件想画对数
频率轴,得自己解析 `display`,Host 不做这层——因为不同参数的曲线不同,Host 无从得知。

### 6.2 乐观写入 + 推送对账(应对「写入无 ack」)

```
插件 setNormalized(n)
  → Host 立刻把本地 raw 设为 n 映射的值(UI 无延迟响应)
  → 发 /live/device/set/parameter/value
  → Live 稍后回一条 start_listen 推送(可能就是刚写的值,也可能被 Live 钳制/量化过)
```

**反馈环风险:** 用户拖拽时,本地在变、推送也在回,若用推送盖本地会抖动。用 `beginGesture/
endGesture` 解决:
- 手势期内:本地值权威,**忽略**该参数的入站推送。
- `endGesture` 时:接受最近一条权威推送,若与本地不符则 snap 过去(Live 钳制/量化的最终值)。
- 无手势时(别人在 Live 里拧):推送直接更新 UI。

关键:**收到推送绝不触发再一次 set。** 这样环就断了。

### 6.3 显示串刷新策略(应对「推送不带 value_string」)

推送只有 raw。显示串要单独 `get`。策略:
- **continuous 参数:** 拖拽中防抖拉取显示串(如每 80ms 一次),`endGesture` 后再拉一次定妆。
  不必每帧都拉,`normalized` 已经够驱动视觉,`display` 只是标签。
- **quantized 参数:** 档位的显示串**就是**其意义(波形名、滤波器类型),在**绑定时一次性
  探测并缓存**——遍历 `[min..max]` 每个整数档,读 `value_string`,存进 `quantizedLabels`。
  之后切档直接查缓存,不再实时拉。
  > ⚠️ 待验证:quantized 档位探测法尚未在真机跑过(手头 quantized 参数只有 Device On/
  > Chain Selector)。建 quantized 控件前先验一次。

---

## 7. 传输层(L1)—— Python bridge + WS 协议

一个 Python 进程,一头 WebSocket 对前端,一头复用 `scripts/osc_common.py` 对 AbletonOSC。
选浏览器优先 + Python bridge 的理由见对话:迭代快、复用已验证的 collector/listen/诊断、
先不装 Rust。Tauri 以后套壳时,这个 bridge 要么用 Rust 重写,要么作为 sidecar 保留。

### WS 消息(草案)

前端 → bridge:
```jsonc
{ "op": "subscribe",   "track": 4, "device": 0, "param": 1 }
{ "op": "unsubscribe", "track": 4, "device": 0, "param": 1 }
{ "op": "set",         "track": 4, "device": 0, "param": 1, "raw": 100.0 }
{ "op": "getString",   "track": 4, "device": 0, "param": 1 }   // 拉 value_string
{ "op": "snapshot",    "track": 4 }                            // 拉结构(复用 discover 逻辑)
```

bridge → 前端:
```jsonc
{ "type": "param",    "track": 4, "device": 0, "param": 1, "raw": 40.0 }        // 推送/初始值
{ "type": "string",   "track": 4, "device": 0, "param": 1, "display": "290 Hz" }
{ "type": "snapshot", "track": 4, "devices": [ /* discover.py 那套结构 */ ] }
{ "type": "error",    "message": "...", "kind": "live_down|not_installed|..." }
```

约定:线上传 **raw**,归一化在前端 L2 做(min/max 从 snapshot 来)。bridge 尽量薄,只做
OSC↔WS 的翻译和订阅引用计数;乐观/对账/手势逻辑全在前端 L2。

---

## 8. 设计语言(L5)

插件视觉自由,但共享 tokens,才能「一堆自定义插件像一个产品」。这一层 v0 先定**契约结构**,
具体数值等第一个 prototype 时再落:

```ts
type DesignTokens = {
  color: { bg; surface; accent; text; textMuted; track; /* 语义色角色 */ }
  type:  { fontFamily; scale: number[] }
  space: number[]        // 间距梯度
  radius: number[]
  motion: { fast; base; slow }  // 时长/缓动
}
```

外加一套**可选的基础控件套件**(裸旋钮、XY pad、曲线画布……):插件可以拿来拼,也可以完全绕开
自己画。目的是给「大部分插件」一条省力路径,同时不挡住「想完全自定义」的插件。

---

## 9. 建议的仓库结构(尚未创建)

```
ableton-ctrl/
  scripts/                 # 现有:Python 验证 & discovery(不动)
  bridge/                  # L1:Python WS↔OSC bridge,import scripts/osc_common
  app/                     # 前端:Vite + React
    src/
      transport/           # L1 前端侧:WS 客户端
      model/               # L2:ParamModel、归一化、订阅、对账
      host/                # L4:注册表、实例、绑定 UI、画布
      design/              # L5:tokens + 基础控件套件
      plugins/             # L3:一个插件一个目录,各自实现 VisualPlugin
        <plugin-id>/
      contract.ts          # L3:PluginManifest / ParamHandle / VisualPlugin 类型
  docs/
    plugin-host-spec.md    # 本文
    osc-reference.md
    session_dump.json
```

`contract.ts` 是全项目的中枢:插件作者只需要 import 它。

---

## 10. 待验证 / 开放问题

- [ ] **quantized 档位探测法**(§6.3)——真机验证遍历读 `value_string` 是否可靠。
- [ ] **推送频率与背压**——用户在 Live 里快速拧旋钮,推送有多密?会不会淹掉 WS?需压测。
- [ ] **显示串防抖间隔**(§6.3)——80ms 是拍脑袋,实测手感再调。
- [ ] **Live 钳制/量化行为**——`set` 一个越界或非法值,Live 是钳制、忽略还是取最近档?
      影响 `endGesture` 的 snap 逻辑。
- [ ] **多参数原子写**——`/live/device/set/parameters/value` 能一次写整组,XY pad 这类
      双参数插件是否该用它以减少抖动?待评估。
- [ ] **绑定持久化格式**——画布 + 绑定存成什么;换工程后 track/device 索引失效怎么办
      (可能要用 track 名 + device 名做软锚)。

---

## 11. 环境

- Ableton Live **12.4** Standard,macOS
- AbletonOSC master `0ca6821`(2025-11-19)
- Node 24.8.0 / npm 11.6.0(已装);Rust 未装(Tauri 阶段再说)
- python-osc 1.10.2 / Python 3.14.0
