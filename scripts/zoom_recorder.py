#!/usr/bin/env python3
"""Continuous screenshot recorder during user pinch-zoom-out.

Captures one screencap every ~700ms, saves with sequence number + timestamp.
Stops on Ctrl-C. Output: ~/.local/state/warsync/zoom_recording_<timestamp>/
"""
from __future__ import annotations

import datetime
import subprocess
import time
from pathlib import Path

ADB = "/opt/homebrew/bin/adb"
INTERVAL_S = 0.7

base = Path("/Users/ben/.local/state/warsync") / f"zoom_recording_{datetime.datetime.now():%Y%m%d_%H%M%S}"
base.mkdir(parents=True, exist_ok=True)
print(f"Recording to: {base}")
print(f"Interval: {INTERVAL_S}s — Ctrl-C to stop")
print()

n = 0
try:
    while True:
        n += 1
        ts = time.time()
        path = base / f"frame_{n:04d}_{int(ts*1000)}.png"
        try:
            data = subprocess.check_output([ADB, "exec-out", "screencap", "-p"], timeout=5)
            path.write_bytes(data)
            sz = len(data) // 1024
            print(f"  #{n:04d} {path.name} ({sz}KB)")
        except Exception as e:
            print(f"  #{n:04d} ERR: {e}")
        # Sleep until next interval
        elapsed = time.time() - ts
        time.sleep(max(0, INTERVAL_S - elapsed))
except KeyboardInterrupt:
    print(f"\nStopped. {n} frames in {base}")
