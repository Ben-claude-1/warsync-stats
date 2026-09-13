#!/usr/bin/env python3
"""warsync scout master-loop.

Runs only when ~/.local/state/warsync/mode is "scouting" (set via
`warsync-mode scouting`). Drives the AVD via ADB, performs four tasks
in a configurable rotation:

    A  scout_map        — pan the world map, OCR every tile
    B  scout_search     — look up specific player names from a queue
    C  scout_rally      — join alliance rally invites
    D  scout_rewards    — collect daily/mail/calendar/quest rewards

Sub-modules live in `scripts/scout/` and each exposes:
    run(adb, db, ctx) -> dict  # returns counters/log info

The loop pauses immediately when mode flips back to "playing".

Status:
    All four sub-modules are SKELETONS — they print "TODO" and return.
    Touch-coordinates need to be captured empirically once Last War is
    logged in inside the AVD. Run with --capture to enter calibration mode.

Usage:
    python3 scripts/scout_loop.py                # respect mode flag
    python3 scripts/scout_loop.py --once         # one rotation, then exit
    python3 scripts/scout_loop.py --task map     # run only one task
    python3 scripts/scout_loop.py --capture      # calibration helper
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# Adjust path so we can import sibling modules
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from scout import scout_map, scout_search, scout_rally, scout_rewards  # noqa: E402

ADB = "/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
MODE_FILE = Path.home() / ".local/state/warsync/mode"
LOG_FILE = Path.home() / ".local/state/warsync/scout.log"


# Time between full rotations (seconds). Each task internally throttles itself.
ROTATION_SLEEP_SCOUTING = 30
ROTATION_SLEEP_PLAYING = 120

TASKS = {
    "map":     scout_map,
    "search":  scout_search,
    "rally":   scout_rally,
    "rewards": scout_rewards,
}

# How often each task wants to run (seconds since last successful run)
TASK_INTERVAL = {
    "map":     3600,   # full map sweep at most once per hour
    "search":  60,     # check pending lookup queue often
    "rally":   180,    # check inbox every 3 min for rally invites
    "rewards": 1800,   # collect freebies every 30 min
}


def now() -> float:
    return time.time()


def read_mode() -> str:
    try:
        return MODE_FILE.read_text().strip()
    except FileNotFoundError:
        return "unknown"


def log(msg: str) -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
    LOG_FILE.open("a").write(line)
    print(line, end="", flush=True)


def adb_device() -> str | None:
    import subprocess
    proc = subprocess.run([ADB, "devices"], capture_output=True, text=True)
    for line in proc.stdout.splitlines()[1:]:
        if "\tdevice" in line:
            return line.split("\t")[0]
    return None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--once", action="store_true", help="run one rotation and exit")
    p.add_argument("--task", choices=list(TASKS), help="run only this task")
    p.add_argument("--capture", action="store_true", help="enter touch-coordinate calibration mode")
    args = p.parse_args()

    if args.capture:
        from scout.calibrate import run_calibration
        return run_calibration(adb=ADB)

    last_run: dict[str, float] = {k: 0.0 for k in TASKS}
    ctx = {"adb": ADB, "session_started": now()}

    log("scout_loop up")
    while True:
        mode = read_mode()
        if mode != "scouting":
            log(f"mode={mode}, sleeping {ROTATION_SLEEP_PLAYING}s")
            if args.once:
                return 0
            time.sleep(ROTATION_SLEEP_PLAYING)
            continue

        device = adb_device()
        if not device:
            log("no adb device — emulator not running?")
            if args.once:
                return 1
            time.sleep(60)
            continue

        ctx["device"] = device

        # Decide which tasks to run this rotation
        task_names = [args.task] if args.task else list(TASKS)
        for tname in task_names:
            if not args.task and now() - last_run[tname] < TASK_INTERVAL[tname]:
                continue
            mod = TASKS[tname]
            try:
                result = mod.run(ctx) or {}
                log(f"  {tname}: {json.dumps(result, ensure_ascii=False)[:200]}")
                last_run[tname] = now()
            except Exception as exc:  # noqa: BLE001
                log(f"  {tname}: ERR {exc}")
                last_run[tname] = now()

            # bail early if user switched mode mid-rotation
            if read_mode() != "scouting":
                log("mode flipped — pausing")
                break

        if args.once:
            return 0
        time.sleep(ROTATION_SLEEP_SCOUTING)


if __name__ == "__main__":
    sys.exit(main())
