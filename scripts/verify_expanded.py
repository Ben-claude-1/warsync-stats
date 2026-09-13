#!/usr/bin/env python3
"""Verify expanded grid predictions by tap+medal-flow on each new position.

Reads /Users/ben/.local/state/warsync/expanded_grid.json,
filters to predictions within game-screen bounds + not already verified,
runs the medal flow on each.

Output: /Users/ben/.local/state/warsync/expanded_verified.jsonl
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

import cv2
import numpy as np
from PIL import Image

ADB = "/opt/homebrew/bin/adb"
MEDAL_TPL = "/Users/ben/Projects/Warsync-stats/zoom/template_medal.png"

STATE = Path("/Users/ben/.local/state/warsync")
GRID = STATE / "expanded_grid.json"
OUT_FILE = STATE / "expanded_verified.jsonl"
LOG_FILE = STATE / "expanded_verified.log"
SCREENS = STATE / "expanded_screens"
SCREENS.mkdir(parents=True, exist_ok=True)

SCREEN_W, SCREEN_H = 2560, 1600
GAME_X_MIN, GAME_X_MAX = 320, 1920
GAME_Y_MIN, GAME_Y_MAX = 80, 1300

OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5vl:7b"


def log(msg: str):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")


def shell(*args):
    subprocess.run([ADB, "shell", *args], check=True)


def tap(x, y):
    shell("input", "tap", str(int(x)), str(int(y)))


def screencap(path: Path) -> bytes:
    data = subprocess.check_output([ADB, "exec-out", "screencap", "-p"])
    path.write_bytes(data)
    return data


def back():
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(0.7)


def find_medal(img_bytes: bytes):
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    tpl = cv2.imread(MEDAL_TPL)
    th, tw = tpl.shape[:2]
    best = None
    for scale in [1.0, 0.85, 1.15, 0.7, 1.3]:
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


def vision_extract_coord(img_bytes: bytes):
    im = Image.open(BytesIO(img_bytes)).convert("RGB")
    w, h = im.size
    crop = im.crop((0, 0, w, int(h * 0.4)))
    if crop.size[0] > 1700:
        new_w = 1600
        crop = crop.resize((new_w, int(crop.size[1] * new_w / crop.size[0])), Image.LANCZOS)
    buf = BytesIO()
    crop.save(buf, "JPEG", quality=92)
    prompt = """Last War "Allianz-Markierung"-Dialog. Lies "Kriegszone #1668 X:NUMMER Y:NUMMER".
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


def main():
    grid = json.loads(GRID.read_text())["grid"]

    # Filter to predictions within game bounds, NOT already verified
    todo = []
    for cell in grid:
        if cell["verified"]:
            continue
        if cell["status"] == "★ YOU":
            continue
        px, py = cell["pred_pixel"]
        if not (GAME_X_MIN <= px <= GAME_X_MAX and GAME_Y_MIN <= py <= GAME_Y_MAX):
            continue
        todo.append(cell)

    log(f"=== EXPANDED VERIFY — {len(todo)} positions to tap ===")

    OUT_FILE.write_text("")
    success = 0
    for i, cell in enumerate(todo, 1):
        wx, wy = cell["world"]
        px, py = cell["pred_pixel"]
        log(f"--- {i}/{len(todo)}: predicted ({wx},{wy}) at pixel ({px},{py}) ---")

        rec = {"world_pred": [wx, wy], "pred_pixel": [px, py]}
        tap(px, py)
        time.sleep(2.5)
        img = screencap(SCREENS / f"e{i:02d}_a_popup.png")

        medal = find_medal(img)
        if medal is None:
            log("  no medal found")
            rec["error"] = "no_medal"
            back(); back()
        else:
            tap(medal[0], medal[1])
            time.sleep(2.0)
            img2 = screencap(SCREENS / f"e{i:02d}_b_dialog.png")
            coord = vision_extract_coord(img2)
            if coord is None:
                rec["error"] = "no_coord"
                log("  dialog opened but coord unreadable")
            else:
                rec["world_actual"] = list(coord)
                rec["delta"] = [coord[0] - wx, coord[1] - wy]
                match = abs(rec["delta"][0]) <= 1 and abs(rec["delta"][1]) <= 1
                rec["match"] = match
                if match:
                    success += 1
                    log(f"  ✓ MATCH: actual ({coord[0]}, {coord[1]}) Δ({rec['delta'][0]:+d},{rec['delta'][1]:+d})")
                else:
                    log(f"  ✗ MISS: actual ({coord[0]}, {coord[1]}) Δ({rec['delta'][0]:+d},{rec['delta'][1]:+d})")
            back(); back()

        with OUT_FILE.open("a") as f:
            f.write(json.dumps(rec) + "\n")

    log(f"=== DONE: {success}/{len(todo)} predictions verified ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
