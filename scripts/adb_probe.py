#!/usr/bin/env python3
"""warsync ADB probe — verify the Android emulator pipeline works on macOS.

Replaces the Windows-only Win32 ImageGrab + AttachThreadInput trick.
Same primitives as `auto/autonomous_scan.py` but on top of ADB:

    tap, swipe, screencap, key event, install APK, list packages.

Usage:
    python3 scripts/adb_probe.py screenshot           # save /tmp/warsync_screen.png
    python3 scripts/adb_probe.py tap 540 1200         # tap at coords (device px)
    python3 scripts/adb_probe.py swipe 800 1200 200 1200 600  # x1 y1 x2 y2 ms
    python3 scripts/adb_probe.py info                 # device size, density, version
    python3 scripts/adb_probe.py packages | grep -i lastwar
    python3 scripts/adb_probe.py install path/to/app.apk
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ADB = "/opt/homebrew/share/android-commandlinetools/platform-tools/adb"


def adb_run(*args: str, capture: bool = True, binary: bool = False) -> bytes | str:
    """Run an adb command. Returns stdout (str by default, bytes if binary=True)."""
    proc = subprocess.run(
        [ADB, *args],
        check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE,
    )
    if not capture:
        return ""
    return proc.stdout if binary else proc.stdout.decode("utf-8", "replace")


def first_device() -> str | None:
    out = adb_run("devices")
    for line in out.strip().splitlines()[1:]:
        if line.strip() and "\tdevice" in line:
            return line.split("\t")[0]
    return None


def cmd_info(serial: str) -> None:
    print("device:", serial)
    print("size:  ", adb_run("-s", serial, "shell", "wm", "size").strip())
    print("dpi:   ", adb_run("-s", serial, "shell", "wm", "density").strip())
    print("ver:   ", adb_run("-s", serial, "shell", "getprop", "ro.build.version.release").strip())


def cmd_screenshot(serial: str, out: Path = Path("/tmp/warsync_screen.png")) -> None:
    data = adb_run("-s", serial, "exec-out", "screencap", "-p", binary=True)
    out.write_bytes(data)  # type: ignore[arg-type]
    print(f"saved {out}  ({out.stat().st_size} bytes)")


def cmd_tap(serial: str, x: int, y: int) -> None:
    adb_run("-s", serial, "shell", "input", "tap", str(x), str(y), capture=False)
    print(f"tap {x},{y}")


def cmd_swipe(serial: str, x1: int, y1: int, x2: int, y2: int, dur_ms: int = 400) -> None:
    adb_run("-s", serial, "shell", "input", "swipe",
            str(x1), str(y1), str(x2), str(y2), str(dur_ms), capture=False)
    print(f"swipe {x1},{y1} -> {x2},{y2}  ({dur_ms}ms)")


def cmd_packages(serial: str) -> None:
    print(adb_run("-s", serial, "shell", "pm", "list", "packages", "-f"), end="")


def cmd_install(serial: str, apk: str) -> None:
    adb_run("-s", serial, "install", "-r", apk, capture=False)
    print(f"installed {apk}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    serial = first_device()
    if not serial:
        print("no adb device — start the emulator first", file=sys.stderr)
        return 1

    cmd, *rest = argv[1:]
    handlers = {
        "info":       lambda: cmd_info(serial),
        "screenshot": lambda: cmd_screenshot(serial, Path(rest[0]) if rest else Path("/tmp/warsync_screen.png")),
        "tap":        lambda: cmd_tap(serial, int(rest[0]), int(rest[1])),
        "swipe":      lambda: cmd_swipe(serial, int(rest[0]), int(rest[1]), int(rest[2]), int(rest[3]),
                                        int(rest[4]) if len(rest) > 4 else 400),
        "packages":   lambda: cmd_packages(serial),
        "install":    lambda: cmd_install(serial, rest[0]),
    }
    handler = handlers.get(cmd)
    if not handler:
        print(f"unknown cmd: {cmd}\n\n{__doc__}", file=sys.stderr)
        return 2
    handler()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
