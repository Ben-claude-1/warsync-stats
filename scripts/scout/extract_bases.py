"""Live-test of full per-base coordinate extraction.

For each detected base candidate:
  1. Tap base center → expect popup top-left
  2. Tap popup-star → expect favorit dialog
  3. OCR coords from dialog header
  4. Tap close-X → back to map
  5. Verify each step via screencap, abort on mismatch
"""
from __future__ import annotations

import base64
import json
import subprocess
import time
from pathlib import Path
from urllib import request as urlrequest

import numpy as np
from PIL import Image

ADB = "/opt/homebrew/bin/adb"
COORDS_FILE = Path(__file__).resolve().parent / "coords.json"


def adb_device() -> str:
    out = subprocess.check_output([ADB, "devices"], text=True).splitlines()
    return next(l.split("\t")[0] for l in out[1:] if "\tdevice" in l)


def screencap(dev: str, out: Path) -> None:
    data = subprocess.check_output([ADB, "-s", dev, "exec-out", "screencap", "-p"])
    out.write_bytes(data)


def tap(dev: str, x: int, y: int) -> None:
    subprocess.run([ADB, "-s", dev, "shell", "input", "tap", str(x), str(y)], check=True)


def detect_banners(png_path: Path) -> list[tuple[int, int]]:
    """Return [(base_center_x, base_center_y), ...] candidates."""
    arr = np.array(Image.open(png_path))
    H, W = arr.shape[:2]
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    banner_px = (
        ((b > 150) & (g > 130) & (r < 150) & (b > r + 30)) |
        ((r > 200) & (g > 150) & (g < 230) & (b < 130) & (r > b + 80))
    )
    row_sum = banner_px.sum(axis=1)
    smoothed = np.convolve(row_sum, np.ones(50)/50, mode='same')
    mean, std = smoothed.mean(), smoothed.std()
    hot_y = np.where(smoothed > mean + 0.3 * std)[0]
    if not len(hot_y):
        return []
    breaks = np.where(np.diff(hot_y) > 30)[0]
    starts = np.concatenate([[hot_y[0]], hot_y[breaks+1]])
    ends = np.concatenate([hot_y[breaks], [hot_y[-1]]])
    bases = []
    for s, e in zip(starts, ends):
        if e - s < 20:
            continue
        cy = (s + e) // 2
        if cy < 250 or cy > 1400:
            continue
        sub = banner_px[s:e]
        col_sum = sub.sum(axis=0)
        smooth_x = np.convolve(col_sum, np.ones(50)/50, mode='same')
        th = smooth_x.mean() + 0.5 * smooth_x.std()
        hot_x = np.where(smooth_x > th)[0]
        if not len(hot_x):
            continue
        bx = np.where(np.diff(hot_x) > 100)[0]
        sx = np.concatenate([[hot_x[0]], hot_x[bx+1]])
        ex = np.concatenate([hot_x[bx], [hot_x[-1]]])
        for s_, e_ in zip(sx, ex):
            w = e_ - s_
            if 100 < w < 320:
                cx = (s_ + e_) // 2
                # Base center is slightly above the banner (user said "zentral etwas über")
                bases.append((int(cx), int(cy - 80)))
    return bases


def has_popup(png_path: Path) -> bool:
    """Detect if profile popup is open (top-left small dialog)."""
    arr = np.array(Image.open(png_path))
    # Popup has bright blue button strip at y≈100..160, x≈950..1230
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    blue = (b > 200) & (r < 100) & (g > 130) & (g < 230)
    region = blue[80:170, 950:1450]
    return region.sum() > 1000


def has_favorit_dialog(png_path: Path) -> bool:
    """Detect if 'Zu Favoriten hinzufügen' dialog is open (white dialog with X close)."""
    arr = np.array(Image.open(png_path))
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    # Close X is white pixels near (1653, 159)
    white = (r > 200) & (g > 200) & (b > 200)
    return white[140:200, 1620:1700].sum() > 500


OLLAMA = "http://127.0.0.1:11434/api/generate"


def ocr_coords_from_dialog(png_path: Path, crop_box: tuple) -> dict | None:
    """Crop the coord text region and OCR via vision model."""
    Image.open(png_path).crop(crop_box).save("/tmp/last_coord_crop.png")
    img = Path("/tmp/last_coord_crop.png").read_bytes()
    body = json.dumps({
        "model": "qwen2.5vl:7b",
        "prompt": ('Lies den Text. Format: {"text":"...","x":int,"y":int,"server":int}\n'
                   'Beispiel: aus "Kriegszone #1668 X:491 Y:566" → '
                   '{"text":"Kriegszone #1668 X:491 Y:566","x":491,"y":566,"server":1668}'),
        "images": [base64.b64encode(img).decode()],
        "stream": False, "format": "json",
        "options": {"num_ctx": 2048},
    }).encode()
    req = urlrequest.Request(OLLAMA, data=body,
                             headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=120) as r:
            data = json.loads(r.read())
        return json.loads(data.get("response", "{}"))
    except Exception:
        return None


def main() -> int:
    coords = json.loads(COORDS_FILE.read_text())
    star = coords["popup_star"]
    close_x = coords["fav_dialog_close"]
    crop_box = tuple(coords["fav_dialog_text_box"])

    dev = adb_device()
    cur = Path("/tmp/extract_cur.png")
    screencap(dev, cur)
    bases = detect_banners(cur)
    print(f"detected {len(bases)} base candidates")
    results = []
    for i, (bx, by) in enumerate(bases, 1):
        print(f"\n[{i}/{len(bases)}] base candidate ({bx},{by})")
        tap(dev, bx, by)
        time.sleep(1.8)
        screencap(dev, cur)
        if not has_popup(cur):
            print("  → no popup, skip")
            results.append({"tap": (bx, by), "status": "no_popup"})
            continue
        tap(dev, *star)
        time.sleep(1.6)
        screencap(dev, cur)
        if not has_favorit_dialog(cur):
            print("  → no favorit dialog after star, skip")
            results.append({"tap": (bx, by), "status": "no_dialog"})
            # Try to recover: tap empty area to dismiss any popup
            tap(dev, 100, 800); time.sleep(1)
            continue
        ocr = ocr_coords_from_dialog(cur, crop_box)
        print(f"  → ocr: {ocr}")
        results.append({"tap": (bx, by), "status": "ok", "ocr": ocr})
        # Close dialog
        tap(dev, *close_x)
        time.sleep(1.4)

    print("\n=== summary ===")
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
