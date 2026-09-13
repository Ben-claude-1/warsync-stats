"""Task B — Player-Lookup. Process a queue of player names that need
their profile / strength refreshed; for each: tap search → type name →
tap match → screencap profile → OCR → store.

The queue lives in Postgres:
    warsync.search_queue (id, player_name, requested_at, status)

Operator can drop names in via SQL or a small CLI.

STATUS: SKELETON. Need calibration of search-icon position, search
input, result-list tap, profile-close button.
"""
from __future__ import annotations

from typing import Any


def run(ctx: dict[str, Any]) -> dict:
    return {
        "task": "search",
        "status": "skeleton",
        "todo": "calibrate search dialog touch points",
    }
