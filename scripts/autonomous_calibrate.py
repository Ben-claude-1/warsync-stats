#!/usr/bin/env python3
"""Overnight autonomous calibration-verification loop.

Walks a 7x7 grid around the user's base. At each non-center position:
  1. Tap center of screen → opens player profile popup (if a base is there)
  2. Screenshot, send to qwen2.5vl:7b: "Is this a profile popup? extract X/Y"
  3. Compare extracted coord to predicted (BASE + grid_offset * PAN_DELTA)
  4. ALWAYS press BACK afterward to close popup

Stops at 20 matches OR 80 attempts. Writes report. Camera lock prevents
launchd-rescan collision.

Match tolerance: ±3 world units (since one tile spans ~6 units).
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import time
from io import BytesIO
from pathlib import Path
from urllib import request

from PIL import Image

# --- config ----------------------------------------------------------
ADB = "/opt/homebrew/bin/adb"
SCREEN_W, SCREEN_H = 2560, 1600
CX, CY = SCREEN_W // 2, SCREEN_H // 2
PAN_X = 900
PAN_Y = 700
SWIPE_MS = 400
SETTLE_AFTER_PAN = 1.5
SETTLE_AFTER_TAP = 1.4
SETTLE_AFTER_BACK = 0.7

BASE_X, BASE_Y = 494, 563
PAN_DELTA_X = 6        # calibrated from GeneralBlücher
PAN_DELTA_Y = 4.67     # estimated, will be refined by verification

GRID_SIZE = 7
CENTER = GRID_SIZE // 2

TARGET_MATCHES = 20
MAX_ATTEMPTS = 80
COORD_TOLERANCE = 3

STATE = Path("/Users/ben/.local/state/warsync")
STATE.mkdir(parents=True, exist_ok=True)
LOG_FILE = STATE / "autonomous_calibrate.log"
REPORT_FILE = STATE / "autonomous_calibrate_report.json"
SCREENS_DIR = STATE / "calibrate_screens"
SCREENS_DIR.mkdir(exist_ok=True)
LOCK_FILE = Path("/tmp/warsync_autonomous.lock")

OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5vl:7b"

POPUP_PROMPT = """Last War Screenshot. Auf der Welt-Map wurde gerade auf eine Basis getippt — ist ein Spieler-Profil-Popup zu sehen?

Wenn JA: Lies aus dem Popup die X- und Y-Koordinate (Format meist "X:494 Y:563" oder "(494, 563)" oder ähnlich) und den Spielernamen.

Antwort als JSON:
- Popup mit Coords: {"popup": true, "x": INT, "y": INT, "name": "..."}
- Popup ohne lesbare Coords: {"popup": true, "x": null, "y": null, "name": "..."}
- Kein Popup (leerer Tipp / oder nur Allianz-Banner / oder andere UI): {"popup": false}
"""


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")


def shell(*args: str) -> None:
    subprocess.run([ADB, "shell", *args], check=True)


def screencap() -> bytes:
    return subprocess.check_output([ADB, "exec-out", "screencap", "-p"])


def pan(dx: int, dy: int) -> None:
    x1, y1 = CX + dx // 2, CY + dy // 2
    x2, y2 = CX - dx // 2, CY - dy // 2
    shell("input", "swipe", str(x1), str(y1), str(x2), str(y2), str(SWIPE_MS))
    time.sleep(SETTLE_AFTER_PAN)


def tap_center() -> None:
    shell("input", "tap", str(CX), str(CY))
    time.sleep(SETTLE_AFTER_TAP)


def back() -> None:
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(SETTLE_AFTER_BACK)


def vision_popup(img_bytes: bytes) -> dict:
    im = Image.open(BytesIO(img_bytes)).convert("RGB")
    if im.size[0] > 1700:
        new_w = 1600
        new_h = int(im.size[1] * new_w / im.size[0])
        im = im.resize((new_w, new_h), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, "JPEG", quality=88)
    body = json.dumps({
        "model": MODEL, "prompt": POPUP_PROMPT,
        "images": [base64.b64encode(buf.getvalue()).decode()],
        "stream": False, "format": "json",
        "options": {"num_ctx": 4096},
    }).encode()
    req = request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read())
    try:
        return json.loads(data.get("response", "{}"))
    except json.JSONDecodeError:
        return {"popup": False, "_raw": data.get("response", "")[:200]}


def predicted_coord(row: int, col: int) -> tuple[int, int]:
    return (
        round(BASE_X + (col - CENTER) * PAN_DELTA_X),
        round(BASE_Y + (CENTER - row) * PAN_DELTA_Y),
    )


def main():
    if LOCK_FILE.exists():
        log(f"lock {LOCK_FILE} exists — refusing")
        return 1
    LOCK_FILE.write_text(str(os.getpid()))
    try:
        return run()
    finally:
        LOCK_FILE.unlink(missing_ok=True)


def run():
    log(f"=== AUTONOMOUS CALIBRATE — pan_delta=({PAN_DELTA_X}, {PAN_DELTA_Y}) ===")
    log(f"target {TARGET_MATCHES} matches, max {MAX_ATTEMPTS} attempts, tolerance ±{COORD_TOLERANCE}")

    # Walk to top-left of 7x7
    log("walking to top-left...")
    for _ in range(CENTER):
        pan(-PAN_X, 0)
    for _ in range(CENTER):
        pan(0, -PAN_Y)
    log("at r0c0")

    matches: list[dict] = []
    mismatches: list[dict] = []
    no_popup: list[dict] = []
    attempts = 0
    cur_row, cur_col = 0, 0

    for row in range(GRID_SIZE):
        cols = list(range(GRID_SIZE)) if row % 2 == 0 else list(range(GRID_SIZE - 1, -1, -1))
        for i, col in enumerate(cols):
            if (row, col) != (cur_row, cur_col):
                # shouldn't happen but log
                log(f"  WARN expected ({cur_row},{cur_col}) but loop at ({row},{col})")
            if (row, col) == (CENTER, CENTER):
                log(f"  ({row},{col}) skip — own base")
            else:
                attempts += 1
                pred_x, pred_y = predicted_coord(row, col)

                tap_center()
                img = screencap()
                shot_path = SCREENS_DIR / f"r{row}c{col}.png"
                shot_path.write_bytes(img)

                try:
                    result = vision_popup(img)
                except Exception as e:
                    result = {"popup": False, "_err": str(e)[:160]}

                rec = {"row": row, "col": col, "pred": [pred_x, pred_y], "result": result}

                if result.get("popup"):
                    actual_x = result.get("x")
                    actual_y = result.get("y")
                    name = result.get("name") or "?"
                    if isinstance(actual_x, int) and isinstance(actual_y, int):
                        dx = actual_x - pred_x
                        dy = actual_y - pred_y
                        rec["actual"] = [actual_x, actual_y]
                        rec["delta"] = [dx, dy]
                        rec["name"] = name
                        if abs(dx) <= COORD_TOLERANCE and abs(dy) <= COORD_TOLERANCE:
                            matches.append(rec)
                            log(f"  ({row},{col}) MATCH#{len(matches)}: {name} pred=({pred_x},{pred_y}) actual=({actual_x},{actual_y})")
                        else:
                            mismatches.append(rec)
                            log(f"  ({row},{col}) MISMATCH: {name} pred=({pred_x},{pred_y}) actual=({actual_x},{actual_y}) Δ=({dx:+d},{dy:+d})")
                    else:
                        no_popup.append(rec)
                        log(f"  ({row},{col}) popup but no coords: {result}")
                else:
                    no_popup.append(rec)
                    log(f"  ({row},{col}) no popup ({result.get('_err', '')[:60]})")

                # ALWAYS close popup
                back()
                # extra back in case still in popup
                back()

                if len(matches) >= TARGET_MATCHES:
                    log(f"target {TARGET_MATCHES} matches reached at attempt {attempts}")
                    break
                if attempts >= MAX_ATTEMPTS:
                    log(f"hit MAX_ATTEMPTS={MAX_ATTEMPTS}")
                    break

            # advance to next grid cell
            if i < len(cols) - 1:
                next_col = cols[i + 1]
                if next_col > col:
                    pan(+PAN_X, 0)
                else:
                    pan(-PAN_X, 0)
                cur_col = next_col

        if len(matches) >= TARGET_MATCHES or attempts >= MAX_ATTEMPTS:
            break
        # next row
        if row < GRID_SIZE - 1:
            pan(0, +PAN_Y)
            cur_row = row + 1

    # Walk back to center (best-effort: cur_col, cur_row → CENTER)
    dcol = CENTER - cur_col
    drow = CENTER - cur_row
    log(f"returning to center: dcol={dcol}, drow={drow}")
    for _ in range(abs(dcol)):
        pan(+PAN_X if dcol > 0 else -PAN_X, 0)
    for _ in range(abs(drow)):
        pan(0, +PAN_Y if drow > 0 else -PAN_Y)

    # Report
    report = {
        "pan_delta_x": PAN_DELTA_X,
        "pan_delta_y": PAN_DELTA_Y,
        "tolerance": COORD_TOLERANCE,
        "attempts": attempts,
        "matches": len(matches),
        "mismatches": len(mismatches),
        "no_popup": len(no_popup),
        "matches_detail": matches,
        "mismatches_detail": mismatches,
        "no_popup_detail": no_popup,
    }
    REPORT_FILE.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    log(f"=== DONE: {len(matches)}/{attempts} matches ({len(mismatches)} mismatches, {len(no_popup)} no popup) ===")
    log(f"report: {REPORT_FILE}")

    # If 20+ matches: SUCCESS. Otherwise we'd need to recalibrate.
    if len(matches) >= TARGET_MATCHES:
        log("CALIBRATION VERIFIED ✓")
        return 0
    log("CALIBRATION NOT VERIFIED — needs another iteration tomorrow")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
