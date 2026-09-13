#!/usr/bin/env python3
"""Robust pan-delta calibration via Lupe-Dialog only.

Per measurement:
  1. Teleport home (camera at user base = 494, 563)
  2. Open Lupe → vision reads X/Y → confirm (494, 563)
  3. Pan N steps in one direction
  4. Open Lupe → vision reads new X/Y
  5. Record (axis, steps, delta_world_x, delta_world_y)
  6. Repeat from step 1 for next axis/steps

Final: regression on all measurements gives pan_delta_x and pan_delta_y.
A "verified match" = the read X/Y is consistent with linear pan_delta within ±1.

Goal: 20+ verified measurements.
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
import time
from io import BytesIO
from pathlib import Path
from urllib import request

from PIL import Image

ADB = "/opt/homebrew/bin/adb"
SCREEN_W, SCREEN_H = 2560, 1600
CX, CY = SCREEN_W // 2, SCREEN_H // 2
PAN_X = 900
PAN_Y = 700
SWIPE_MS = 400
SETTLE = 1.6

LUPE = (700, 1250)
HOME = (1700, 1374)
BASE_X, BASE_Y = 494, 563

STATE = Path("/Users/ben/.local/state/warsync")
LOG_FILE = STATE / "calibrate_lupe_v2.log"
REPORT_FILE = STATE / "calibrate_lupe_v2_report.json"
SCREENS = STATE / "calibrate_lupe_v2_screens"
SCREENS.mkdir(parents=True, exist_ok=True)

OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5vl:7b"


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")


def shell(*args):
    subprocess.run([ADB, "shell", *args], check=True)


def screencap_to(path: Path) -> bytes:
    data = subprocess.check_output([ADB, "exec-out", "screencap", "-p"])
    path.write_bytes(data)
    return data


def tap(x, y):
    shell("input", "tap", str(int(x)), str(int(y)))


def back():
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(0.7)


def teleport_home():
    tap(*HOME)
    time.sleep(2.0)


def pan(dx: int, dy: int):
    x1, y1 = CX + dx // 2, CY + dy // 2
    x2, y2 = CX - dx // 2, CY - dy // 2
    shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), str(SWIPE_MS))
    time.sleep(SETTLE)


def open_lupe_and_read() -> tuple[int | None, int | None]:
    """Open Lupe dialog, read X/Y, close dialog."""
    tap(*LUPE)
    time.sleep(1.6)
    img_path = SCREENS / f"read_{int(time.time() * 1000)}.png"
    img_bytes = screencap_to(img_path)

    # Crop the top of the screen where dialog appears (top 40% should cover it)
    im = Image.open(BytesIO(img_bytes)).convert("RGB")
    w, h = im.size
    crop = im.crop((0, 0, w, int(h * 0.4)))
    # Resize for vision
    new_w = 1600
    new_h = int(crop.size[1] * new_w / crop.size[0])
    crop = crop.resize((new_w, new_h), Image.LANCZOS)
    crop_path = img_path.with_name(img_path.stem + "_crop.jpg")
    crop.save(crop_path, "JPEG", quality=92)

    prompt = """Last War Koord-Such-Dialog-Screenshot. Du siehst zwei Eingabefelder, die mit "X:" und "Y:" beschriftet sind. In den Feldern stehen Zahlen.

Lies die Zahlen ab und gib sie als Integer zurück.

JSON: {"x": NUMBER, "y": NUMBER}

Wenn der Dialog NICHT sichtbar ist oder die Werte unleserlich:
{"x": null, "y": null, "reason": "kurz"}

Beispiel: Wenn die Felder zeigen "X: 494" und "Y: 563", gibst du zurück: {"x": 494, "y": 563}"""

    buf = BytesIO()
    crop.save(buf, "JPEG", quality=92)
    body = json.dumps({
        "model": MODEL, "prompt": prompt,
        "images": [base64.b64encode(buf.getvalue()).decode()],
        "stream": False, "format": "json",
        "options": {"num_ctx": 4096},
    }).encode()
    req = request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    try:
        result = json.loads(data.get("response", "{}"))
    except json.JSONDecodeError:
        result = {"_raw": data.get("response", "")[:200]}

    back()  # close dialog
    time.sleep(0.5)

    x = result.get("x"); y = result.get("y")
    if isinstance(x, int) and isinstance(y, int):
        return x, y
    return None, None


def main():
    log("=== CALIBRATE LUPE V2 ===")

    teleport_home()
    log("teleported home")

    # Confirm starting position
    x0, y0 = open_lupe_and_read()
    log(f"start: ({x0}, {y0})")
    if x0 is None or x0 != BASE_X or y0 != BASE_Y:
        log(f"WARN: expected ({BASE_X}, {BASE_Y}), got ({x0}, {y0}). Continuing.")
        if x0 is None:
            return 1

    measurements: list[dict] = []

    # 4 directions × 3 step counts = 12 measurements
    test_plan = []
    for n in [1, 2, 3]:
        test_plan.append(("+x", n))
        test_plan.append(("-x", n))
        test_plan.append(("+y", n))
        test_plan.append(("-y", n))

    # Add some additional measurements with smaller pans (half PAN_X) for finer precision
    test_plan.append(("+x_half", 2))
    test_plan.append(("-x_half", 2))
    test_plan.append(("+y_half", 2))
    test_plan.append(("-y_half", 2))

    # Diagonal measurements
    test_plan.append(("+xy", 1))
    test_plan.append(("-xy", 1))
    test_plan.append(("+x-y", 1))
    test_plan.append(("-x+y", 1))

    log(f"plan: {len(test_plan)} measurements")

    for i, (axis, n) in enumerate(test_plan, 1):
        log(f"--- measurement {i}/{len(test_plan)}: {axis} × {n} ---")
        teleport_home()
        time.sleep(1)

        if axis == "+x":
            for _ in range(n):
                pan(+PAN_X, 0)
        elif axis == "-x":
            for _ in range(n):
                pan(-PAN_X, 0)
        elif axis == "+y":
            for _ in range(n):
                pan(0, +PAN_Y)
        elif axis == "-y":
            for _ in range(n):
                pan(0, -PAN_Y)
        elif axis == "+x_half":
            for _ in range(n):
                pan(PAN_X // 2, 0)
        elif axis == "-x_half":
            for _ in range(n):
                pan(-PAN_X // 2, 0)
        elif axis == "+y_half":
            for _ in range(n):
                pan(0, PAN_Y // 2)
        elif axis == "-y_half":
            for _ in range(n):
                pan(0, -PAN_Y // 2)
        elif axis == "+xy":
            pan(+PAN_X, +PAN_Y)
        elif axis == "-xy":
            pan(-PAN_X, -PAN_Y)
        elif axis == "+x-y":
            pan(+PAN_X, -PAN_Y)
        elif axis == "-x+y":
            pan(-PAN_X, +PAN_Y)

        x1, y1 = open_lupe_and_read()
        if x1 is None or y1 is None:
            log(f"  read failed")
            continue
        dx = x1 - BASE_X
        dy = y1 - BASE_Y
        log(f"  pos=({x1}, {y1})  dx={dx:+d}  dy={dy:+d}")
        measurements.append({
            "axis": axis, "n_steps": n,
            "pos": [x1, y1], "dx": dx, "dy": dy,
        })

    # Final: home
    teleport_home()

    # Compute pan_delta from measurements
    log("=== Analyzing measurements ===")
    pan_x_steps = []  # (n, dx) where pan was full PAN_X
    pan_x_half_steps = []
    pan_y_steps = []
    pan_y_half_steps = []
    diagonals = []
    for m in measurements:
        a, n = m["axis"], m["n_steps"]
        dx, dy = m["dx"], m["dy"]
        if a == "+x":
            pan_x_steps.append((n, dx))
        elif a == "-x":
            pan_x_steps.append((-n, dx))
        elif a == "+x_half":
            pan_x_half_steps.append((n, dx))
        elif a == "-x_half":
            pan_x_half_steps.append((-n, dx))
        elif a == "+y":
            pan_y_steps.append((n, dy))
        elif a == "-y":
            pan_y_steps.append((-n, dy))
        elif a == "+y_half":
            pan_y_half_steps.append((n, dy))
        elif a == "-y_half":
            pan_y_half_steps.append((-n, dy))
        elif a in ("+xy", "-xy", "+x-y", "-x+y"):
            diagonals.append({"axis": a, "dx": dx, "dy": dy})

    def avg_delta(steps_list):
        if not steps_list:
            return None
        # delta_per_step = avg(delta / n) over all measurements where n != 0
        deltas = [d / n for n, d in steps_list if n != 0]
        if not deltas:
            return None
        return sum(deltas) / len(deltas), deltas

    log(f"\n+/-PAN_X measurements: {pan_x_steps}")
    if pan_x_steps:
        avg_x, deltas_x = avg_delta(pan_x_steps)
        log(f"  pan_delta_x (full PAN_X={PAN_X}px) = {avg_x:.2f} (n={len(deltas_x)}, range {min(deltas_x):.1f}..{max(deltas_x):.1f})")
    else:
        avg_x = None

    log(f"\n+/-PAN_Y measurements: {pan_y_steps}")
    if pan_y_steps:
        avg_y, deltas_y = avg_delta(pan_y_steps)
        log(f"  pan_delta_y (full PAN_Y={PAN_Y}px) = {avg_y:.2f} (n={len(deltas_y)}, range {min(deltas_y):.1f}..{max(deltas_y):.1f})")
    else:
        avg_y = None

    if pan_x_half_steps:
        avg_xh, _ = avg_delta(pan_x_half_steps)
        log(f"  pan_delta_x_half (PAN_X/2={PAN_X//2}px) = {avg_xh:.2f}/step  → full equivalent {avg_xh*2:.2f}")
    if pan_y_half_steps:
        avg_yh, _ = avg_delta(pan_y_half_steps)
        log(f"  pan_delta_y_half (PAN_Y/2={PAN_Y//2}px) = {avg_yh:.2f}/step  → full equivalent {avg_yh*2:.2f}")

    log(f"\nDiagonals: {diagonals}")

    # Count "verified" measurements: those where dx (or dy) is consistent within ±1 of avg
    matches = 0
    if pan_x_steps and avg_x:
        for n, d in pan_x_steps:
            expected = n * avg_x
            if abs(d - expected) <= 1:
                matches += 1
    if pan_y_steps and avg_y:
        for n, d in pan_y_steps:
            expected = n * avg_y
            if abs(d - expected) <= 1:
                matches += 1
    if pan_x_half_steps and avg_x:
        for n, d in pan_x_half_steps:
            expected = n * avg_x / 2
            if abs(d - expected) <= 1:
                matches += 1
    if pan_y_half_steps and avg_y:
        for n, d in pan_y_half_steps:
            expected = n * avg_y / 2
            if abs(d - expected) <= 1:
                matches += 1
    if diagonals and avg_x and avg_y:
        for di in diagonals:
            sign_x = 1 if "+x" in di["axis"] else -1
            sign_y = 1 if "+y" in di["axis"] else -1
            ex = sign_x * avg_x
            ey = sign_y * avg_y
            if abs(di["dx"] - ex) <= 1 and abs(di["dy"] - ey) <= 1:
                matches += 1

    log(f"\n=== INTERNAL CONSISTENCY MATCHES: {matches}/{len(measurements)} within ±1 ===")

    report = {
        "pan_x_px": PAN_X,
        "pan_y_px": PAN_Y,
        "pan_delta_x": avg_x,
        "pan_delta_y": avg_y,
        "measurements": measurements,
        "consistency_matches": matches,
        "total_measurements": len(measurements),
    }
    REPORT_FILE.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    log(f"saved: {REPORT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
