"""Interactive touch-coordinate capture.

When run, prints the live cursor / tap location from the AVD so the
operator can record a label + (x, y) for each named anchor (e.g.
"map_icon", "search_button", ...). Stores results in
`scripts/scout/coords.json` for the sub-tasks to import.

Usage:
    python3 scripts/scout_loop.py --capture
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

COORDS_FILE = Path(__file__).resolve().parent / "coords.json"


def screenshot(adb: str, device: str, out: Path) -> None:
    data = subprocess.check_output([adb, "-s", device, "exec-out", "screencap", "-p"])
    out.write_bytes(data)


def run_calibration(adb: str) -> int:
    devs = subprocess.check_output([adb, "devices"], text=True).splitlines()
    device = next((l.split("\t")[0] for l in devs[1:] if "\tdevice" in l), None)
    if not device:
        print("no AVD device", file=sys.stderr)
        return 1

    coords: dict = {}
    if COORDS_FILE.exists():
        coords = json.loads(COORDS_FILE.read_text())

    print(f"calibrating against {device}")
    print("Workflow per anchor:")
    print("  1. Position the screen so the target is visible")
    print("  2. Type the anchor label, e.g. 'map_icon'")
    print("  3. Type x,y in device pixels (use a screenshot to read off coords)")
    print("  4. type 'show' to take a fresh screenshot to /tmp/avd_calib.png")
    print("  5. type 'q' to save & quit")
    print()
    print(f"current: {list(coords.keys())}")

    while True:
        try:
            label = input("label> ").strip()
        except EOFError:
            break
        if not label:
            continue
        if label == "q":
            break
        if label == "show":
            screenshot(adb, device, Path("/tmp/avd_calib.png"))
            print("saved /tmp/avd_calib.png")
            continue
        try:
            xy = input(f"  {label} x,y> ").strip()
            x, y = (int(s.strip()) for s in xy.split(","))
        except (ValueError, KeyboardInterrupt):
            print("  skipped")
            continue
        coords[label] = [x, y]
        # immediately tap the spot to verify
        subprocess.run([adb, "-s", device, "shell", "input", "tap", str(x), str(y)])
        print(f"  saved + tapped {label}=({x},{y})")

    COORDS_FILE.write_text(json.dumps(coords, indent=2, ensure_ascii=False))
    print(f"\nwritten: {COORDS_FILE}")
    return 0
