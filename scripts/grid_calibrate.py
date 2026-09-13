#!/usr/bin/env python3
"""Calibrate pan-delta from one known player coordinate in the latest scan.

Looks up the player's (row, col) in /tmp/grid_*x*/result.json and computes
pan_delta = (known_x - 494) / (col - center) (or y/row analog).

Usage:
    grid_calibrate.py "GeneralBlücher" --x 510 --y 568
    grid_calibrate.py "GeneralBlücher" --x 510 --y 568 --in /tmp/grid_7x7/result.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BASE_X, BASE_Y = 494, 563


def normalize(s: str) -> str:
    return "".join(c.lower() for c in s if c.isalnum())


def find_player(data: list[dict], name: str) -> list[tuple[int, int]]:
    target = normalize(name)
    hits = []
    for tile in data:
        for p in tile.get("players", []):
            pname = (p.get("name") or "")
            if target in normalize(pname) or normalize(pname) in target:
                hits.append((tile["row"], tile["col"]))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--x", type=int, required=True)
    ap.add_argument("--y", type=int, required=True)
    ap.add_argument("--in", dest="in_file", default=None)
    args = ap.parse_args()

    if args.in_file:
        in_file = Path(args.in_file)
    else:
        candidates = sorted(Path("/tmp").glob("grid_*x*/result.json"),
                            key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            print("no scan results found"); sys.exit(1)
        in_file = candidates[0]
    print(f"using {in_file}")

    data = json.loads(in_file.read_text())
    grid_size = max(t["row"] for t in data) + 1
    center = grid_size // 2

    hits = find_player(data, args.name)
    if not hits:
        print(f"player '{args.name}' not found in scan")
        names = sorted({(p.get("name") or "") for t in data for p in t.get("players", []) if p.get("name")})
        print("available names:", names[:30], "..." if len(names) > 30 else "")
        sys.exit(1)
    print(f"found '{args.name}' in {len(hits)} tile(s): {hits}")

    # average grid position (in case duplicates from overlapping tiles)
    avg_row = sum(r for r, _ in hits) / len(hits)
    avg_col = sum(c for _, c in hits) / len(hits)
    dx_grid = avg_col - center
    dy_grid = center - avg_row  # row 0 = north = +y
    dx_world = args.x - BASE_X
    dy_world = args.y - BASE_Y
    print(f"grid offset: dcol={dx_grid:+.2f}, drow={dy_grid:+.2f}")
    print(f"world offset: dx={dx_world:+d}, dy={dy_world:+d}")

    deltas = []
    if abs(dx_grid) > 0.1:
        d = dx_world / dx_grid
        deltas.append(d)
        print(f"  pan_delta_x = {d:.2f}")
    if abs(dy_grid) > 0.1:
        d = dy_world / dy_grid
        deltas.append(d)
        print(f"  pan_delta_y = {d:.2f}")
    if not deltas:
        print("player too close to grid center for reliable calibration"); sys.exit(2)

    pan_delta = sum(deltas) / len(deltas)
    print(f"\nrecommended PAN_DELTA = {pan_delta:.0f}")
    print(f"\nTo apply, re-persist with: python3 grid_persist.py --in {in_file} --pan-delta {round(pan_delta)} --source-tag recalibrated")


if __name__ == "__main__":
    main()
