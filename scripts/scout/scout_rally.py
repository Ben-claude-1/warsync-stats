"""Task C — Rally-Join. Open Alliance → Mail / Active Rallies, tap
each open invite, join with the configured army composition.

STATUS: SKELETON. Calibration needed for:
  - alliance_icon_xy
  - rally_tab_xy
  - active_rally_row_y_offset
  - join_button_xy
  - march_setup_confirm_xy
"""
from __future__ import annotations

from typing import Any


def run(ctx: dict[str, Any]) -> dict:
    return {
        "task": "rally",
        "status": "skeleton",
        "todo": "calibrate alliance/rally screens",
    }
