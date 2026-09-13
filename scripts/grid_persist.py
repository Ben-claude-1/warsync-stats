#!/usr/bin/env python3
"""Persist /tmp/grid5x5/result.json into warsync.player_positions.

User base coord: x=494, y=563 at grid center (r2c2).
Pan-step Δ ≈ 12 world units (heuristic, NOT calibrated).
Convention: row 0 = top = higher y; col 0 = left = lower x.

Normalizes alliance-tag OCR variants (AR1S/AR15/ART5/ARTS → AR1S) and
de-duplicates the doubled name pattern ("Prof BonesProf Bones" → "Prof Bones").
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

BASE_X, BASE_Y = 494, 563
PAN_DELTA = 6   # calibrated 2026-04-28 from GeneralBlücher (500,566) at r3c4 of 7x7
PAN_DELTA_Y_RATIO = 700 / 900  # PAN_Y / PAN_X ratio

ALLIANCE_NORMALIZE = {
    "AR1S": "AR1S", "AR15": "AR1S", "ART5": "AR1S", "ARTS": "AR1S",
    "CYKA": "CYKA",
    "Wah": "Wah", "WAH": "Wah",
    "Tyty": "Tyty", "TYTY": "Tyty",
}


def clean_tag(tag: str | None) -> str | None:
    if not tag:
        return None
    t = tag.strip().strip("[]").strip()
    return f"[{ALLIANCE_NORMALIZE.get(t, t)}]" if t else None


def clean_name(raw: str | None, tag: str | None) -> str:
    if not raw:
        return ""
    name = raw.strip()
    # Strip leading bracketed tag if duplicated
    name = re.sub(r"^\[[^\]]+\]\s*", "", name)
    # Detect "FooFoo" duplicate (model often returns "Prof BonesProf Bones")
    n = len(name)
    if n >= 4 and n % 2 == 0 and name[: n // 2] == name[n // 2 :]:
        name = name[: n // 2]
    return name.strip()


def sql_str(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''")[:300] + "'"


def sql_int(v):
    if v is None:
        return "NULL"
    try:
        return str(int(v))
    except (TypeError, ValueError):
        return "NULL"


def main():
    import argparse, datetime
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_file", default="/tmp/grid_scan/result.json")
    ap.add_argument("--source-tag", default="manual")
    ap.add_argument("--pan-delta", type=int, default=PAN_DELTA)
    args = ap.parse_args()
    pan_delta = args.pan_delta

    data = json.loads(Path(args.in_file).read_text())
    if not data:
        print("no tiles in", args.in_file); return 0
    grid_size = max(t["row"] for t in data) + 1
    center = grid_size // 2
    source = f"scout_grid_{grid_size}x{grid_size}_{args.source_tag}_{datetime.datetime.now():%Y-%m-%d_%H%M}"

    scan_sql = (
        "INSERT INTO warsync.scans (started_at, finished_at, scout_account, map_zone,"
        " status, notes, tile_count) VALUES (NOW(), NOW(),"
        f" {sql_str(source)}, 'state_map', 'done',"
        f" {sql_str(json.dumps({'base_x': BASE_X, 'base_y': BASE_Y, 'pan_delta': pan_delta, 'grid_size': grid_size}))[:300]},"
        f" {len(data)}) RETURNING id"
    )

    inserts = [scan_sql]
    written = 0
    pan_delta_y = round(pan_delta * PAN_DELTA_Y_RATIO)
    for tile in data:
        row, col = tile["row"], tile["col"]
        world_x = BASE_X + (col - center) * pan_delta
        world_y = BASE_Y + (center - row) * pan_delta_y
        for p in tile.get("players", []):
            tag = clean_tag(p.get("alliance_tag"))
            name = clean_name(p.get("name"), tag)
            if not name:
                continue
            castle = p.get("castle_level")
            inserts.append(
                "WITH up AS (INSERT INTO warsync.players (name, alliance_tag) VALUES "
                f"({sql_str(name)}, {sql_str(tag)}) ON CONFLICT (name, server)"
                " DO UPDATE SET last_seen_at=NOW(), alliance_tag=COALESCE(EXCLUDED.alliance_tag, warsync.players.alliance_tag)"
                " RETURNING id)"
                " INSERT INTO warsync.player_positions"
                " (scan_id, player_id, world_x, world_y, castle_level, alliance_tag,"
                " tile_screenshot_path, raw_ocr_json)"
                " SELECT (SELECT id FROM warsync.scans ORDER BY id DESC LIMIT 1), up.id,"
                f" {world_x}, {world_y}, {sql_int(castle)}, {sql_str(tag)},"
                f" {sql_str(tile['file'])},"
                f" $${json.dumps(p, ensure_ascii=False)}$$::jsonb FROM up"
            )
            written += 1

    sql = ";\n".join(inserts) + ";"
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        input=sql.encode(), capture_output=True
    )
    if proc.returncode != 0:
        print("ERR:", proc.stderr.decode()[:500])
        return 1
    print(f"wrote {written} positions across {len(data)} tiles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
