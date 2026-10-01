#!/usr/bin/env python3
"""Opt in selected existing grouped Chrome launchers; never restart Chrome."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

PREIMAGE_SHA256 = "4948b5fa130c1b1418dfb7342a2da35e544f79dfd33361c66782c266d5ff39fe"
HELPER = '''    def _cdp_enabled(self, profile_id: str) -> bool:
        config = self.base / "cdp-profiles.json"
        try:
            fd = os.open(config, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return False
        try:
            info = os.fstat(fd)
            import stat
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077 or info.st_size > 8192:
                raise ProfileStateError("unsafe CDP profile configuration")
            data = os.read(fd, 8193)
            value = json.loads(data)
            if set(value) != {"version", "profiles"} or value["version"] != 1 or not isinstance(value["profiles"], list) or len(value["profiles"]) > 6:
                raise ProfileStateError("invalid CDP profile configuration")
            for selected in value["profiles"]:
                self._validate_id(selected)
            if len(set(value["profiles"])) != len(value["profiles"]):
                raise ProfileStateError("duplicate CDP profile configuration")
            return profile_id in value["profiles"]
        finally:
            os.close(fd)

'''
START = "    def launch_argv(self,"
END = "            ]\n        if new_window:"
EXTRA = '''            ]
            if self._cdp_enabled(profile_id):
                argv.extend(["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"])
        if new_window:'''


def patch_manager(source: str) -> str:
    if HELPER in source and EXTRA in source:
        return source
    if source.count(START) != 1 or source.count(END) != 1 or "def _cdp_enabled(" in source:
        raise ValueError("unsupported launcher source; inspect before changing")
    return source.replace(START, HELPER + START, 1).replace(END, EXTRA, 1)


def atomic_write(file: Path, content: bytes, mode: int):
    fd, name = tempfile.mkstemp(prefix=".cdp-", dir=file.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, file)
        directory = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(name).unlink(missing_ok=True)


def install(base: Path, profiles: list[str]):
    if not profiles or len(profiles) > 6 or len(set(profiles)) != len(profiles) or any(not re.fullmatch(r"cp-[0-9a-f]{12}", value) for value in profiles):
        raise ValueError("explicit unique profile IDs required (maximum six)")
    base = base.absolute()
    if base.resolve() != base or not base.is_dir() or base.stat().st_uid != os.getuid():
        raise ValueError("unsafe launcher directory")
    source = base / "manager.py"
    if source.is_symlink() or source.stat().st_uid != os.getuid() or not source.is_file():
        raise ValueError("unsafe launcher source")
    with (base / "manager.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        original = source.read_bytes()
        patched = patch_manager(original.decode()).encode()
        digest = hashlib.sha256(original).hexdigest()
        if digest != PREIMAGE_SHA256:
            previous = base / "backups" / f"cdp-launcher-{PREIMAGE_SHA256}" / "manager.py"
            if patched != original or not previous.is_file() or previous.is_symlink() or hashlib.sha256(previous.read_bytes()).hexdigest() != PREIMAGE_SHA256 or patch_manager(previous.read_text()).encode() != original:
                raise ValueError("launcher changed since inspected snapshot; patch not installed")
        compile(patched, str(source), "exec")
        config = base / "cdp-profiles.json"
        desired = (json.dumps({"version": 1, "profiles": profiles}, indent=2) + "\n").encode()
        if config.exists() or config.is_symlink():
            if config.is_symlink() or config.stat().st_uid != os.getuid() or config.stat().st_mode & 0o077 or config.read_bytes() != desired:
                raise ValueError("existing CDP selection differs; inspect before replacing")
        backup = base / "backups" / f"cdp-launcher-{digest}"
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        before = backup / "manager.py"
        if before.exists():
            if before.read_bytes() != original:
                raise ValueError("backup conflicts")
        else:
            with before.open("xb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(original); stream.flush(); os.fsync(stream.fileno())
        if patched != original:
            atomic_write(source, patched, source.stat().st_mode & 0o777)
        if not config.exists():
            atomic_write(config, desired, 0o600)
        return {"before_sha256": digest, "after_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "profiles": profiles, "restarted": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=Path.home() / ".local/share/chrome-profile-grouping")
    parser.add_argument("--profile", action="append", required=True)
    args = parser.parse_args()
    print(json.dumps(install(args.base, args.profile), indent=2))
