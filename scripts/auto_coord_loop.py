#!/usr/bin/env python3
"""Autonomous coord-extraction loop.

For each given (pixel_x, pixel_y) tap position:
  1. Tap base position
  2. Wait for popup
  3. Template-match medal icon → tap it
  4. Wait for "Allianz-Markierung" dialog
  5. Vision-OCR "Kriegszone #1668 X:N Y:N"
  6. BACK BACK to close
  7. Save (tap_xy, world_coord)

Outputs: /Users/ben/.local/state/warsync/auto_coords.jsonl
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

import cv2
import numpy as np
from PIL import Image

ADB = "/opt/homebrew/bin/adb"
MEDAL_TPL = "/Users/ben/Projects/Warsync-stats/zoom/template_medal.png"

STATE = Path("/Users/ben/.local/state/warsync")
OUT_FILE = STATE / "auto_coords.jsonl"
LOG_FILE = STATE / "auto_coords.log"
SCREENS = STATE / "auto_coords_screens"
SCREENS.mkdir(parents=True, exist_ok=True)

OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5vl:7b"


def log(msg: str):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")


def shell(*args):
    subprocess.run([ADB, "shell", *args], check=True)


def screencap(path: Path) -> bytes:
    data = subprocess.check_output([ADB, "exec-out", "screencap", "-p"])
    path.write_bytes(data)
    return data


def tap(x, y):
    shell("input", "tap", str(int(x)), str(int(y)))


def back():
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(0.7)


def find_medal(img_bytes: bytes) -> tuple[int, int] | None:
    """Template-match medal icon, return center pixel of best match."""
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    tpl = cv2.imread(MEDAL_TPL)
    if tpl is None:
        return None
    th, tw = tpl.shape[:2]
    best = None
    for scale in [1.0, 0.85, 1.15, 0.7, 1.3, 0.6, 1.5]:
        ts = cv2.resize(tpl, (int(tw*scale), int(th*scale)))
        if ts.shape[0] >= img.shape[0] or ts.shape[1] >= img.shape[1]:
            continue
        res = cv2.matchTemplate(img, ts, cv2.TM_CCOEFF_NORMED)
        _, mx, _, ml = cv2.minMaxLoc(res)
        if best is None or mx > best[0]:
            best = (mx, (ml[0] + ts.shape[1]//2, ml[1] + ts.shape[0]//2))
    if best and best[0] > 0.55:
        return best[1]
    return None


def vision_extract_coord(img_bytes: bytes) -> tuple[int, int] | None:
    """OCR coord from Allianz-Markierung dialog: 'Kriegszone #1668 X:N Y:N'."""
    im = Image.open(BytesIO(img_bytes)).convert("RGB")
    w, h = im.size
    crop = im.crop((0, 0, w, int(h * 0.4)))
    if crop.size[0] > 1700:
        new_w = 1600
        crop = crop.resize((new_w, int(crop.size[1] * new_w / crop.size[0])), Image.LANCZOS)
    buf = BytesIO()
    crop.save(buf, "JPEG", quality=92)

    prompt = """Last War "Allianz-Markierung"-Dialog. Lies die Zeile "Kriegszone #1668 X:NUMMER Y:NUMMER".

JSON: {"x": INTEGER, "y": INTEGER}
Wenn nicht lesbar: {"x": null, "y": null}"""

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
        return None
    x = result.get("x"); y = result.get("y")
    if isinstance(x, int) and isinstance(y, int):
        return (x, y)
    return None


def process_position(idx: int, tap_x: int, tap_y: int) -> dict:
    """Tap base, find medal, tap, OCR coord, BACK BACK."""
    rec = {"n": idx, "tap_xy": [tap_x, tap_y]}

    log(f"--- #{idx}: tap base at ({tap_x}, {tap_y}) ---")
    tap(tap_x, tap_y)
    time.sleep(2.5)
    img = screencap(SCREENS / f"{idx:02d}_a_popup.png")

    medal = find_medal(img)
    if medal is None:
        log(f"  no medal found")
        rec["error"] = "no_medal"
        back(); back()
        return rec
    log(f"  medal at ({medal[0]}, {medal[1]})")
    rec["medal_xy"] = list(medal)

    tap(medal[0], medal[1])
    time.sleep(2.0)
    img2 = screencap(SCREENS / f"{idx:02d}_b_dialog.png")

    coord = vision_extract_coord(img2)
    if coord is None:
        log(f"  no coord OCR'd")
        rec["error"] = "no_coord"
    else:
        rec["world_xy"] = list(coord)
        log(f"  WORLD COORD: ({coord[0]}, {coord[1]})")

    back(); back()
    time.sleep(0.5)
    return rec


def main():
    # Re-run only the failed positions (failed in earlier run: 3, 7, 8, 9, 10, 11)
    failed_targets = {3, 7, 8, 9, 10, 11}
    taps = []
    with open(STATE / "user_taps.jsonl") as f:
        for line in f:
            t = json.loads(line)
            if t["n"] in failed_targets:
                taps.append((t["n"], t["screen_xy"][0], t["screen_xy"][1]))

    log(f"=== AUTO COORD LOOP — {len(taps)} positions ===")

    # APPEND to existing results (don't truncate)
    results = []
    for idx, x, y in taps:
        rec = process_position(idx, x, y)
        results.append(rec)
        with OUT_FILE.open("a") as f:
            f.write(json.dumps(rec) + "\n")

    matched = [r for r in results if "world_xy" in r]
    log(f"=== DONE: {len(matched)}/{len(results)} coords extracted ===")
    for r in matched:
        log(f"  pixel {r['tap_xy']} → world {r['world_xy']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
