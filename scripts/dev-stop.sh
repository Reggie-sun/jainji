#!/usr/bin/env bash
# Stop only the primary dev owner of this repository, including other worktrees.
# Never force-kill Electron or signal independent profiles and other projects.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
common_dir="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)"
primary_lock="${XDG_CONFIG_HOME:-"$HOME/.config"}/jianji/SingletonLock"
owner="$(readlink "$primary_lock" 2>/dev/null)" || exit 0
primary_pid="${owner##*-}"
[[ "$primary_pid" =~ ^[1-9][0-9]*$ ]] || { echo "Cannot identify the primary Jianji owner; close it normally first." >&2; exit 1; }
[[ "$owner" = "$(hostname)-$primary_pid" ]] || { echo "Primary Jianji lock belongs to another host; not starting a replacement." >&2; exit 1; }
kill -0 "$primary_pid" 2>/dev/null || exit 0

same_repository() {
  local cwd common
  cwd="$(readlink "/proc/$1/cwd" 2>/dev/null)" || return 1
  common="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  [[ "$common" = "$common_dir" ]]
}
primary_command="$(tr '\0' ' ' < "/proc/$primary_pid/cmdline")"
if [[ "$(stat -c %u "/proc/$primary_pid")" != "$(id -u)" ]] ||
   ! [[ "$primary_command" =~ /node_modules/electron/dist/electron\ \.\ ?$ ]] || ! same_repository "$primary_pid"; then
  echo "The primary Jianji window is not a development instance of this repository; close it normally first." >&2
  exit 1
fi

launcher_pid="$(awk '/^PPid:/ {print $2}' "/proc/$primary_pid/status")"
launcher_command="$(tr '\0' ' ' < "/proc/$launcher_pid/cmdline")"
if ! [[ "$launcher_command" =~ node\ ([^[:space:]]*/)?scripts/dev\.mjs\ ?$ ]] || ! same_repository "$launcher_pid"; then
  echo "The primary dev launcher is unavailable; close the Jianji window normally before restarting." >&2
  exit 1
fi
# The launcher requests the existing idle/save/close path and releases its Vite
# and build watchers before this script permits a fresh launch.
kill -TERM "$launcher_pid"
echo "Waiting for the previous primary workspace to finish tasks and close normally..."
for i in $(seq 1 180); do
  if ! kill -0 "$primary_pid" 2>/dev/null && ! kill -0 "$launcher_pid" 2>/dev/null; then
    exit 0
  fi
  if [ "$((i % 15))" -eq 0 ]; then
    echo "Still waiting (${i}s); no replacement will start before the original owner exits."
  fi
  sleep 1
done

echo "Previous Jianji instance is still running. Close it in the app first, then rerun make frontend." >&2
exit 1
