"""Pass 2: For every unique player name from vision_sweeps, get their EXACT world coord.

Strategy:
1. Query DB for unique player names + their average tile (where Pass 1 saw them)
2. For each name:
   a. Teleport to the average tile
   b. Tap screen-center → if a player popup opens
   c. Verify name matches expected (OCR popup header)
   d. Tap star → favorit dialog → OCR coords → close
   e. Persist exact (name, world_x, world_y) to warsync.player_positions

Robustness:
- If popup name doesn't match (different base at center): try fallback positions
- If no popup at center: skip (rare)
- All errors logged, run continues

Run: python scripts/scout/name_resolver.py [max_names] [duration_s]
"""
from __future__ import annotations

import base64
import io
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib import request as urlrequest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from autonomous_scout import (  # noqa: E402
    ADB, COORDS,
    adb_dev, adb_tap, adb_screencap,
    teleport, dismiss_modal, ensure_world_view, lupe_visible,
    detect_player_popup, is_favorit_dialog, ocr_dialog_coords,
    validate_coords, log, _ts,
)

OLLAMA = "http://127.0.0.1:11434/api/generate"


def query_unique_names() -> list[dict]:
    """Returns list of {name, alliance_tag, x_avg, y_avg, sightings} from vision_sweeps."""
    sql = """
    WITH expanded AS (
      SELECT view_x_actual AS vx, view_y_actual AS vy,
             jsonb_array_elements(names_jsonb) AS player
      FROM warsync.vision_sweeps
      WHERE status = 'ok' AND view_x_actual IS NOT NULL
    )
    SELECT
      player->>'name' AS name,
      player->>'alliance_tag' AS alliance_tag,
      ROUND(AVG(vx))::int AS x_avg,
      ROUND(AVG(vy))::int AS y_avg,
      COUNT(*) AS sightings
    FROM expanded
    WHERE player->>'name' IS NOT NULL
    GROUP BY player->>'name', player->>'alliance_tag'
    ORDER BY sightings DESC, name;
    """
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-A", "-F", "\t", "-tc", sql],
        capture_output=True
    )
    if proc.returncode != 0:
        log(f"DB query err: {proc.stderr.decode()[:200]}")
        return []
    rows = []
    for line in proc.stdout.decode().splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) >= 5:
            try:
                rows.append({
                    "name": parts[0],
                    "alliance_tag": parts[1] if parts[1] not in ("", "\\N") else None,
                    "x_avg": int(parts[2]),
                    "y_avg": int(parts[3]),
                    "sightings": int(parts[4]),
                })
            except (ValueError, IndexError):
                pass
    return rows


def already_resolved(name: str) -> bool:
    sql = (f"SELECT 1 FROM warsync.player_positions pp "
           f"JOIN warsync.players p ON pp.player_id = p.id "
           f"JOIN warsync.scans s ON pp.scan_id = s.id "
           f"WHERE p.name = $${name}$$ AND s.scout_account = 'name_resolver' LIMIT 1")
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
        capture_output=True
    )
    return proc.stdout.decode().strip() == "1"


def ocr_popup_name(arr: np.ndarray) -> str | None:
    """Read the player name from the open popup header. Returns string or None."""
    # Header is small text near top of screen; the popup follows the base
    # Heuristic: find the dark-blue [TAG]Name text. We use vision-OCR on a strip.
    # Best approach: just use full screenshot and ask vision for visible popup name.
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    body = json.dumps({
        "model": "qwen2.5vl:7b",
        "prompt": ('Im Bildschirm ist ein offenes Profil-Popup mit Spieler-Header "[ALLIANZ]Name". '
                   'Lies NUR den Namen aus dem Popup-Header. JSON: {"popup_name":"[ALLIANZ]Name"}'),
        "images": [base64.b64encode(buf.getvalue()).decode()],
        "stream": False,
        "format": "json",
        "options": {"num_ctx": 2048},
    }).encode()
    req = urlrequest.Request(OLLAMA, data=body,
                             headers={"Content-Type": "application/json"})
    try:
        with urlrequest.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        out = json.loads(data.get("response", "{}"))
        return out.get("popup_name")
    except Exception:
        return None


def persist_resolved(name: str, alliance_tag: str | None,
                     world_x: int, world_y: int, server: int) -> None:
    """Insert into players + player_positions with source='name_resolver'."""
    notes = json.dumps({
        "world_x": world_x, "world_y": world_y, "server": server,
        "alliance_tag": alliance_tag,
    })
    sql = (
        "WITH s AS ("
        " INSERT INTO warsync.scans (started_at, finished_at, scout_account, "
        " map_zone, status, notes, tile_count) VALUES "
        f"(NOW(), NOW(), 'name_resolver', 'state_map', 'done', $${notes}$$::text, 1) "
        "RETURNING id), "
        "up AS ("
        f" INSERT INTO warsync.players (name) VALUES ($${name[:200]}$$) "
        " ON CONFLICT (name, server) DO UPDATE SET last_seen_at=NOW() RETURNING id) "
        "INSERT INTO warsync.player_positions "
        "(scan_id, player_id, world_x, world_y, alliance_tag, raw_ocr_json) "
        "SELECT (SELECT id FROM s), (SELECT id FROM up), "
        f"{world_x}, {world_y}, "
        f"{'NULL' if not alliance_tag else f\"$${alliance_tag}$$\"}, "
        f"$${json.dumps({'name': name, 'world_x': world_x, 'world_y': world_y, 'server': server})}$$::jsonb;"
    )
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
        capture_output=True
    )
    if proc.returncode != 0:
        log(f"  persist err: {proc.stderr.decode()[:200]}")


def resolve_one(d: str, candidate: dict, max_attempts: int = 2) -> dict:
    """Attempt to resolve one name to exact coords. Returns result dict."""
    name = candidate["name"]
    expected_alliance = candidate.get("alliance_tag")
    target = (candidate["x_avg"], candidate["y_avg"])

    for attempt in range(max_attempts):
        log(f"  attempt {attempt+1}/{max_attempts}: teleport ({target[0]},{target[1]})")
        if not dismiss_modal(d):
            ensure_world_view(d)
        teleport(d, target[0], target[1])

        # Tap screen center
        adb_tap(d, 1280, 800)
        time.sleep(1.6)
        arr = adb_screencap(d)
        popup = detect_player_popup(arr)

        if not popup:
            log("  no popup at center")
            if not lupe_visible(arr):
                dismiss_modal(d)
            # Try slightly offset positions
            if attempt + 1 < max_attempts:
                target = (target[0] + 3, target[1])
            continue

        sx, sy = popup
        if sy < 80:
            dismiss_modal(d)
            continue

        # Tap star
        adb_tap(d, sx, sy)
        time.sleep(1.5)
        arr = adb_screencap(d)
        if not is_favorit_dialog(arr):
            log("  no favorit-dialog, dismiss")
            dismiss_modal(d)
            continue

        coords = ocr_dialog_coords(arr)
        if not validate_coords(coords):
            log(f"  invalid OCR: {coords}")
            adb_tap(d, *COORDS["fav_dialog_close"])
            time.sleep(1.0)
            continue

        wx, wy = int(coords["x"]), int(coords["y"])
        server = int(coords.get("server", 1668))
        text = coords.get("text", "")

        # Verify name matches (text contains expected name fragment)
        # Extract name from text after server number
        m = re.search(r'\[\w+\]\S+', text)
        seen_name = m.group(0) if m else None
        match_ok = (seen_name and name in text) or (expected_alliance and expected_alliance in text)

        adb_tap(d, *COORDS["fav_dialog_close"])
        time.sleep(1.2)

        if match_ok:
            return {"status": "ok", "world_x": wx, "world_y": wy, "server": server,
                    "seen_name": seen_name, "matched": True, "text": text}
        else:
            log(f"  name mismatch: expected '{name}', got '{seen_name}' (text='{text[:80]}')")
            return {"status": "name_mismatch", "world_x": wx, "world_y": wy,
                    "seen_name": seen_name, "expected": name, "text": text}

    return {"status": "no_popup_after_attempts"}


def main(max_names: int = 0, duration_s: int = 7200) -> None:
    d = adb_dev()
    log(f"NAME-RESOLVER pass dev={d}")
    candidates = query_unique_names()
    log(f"candidates from vision_sweeps: {len(candidates)}")

    resolved_ok = 0
    resolved_mismatch = 0
    failed = 0
    deadline = time.time() + duration_s

    for i, c in enumerate(candidates):
        if max_names and i >= max_names:
            break
        if time.time() > deadline:
            log("deadline reached"); break

        name = c["name"]
        if already_resolved(name):
            continue

        log(f"\n[{i+1}/{len(candidates)} | ok={resolved_ok} mis={resolved_mismatch} fail={failed}] '{name}' avg=({c['x_avg']},{c['y_avg']}) seen={c['sightings']}x")
        try:
            result = resolve_one(d, c)
            if result.get("status") == "ok":
                wx, wy = result["world_x"], result["world_y"]
                log(f"  ★ {name} → world ({wx},{wy})")
                persist_resolved(name, c.get("alliance_tag"), wx, wy, result["server"])
                resolved_ok += 1
            elif result.get("status") == "name_mismatch":
                # Save the mismatched coord too (different player at that tile)
                seen = result.get("seen_name") or name
                log(f"  ⚠ mismatch: tile center has '{seen}' instead. Saving '{seen}'.")
                persist_resolved(seen, None, result["world_x"], result["world_y"], 1668)
                resolved_mismatch += 1
            else:
                log(f"  ✗ failed: {result.get('status')}")
                failed += 1
        except Exception as exc:
            log(f"  ! {type(exc).__name__}: {exc}")
            failed += 1
            try:
                dismiss_modal(d)
            except Exception:
                pass

    log(f"\n=== DONE resolved_ok={resolved_ok} mismatched={resolved_mismatch} failed={failed} ===")


if __name__ == "__main__":
    args = sys.argv[1:]
    main(
        int(args[0]) if len(args) > 0 else 0,
        int(args[1]) if len(args) > 1 else 7200,
    )
