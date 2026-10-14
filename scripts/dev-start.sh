#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
log_file="$(mktemp /tmp/jianji-dev.XXXXXX.log)"
env -u ELECTRON_RUN_AS_NODE npm run dev > "$log_file" 2>&1 &
echo "Jianji development window starting (launcher PID: $!)."
echo "Logs: tail -f $log_file"
sleep 3
tail -20 "$log_file"
