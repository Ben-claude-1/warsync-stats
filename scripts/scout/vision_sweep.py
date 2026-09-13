"""Pass 1: Vision sweep over a rectangular region.

For each teleport center:
1. Teleport
2. Verify view-center via Favorit dialog OCR (skip if teleport failed)
3. Take screenshot
4. Run qwen2.5vl:7b to list visible player bases by name + alliance + level
5. Persist (view_x, view_y, view_actual, names) to warsync.vision_sweeps

Designed to run for hours unattended. Periodic state-check.
Resume-friendly: skips view-centers already in DB.
"""
from __future__ import annotations

import base64
import io
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib import request as urlrequest

import numpy as np
from PIL import Image

# Reuse autonomous_scout primitives
sys.path.insert(0, str(Path(__file__).resolve().parent))
from autonomous_scout import (  # noqa: E402
    ADB, COORDS, COORDS_FILE, LOG_FILE,
    adb_dev, adb_tap, adb_back, adb_screencap,
    teleport, dismiss_modal, ensure_world_view, lupe_visible,
    log, _ts,
)

OLLAMA = "http://127.0.0.1:11434/api/generate"
SCREENSHOTS_DIR = Path("/tmp/warsync_sweep")
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)


VIEW_PROMPT = """Last War Map-Screenshot. Liste ALLE sichtbaren Spielerbasen.

Pro Basis extrahiere:
- name: voller Text wie "[ALLIANZ]Spielername" (das blaue Banner über jeder Basis)
- alliance_tag: nur das Tag in eckigen Klammern, z. B. "[AR1S]"
- castle_level: die Zahl im kleinen Wappen unter dem Banner (typisch 25..30)
- tile_position: ungefähre Position als "tl|t|tr|l|c|r|bl|b|br" (top-left bis bottom-right)

Antwort nur als JSON:
{
  "screen_type": "state_map",
  "players": [
    {"name": "[XYZ]Name", "alliance_tag": "[XYZ]", "castle_level": 30, "tile_position": "c"}
  ]
}

Wenn keine Spielerbasen sichtbar (nur Wüste, Schnee, Zombies, eigene Marsch-Truppen):
{"screen_type": "state_map", "players": []}

Ignoriere: Zombie-Spawns, eigene Marsch-Indikatoren mit Timer, Wegmarker, Allianzgebäude (Bergbaustützpunkt, Kriegspalast)."""


def vision_ocr(arr: np.ndarray, model: str = "qwen2.5vl:7b") -> dict:
    """Run vision-OCR on screenshot. Returns parsed JSON."""
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    body = json.dumps({
        "model": model,
        "prompt": VIEW_PROMPT,
        "images": [base64.b64encode(buf.getvalue()).decode()],
        "stream": False,
        "format": "json",
        "options": {"num_ctx": 4096},
    }).encode()
    req = urlrequest.Request(OLLAMA, data=body,
                             headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
        return json.loads(data.get("response", "{}"))
    except Exception as exc:
        log(f"  vision error: {exc}")
        return {"screen_type": "error", "players": [], "_err": str(exc)[:200]}


def read_dialog_xy(arr: np.ndarray) -> tuple | None:
    """OCR Favorit-dialog X:Y header (used to verify view-center after teleport).
    Returns (x, y) or None."""
    crop = Image.fromarray(arr).crop((1000, 180, 1700, 280))
    buf = io.BytesIO()
    crop.save(buf, "PNG")
    body = json.dumps({
        "model": "qwen2.5vl:7b",
        "prompt": 'Lies die zwei Zahlen X und Y. JSON: {"x":int,"y":int}',
        "images": [base64.b64encode(buf.getvalue()).decode()],
        "stream": False,
        "format": "json",
        "options": {"num_ctx": 1024},
    }).encode()
    req = urlrequest.Request(OLLAMA, data=body,
                             headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        out = json.loads(data.get("response", "{}"))
        x, y = out.get("x"), out.get("y")
        if isinstance(x, int) and isinstance(y, int) and 1 <= x <= 1500 and 1 <= y <= 1500:
            return (x, y)
    except Exception:
        pass
    return None


def verify_view_center(d: str, expected: tuple, tolerance: int = 5) -> tuple | None:
    """Open Favorit, read X:Y, close. Returns (x,y) if WITHIN tolerance, else None.

    Also returns None if dialog couldn't be read.
    Caller distinguishes None=verify-failed from a returned tuple=verified.
    """
    adb_tap(d, *COORDS["search_icon"])
    time.sleep(1.6)
    arr = adb_screencap(d)
    actual = read_dialog_xy(arr)
    # Close dialog
    adb_tap(d, *COORDS["fav_dialog_close"])
    time.sleep(1.5)
    if actual is None:
        log("  verify: couldn't read dialog X:Y")
        return None
    if abs(actual[0] - expected[0]) > tolerance or abs(actual[1] - expected[1]) > tolerance:
        log(f"  verify: mismatch expected={expected}, got={actual}")
        return None  # treat as failed verification
    return actual


def persist_sweep(view_x: int, view_y: int, actual: tuple | None,
                  payload: dict, status: str = "ok") -> None:
    names = json.dumps(payload.get("players", []), ensure_ascii=False)[:8000]
    actual_x = actual[0] if actual else None
    actual_y = actual[1] if actual else None
    sql = (
        "INSERT INTO warsync.vision_sweeps "
        "(view_x, view_y, view_x_actual, view_y_actual, names_jsonb, status) VALUES "
        f"({view_x}, {view_y}, "
        f"{'NULL' if actual_x is None else actual_x}, "
        f"{'NULL' if actual_y is None else actual_y}, "
        f"$${names}$$::jsonb, '{status}') "
        "ON CONFLICT (view_x, view_y) DO UPDATE SET "
        "view_x_actual=EXCLUDED.view_x_actual, "
        "view_y_actual=EXCLUDED.view_y_actual, "
        "names_jsonb=EXCLUDED.names_jsonb, status=EXCLUDED.status, "
        "captured_at=NOW();"
    )
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
        capture_output=True
    )
    if proc.returncode != 0:
        log(f"  DB persist err: {proc.stderr.decode()[:200]}")


def already_swept(view_x: int, view_y: int) -> bool:
    sql = f"SELECT 1 FROM warsync.vision_sweeps WHERE view_x={view_x} AND view_y={view_y} AND status='ok' LIMIT 1"
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
        capture_output=True
    )
    return proc.stdout.decode().strip() == "1"


def generate_centers(x_min: int, x_max: int, y_min: int, y_max: int,
                     step_x: int = 10, step_y: int = 16,
                     start: tuple = (494, 563)) -> list:
    """Region-grid centers. First yields `start` then sorts the rest by Manhattan distance from start."""
    grid = [(x, y) for y in range(y_min, y_max + 1, step_y)
                   for x in range(x_min, x_max + 1, step_x)]
    sx, sy = start
    grid_sorted = sorted(grid, key=lambda c: abs(c[0]-sx) + abs(c[1]-sy))
    if start in grid_sorted:
        grid_sorted.remove(start)
    return [start] + grid_sorted


def main(x_min: int = 375, x_max: int = 799, y_min: int = 375, y_max: int = 624,
         step_x: int = 10, step_y: int = 16, duration_s: int = 21600) -> None:
    LOG_FILE.write_text("")
    d = adb_dev()
    log(f"VISION-SWEEP region=({x_min}..{x_max}, {y_min}..{y_max}) step=({step_x},{step_y})")

    centers = generate_centers(x_min, x_max, y_min, y_max, step_x, step_y, start=(494, 563))
    log(f"total centers: {len(centers)}")

    deadline = time.time() + duration_s
    processed = 0
    skipped_done = 0
    bases_total = 0

    for i, (vx, vy) in enumerate(centers):
        if time.time() > deadline:
            log("deadline reached"); break
        if already_swept(vx, vy):
            skipped_done += 1
            continue

        log(f"\n[{i+1}/{len(centers)} | done={processed}] center=({vx},{vy})")
        try:
            # Periodic state recovery
            if i % 10 == 0 or not lupe_visible(adb_screencap(d)):
                if not dismiss_modal(d):
                    ensure_world_view(d)

            # Teleport
            teleport(d, vx, vy)

            # MANDATORY verify: re-open Lupe, OCR X:Y, compare to expected
            actual = verify_view_center(d, (vx, vy), tolerance=3)
            if actual is None:
                log("  ✗ verify failed (mismatch or OCR junk) — retry once")
                if not dismiss_modal(d):
                    ensure_world_view(d)
                teleport(d, vx, vy)
                actual = verify_view_center(d, (vx, vy), tolerance=3)

            if actual is None:
                log("  ✗ verify failed twice — skip")
                persist_sweep(vx, vy, None, {"players": []}, status="verify_failed")
                continue

            # Pre-OCR check: must be sane world view
            arr = adb_screencap(d)
            if not lupe_visible(arr):
                log("  ✗ no Lupe after teleport → skip")
                dismiss_modal(d)
                persist_sweep(vx, vy, None, {"players": []}, status="no_lupe")
                continue

            # Vision-OCR for visible bases
            payload = vision_ocr(arr)
            n = len(payload.get("players", []) or [])
            bases_total += n
            log(f"  ✓ verified=({actual[0]},{actual[1]}) → {n} bases")
            if n > 0:
                names = [p.get("name", "?") for p in payload["players"][:6]]
                log(f"    {names}")

            persist_sweep(vx, vy, actual, payload, status="ok")
            processed += 1

            if n > 0:
                fp = SCREENSHOTS_DIR / f"sweep_x{actual[0]:04d}_y{actual[1]:04d}.png"
                Image.fromarray(arr).save(fp, optimize=True)

        except Exception as exc:
            log(f"  ! {type(exc).__name__}: {exc}")
            persist_sweep(vx, vy, None, {"players": []}, status="error")
            try:
                dismiss_modal(d)
            except Exception:
                pass

    log(f"\n=== DONE processed={processed} skipped={skipped_done} bases_seen_raw={bases_total} ===")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(
        int(args[0]) if len(args) > 0 else 375,
        int(args[1]) if len(args) > 1 else 799,
        int(args[2]) if len(args) > 2 else 375,
        int(args[3]) if len(args) > 3 else 624,
        int(args[4]) if len(args) > 4 else 10,
        int(args[5]) if len(args) > 5 else 16,
        int(args[6]) if len(args) > 6 else 21600,
    )
