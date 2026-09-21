#!/usr/bin/env bash
# Stop a previous `make frontend` dev session through its normal lifecycle.
# Never force-kill Electron: a killed owner cannot release the source-sticker
# knowledge store lock, so the next start would demand recovery (issue #5).
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_pattern="$root/node_modules/electron/dist/electron"

# The dev launcher forwards SIGTERM into a graceful app quit
# (scripts/dev.mjs -> IPC jianji-dev-quit -> normal save/close flow).
pkill -TERM -f "node scripts/dev\.mjs" 2>/dev/null || true

if ! pgrep -f "$electron_pattern" >/dev/null 2>&1; then
  exit 0
fi

echo "Waiting for the previous Jianji instance to close (save or cancel in the app if prompted)..."
for i in $(seq 1 180); do
  if ! pgrep -f "$electron_pattern" >/dev/null 2>&1; then
    exit 0
  fi
  if [ "$((i % 15))" -eq 0 ]; then
    echo "Still waiting (${i}s); the app releases its stores before the process exits."
  fi
  sleep 1
done

echo "Previous Jianji instance is still running. Close it in the app first, then rerun make frontend." >&2
exit 1
