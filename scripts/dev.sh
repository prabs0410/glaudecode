#!/usr/bin/env bash
# GlaudeCode dev helper — start / stop / restart / clean / status the desktop app.
#
#   ./scripts/dev.sh start     compile + launch the app + the Bun engine sidecar (foreground; Ctrl-C stops)
#   ./scripts/dev.sh stop      kill the dev app + tauri watcher + vite + any engine sidecars
#   ./scripts/dev.sh restart   stop, then start fresh  (needed for ENGINE or RUST changes — a WebView
#                              reload via vite HMR does NOT respawn the engine sidecar)
#   ./scripts/dev.sh clean     stop + kill orphaned engine sidecars + reset off-screen window geometry
#   ./scripts/dev.sh status    show running app/engine processes
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Process-match patterns for the dev app: the Tauri watcher, vite, the built binary, the engine sidecar.
PATTERNS=(
  "node_modules/.bin/tauri"
  "node_modules/.bin/vite"
  "target/debug/desktop"
  "engine/bin/serve.ts"
)

# tauri-plugin-window-state store locations (per OS). A corrupted file can restore the window
# off-screen (the app shows "alive in the dock" but invisible) — `clean` deletes it so it re-centers.
WIN_STATE=(
  "$HOME/Library/Application Support/dev.glaudecode.desktop/.window-state.json"
  "$HOME/.local/share/dev.glaudecode.desktop/.window-state.json"
  "$HOME/.config/dev.glaudecode.desktop/.window-state.json"
)

kill_app() {
  local killed=0
  for p in "${PATTERNS[@]}"; do
    if pkill -f "$p" 2>/dev/null; then killed=1; fi
  done
  if [ "$killed" = 1 ]; then echo "• stopped GlaudeCode dev processes"; else echo "• nothing running"; fi
}

reset_window_state() {
  local removed=0
  for f in "${WIN_STATE[@]}"; do
    if [ -f "$f" ]; then rm -f "$f" && echo "• reset window geometry: $f" && removed=1; fi
  done
  [ "$removed" = 0 ] && echo "• no window-state file to reset"
  return 0
}

status() {
  echo "GlaudeCode dev processes:"
  # shellcheck disable=SC2009
  ps aux | grep -E "target/debug/desktop|engine/bin/serve\.ts|node_modules/\.bin/(tauri|vite)" \
    | grep -v grep | awk '{print "  " $2 "  " $11 " " $12 " " $13}' || true
  echo "engine sidecars: $(ps aux | grep -c '[e]ngine/bin/serve.ts')"
}

start() {
  echo "▶ starting GlaudeCode (tauri dev) — Ctrl-C to stop"
  cd "$ROOT" && exec bun run desktop
}

case "${1:-}" in
  start)   start ;;
  stop)    kill_app ;;
  restart) kill_app; sleep 1; start ;;
  clean)   kill_app; sleep 1; reset_window_state; echo "• clean done" ;;
  status)  status ;;
  *)
    echo "Usage: ./scripts/dev.sh {start|stop|restart|clean|status}"
    grep -E '^#   ' "${BASH_SOURCE[0]}" | sed 's/^#   /  /'
    exit 1
    ;;
esac
