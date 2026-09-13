#!/usr/bin/env python3
"""NxN grid scan around current camera position via ADB swipes.

Snake pattern starting from current center, walking out to top-left, then
sweeping rows. Saves tiles as <out>/r{row}c{col}.png.

Usage:
    grid_scan.py [--size 5|7|9] [--out /tmp/grid7x7]
"""
from __future__ import annotations

import argparse
import subprocess
import time
from pathlib import Path

ADB = "/opt/homebrew/bin/adb"
SCREEN_W, SCREEN_H = 2560, 1600
CX, CY = SCREEN_W // 2, SCREEN_H // 2
PAN_X = 900   # ~35% of width — overlaps adjacent tiles
PAN_Y = 700
SWIPE_MS = 400
SETTLE_S = 1.2


def shell(*args):
    subprocess.check_call([ADB, "shell"] + list(args))


def screencap(out: Path):
    out.write_bytes(subprocess.check_output([ADB, "exec-out", "screencap", "-p"]))


def pan(dx: int, dy: int):
    x1, y1 = CX + dx // 2, CY + dy // 2
    x2, y2 = CX - dx // 2, CY - dy // 2
    shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), str(SWIPE_MS))
    time.sleep(SETTLE_S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=5, choices=[3, 5, 7, 9])
    ap.add_argument("--out", default="/tmp/grid_scan")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("r?c?.png"):
        f.unlink()

    half = args.size // 2
    print(f"NxN scan: size={args.size}, out={out}")

    for _ in range(half):
        pan(-PAN_X, 0)
    for _ in range(half):
        pan(0, -PAN_Y)

    for row in range(args.size):
        cols = range(args.size) if row % 2 == 0 else range(args.size - 1, -1, -1)
        for i, col in enumerate(cols):
            time.sleep(0.3)
            f = out / f"r{row}c{col}.png"
            screencap(f)
            print(f"  r{row}c{col} → {f.stat().st_size // 1024}KB")
            if i < args.size - 1:
                pan(+PAN_X if row % 2 == 0 else -PAN_X, 0)
        if row < args.size - 1:
            pan(0, +PAN_Y)

    end_col = args.size - 1 if (args.size - 1) % 2 == 0 else 0
    print(f"Walking back from r{args.size-1}c{end_col} to center...")
    if end_col == args.size - 1:
        for _ in range(half):
            pan(-PAN_X, 0)
    else:
        for _ in range(half):
            pan(+PAN_X, 0)
    for _ in range(half):
        pan(0, -PAN_Y)

    print(f"done. {len(list(out.glob('r?c?.png')))} tiles")


if __name__ == "__main__":
    main()
