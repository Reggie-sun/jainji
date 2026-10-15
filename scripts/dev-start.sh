#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
exec 9>"$common_dir/jianji-frontend-start.lock"
flock -x 9
scripts/dev-stop.sh
log_file="$(mktemp /tmp/jianji-dev.XXXXXX.log)"
setsid nohup env -u ELECTRON_RUN_AS_NODE JIANJI_DEV_REUSE_PRIMARY=1 npm run dev 9>&- </dev/null > "$log_file" 2>&1 &
launcher_pid=$!
echo "Starting Jianji from $root (launcher PID: $launcher_pid)."
echo "Logs: tail -f $log_file"
sleep 3
if ! kill -0 "$launcher_pid" 2>/dev/null; then
  tail -20 "$log_file" >&2
  wait "$launcher_pid" || true
  echo "Jianji exited before startup completed; fresh code is not running. Check the log above." >&2
  exit 1
fi
tail -20 "$log_file"
