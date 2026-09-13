#!/usr/bin/env python3
"""Verification loop using the Medal-icon → Allianz-Markierung flow.

Per iteration:
  1. Take screenshot of world map.
  2. Vision: find a player base (not user's own) at known pixel pos.
  3. Tap base → wait → screenshot (popup open).
  4. Vision: find Medal icon position in popup.
  5. Tap Medal → wait → screenshot (Allianz-Markierung dialog open).
  6. Vision: extract "Kriegszone #1668 X:N Y:N" coord text.
  7. NEVER tap Bestätigen. BACK BACK to close.
  8. Compare against my 7x7-scan predicted coord (fuzzy name match).

Stops at 20 matches OR 60 attempts. Writes report.
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

HOME_BTN = (1700, 1374)
LUPE_BTN = (700, 1250)

BASE_X, BASE_Y = 494, 563
PAN_DELTA_X = 6.0
PAN_DELTA_Y = 4.67

TARGET_MATCHES = 20
MAX_ATTEMPTS = 50
COORD_TOLERANCE = 4

STATE = Path("/Users/ben/.local/state/warsync")
LOG_FILE = STATE / "verify_medal.log"
REPORT_FILE = STATE / "verify_medal_report.json"
SCREENS = STATE / "verify_screens"
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


def tap(x: int | float, y: int | float):
    shell("input", "tap", str(int(x)), str(int(y)))


def back():
    shell("input", "keyevent", "KEYCODE_BACK")
    time.sleep(0.6)


def teleport_home():
    tap(*HOME_BTN)
    time.sleep(2.0)


def call_vision(img_bytes: bytes, prompt: str, max_size: int = 1280) -> dict:
    im = Image.open(BytesIO(img_bytes)).convert("RGB")
    if im.size[0] > max_size:
        new_w = max_size
        new_h = int(im.size[1] * new_w / im.size[0])
        im = im.resize((new_w, new_h), Image.LANCZOS)
    buf = BytesIO(); im.save(buf, "JPEG", quality=88)
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
        return {"_raw": data.get("response", "")[:200]}


# ------- Vision helpers ----------------------------------------------

FIND_BASE_PROMPT = """Last War Welt-Map-Screenshot. Skaliert auf 1280×800.

Finde EINE Spieler-Basis im Bild — eine Burg/Pyramide mit einem Namens-Banner darüber wie "[XXX]NAME". Wähle eine, die NICHT genau in der Mitte ist (vermeide Mitte ±50 Pixel) und NICHT der Name "Ben the men" ist.

Gib im JSON:
{"name": "[XXX]NAME", "base_pixel": [PX, PY]}

PX, PY = Pixel im 1280×800-Bild auf das Burg-/Pyramiden-Gebäude (NICHT auf das Name-Banner).
Falls keine geeignete Basis sichtbar: {"name": null, "base_pixel": null}
"""

FIND_MEDAL_PROMPT = """Last War Screenshot — Spieler-Popup mit weißem Hintergrund ist offen. Im Popup steht "#1668 [XXX]NAME" und 3 kleine quadratische Icons rechts vom Namen: (1) blaues Wappen mit Stern, (2) blaues Share-Symbol, (3) blauer Stern.

Gib Pixel-Koord des ERSTEN Icons (das Wappen, leftmost):

{"medal_pixel": [PX, PY]}

Skaliere auf 1280×800. Falls kein Popup sichtbar: {"medal_pixel": null}
"""

READ_COORD_PROMPT = """Last War Screenshot — "Allianz-Markierung"-Dialog ist offen. Im Dialog steht eine Zeile mit der Form "Kriegszone #1668 X:N Y:N" oder "X:NUMBER Y:NUMBER".

Lies X und Y als Integer ab.

JSON: {"x": INT, "y": INT}
Falls Dialog nicht offen oder Zahlen nicht lesbar: {"x": null, "y": null}
"""


# ------- name normalization & match --------------------------------

def norm(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"\[[^\]]+\]", "", s)
    s = re.sub(r"^(?:DE|US|FR|GB|JP|JAP|GER|USA|SWE|POL|AT|IT|ES|RU|TR)\|?\s*", "", s, flags=re.I)
    return "".join(c.lower() for c in s if c.isalnum())


def find_predicted_in_scan(name: str, scan_data: list) -> tuple[float, float] | None:
    target = norm(name)
    if not target or len(target) < 3:
        return None
    grid_size = max(t["row"] for t in scan_data) + 1
    center = grid_size // 2
    rows, cols = [], []
    for tile in scan_data:
        for p in tile.get("players", []):
            pn = norm(p.get("name") or "")
            if not pn:
                continue
            if target in pn or pn in target:
                rows.append(tile["row"]); cols.append(tile["col"])
    if not rows:
        return None
    avg_r = sum(rows) / len(rows)
    avg_c = sum(cols) / len(cols)
    return (
        BASE_X + (avg_c - center) * PAN_DELTA_X,
        BASE_Y + (center - avg_r) * PAN_DELTA_Y,
    )


# ------- main loop ---------------------------------------------------

def main():
    log("=== VERIFY VIA MEDAL ===")
    log(f"target {TARGET_MATCHES} matches, max {MAX_ATTEMPTS} attempts, tolerance ±{COORD_TOLERANCE}")

    scan_data = json.loads(Path("/tmp/grid_7x7/result.json").read_text())
    log(f"loaded {sum(len(t.get('players', [])) for t in scan_data)} positions from 7x7 scan")

    teleport_home()
    log("at home")

    matches: list[dict] = []
    misses: list[dict] = []
    attempts = 0
    pan_count = 0

    while attempts < MAX_ATTEMPTS and len(matches) < TARGET_MATCHES:
        attempts += 1
        screen = screencap_to(SCREENS / f"a{attempts:02d}_world.png")

        # 1. Find a base
        try:
            base = call_vision(screen, FIND_BASE_PROMPT, max_size=1280)
        except Exception as e:
            log(f"  #{attempts} vision-find-base err: {e}")
            base = {}
        name = (base.get("name") or "").strip()
        bp = base.get("base_pixel")
        if not name or not isinstance(bp, list) or len(bp) != 2:
            log(f"  #{attempts} no base found, panning")
            shell("input", "swipe", str(CX + PAN_X//2), str(CY), str(CX - PAN_X//2), str(CY), str(SWIPE_MS))
            time.sleep(1.5)
            pan_count += 1
            if pan_count > 5:
                log("  too many pans, teleport home")
                teleport_home(); pan_count = 0
            continue

        # convert pixel back to original 2560x1600
        target_x = int(bp[0] * 2)
        target_y = int(bp[1] * 2)
        log(f"  #{attempts} target: {name} at pixel ({target_x},{target_y})")

        # 2. Tap base
        tap(target_x, target_y)
        time.sleep(1.5)
        screen2 = screencap_to(SCREENS / f"a{attempts:02d}_popup.png")

        # 3. Find medal icon
        try:
            mres = call_vision(screen2, FIND_MEDAL_PROMPT, max_size=1280)
        except Exception as e:
            log(f"  #{attempts} vision-medal err: {e}")
            mres = {}
        mp = mres.get("medal_pixel")
        if not isinstance(mp, list) or len(mp) != 2:
            log(f"  #{attempts} no medal icon found in popup")
            back(); back()
            misses.append({"name": name, "reason": "no_medal"})
            continue
        medal_x = int(mp[0] * 2)
        medal_y = int(mp[1] * 2)

        # 4. Tap medal
        tap(medal_x, medal_y)
        time.sleep(1.5)
        screen3 = screencap_to(SCREENS / f"a{attempts:02d}_dialog.png")

        # 5. Read coord
        try:
            cres = call_vision(screen3, READ_COORD_PROMPT, max_size=1600)
        except Exception as e:
            log(f"  #{attempts} vision-coord err: {e}")
            cres = {}
        actual_x = cres.get("x")
        actual_y = cres.get("y")

        # 6. Close dialogs (BACK closes Allianz-Markierung; second BACK closes popup)
        back(); back()
        time.sleep(0.3)

        if not isinstance(actual_x, int) or not isinstance(actual_y, int):
            log(f"  #{attempts} {name}: dialog opened but coord unreadable")
            misses.append({"name": name, "reason": "no_coord"})
            continue

        # 7. Compare to predicted
        pred = find_predicted_in_scan(name, scan_data)
        if pred is None:
            log(f"  #{attempts} {name}: actual ({actual_x},{actual_y}) — no scan prediction")
            misses.append({"name": name, "actual": [actual_x, actual_y], "reason": "no_pred"})
            continue
        pred_x, pred_y = pred
        dx = actual_x - pred_x
        dy = actual_y - pred_y
        rec = {"name": name, "actual": [actual_x, actual_y], "pred": [round(pred_x, 1), round(pred_y, 1)], "dx": round(dx, 1), "dy": round(dy, 1)}
        if abs(dx) <= COORD_TOLERANCE and abs(dy) <= COORD_TOLERANCE:
            matches.append(rec)
            log(f"  #{attempts} ✓ MATCH#{len(matches)}: {name} actual=({actual_x},{actual_y}) pred=({pred_x:.1f},{pred_y:.1f}) Δ=({dx:+.1f},{dy:+.1f})")
        else:
            misses.append({**rec, "reason": "coord_mismatch"})
            log(f"  #{attempts} ✗ {name} actual=({actual_x},{actual_y}) pred=({pred_x:.1f},{pred_y:.1f}) Δ=({dx:+.1f},{dy:+.1f})")

        # Re-teleport every 5 attempts to avoid drift
        if attempts % 5 == 0:
            teleport_home()
            time.sleep(1)
            pan_count = 0

    # Done — return home
    teleport_home()

    # Compute calibration suggestion from matches
    if matches:
        avg_dx = sum(m["dx"] for m in matches) / len(matches)
        avg_dy = sum(m["dy"] for m in matches) / len(matches)
    else:
        avg_dx = avg_dy = None

    report = {
        "pan_delta_x": PAN_DELTA_X,
        "pan_delta_y": PAN_DELTA_Y,
        "tolerance": COORD_TOLERANCE,
        "attempts": attempts,
        "matches": len(matches),
        "misses": len(misses),
        "avg_dx_in_matches": avg_dx,
        "avg_dy_in_matches": avg_dy,
        "matches_detail": matches,
        "misses_detail": misses,
    }
    REPORT_FILE.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    log(f"=== DONE: {len(matches)}/{attempts} matches, {len(misses)} misses ===")
    return 0 if len(matches) >= TARGET_MATCHES else 2


if __name__ == "__main__":
    raise SystemExit(main())
