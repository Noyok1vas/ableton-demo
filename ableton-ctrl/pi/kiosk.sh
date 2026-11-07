#!/usr/bin/env bash
# Ephnim kiosk launcher — run at login by the desktop session (installed by
# `ephnim enable`). Waits for the local web server, then keeps Chromium
# full screen on the app:
#
#   Chromium crashes or is killed      → started again
#   `ephnim restart` (after an update) → started again on the new build
#   Alt+F4 / Ctrl+W, or `ephnim desktop` → leaves the kiosk and brings up
#                                          the normal desktop for this session
#
# Works under labwc (Wayland, Raspberry Pi OS's default) and under X11.
# Optional settings: ~/.config/ephnim/kiosk.env (see README.md).
set -u

[ -f "$HOME/.config/ephnim/kiosk.env" ] && . "$HOME/.config/ephnim/kiosk.env"

PORT=${EPHNIM_PORT:-4173}
URL=${EPHNIM_URL:-http://127.0.0.1:$PORT/?kiosk}
# Web Audio's output buffer, in frames at the device rate: 256 ≈ 5 ms at
# 48 kHz. Raise to 512 if the sound crackles.
AUDIO_BUFFER=${EPHNIM_AUDIO_BUFFER:-256}
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/ephnim
PROFILE=${XDG_DATA_HOME:-$HOME/.local/share}/ephnim/chromium
RUN=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/ephnim
mkdir -p "$STATE" "$PROFILE" "$RUN"

# One launcher per session, however many autostart mechanisms start it.
exec 9>"$RUN/kiosk.lock"
flock -n 9 || exit 0

# One log per boot; the previous one is kept beside it.
LOG=$STATE/kiosk.log
[ -f "$LOG" ] && mv -f "$LOG" "$LOG.1"
exec >>"$LOG" 2>&1
log() { echo "$(date '+%F %T') $*"; }

CHROMIUM=$(command -v chromium || command -v chromium-browser || true)
if [ -z "$CHROMIUM" ]; then
  log "chromium not found — run: ableton-ctrl/pi/ephnim install"
  exit 1
fi

WAYLAND=0
[ -n "${WAYLAND_DISPLAY:-}" ] && WAYLAND=1
log "session: ${XDG_SESSION_TYPE:-?} (${XDG_CURRENT_DESKTOP:-?}), wayland=$WAYLAND, url=$URL"

# The desktop's own furniture. Under labwc it is started by the system
# autostart, each under lwrespawn, which would bring it back if only the
# program were stopped — so the respawner goes first.
DESKTOP_APPS=(pcmanfm-pi wf-panel-pi)

hide_desktop() {
  [ "$WAYLAND" = 1 ] || return 0
  for app in "${DESKTOP_APPS[@]}"; do
    pkill -f "lwrespawn .*$app" 2>/dev/null
    pkill -x "$app" 2>/dev/null
  done
  # Display layout (Screen Configuration) still applies without the desktop.
  if command -v kanshi >/dev/null && ! pgrep -x kanshi >/dev/null; then
    setsid -f kanshi >/dev/null 2>&1
  fi
}

show_desktop() {
  [ "$WAYLAND" = 1 ] || return 0
  for app in "${DESKTOP_APPS[@]}"; do
    command -v "$app" >/dev/null || continue
    pgrep -x "$app" >/dev/null && continue
    if command -v lwrespawn >/dev/null; then
      setsid -f lwrespawn "$(command -v "$app")" >/dev/null 2>&1
    else
      setsid -f "$app" >/dev/null 2>&1
    fi
  done
}

wait_for_server() {
  local waited=0
  until curl -fsS -o /dev/null --max-time 2 "$URL"; do
    [ $((waited % 10)) -eq 0 ] && log "waiting for the web server at $URL"
    sleep 1
    waited=$((waited + 1))
  done
}

# A power cut is a normal way to switch an instrument off: never let Chromium
# open with "restore pages?" because of one.
mark_clean_exit() {
  local prefs=$PROFILE/Default/Preferences
  [ -f "$prefs" ] || return 0
  sed -i -e 's/"exited_cleanly":false/"exited_cleanly":true/' \
    -e 's/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$prefs"
}

FLAGS=(
  --kiosk
  --user-data-dir="$PROFILE"
  --ozone-platform-hint=auto
  --window-position=0,0
  --window-size=720,720
  # No browser chrome, prompts or bubbles.
  --noerrdialogs
  --disable-infobars
  --no-first-run
  --no-default-browser-check
  --hide-crash-restore-bubble
  --password-store=basic
  --disable-features=Translate
  # Offline appliance: no update checks or nags.
  --disable-component-update
  --check-for-update-interval=31536000
  "--simulate-outdated-no-au=Tue, 31 Dec 2099 23:59:59 GMT"
  # Touch: no browser zoom, no swipe back/forward. The page keeps its own
  # gestures (the canvas still turns and pinches the song itself).
  --disable-pinch
  --overscroll-history-navigation=0
  # Sound: start the engine at load (no tap-to-unlock) and keep the output
  # buffer short so a hit is heard as it lands.
  --autoplay-policy=no-user-gesture-required
  --audio-buffer-size="$AUDIO_BUFFER"
)
# Anything extra, e.g. EPHNIM_CHROMIUM_FLAGS="--force-device-scale-factor=1"
# shellcheck disable=SC2206
[ -n "${EPHNIM_CHROMIUM_FLAGS:-}" ] && FLAGS+=(${EPHNIM_CHROMIUM_FLAGS})

if [ "$WAYLAND" = 0 ] && [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null; then
  xset s off -dpms s noblank
fi

rm -f "$RUN/exit-to-desktop" "$RUN/restart"
hide_desktop

while :; do
  wait_for_server
  mark_clean_exit
  log "starting $CHROMIUM"
  "$CHROMIUM" "${FLAGS[@]}" "$URL"
  code=$?
  log "chromium exited ($code)"

  if [ -e "$RUN/restart" ]; then
    rm -f "$RUN/restart"
    continue
  fi
  if [ -e "$RUN/exit-to-desktop" ] || [ "$code" -eq 0 ]; then
    rm -f "$RUN/exit-to-desktop"
    break
  fi
  sleep 2
done

log "leaving the kiosk for the desktop"
show_desktop
