"""Run a 3x3 smoke test around the user's base and print results."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scout.scout_map import scan_grid  # noqa: E402


def main() -> int:
    cx = int(sys.argv[1]) if len(sys.argv) > 1 else 494
    cy = int(sys.argv[2]) if len(sys.argv) > 2 else 563
    radius = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    step = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    save_dir = Path("/tmp/warsync_smoke")
    save_dir.mkdir(parents=True, exist_ok=True)
    print(f"smoke_test center=({cx},{cy}) radius={radius} step={step}")
    out = scan_grid(cx, cy, step=step, radius=radius,
                    source="smoke_test", save_dir=save_dir)
    print(json.dumps(out, indent=2))
    return 0 if out["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
