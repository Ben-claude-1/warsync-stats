"""Task D — Reward-Collect. Sweep the standard daily/mail/calendar/
quest/alliance-gift screens and tap "Claim" wherever a button is
present.

STATUS: SKELETON. Each reward source is a separate small routine
that needs UI calibration:

  - mail_icon_xy → mail_claim_all_xy → close
  - quest_icon_xy → quest_claim_all_xy → close
  - calendar/event_icon_xy → daily_claim_xy → close
  - alliance_gift_icon_xy → claim_all_xy
"""
from __future__ import annotations

from typing import Any


def run(ctx: dict[str, Any]) -> dict:
    return {
        "task": "rewards",
        "status": "skeleton",
        "todo": "calibrate inbox/quest/calendar claim buttons",
    }
