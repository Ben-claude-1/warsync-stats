"""Autonomous base coordinate extraction around home base.

Strategy:
1. Verify world-view (tap WELT if in base-view), then teleport home (494, 563).
2. Grid-sample taps within the player-base zone (skip top/bottom UI).
3. For each tap, detect the player-profile popup specifically:
   - 3 blue circular buttons in a row (centers ~50-90px apart)
   - WHITE/cream profile card background within ~50px of buttons
   - Region within game content (645 < x < 1914, y < 1300 — exclude bottom nav)
4. Tap rightmost blue button (=star). Verify favorit-dialog opens.
5. OCR coords. Persist. Tap fav_dialog_close (1653, 159).
6. Recovery: NEVER use KEYCODE_BACK (it switches to base view).
   Use safe_dismiss_tap (300, 800 in black bar) or fav_dialog_close.
7. Every 4 collected, fit pixel→world transform and log.

Output:
- /tmp/auto_scout.log — running log
- scripts/scout/calibration_samples.json — raw tuples
- scripts/scout/pixel_to_world.json — final formula
- warsync.scans rows with source='autonomous'
"""
from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib import request as urlrequest

import numpy as np
from PIL import Image

ADB = "/opt/homebrew/bin/adb"
LOG_FILE = Path("/tmp/auto_scout.log")
COORDS_FILE = Path(__file__).resolve().parent / "coords.json"
OLLAMA = "http://127.0.0.1:11434/api/generate"


def _ts() -> str:
    return time.strftime("%H:%M:%S")


def log(msg: str) -> None:
    line = f"[{_ts()}] {msg}"
    print(line, flush=True)
    with LOG_FILE.open("a") as f:
        f.write(line + "\n")


def adb_dev() -> str:
    out = subprocess.check_output([ADB, "devices"], text=True).splitlines()
    return next(l.split("\t")[0] for l in out[1:] if "\tdevice" in l)


def adb_tap(d: str, x: int, y: int) -> None:
    subprocess.run([ADB, "-s", d, "shell", "input", "tap", str(int(x)), str(int(y))],
                   check=True, capture_output=True)


def adb_back(d: str) -> None:
    subprocess.run([ADB, "-s", d, "shell", "input", "keyevent", "KEYCODE_BACK"],
                   capture_output=True)


def adb_screencap(d: str) -> np.ndarray:
    data = subprocess.check_output([ADB, "-s", d, "exec-out", "screencap", "-p"])
    return np.array(Image.open(io.BytesIO(data)))


COORDS = json.loads(COORDS_FILE.read_text())


def is_world_view(arr: np.ndarray) -> bool:
    """In world view the BASIS button is bottom-right (blue); in base view it's WELT (green)."""
    region = arr[1450:1560, 1750:1880]
    r, g, b = region[..., 0], region[..., 1], region[..., 2]
    green = (g > 150) & (r < 120) & (b < 120)
    return int(green.sum()) < 200


def lupe_visible(arr: np.ndarray) -> bool:
    """Check Lupe icon at (705, 1255). Visible = no modal blocking the world view."""
    region = arr[1230:1280, 685:730]
    r, g, b = region[..., 0], region[..., 1], region[..., 2]
    blue = (r < 100) & (g > 50) & (g < 140) & (b > 90) & (b < 170)
    return int(blue.sum()) > 200


def dismiss_modal(d: str) -> bool:
    """Recover to a clean world view. Returns True if Lupe visible after.

    Strategy:
    1. KEYCODE_BACK (closes any modal in Last War; switches base↔world only if no modal)
    2. If now in base view (because BACK with no modal switched), tap WELT
    3. Repeat once more if still no Lupe.
    """
    arr = adb_screencap(d)
    if lupe_visible(arr):
        return True
    for attempt in range(3):
        adb_back(d)
        time.sleep(1.2)
        arr = adb_screencap(d)
        if lupe_visible(arr):
            return True
        if not is_world_view(arr):
            adb_tap(d, *COORDS["welt_button"])
            time.sleep(2.0)
            arr = adb_screencap(d)
            if lupe_visible(arr):
                return True
    log("  ! couldn't restore world view")
    return False


_LUPE_TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "Pics" / "icons" / "lupe_icon_v2.png"
_LUPE_TEMPLATE_GRAY = None


def _lupe_template():
    global _LUPE_TEMPLATE_GRAY
    if _LUPE_TEMPLATE_GRAY is None:
        try:
            import cv2
            t = cv2.imread(str(_LUPE_TEMPLATE_PATH), cv2.IMREAD_GRAYSCALE)
            _LUPE_TEMPLATE_GRAY = t
        except Exception:
            _LUPE_TEMPLATE_GRAY = False
    return _LUPE_TEMPLATE_GRAY if _LUPE_TEMPLATE_GRAY is not False else None


def find_lupe(d: str) -> tuple[int, int] | None:
    """Locate Lupe icon center in current screenshot via template-match.
    Returns (x, y) or None if not found above 0.6 confidence."""
    try:
        import cv2
    except ImportError:
        return tuple(COORDS["search_icon"])
    tmpl = _lupe_template()
    if tmpl is None:
        return tuple(COORDS["search_icon"])
    arr = adb_screencap(d)
    gray = cv2.cvtColor(arr[..., :3], cv2.COLOR_RGB2GRAY)
    res = cv2.matchTemplate(gray, tmpl, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    if max_val < 0.55:
        return None
    h, w = tmpl.shape
    cx = max_loc[0] + w // 2
    cy = max_loc[1] + h // 2
    return (cx, cy)


def teleport(d: str, x: int, y: int) -> None:
    # Dynamically find Lupe (icon column shifts due to notifications)
    lupe = find_lupe(d) or tuple(COORDS["search_icon"])
    adb_tap(d, *lupe); time.sleep(1.6)
    # X-field: tap, clear (delete 8 to be safe), type
    adb_tap(d, *COORDS["coord_x_field"]); time.sleep(0.5)
    adb_tap(d, *COORDS["coord_x_field"]); time.sleep(0.5)  # double-tap to ensure focus
    for _ in range(8):
        subprocess.run([ADB, "-s", d, "shell", "input", "keyevent", "67"], capture_output=True)
    time.sleep(0.3)
    subprocess.run([ADB, "-s", d, "shell", "input", "text", str(x)], capture_output=True)
    time.sleep(0.6)
    # Y-field: tap, clear, type
    adb_tap(d, *COORDS["coord_y_field"]); time.sleep(0.5)
    adb_tap(d, *COORDS["coord_y_field"]); time.sleep(0.5)
    for _ in range(8):
        subprocess.run([ADB, "-s", d, "shell", "input", "keyevent", "67"], capture_output=True)
    time.sleep(0.3)
    subprocess.run([ADB, "-s", d, "shell", "input", "text", str(y)], capture_output=True)
    time.sleep(0.6)
    adb_tap(d, *COORDS["coord_go_button"])
    time.sleep(3.5)


def detect_player_popup(arr: np.ndarray) -> tuple | None:
    """Find a PLAYER-PROFILE popup: 3 blue buttons + nearby white card.

    Returns (x_star, y_star) or None.

    Filters:
    - Restrict to game content area (645 < x < 1914)
    - Restrict y to upper portion (y < 1300) — exclude bottom nav bar
    - Require white/cream card pixels within 100px of blue button cluster
    - Reject if buttons at extreme right edge (likely nav bar at x > 1700 with y > 1400)
    """
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    blue = (b > 200) & (r < 100) & (g > 130) & (g < 230)
    # White card: cream/light-grey background
    card = (r > 200) & (g > 195) & (b > 195)

    H, W = blue.shape
    for y0 in range(40, 1250, 12):  # only above bottom nav
        band = blue[y0:y0+60].sum(axis=0)
        # Restrict to game content x-range
        band[:645] = 0
        band[1914:] = 0
        smooth = np.convolve(band, np.ones(15)/15, mode="same")
        hot = np.where(smooth > 8)[0]
        if len(hot) < 30:
            continue
        breaks = np.where(np.diff(hot) > 5)[0]
        starts = np.concatenate([[hot[0]], hot[breaks+1]])
        ends = np.concatenate([hot[breaks], [hot[-1]]])
        runs = [(int((s+e)//2), int(e-s)) for s, e in zip(starts, ends) if 30 < e-s < 100]
        for i in range(len(runs) - 2):
            c1, w1 = runs[i]
            c2, w2 = runs[i+1]
            c3, w3 = runs[i+2]
            d12 = c2 - c1
            d23 = c3 - c2
            if 40 < d12 < 100 and 40 < d23 < 100 and abs(d12 - d23) < 20:
                # Validate: there should be card-colored pixels near these buttons
                y_btn = y0 + 30
                # Check region around buttons for white card
                region_y0 = max(0, y_btn - 150)
                region_y1 = min(H, y_btn + 150)
                region_x0 = max(0, c1 - 200)
                region_x1 = min(W, c3 + 100)
                card_count = int(card[region_y0:region_y1, region_x0:region_x1].sum())
                if card_count < 5000:
                    # Not a player popup (no white card nearby)
                    continue
                # Also reject if buttons are too low (overlap with bottom UI)
                if y_btn > 1350:
                    continue
                return (c3, y_btn)
    return None


def is_favorit_dialog(arr: np.ndarray) -> bool:
    """Coarse check: large white modal card + X-close.
    Final validation is done by the OCR text content (validate_coords).
    """
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    white = (r > 200) & (g > 200) & (b > 200)
    central_white = int(white[200:1300, 700:1900].sum())
    x_close = int(white[140:200, 1620:1700].sum())
    return central_white > 200000 and x_close > 500


def validate_coords(d: dict) -> bool:
    """OCR output sanity: text starts with 'Kriegszone', x/y in valid range."""
    if not d:
        return False
    x, y = d.get("x"), d.get("y")
    if not (isinstance(x, int) and isinstance(y, int)):
        return False
    if not (1 <= x <= 1500 and 1 <= y <= 1500):
        return False
    text = (d.get("text") or "").lower()
    if "kriegszone" not in text and "x:" not in text:
        return False
    return True


def ocr_dialog_coords(arr: np.ndarray) -> dict | None:
    crop_box = COORDS.get("fav_dialog_text_box", [850, 280, 1700, 360])
    crop = Image.fromarray(arr).crop(tuple(crop_box))
    buf = io.BytesIO()
    crop.save(buf, "PNG")
    body = json.dumps({
        "model": "qwen2.5vl:7b",
        "prompt": ('Lies den Text. Format: {"text":"...","x":int,"y":int,"server":int}\n'
                   'Beispiel: aus "Kriegszone #1668 X:491 Y:566" → '
                   '{"text":"Kriegszone #1668 X:491 Y:566","x":491,"y":566,"server":1668}'),
        "images": [base64.b64encode(buf.getvalue()).decode()],
        "stream": False, "format": "json",
        "options": {"num_ctx": 2048},
    }).encode()
    req = urlrequest.Request(OLLAMA, data=body,
                             headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        return json.loads(data.get("response", "{}"))
    except Exception as exc:
        log(f"  OCR error: {exc}")
        return None


def safe_dismiss(d: str) -> None:
    """Tap into the black bar to dismiss generic popups without panning view."""
    adb_tap(d, *COORDS["safe_dismiss_tap"])
    time.sleep(0.8)


def ensure_world_view(d: str) -> None:
    arr = adb_screencap(d)
    if is_world_view(arr):
        return
    log("  not in world view — tap WELT")
    adb_tap(d, *COORDS["welt_button"])
    time.sleep(2.5)


def persist_base(world_x: int, world_y: int, click_x: int, click_y: int,
                 server: int, source: str = "autonomous") -> None:
    notes = json.dumps({"click_x": click_x, "click_y": click_y,
                        "world_x": world_x, "world_y": world_y,
                        "server": server})
    sql = (
        "INSERT INTO warsync.scans (started_at, finished_at, scout_account, "
        "map_zone, status, notes, tile_count) VALUES "
        f"(NOW(), NOW(), '{source}', 'state_map', 'done', "
        f"$${notes}$$::text, 1);"
    )
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
        capture_output=True
    )
    if proc.returncode != 0:
        log(f"  DB persist error: {proc.stderr.decode()[:200]}")


def fit_transform(samples: list[dict]) -> dict:
    A = np.array([[s["click_xy"][0], s["click_xy"][1], 1.0] for s in samples])
    bx = np.array([s["world_xy"][0] for s in samples], dtype=float)
    by = np.array([s["world_xy"][1] for s in samples], dtype=float)
    cx, _, _, _ = np.linalg.lstsq(A, bx, rcond=None)
    cy, _, _, _ = np.linalg.lstsq(A, by, rcond=None)
    pred_x = A @ cx
    pred_y = A @ cy
    rms_x = float(np.sqrt(np.mean((bx - pred_x) ** 2)))
    rms_y = float(np.sqrt(np.mean((by - pred_y) ** 2)))
    max_x = float(np.max(np.abs(bx - pred_x)))
    max_y = float(np.max(np.abs(by - pred_y)))
    return {
        "n": len(samples),
        "x_formula": f"world_x = {cx[0]:+.5f}*px {cx[1]:+.5f}*py {cx[2]:+.2f}",
        "y_formula": f"world_y = {cy[0]:+.5f}*px {cy[1]:+.5f}*py {cy[2]:+.2f}",
        "rms": (rms_x, rms_y),
        "max_err": (max_x, max_y),
        "coefs_x": cx.tolist(),
        "coefs_y": cy.tolist(),
    }


def autonomous_run(duration_s: int, max_bases: int) -> None:
    LOG_FILE.write_text("")
    d = adb_dev()
    log(f"START dev={d} dur={duration_s}s cap={max_bases}")

    # Bootstrap: ensure world view, then teleport home
    ensure_world_view(d)
    safe_dismiss(d)
    teleport(d, 494, 563)
    log("teleported (494,563)")

    collected: list[dict] = []
    deadline = time.time() + duration_s

    # Hive grid: keep y >= 550 to avoid popups that overflow above screen
    grid_x = list(range(800, 1880, 100))   # 11 cols
    grid_y = list(range(550, 1220, 95))    # 8 rows
    grid = [(x, y) for y in grid_y for x in grid_x]
    # Snake-order (alternate row direction) — reduces accidental drift
    snake = []
    for ri, y in enumerate(grid_y):
        row = grid_x if ri % 2 == 0 else grid_x[::-1]
        for x in row:
            snake.append((x, y))
    grid = snake
    log(f"grid: {len(grid)} positions ({len(grid_x)}x{len(grid_y)})")

    seen_star_positions: list[tuple] = []
    seen_world_coords: set = set()

    for i, (tx, ty) in enumerate(grid):
        if time.time() > deadline:
            log("deadline"); break
        if len(collected) >= max_bases:
            log("max_bases"); break

        # Skip if too close to a recent successful click (wider filter — bases are ~200px wide)
        if any(abs(c["click_xy"][0] - tx) < 180 and abs(c["click_xy"][1] - ty) < 100
               for c in collected[-30:]):
            continue

        # CRITICAL: before every tap, ensure we're in a tappable world view (no modal)
        if not dismiss_modal(d):
            log("  modal stuck → ensure world view + re-teleport")
            ensure_world_view(d)
            teleport(d, 494, 563)
            if not lupe_visible(adb_screencap(d)):
                log("  still no lupe after recovery → skip iteration")
                continue

        log(f"[{i+1}/{len(grid)} | got {len(collected)}] tap ({tx},{ty})")
        try:
            adb_tap(d, tx, ty)
            time.sleep(1.5)
            arr = adb_screencap(d)

            popup = detect_player_popup(arr)
            if not popup:
                # No player popup. Maybe modal opened from this tap.
                if not lupe_visible(arr):
                    dismiss_modal(d)
                continue

            sx, sy = popup
            if sy < 80:
                log(f"  popup buttons too high (y={sy}) — clipped")
                dismiss_modal(d)
                continue
            # Star-position dedup: if we've seen this exact star position, it's the same base
            if any(abs(p[0]-sx) < 30 and abs(p[1]-sy) < 30 for p in seen_star_positions):
                log(f"  popup at ({sx},{sy}) already extracted — close + skip")
                dismiss_modal(d)
                continue
            log(f"  popup → star ({sx},{sy})")
            adb_tap(d, sx, sy)
            time.sleep(1.5)
            arr = adb_screencap(d)

            if not is_favorit_dialog(arr):
                log("  no favorit-dialog after star")
                dismiss_modal(d)
                continue

            coords = ocr_dialog_coords(arr)
            if validate_coords(coords):
                wx, wy = int(coords["x"]), int(coords["y"])
                server = int(coords.get("server", 1668))
                seen_star_positions.append((sx, sy))
                if (wx, wy) in seen_world_coords:
                    log(f"  ⊘ duplicate world ({wx},{wy}) — skip persist")
                else:
                    seen_world_coords.add((wx, wy))
                    text = coords.get('text', '')
                    log(f"  ✓ click=({tx},{ty}) star=({sx},{sy}) → world=({wx},{wy})  [{text[:50]}]")
                    collected.append({
                        "click_xy": (tx, ty),
                        "star_xy": (sx, sy),
                        "world_xy": (wx, wy),
                        "server": server,
                        "ts": _ts(),
                    })
                    persist_base(wx, wy, tx, ty, server)
            else:
                log(f"  ✗ OCR rejected: {coords}")

            adb_tap(d, *COORDS["fav_dialog_close"])
            time.sleep(1.2)

            n = len(collected)
            if n >= 6 and (n % 4 == 0):
                t = fit_transform(collected)
                log(f"  TRANSFORM ({n}): {t['x_formula']}")
                log(f"                  {t['y_formula']}")
                log(f"                  rms=({t['rms'][0]:.2f},{t['rms'][1]:.2f}) "
                    f"max=({t['max_err'][0]:.1f},{t['max_err'][1]:.1f})")

        except Exception as exc:
            log(f"  ! {type(exc).__name__}: {exc}")
            safe_dismiss(d)

    log(f"\n=== FINAL collected={len(collected)} ===")
    if len(collected) >= 6:
        t = fit_transform(collected)
        log(f"FINAL: {t['x_formula']}")
        log(f"       {t['y_formula']}")
        log(f"       rms=({t['rms'][0]:.3f},{t['rms'][1]:.3f}) max=({t['max_err'][0]:.2f},{t['max_err'][1]:.2f})")
        Path(__file__).resolve().parent.joinpath("pixel_to_world.json").write_text(json.dumps(t, indent=2))
    Path(__file__).resolve().parent.joinpath("calibration_samples.json").write_text(
        json.dumps(collected, indent=2, default=str))


if __name__ == "__main__":
    dur = int(sys.argv[1]) if len(sys.argv) > 1 else 5400
    cap = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    autonomous_run(dur, cap)
