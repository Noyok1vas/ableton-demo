# Ephnim on Raspberry Pi — kiosk 部署

让 Raspberry Pi 5 开机直接进入 Ephnim:720 × 720 触控屏上全屏显示 App,看不到桌面、任务栏、
地址栏和鼠标指针,像一台独立的电子乐器。

```
开机 → 自动登录桌面会话(labwc / Wayland)
        ├─ systemd: ephnim-web.service ── node serve.mjs ── http://127.0.0.1:4173  (挂了 2 s 后自动重启)
        └─ 会话 autostart: kiosk.sh ── 等 server 就绪 ── chromium --kiosk http://127.0.0.1:4173/?kiosk
                                         (崩溃自动重开;Alt+F4 / Ctrl+W 退回桌面)
```

App 本身不变:还是 `ableton-ctrl/app` 的 Vite + React 静态页面,声音由浏览器里的 Web Audio
引擎(BUILT-IN 音源)合成。Pi 上只多了一个零依赖的静态文件 server 和启动脚本,**完全离线运行**。

本目录的全部内容:

| 文件 | 作用 |
|---|---|
| `ephnim` | 管理命令:install / update / restart / desktop / logs / audio … |
| `serve.mjs` | 本地 web server(只用 Node 自带模块),服务 `app/dist` |
| `kiosk.sh` | kiosk 启动器:等 server → 开 Chromium → 崩溃重开 / 退回桌面 |

App 里与 kiosk 有关的只有 URL 参数 `?kiosk`(`app/src/kiosk.ts`):隐藏鼠标指针、屏蔽长按菜单、
页面一加载就启动音频引擎。Mac 上 `npm run dev` 和 Vercel 部署不带这个参数,行为完全不变;
想在 Mac 上预览 kiosk 效果,打开 `http://localhost:5173/?kiosk`。

---

## 1. 首次部署

### 1.1 准备系统

用 Raspberry Pi Imager 烧录 **Raspberry Pi OS (64-bit) with Desktop**,在 Imager 的设置里:

- 设定用户名 / 密码(下面以 `pi` 为例,用别的也可以)
- 配好 Wi-Fi(只用于第一次安装和以后的 `git pull`,运行时不需要网络)
- 打开 **SSH**,方便以后在 Mac 上远程维护

接线:

- Waveshare 4inch HDMI LCD (C):HDMI 接 Pi 的 **HDMI0**(靠近 USB-C 电源口的那个);屏幕的
  **Touch USB 口**接 Pi 的 USB(触控是 USB HID,免驱)
- USB 声卡接 USB 口,音箱接声卡

第一次开机进桌面后确认屏幕是 720 × 720:

```bash
wlr-randr
```

应能看到 `720x720` 那一行带 `current`。Pi 5 用 KMS 时这块屏一般通过 EDID 直接识别;
如果分辨率不对或画面偏移,按 Waveshare 官方 wiki 对该型号给出的 `/boot/firmware/config.txt`
配置修改后重启。需要旋转画面时用桌面菜单 **Preferences → Screen Configuration**
(设置保存后 kiosk 下同样生效)。

### 1.2 取代码

在 Pi 上(本机终端或 `ssh pi@<pi 的地址>`):

```bash
git clone <仓库地址> ~/AbletonPlugin
```

```bash
cd ~/AbletonPlugin && git checkout physical-demo
```

私有仓库需要 Pi 能访问 GitHub:用 `gh auth login`,或给 Pi 配一把 deploy key / HTTPS token。

### 1.3 一键安装

```bash
~/AbletonPlugin/ableton-ctrl/pi/ephnim install
```

它会依次:

1. 用 apt 装缺的包:`nodejs` `npm` `chromium` `curl` `pulseaudio-utils`(已有的跳过;Node 需 ≥ 18)
2. `npm ci && npm run build`,生成 `ableton-ctrl/app/dist`
3. 写入并启动 systemd 服务 `ephnim-web`(开机自启,异常退出 2 s 后自动重启)
4. 写入 kiosk 自动启动(见第 3 节)
5. `raspi-config`:开机进入桌面并**自动登录**(B4)、**关闭屏幕休眠**
6. 把 USB 声卡设为默认输出(没插就跳过,之后用 `ephnim audio`)

然后重启:

```bash
sudo reboot
```

重启后屏幕应直接出现 Ephnim。

---

## 2. 依赖与启动命令

| 依赖 | 来源 | 用途 |
|---|---|---|
| Node.js ≥ 18 + npm | apt `nodejs` `npm` | 构建 App、运行 `serve.mjs` |
| Chromium | apt `chromium`(系统自带) | kiosk 浏览器 |
| curl | apt | 启动器等待 server 就绪 |
| pactl | apt `pulseaudio-utils` | 选择 USB 声卡(PipeWire 的 pulse 接口) |

没有其他 npm 包要装到系统里,`serve.mjs` 不依赖任何第三方模块。

手动运行(调试用,平时由 systemd / 会话自动启动):

```bash
cd ~/AbletonPlugin/ableton-ctrl/app && npm ci && npm run build
```

```bash
node ~/AbletonPlugin/ableton-ctrl/pi/serve.mjs
```

```bash
~/AbletonPlugin/ableton-ctrl/pi/ephnim kiosk
```

`ephnim` 全部命令:

| 命令 | 作用 |
|---|---|
| `ephnim install` | 首次安装(见 1.3) |
| `ephnim update` | `git pull` → 重新构建 → 重启 server → 刷新 kiosk |
| `ephnim build` | 只重新构建 App |
| `ephnim restart` | 重启 server 并重开 kiosk |
| `ephnim desktop` | 立即退出 kiosk,显示桌面(本次会话) |
| `ephnim kiosk` | 立即进入 kiosk(桌面终端或 SSH 都可以) |
| `ephnim enable` / `disable` | 开 / 关登录时自动进入 kiosk |
| `ephnim audio [设备名]` | 列出输出设备,把 USB 声卡(或指定设备)设为默认 |
| `ephnim status` | server、kiosk、自动启动、会话类型、音频输出、当前版本 |
| `ephnim logs` | server 和 kiosk 的最近日志 |
| `ephnim uninstall` | 关闭自动启动并删除 systemd 服务 |

为了少打字,可以加个链接:`sudo ln -s ~/AbletonPlugin/ableton-ctrl/pi/ephnim /usr/local/bin/ephnim`

---

## 3. Kiosk 自动启动是怎么配置的

Raspberry Pi OS 现在的桌面是 **labwc(Wayland)**,不是 X11,所以不依赖 `unclutter`、`xdotool`、
`~/.config/lxsession/...` 这类只在 X11 下有效的办法。确认当前会话:

```bash
echo $XDG_SESSION_TYPE
```

(桌面终端里看:`wayland` 即 labwc。)

`ephnim enable`(install 时自动执行)只写两个用户级文件,不改系统文件:

| 文件 | 生效于 | 内容 |
|---|---|---|
| `~/.config/labwc/autostart` | labwc / Wayland | 一行:启动 `kiosk.sh` |
| `~/.config/autostart/ephnim-kiosk.desktop` | X11 等其他 XDG 桌面(兜底) | 同上 |

两个都触发时,`kiosk.sh` 用文件锁保证只运行一份。如果你原来就有 `~/.config/labwc/autostart`,
会备份为 `autostart.before-ephnim`,`ephnim disable` 时还原。

各项要求的实现方式:

| 要求 | 实现 |
|---|---|
| 无桌面、无任务栏 | labwc 下 `kiosk.sh` 停掉 `pcmanfm-pi`(桌面)和 `wf-panel-pi`(任务栏),连同照看它们的 `lwrespawn`;退出 kiosk 时再启动它们 |
| 无地址栏 / 窗口边框 | `chromium --kiosk` |
| 无鼠标指针 | 页面在 `?kiosk` 下 `cursor: none`(与 Wayland / X11 无关) |
| 720 × 720 | App 按 720 × 720 排版,1 单位 = 屏幕上 1 像素 |
| 不滚动、不选中文字 | 页面本身 `overflow: hidden` `overscroll-behavior: none` `user-select: none` |
| 不缩放、不误触手势 | `--disable-pinch`(禁浏览器缩放)、`--overscroll-history-navigation=0`(禁左右滑动前进后退)、页面屏蔽长按菜单;App 自己的触控(pad、画布转动 / 双指)不受影响 |
| 无弹窗 | `--noerrdialogs --no-first-run --hide-crash-restore-bubble --password-store=basic` 等;断电后启动器会把 Chromium 标记为正常退出,不会出现"恢复页面" |
| 不休眠 | install 时 `raspi-config` 关闭屏幕休眠 |
| server 挂了自动恢复 | systemd `Restart=always`;kiosk 在 server 回来前一直等待 |
| 浏览器挂了自动恢复 | `kiosk.sh` 循环:非正常退出 2 s 后重开 |

Kiosk 使用独立的浏览器配置目录 `~/.local/share/ephnim/chromium`,保存的 pattern(localStorage)
也在这里,重启不丢。

可选设置写在 `~/.config/ephnim/kiosk.env`(没有就用默认值),改完 `ephnim restart`:

```bash
EPHNIM_AUDIO_BUFFER=512                              # 默认 256,出现爆音时调大
EPHNIM_CHROMIUM_FLAGS="--force-device-scale-factor=1"  # 额外的 Chromium 参数
```

---

## 4. 退出 kiosk、回到桌面、看日志

**临时退出(本次开机)**

- 接一个 USB 键盘,按 **Alt+F4** 或 **Ctrl+W**:Chromium 正常关闭,桌面和任务栏随即出现
- 或在 Mac 上 SSH 进去执行 `ephnim desktop`

触屏上没有退出方式,这是有意的:演奏时不会误退出。

**重新进入 kiosk**:在桌面终端或 SSH 里执行 `ephnim kiosk`,或者直接重启。

**长期关闭 kiosk(开机进普通桌面)**:`ephnim disable`,下次登录起就是普通桌面;
`ephnim enable` 恢复。完全移除:`ephnim uninstall`。

**日志**

```bash
ephnim logs
```

```bash
journalctl -u ephnim-web -f
```

```bash
tail -f ~/.local/state/ephnim/kiosk.log
```

`kiosk.log` 每次开机重写一份,上一次的保存在 `kiosk.log.1`;Chromium 自己的报错也写在这里。
查看页面里的 JS 报错:退出 kiosk 后,在桌面用 Chromium 打开 `http://127.0.0.1:4173/?kiosk` 再按 F12。

---

## 5. 从 Git 更新并重新部署

日常流程:**Mac 上开发 → push → Pi 上一条命令更新**。

```bash
ssh pi@<pi 的地址> '~/AbletonPlugin/ableton-ctrl/pi/ephnim update'
```

`update` 会在 Pi 当前所在的分支上 `git pull --ff-only`,`npm ci && npm run build`,重启
`ephnim-web`,然后让 kiosk 重新打开(屏幕黑一下就是新版本)。Pi 上不要直接改代码,否则
fast-forward 会失败;要换分支先 `git checkout <分支>` 再 `ephnim update`。

Mac 端的开发方式不变:`npm run dev`、localhost:5173、Vercel 部署都和以前一样。

---

## 6. 音频

**输出到 USB 声卡**:Raspberry Pi OS 桌面用 PipeWire,Chromium 的声音走系统默认输出。

```bash
ephnim audio
```

它会列出所有输出设备,并把名字里带 `usb` 的那个设为默认(WirePlumber 会记住,重启后不变)。
自动匹配不对时,把列表里的设备名传进去:`ephnim audio <设备名>`。音量:`alsamixer`
(F6 选声卡),或 `pactl set-sink-volume @DEFAULT_SINK@ 80%`。

**Autoplay Policy**:Chromium 默认要求一次用户手势后 AudioContext 才能发声。App 原本的做法是
"第一次按 pad 时创建并解锁音频"(会显示 *Tap any pad once to start sound*),这在 Mac / iPad 上
保持不变。Kiosk 用 `--autoplay-policy=no-user-gesture-required` 启动 Chromium(这台机器只运行
Ephnim,放开这条策略没有副作用),并在 `?kiosk` 下让 Web Audio 引擎在页面加载时就建好
AudioContext 和整套音频图:开机后**不需要先点一下**,第一下敲击也不用等创建音频上下文。
App 本身从不自动播放声音,交互逻辑没有改动。如果这条策略没生效(比如手动用普通 Chromium 打开),
就回到原来的行为:第一次按 pad 解锁。

**延迟**:

- `--audio-buffer-size=256`:Web Audio 输出缓冲 256 帧(48 kHz 下约 5 ms)。听到爆音 / 卡顿就在
  `kiosk.env` 里改成 512
- 音频引擎在加载时就已就绪,首个音符没有额外的初始化开销
- 想看 PipeWire 实际运行的缓冲(quantum)和有无 xrun:`pw-top`

---

## 7. 以后接 8 个 GPIO 机械 pad

App 已经支持**键盘 1–8 触发 8 个 pad**(按行:上排 1–4,下排 5–8),走的就是手指按 pad 的同一条
逻辑:短按录入 loop,按住超过 400 ms 进入试听,松开返回。实现在
`app/src/selector/SelectorScreen.tsx` 的 `PAD_KEYS`,现在在 Mac 上就可以用键盘测试。

所以接 GPIO 时**不需要改 App,也不需要额外的程序或依赖**:Linux 内核的 `gpio-key` overlay 能把
每个 GPIO 变成一个按键,Chromium 收到的就是 1–8 的按键。等硬件到位,在
`/boot/firmware/config.txt` 末尾为每个 pad 加一行(GPIO 编号按实际接线,开关一端接 GPIO、
一端接 GND;keycode 2–9 是 Linux 的 `KEY_1`–`KEY_8`):

```ini
# Ephnim pads — 示例,尚未在硬件上验证
dtoverlay=gpio-key,gpio=5,active_low=1,gpio_pull=up,label=PAD1,keycode=2
dtoverlay=gpio-key,gpio=6,active_low=1,gpio_pull=up,label=PAD2,keycode=3
# … PAD3–PAD8,keycode 4–9
```

参数说明见 Pi 上的 `/boot/firmware/overlays/README`(搜 `gpio-key`)。重启后可以用
`sudo evtest` 确认每个开关产生的按键。gpio-keys 驱动自带去抖。

如果以后需要力度(velocity),再考虑通过 WebSocket 送进 App——现有的 bridge
(`ableton-ctrl/bridge/`,Arduino 串口 pad)已经是这个模式,到时可以沿用。

---

## 附:已知情况

- 浏览器控制台里每隔几秒会有一条 `WebSocket connection to 'ws://127.0.0.1:8722/' failed`:App 在
  AUTO 音源模式下探测 Ableton bridge,没探测到就继续用内置音源。不影响使用。
- Assistant 的语音输入依赖在线语音识别,在 Pi 的 Chromium 上离线时不可用;Sequencer 和声音不受影响。
- 只适配 labwc(当前默认)和 X11。如果 `raspi-config` → Advanced Options → Wayland 里选的是
  Wayfire(旧版 Bookworm 的默认),请切换到 labwc。
