#!/usr/bin/env python3
"""Precise pan-delta calibration via the Last War coord-jump dialog.

Workflow per measurement:
  1. Open coord-search dialog (tap Lupe icon).
  2. Capture screenshot, vision-OCR the X/Y values.
  3. Close dialog (BACK).
  4. Pan by a known amount (+PAN_X horizontally, etc).
  5. Repeat from step 1 to read new X/Y.
  6. pan_delta = (new - old).

Does 4 measurements: pan +X, pan -X, pan +Y, pan -Y. Averages for accuracy.

Coords measured at:
- (1700, 1374) home button — to teleport back to base
- (700, 1250)  Lupe / coord-search icon
- After Lupe opens, the dialog shows X and Y fields populated with current camera coord
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
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
SETTLE = 1.5

LUPE_X, LUPE_Y = 700, 1250
HOME_X, HOME_Y = 1700, 1374

OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5vl:7b"
LOG = Path("/Users/ben/.local/state/warsync/precise_calibrate.log")


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def shell(*args: str) -> None:
    subprocess.run([ADB, "shell", *args], check=True)


def screencap() -> bytes:
    return subprocess.check_output([ADB, "exec-out", "screencap", "-p"])


def pan(dx: int, dy: int) -> None:
    x1, y1 = CX + dx // 2, CY + dy // 2
    x2, y2 = CX - dx // 2, CY - dy // 2
    shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), str(SWIPE_MS))
    time.sleep(SETTLE)


def tap(x: int, y: int) -> None:
    shell("input", "tap", str(x), str(y))


def back() -> None:
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(0.7)


def go_home() -> None:
    """Teleport camera back to user's base via home button."""
    tap(HOME_X, HOME_Y)
    time.sleep(2.0)


def open_search_dialog() -> None:
    tap(LUPE_X, LUPE_Y)
    time.sleep(1.5)


def vision_read_coords(img_bytes: bytes) -> dict:
    """Send screenshot of opened Lupe dialog, return {x, y}."""
    im = Image.open(BytesIO(img_bytes)).convert("RGB")
    # Crop top-third where the dialog appears
    w, h = im.size
    im = im.crop((0, 0, w, h // 2))
    if im.size[0] > 1700:
        new_w = 1600
        im = im.resize((new_w, int(im.size[1] * new_w / im.size[0])), Image.LANCZOS)
    buf = BytesIO(); im.save(buf, "JPEG", quality=90)

    prompt = """Last War Koord-Such-Dialog ist offen. Ich sehe zwei Eingabefelder mit der Beschriftung "X:" und "Y:" und vorausgefüllten Zahlen. Lies bitte diese Zahlen ab.

Antwort als JSON:
{"x": INT, "y": INT}

Wenn der Dialog NICHT zu sehen ist oder die Werte nicht lesbar:
{"x": null, "y": null, "reason": "..."}"""

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
        return json.loads(data.get("response", "{}"))
    except json.JSONDecodeError:
        return {"x": None, "y": None, "_raw": data.get("response", "")[:200]}


def measure_camera_coord() -> tuple[int | None, int | None]:
    """Open Lupe dialog, read coords, close dialog. Returns (x, y) or (None, None)."""
    open_search_dialog()
    img = screencap()
    res = vision_read_coords(img)
    back()
    time.sleep(0.5)
    return res.get("x"), res.get("y")


def main():
    log("=== PRECISE CALIBRATE ===")

    # Step 0: ensure at home
    log("teleport home")
    go_home()
    time.sleep(1)

    # Read starting coord
    x0, y0 = measure_camera_coord()
    log(f"start position: ({x0}, {y0})")
    if x0 is None or y0 is None:
        log("FAIL: cannot read starting coord. Abort.")
        return 1

    measurements = []

    # +PAN_X (swipe right-to-left, camera moves right, world_x increases)
    log("pan +PAN_X (=+900px)")
    pan(+PAN_X, 0)
    x1, y1 = measure_camera_coord()
    log(f"  after +PAN_X: ({x1}, {y1})")
    if isinstance(x1, int) and isinstance(y1, int):
        measurements.append({"axis": "+x", "delta_world_x": x1 - x0, "delta_world_y": y1 - y0})

    # back home
    go_home()
    time.sleep(1)

    # -PAN_X
    log("pan -PAN_X (=-900px)")
    pan(-PAN_X, 0)
    x2, y2 = measure_camera_coord()
    log(f"  after -PAN_X: ({x2}, {y2})")
    if isinstance(x2, int) and isinstance(y2, int):
        measurements.append({"axis": "-x", "delta_world_x": x2 - x0, "delta_world_y": y2 - y0})

    go_home()
    time.sleep(1)

    # +PAN_Y (swipe top-to-bottom, camera moves down, world_y decreases)
    log("pan +PAN_Y (=+700px)")
    pan(0, +PAN_Y)
    x3, y3 = measure_camera_coord()
    log(f"  after +PAN_Y: ({x3}, {y3})")
    if isinstance(x3, int) and isinstance(y3, int):
        measurements.append({"axis": "+y", "delta_world_x": x3 - x0, "delta_world_y": y3 - y0})

    go_home()
    time.sleep(1)

    # -PAN_Y
    log("pan -PAN_Y (=-700px)")
    pan(0, -PAN_Y)
    x4, y4 = measure_camera_coord()
    log(f"  after -PAN_Y: ({x4}, {y4})")
    if isinstance(x4, int) and isinstance(y4, int):
        measurements.append({"axis": "-y", "delta_world_x": x4 - x0, "delta_world_y": y4 - y0})

    go_home()

    # Compute pan_delta from measurements
    log(f"\nMeasurements: {measurements}")
    delta_x_per_pan_x = []
    delta_y_per_pan_y = []
    for m in measurements:
        if m["axis"] == "+x":
            delta_x_per_pan_x.append(m["delta_world_x"])
        elif m["axis"] == "-x":
            delta_x_per_pan_x.append(-m["delta_world_x"])
        elif m["axis"] == "+y":
            delta_y_per_pan_y.append(-m["delta_world_y"])  # Y inverts
        elif m["axis"] == "-y":
            delta_y_per_pan_y.append(m["delta_world_y"])

    if delta_x_per_pan_x:
        avg_dx = sum(delta_x_per_pan_x) / len(delta_x_per_pan_x)
        log(f"PAN_DELTA_X = {avg_dx:.2f} world units per {PAN_X}px swipe (n={len(delta_x_per_pan_x)})")
    else:
        avg_dx = None

    if delta_y_per_pan_y:
        avg_dy = sum(delta_y_per_pan_y) / len(delta_y_per_pan_y)
        log(f"PAN_DELTA_Y = {avg_dy:.2f} world units per {PAN_Y}px swipe (n={len(delta_y_per_pan_y)})")
    else:
        avg_dy = None

    out = Path("/Users/ben/.local/state/warsync/precise_calibrate_result.json")
    out.write_text(json.dumps({
        "start": [x0, y0],
        "measurements": measurements,
        "pan_delta_x": avg_dx,
        "pan_delta_y": avg_dy,
    }, indent=2))
    log(f"saved: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
