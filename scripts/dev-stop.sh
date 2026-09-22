#!/usr/bin/env bash
# Stop a previous `make frontend` dev session through its normal lifecycle.
# Never force-kill Electron: a killed owner cannot release the source-sticker
# knowledge store lock, so the next start would demand recovery (issue #5).
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_pattern="$root/node_modules/electron/dist/electron"

# Only the dev app matters: its main process is launched as `electron .`
# (optionally with flags before the "."). Other repo-electron consumers
# (smoke fixtures, batch harnesses with their own launch scripts) must never
# be signaled or waited on.
is_dev_app() {
  # Electron rewrites the browser-process cmdline into one space-joined
  # string ("<binary> ."), so look for a standalone "." argv token.
  tr '\0' ' ' 2>/dev/null < "/proc/$1/cmdline" | grep -Eq '(^| )\.( |$)'
}
dev_app_running() {
  for pid in $(pgrep -f "$electron_pattern" 2>/dev/null); do
    if is_dev_app "$pid"; then
      return 0
    fi
  done
  return 1
}

# The dev launcher forwards SIGTERM into a graceful app quit
# (scripts/dev.mjs -> IPC jianji-dev-quit -> normal save/close flow).
# Match by cwd so another project's `node scripts/dev.mjs` is never signaled.
for pid in $(pgrep -f "node scripts/dev\.mjs" 2>/dev/null); do
  if [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$root" ]; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
done

if ! dev_app_running; then
  exit 0
fi

echo "Waiting for the previous Jianji instance to close (save or cancel in the app if prompted)..."
for i in $(seq 1 180); do
  if ! dev_app_running; then
    exit 0
  fi
  if [ "$i" -eq 15 ]; then
    # Escalate orphaned instances (no launcher): the app handles SIGTERM with the
    # same graceful save/close flow and releases the knowledge store lock.
    for pid in $(pgrep -f "$electron_pattern" 2>/dev/null); do
      if is_dev_app "$pid"; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done
  fi
  if [ "$((i % 15))" -eq 0 ]; then
    echo "Still waiting (${i}s); the app releases its stores before the process exits."
  fi
  sleep 1
done

echo "Previous Jianji instance is still running. Close it in the app first, then rerun make frontend." >&2
exit 1
