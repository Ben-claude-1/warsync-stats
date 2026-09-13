"""Scan a rectangular world region by teleporting to a grid of centers and
running per-screen base extraction at each center.

Usage:
  python scripts/scout/region_scan.py X_MIN X_MAX Y_MIN Y_MAX [step]

For the region (375..799, 375..624) with step=20 → ~22×13 = ~286 teleports.
Each teleport: ~5s teleport + ~30s extract = ~35s → ~2.8 hours total.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

# Reuse autonomous_scout helpers
sys.path.insert(0, str(Path(__file__).resolve().parent))
from autonomous_scout import (  # noqa: E402
    ADB, COORDS, COORDS_FILE, LOG_FILE,
    adb_dev, adb_tap, adb_back, adb_screencap,
    teleport, dismiss_modal, ensure_world_view,
    detect_player_popup, is_favorit_dialog, ocr_dialog_coords,
    validate_coords, lupe_visible, persist_base, fit_transform,
    log, _ts,
)


def scan_region(x_min: int, x_max: int, y_min: int, y_max: int,
                step: int = 20, max_taps_per_screen: int = 25,
                max_extracts_per_screen: int = 12,
                duration_s: int = 10800,
                global_max_bases: int = 1500) -> dict:
    """Sweep a rectangular world region. Returns {bases_total, transform}."""
    LOG_FILE.write_text("")
    d = adb_dev()
    log(f"REGION-SCAN x={x_min}..{x_max} y={y_min}..{y_max} step={step} dev={d}")

    deadline = time.time() + duration_s

    centers = []
    for ri, wy in enumerate(range(y_min, y_max + 1, step)):
        row_x = list(range(x_min, x_max + 1, step))
        if ri % 2 == 1:
            row_x.reverse()
        for wx in row_x:
            centers.append((wx, wy))
    log(f"teleport centers: {len(centers)}")

    collected: list[dict] = []
    seen_world: set = set()
    seen_stars: list = []

    # Sparse inner-screen taps: 6 strategic positions covering visible game content.
    # Most teleport centers in sparse areas have 0-1 bases — minimize empty-screen time.
    inner_taps = [
        (1280, 800),   # screen center
        (1000, 700),   # mid-left
        (1600, 700),   # mid-right
        (1000, 1100),  # bottom-left
        (1600, 1100),  # bottom-right
        (1280, 1000),  # mid-low center
    ]
    log(f"inner taps per screen: {len(inner_taps)}")

    for ci, (wx, wy) in enumerate(centers):
        if time.time() > deadline:
            log(f"deadline reached at center {ci+1}/{len(centers)}")
            break
        if len(collected) >= global_max_bases:
            log(f"global_max_bases reached")
            break

        log(f"\n=== center [{ci+1}/{len(centers)}] world=({wx},{wy}) — got={len(collected)} ===")
        try:
            if not dismiss_modal(d):
                ensure_world_view(d)
            teleport(d, wx, wy)
        except Exception as exc:
            log(f"  teleport error: {exc}")
            continue

        screen_extracts = 0
        screen_skips = 0

        for ti, (tx, ty) in enumerate(inner_taps):
            if screen_extracts >= max_extracts_per_screen:
                break
            if ti >= max_taps_per_screen:
                break
            if not lupe_visible(adb_screencap(d)):
                if not dismiss_modal(d):
                    log("  ! cannot recover from modal — skip remainder of screen")
                    break

            try:
                adb_tap(d, tx, ty)
                time.sleep(1.4)
                arr = adb_screencap(d)
                popup = detect_player_popup(arr)
                if not popup:
                    if not lupe_visible(arr):
                        dismiss_modal(d)
                    continue
                sx, sy = popup
                if sy < 80:
                    dismiss_modal(d)
                    continue
                if any(abs(p[0]-sx) < 30 and abs(p[1]-sy) < 30 for p in seen_stars[-100:]):
                    dismiss_modal(d)
                    screen_skips += 1
                    continue
                adb_tap(d, sx, sy)
                time.sleep(1.4)
                arr = adb_screencap(d)
                if not is_favorit_dialog(arr):
                    dismiss_modal(d)
                    continue
                coords = ocr_dialog_coords(arr)
                if validate_coords(coords):
                    rwx, rwy = int(coords["x"]), int(coords["y"])
                    server = int(coords.get("server", 1668))
                    seen_stars.append((sx, sy))
                    if (rwx, rwy) in seen_world:
                        log(f"  ⊘ duplicate ({rwx},{rwy})")
                    else:
                        seen_world.add((rwx, rwy))
                        screen_extracts += 1
                        text = (coords.get('text') or '')[:40]
                        log(f"  ✓ ({rwx},{rwy}) star=({sx},{sy}) [{text}]")
                        collected.append({
                            "click_xy": (tx, ty),
                            "star_xy": (sx, sy),
                            "world_xy": (rwx, rwy),
                            "server": server,
                            "tp_center": (wx, wy),
                            "ts": _ts(),
                        })
                        persist_base(rwx, rwy, tx, ty, server, source="region_scan")
                else:
                    log(f"  ✗ OCR rejected: {coords}")
                # Close fav dialog
                adb_tap(d, *COORDS["fav_dialog_close"])
                time.sleep(1.0)
            except Exception as exc:
                log(f"  ! {type(exc).__name__}: {exc}")
                dismiss_modal(d)

        log(f"  screen done: {screen_extracts} new, {screen_skips} dup-skips")

        # Periodic transform refit + save
        if len(collected) >= 6 and (ci+1) % 5 == 0:
            t = fit_transform(collected)
            log(f"  TRANSFORM ({len(collected)} pts): rms=({t['rms'][0]:.3f},{t['rms'][1]:.3f}) "
                f"max=({t['max_err'][0]:.2f},{t['max_err'][1]:.2f})")
            Path(__file__).resolve().parent.joinpath("pixel_to_world.json").write_text(
                json.dumps(t, indent=2))
            Path(__file__).resolve().parent.joinpath("calibration_samples.json").write_text(
                json.dumps(collected, indent=2, default=str))

    # Final
    log(f"\n=== FINAL bases={len(collected)} ===")
    if len(collected) >= 6:
        t = fit_transform(collected)
        log(f"FINAL TRANSFORM rms=({t['rms'][0]:.3f},{t['rms'][1]:.3f}) max=({t['max_err'][0]:.2f},{t['max_err'][1]:.2f})")
        Path(__file__).resolve().parent.joinpath("pixel_to_world.json").write_text(
            json.dumps(t, indent=2))
    Path(__file__).resolve().parent.joinpath("calibration_samples.json").write_text(
        json.dumps(collected, indent=2, default=str))
    return {"bases_total": len(collected), "centers_visited": ci+1}


if __name__ == "__main__":
    args = sys.argv[1:]
    x_min = int(args[0]) if len(args) > 0 else 375
    x_max = int(args[1]) if len(args) > 1 else 799
    y_min = int(args[2]) if len(args) > 2 else 375
    y_max = int(args[3]) if len(args) > 3 else 624
    step = int(args[4]) if len(args) > 4 else 20
    out = scan_region(x_min, x_max, y_min, y_max, step=step,
                      duration_s=int(args[5]) if len(args) > 5 else 10800,
                      global_max_bases=int(args[6]) if len(args) > 6 else 1500)
    print(json.dumps(out, indent=2))
