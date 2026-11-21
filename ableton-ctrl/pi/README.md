# Ephnim on Raspberry Pi — kiosk 部署

让 Raspberry Pi 5 开机直接进入 Ephnim:720 × 720 触控屏上全屏显示 App,看不到桌面、任务栏、
地址栏和鼠标指针,像一台独立的电子乐器。

```
开机 → 自动登录桌面会话(labwc / Wayland)
        ├─ systemd: ephnim-web.service ── node serve.mjs ── http://127.0.0.1:4173  (挂了 2 s 后自动重启)
        └─ 会话 autostart: kiosk.sh ── 等 server 就绪 ── chromium --kiosk http://127.0.0.1:4173/?kiosk
                                         (崩溃自动重开;Alt+F4 / Ctrl+W / ephnim desktop 退回桌面)
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
| `ephnim pads [on\|status\|test\|off]` | 把 8 个 GPIO 按键映射成 pad 的 1–8 键(GPIO 方案,见第 8 节;用 Pro Micro 时不需要) |
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

**临时退出(本次开机)**,屏幕上没有退出入口,用下面两种方式之一:

- 接一个 USB 键盘,按 **Alt+F4** 或 **Ctrl+W**
- 在 Mac 上 SSH 进去执行 `ephnim desktop`

Chromium 关闭后,桌面和任务栏随即出现。

**从桌面回到 kiosk**:

- **双击桌面上的 Ephnim 图标**,或者从菜单 **Sound & Video → Ephnim** 打开
  (第一次双击时如果文件管理器问要不要执行,选 **Execute**)
- 或在桌面终端 / SSH 里执行 `ephnim kiosk`
- 或者直接重启

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

## 7. 接 8 个实体按键(Pro Micro,现用)

App 已经支持**键盘 1–8 触发 8 个 pad**(按行:上排 1–4,下排 5–8),走的就是手指按 pad 的同一条
逻辑:短按录入 loop,按住超过 400 ms 进入试听,松开返回。实现在
`app/src/selector/SelectorScreen.tsx` 的 `PAD_KEYS`,在 Mac 上用键盘就能测试。

8 个机械轴接在一块 Pro Micro(ATmega32U4,Type-C)上,它刷了
`ableton-ctrl/pi/arduino/ephnim_pads/ephnim_pads.ino` 后就是一个 **USB 键盘**:按住哪个 pad 就按住
哪个数字键,松开就松开。插到 Pi 的 USB 口即可,**Pi 上不用配置任何东西**,也不要运行 `ephnim pads`
(那是第 8 节的 GPIO 方案)。

### 7.1 接线

每个轴一只脚接下表的引脚,另一只脚接公共地(Pro Micro 的 GND)。用芯片内部上拉,**不需要电阻**。
信号脚隔一个用一个,防止焊锡连在一起。

| Pad | 按键 | Pro Micro 引脚 |
|---|---|---|
| 1 | 1 | 10 |
| 2 | 2 | 9 |
| 3 | 3 | 7 |
| 4 | 4 | 5 |
| 5 | 5 | 14 |
| 6 | 6 | A0 |
| 7 | 7 | A2 |
| 8 | 8 | 2 |
| 公共地 | — | GND |

接错了不用改线,改 sketch 里的 `PAD_PINS` 顺序再刷一次。

### 7.2 刷写(在 Mac 上)

板子会被识别成 Arduino Micro(USB ID 2341:8037),所以用 `arduino:avr:micro` 编译。第一次要装
官方 Keyboard 库:

```bash
CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
"$CLI" lib install Keyboard
"$CLI" compile --fqbn arduino:avr:micro ableton-ctrl/pi/arduino/ephnim_pads
"$CLI" upload -p /dev/cu.usbmodem2101 --fqbn arduino:avr:micro ableton-ctrl/pi/arduino/ephnim_pads
```

端口名用 `ls /dev/cu.usbmodem*` 看。刷完后它就是键盘了,在 Mac 上打开任意文本框按 pad,应该打出 1–8。
也可以直接打开 Ephnim 的本地页面试。

### 7.3 细节

- **按住 = 按住键**:按下发 key down,松开发 key up,所以按住超过 400 ms 能进入试听。系统的按键重复
  App 会忽略。
- **去抖**:状态要稳定 5 ms 才算数。
- **上电时就处于按下状态的键会被忽略**,直到它第一次松开。焊锡短路的键不会一直往系统里打字。
- **两颗红色 LED(RX/TX)已关掉**。Pro Micro 的这两颗灯是低电平点亮,而 Micro 固件按高电平点亮的板子写,
  所以原来一直亮着。sketch 把这两个脚改成了输入,USB 收发时也不会再闪。绿色电源灯直接接在 5 V 上,
  代码关不掉,只能遮住、换大电阻或拆掉。按复位、刷写时 bootloader 自己会闪灯,这个也关不掉。

## 8. 备选:按键直接接 GPIO

不用 Pro Micro 时,实体按键也可以直接接 Pi 的 GPIO,由 Linux 内核的 `gpio-key` overlay 把每个 GPIO 变成一个按键
(KEY_1–KEY_8),Chromium 收到的就是 1–8。**不改 App、不跑额外程序、不装依赖**;上拉电阻用
GPIO 内部的,去抖由 gpio-keys 驱动完成。

### 8.1 接线

每个按键(轻触开关、机械轴、街机按钮都行,只要是常开开关)两只脚:一只接下表的 GPIO,另一只接
**任意 GND**。8 个按键的 GND 脚可以串成一根线再接到 Pi 上。**不要接 3.3 V / 5 V**,也不需要外接电阻。

| Pad | 按键 | GPIO (BCM) | 排针物理脚 |
|---|---|---|---|
| 1 | 1 | GPIO5 | 29 |
| 2 | 2 | GPIO6 | 31 |
| 3 | 3 | GPIO13 | 33 |
| 4 | 4 | GPIO19 | 35 |
| 5 | 5 | GPIO12 | 32 |
| 6 | 6 | GPIO16 | 36 |
| 7 | 7 | GPIO20 | 38 |
| 8 | 8 | GPIO21 | 40 |
| GND | — | — | 30 / 34 / 39(任选) |

```
           排针最下面 12 个脚(USB 口那一端),从 Pi 正面看
  奇数列                      偶数列
  29  GPIO5  ── pad 1         30  GND   ── 公共地
  31  GPIO6  ── pad 2         32  GPIO12 ── pad 5
  33  GPIO13 ── pad 3         34  GND
  35  GPIO19 ── pad 4         36  GPIO16 ── pad 6
  37  GPIO26 (空)             38  GPIO20 ── pad 7
  39  GND                     40  GPIO21 ── pad 8
```

全部集中在排针末端 29–40 脚,避开了 I2C(2/3)、SPI(7–11)和串口(14/15);触屏走 USB、
声音走 USB 声卡,都不占这些脚。唯一的冲突:GPIO19/20/21 是 I2S,**以后如果换成 I2S DAC 声卡
HAT**,要把 pad 改到别的脚(见 8.3)。

### 8.2 启用与测试

```bash
~/AbletonPlugin/ableton-ctrl/pi/ephnim pads
```

它把 8 行 `dtoverlay=gpio-key,…` 写进 `/boot/firmware/config.txt`(用 `# >>> ephnim pads` /
`# <<< ephnim pads` 包起来,第一次会把原文件备份成 `config.txt.before-ephnim-pads`),并打印上面的接线表。
重复运行不会重复写入。然后重启:

```bash
sudo reboot
```

重启后检查(可以 SSH 进去做):

```bash
~/AbletonPlugin/ableton-ctrl/pi/ephnim pads status
```

显示接线、config.txt 是否已写入,以及每个开关此刻的电平(`hi` = 松开,`lo` = 按下)——按住一个键
再运行一次,对应那行应变成 `lo`。逐个按键看事件:

```bash
~/AbletonPlugin/ableton-ctrl/pi/ephnim pads test
```

每按一下应看到 `KEY_1 (2) pressed` / `released` 之类的行(第一次会用 apt 装 `libinput-tools`),
Ctrl+C 退出。事件都对了,kiosk 里的 pad 就会响。

### 8.3 换引脚 / 去掉

用别的 GPIO:按 pad 1–8 的顺序给出 8 个 BCM 编号,再重启:

```bash
EPHNIM_PAD_GPIOS="5 6 13 19 26 16 20 21" ~/AbletonPlugin/ableton-ctrl/pi/ephnim pads
```

去掉映射(`ephnim uninstall` 也会去掉),之后重启:

```bash
~/AbletonPlugin/ableton-ctrl/pi/ephnim pads off
```

### 8.4 排查

- `pads status` 里某个键一直是 `lo`:开关接成了常闭,或那根线碰到了 GND
- 按了没反应、电平也不变:那只脚没接对——对照物理脚号,注意排针 1 脚在靠近 SD 卡的那端
- `pads test` 有事件但 App 没反应:kiosk 窗口没有焦点(比如刚 Alt+Tab 过),点一下屏幕
- 一次按下触发两次:开关抖动太严重,换一个开关;正常的机械开关驱动自带的去抖就够了

> 以上配置已在 Mac 上用假的 config.txt 走过写入 / 重复写入 / 删除流程,**还没有在实体 Pi 5 上验证**。
> 如果 `pads test` 没有任何事件,在 Pi 上看 `/boot/firmware/overlays/README` 里 `gpio-key` 一节核对参数。

如果以后需要力度(velocity),再考虑通过 WebSocket 送进 App——现有的 bridge
(`ableton-ctrl/bridge/`,Arduino 串口 pad)已经是这个模式,到时可以沿用。

---

## 附:已知情况

- 浏览器控制台里每隔几秒会有一条 `WebSocket connection to 'ws://127.0.0.1:8722/' failed`:App 在
  AUTO 音源模式下探测 Ableton bridge,没探测到就继续用内置音源。不影响使用。
- Assistant 的语音输入依赖在线语音识别,在 Pi 的 Chromium 上离线时不可用;Sequencer 和声音不受影响。
- 只适配 labwc(当前默认)和 X11。如果 `raspi-config` → Advanced Options → Wayland 里选的是
  Wayfire(旧版 Bookworm 的默认),请切换到 labwc。
