#!/usr/bin/env python3
"""Record user taps on the AVD via `adb shell getevent`.

Streams events, parses ABS_MT_POSITION_X/Y, emits one record per finger-up
(SYN_REPORT after slot release).

Per recorded tap:
  - timestamp
  - screen pixel coords (scaled from event 0..32767 → 0..2560×1600)
  - screenshot at moment of tap (saved as PNG)

Output: appends JSON line per tap to ~/.local/state/warsync/user_taps.jsonl
Screenshots: ~/.local/state/warsync/user_tap_screens/tap_NNN_timestamp.png
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

ADB = "/opt/homebrew/bin/adb"
SCREEN_W, SCREEN_H = 2560, 1600
EVENT_MAX = 32767  # event coord max

STATE = Path("/Users/ben/.local/state/warsync")
TAPS_FILE = STATE / "user_taps.jsonl"
SCREENS = STATE / "user_tap_screens"
SCREENS.mkdir(parents=True, exist_ok=True)


def main():
    # Truncate the taps file at start
    TAPS_FILE.write_text("")
    counter = 0

    # Start getevent subprocess
    print(f"=== Tap recorder ready ===")
    print(f"Screen: {SCREEN_W}×{SCREEN_H}, event max: {EVENT_MAX}")
    print(f"Logs: {TAPS_FILE}")
    print(f"Screens: {SCREENS}")
    print(f"Listening for taps... Ctrl-C to stop.")
    print()

    proc = subprocess.Popen(
        [ADB, "shell", "getevent", "-lt"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        bufsize=1,
    )

    cur_x = None
    cur_y = None
    cur_slot = 0
    in_touch = False

    try:
        for line in proc.stdout:
            # Format: [    1234.5678] /dev/input/event11: EV_ABS       ABS_MT_POSITION_X    00003c4d
            m = re.search(r"ABS_MT_POSITION_X\s+([0-9a-fA-F]+)", line)
            if m:
                cur_x = int(m.group(1), 16)
                in_touch = True
                continue
            m = re.search(r"ABS_MT_POSITION_Y\s+([0-9a-fA-F]+)", line)
            if m:
                cur_y = int(m.group(1), 16)
                in_touch = True
                continue
            m = re.search(r"ABS_MT_TRACKING_ID\s+([0-9a-fA-F]+)", line)
            if m:
                tid = int(m.group(1), 16)
                if tid == 0xFFFFFFFF:  # finger up
                    if cur_x is not None and cur_y is not None:
                        # Scale to screen pixels
                        sx = round(cur_x / EVENT_MAX * SCREEN_W)
                        sy = round(cur_y / EVENT_MAX * SCREEN_H)
                        ts = time.time()
                        counter += 1
                        # Capture screenshot — but BEFORE the tap UI changes too much
                        shot_path = SCREENS / f"tap_{counter:03d}_{int(ts*1000)}.png"
                        try:
                            data = subprocess.check_output([ADB, "exec-out", "screencap", "-p"], timeout=5)
                            shot_path.write_bytes(data)
                        except Exception as e:
                            shot_path = None
                            print(f"  [screenshot fail: {e}]")
                        rec = {
                            "n": counter,
                            "ts": ts,
                            "screen_xy": [sx, sy],
                            "event_xy": [cur_x, cur_y],
                            "screenshot": str(shot_path) if shot_path else None,
                        }
                        with TAPS_FILE.open("a") as f:
                            f.write(json.dumps(rec) + "\n")
                        print(f"  TAP #{counter}: screen=({sx},{sy}) event=({cur_x},{cur_y})  shot={shot_path.name if shot_path else 'fail'}")
                    cur_x = cur_y = None
                    in_touch = False
    except KeyboardInterrupt:
        print(f"\nStopped. Recorded {counter} taps.")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
