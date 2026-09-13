#!/usr/bin/env python3
"""warsync iPhone-Inbox Watcher

Watch ~/Pictures/Warsync-Inbox/ for new screenshots dropped via AirDrop or
Apple Shortcut, run them through qwen2.5-vl (Ollama) to classify + extract
player data, then write into Postgres `warsync.player_positions` with
`source='iphone_share'`.

Lifecycle: poll every 3 s (no fancy fsevents — Python lib just for this is
overkill). Process file, then move to processed/.

Usage:
    python3 scripts/inbox_watcher.py        # foreground
    Run via launchd com.onemann.warsync-inbox.plist
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import time
from pathlib import Path
from urllib import request as urlrequest

INBOX = Path("/Users/ben/Pictures/Warsync-Inbox")
PROCESSED = INBOX / "processed"
FAILED = INBOX / "failed"
LOG = Path("/Users/ben/.local/state/warsync/inbox.log")
PROCESSED.mkdir(exist_ok=True)
FAILED.mkdir(exist_ok=True)
LOG.parent.mkdir(parents=True, exist_ok=True)

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
# Vision model. qwen2.5vl:72b is heavy (~25s/img) but accurate on tables/score boards.
# Fallback to llama3.2-vision:11b if 72b not yet pulled.
MODEL_PRIMARY = "qwen2.5vl:72b"
MODEL_FALLBACK = "llama3.2-vision:11b"


def _pick_model() -> str:
    try:
        with urlrequest.urlopen("http://127.0.0.1:11434/api/tags", timeout=3) as r:
            tags = json.loads(r.read())
        names = {m.get("name") for m in tags.get("models", [])}
        if MODEL_PRIMARY in names:
            return MODEL_PRIMARY
    except Exception:
        pass
    return MODEL_FALLBACK

VISION_PROMPT = """Last War: Survival Screenshot-Analyzer. Antworte NUR mit JSON, kein Prosa.

Erkenne den Screen-Typ:
- "score_board"   : Rang-Tabelle (Nr | Allianz-Icon+[Tag]+Spielername | Punktzahl). Oft Wüstensturm-Endergebnis. Datum unten klein.
- "rally"         : Versammlungsdialog VOR einem Angriff/Sammeln. Zeigt mehrere Slots (typ. 8) mit jeweils einem Spieler + Truppenanzahl + Kampfstärke. Oben das Ziel (Koordinaten X:.. Y:.. oder ein Bauwerk). Rally-Anführer markiert.
- "state_map"     : zoombare Welt-Karte mit Basen, Markern, Gebäuden (X/Y am Rand)
- "player_profile": einzelnes Spieler-Detailfenster mit Castle-Level, Power, Allianz
- "alliance_list" : Mitgliederliste einer Allianz mit Power-Werten
- "other"

Wenn "score_board":
{
  "screen_type": "score_board",
  "match_kind": "desert_storm" | "other",
  "played_at": "YYYY-MM-DD HH:MM:SS oder null",
  "rows": [
    {"rank": int, "alliance_tag": "AR1S oder null", "name": "sichtbarer Name", "score": int}
  ]
}

Wenn "rally":
{
  "screen_type": "rally",
  "rally_kind": "attack" | "gather" | "defense" | "other",
  "target_x": int oder null,
  "target_y": int oder null,
  "target_label": "Bauwerk- oder Spielername oder null",
  "leader_name": "Anführer-Name oder null",
  "rally_started_at": "ISO oder null",
  "squads": [
    {"squad_index": int, "name": "Spielername", "alliance_tag": "AR1S oder null",
     "troops_total": int oder null, "combat_strength": int oder null,
     "troops_t1": int oder null, "troops_t2": int oder null,
     "troops_t3": int oder null, "troops_t4": int oder null, "troops_t5": int oder null}
  ]
}

Wenn "state_map":
{
  "screen_type": "state_map",
  "players": [
    {"name": "string", "alliance_tag": "string oder null",
     "world_x": int oder null, "world_y": int oder null,
     "strength": int oder null, "castle_level": int oder null}
  ]
}

Wenn "player_profile":
{
  "screen_type": "player_profile",
  "name": "Spielername",
  "alliance_tag": "AR1S oder null",
  "world_x": int oder null, "world_y": int oder null,
  "strength": int oder null,
  "castle_level": int oder null,
  "kills": int oder null
}

Sonst:
{"screen_type": "<typ>", "notes": "kurze Beobachtung"}

WICHTIG: Punktzahlen wie 1145939 sind ganze Zahlen — gib sie als integer ohne Tausendertrennzeichen zurück. Allianz-Tag = 2-5 Buchstaben in eckigen Klammern vor dem Namen (z.B. "[AR1S]" → "AR1S"). Wenn Wert nicht klar lesbar, lieber null als raten."""


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
    LOG.open("a", encoding="utf-8").write(line)
    print(line, end="", flush=True)


def call_ollama(image_bytes: bytes) -> dict:
    body = json.dumps({
        "model": MODEL,
        "prompt": VISION_PROMPT,
        "images": [base64.b64encode(image_bytes).decode("ascii")],
        "stream": False,
        "format": "json",
    }).encode()
    req = urlrequest.Request(OLLAMA_URL, data=body, headers={"Content-Type": "application/json"})
    with urlrequest.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read())
    return json.loads(data.get("response", "{}"))


def _sql_str(s) -> str:
    """Quote a string for safe SQL inlining."""
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''")[:300] + "'"


def _sql_int(v) -> str:
    if v is None:
        return "NULL"
    try:
        return str(int(v))
    except (TypeError, ValueError):
        return "NULL"


def insert_into_db(payload: dict, screenshot_path: Path) -> None:
    """Persist via psql — split by screen_type."""
    import subprocess
    rel_path = f"iphone_inbox/{screenshot_path.name}"
    screen_type = payload.get("screen_type", "unknown")

    sql_lines: list[str] = []

    if screen_type == "score_board":
        # Konsolidierung: alle desert_storm-Screenshots eines Tages → ein Match.
        # Andere Match-Kinds: jeder Screenshot bleibt eigenes Match.
        match_kind = payload.get("match_kind") or "other"
        played_at = payload.get("played_at")
        if match_kind == "desert_storm":
            # Re-use bestehenden Match wenn discovery innerhalb 30 min ODER
            # played_at::date passt (gleicher Match-Tag).
            sql_lines.append(
                "WITH existing AS ("
                " SELECT id FROM warsync.matches"
                f" WHERE match_kind = 'desert_storm'"
                "   AND ("
                "       discovered_at >= NOW() - INTERVAL '30 minutes'"
                f"      OR ({('played_at::date = ' + _sql_str(played_at) + '::date') if played_at else 'FALSE'})"
                "   )"
                " ORDER BY id DESC LIMIT 1"
                "), inserted AS ("
                "  INSERT INTO warsync.matches (match_kind, played_at, notes)"
                "  SELECT 'desert_storm',"
                f" {_sql_str(played_at) if played_at else 'NULL'}::timestamptz,"
                f" {_sql_str(json.dumps(payload)[:500])}"
                "  WHERE NOT EXISTS (SELECT 1 FROM existing)"
                "  RETURNING id"
                ")"
                " SELECT id FROM existing UNION ALL SELECT id FROM inserted"
            )
        else:
            sql_lines.append(
                "INSERT INTO warsync.matches (match_kind, played_at, notes)"
                f" VALUES ({_sql_str(match_kind)},"
                f" {_sql_str(played_at) if played_at else 'NULL'}::timestamptz,"
                f" {_sql_str(json.dumps(payload)[:500])})"
                " RETURNING id"
            )

        rows = payload.get("rows", []) or []
        for r in rows:
            name = (r.get("name") or "").strip()
            if not name:
                continue
            sql_lines.append(
                "WITH up AS (INSERT INTO warsync.players (name) VALUES "
                f"({_sql_str(name)}) ON CONFLICT (name, server) DO UPDATE SET last_seen_at=NOW()"
                " RETURNING id)"
                " INSERT INTO warsync.match_results"
                " (match_id, player_id, rank, score, alliance_tag, raw_screenshot_path, raw_ocr_json)"
                " SELECT (SELECT id FROM warsync.matches ORDER BY id DESC LIMIT 1), up.id,"
                f" {_sql_int(r.get('rank'))}, {_sql_int(r.get('score'))},"
                f" {_sql_str(r.get('alliance_tag'))},"
                f" {_sql_str(rel_path)},"
                f" $${json.dumps(r, ensure_ascii=False)}$$::jsonb"
                " FROM up"
                " ON CONFLICT (match_id, player_id) DO UPDATE SET"
                "   rank = COALESCE(EXCLUDED.rank, warsync.match_results.rank),"
                "   score = COALESCE(EXCLUDED.score, warsync.match_results.score),"
                "   alliance_tag = COALESCE(EXCLUDED.alliance_tag, warsync.match_results.alliance_tag),"
                "   raw_screenshot_path = EXCLUDED.raw_screenshot_path,"
                "   raw_ocr_json = EXCLUDED.raw_ocr_json"
            )
    elif screen_type == "rally":
        # Rally-Pipeline (Stärke-Quelle pro Spieler)
        rally_started = payload.get("rally_started_at")
        sql_lines.append(
            "INSERT INTO warsync.rallies (rally_kind, target_x, target_y, target_label,"
            " rally_started_at, raw_screenshot_path, raw_ocr_json)"
            f" VALUES ({_sql_str(payload.get('rally_kind') or 'other')},"
            f" {_sql_int(payload.get('target_x'))}, {_sql_int(payload.get('target_y'))},"
            f" {_sql_str(payload.get('target_label'))},"
            f" {_sql_str(rally_started) if rally_started else 'NULL'}::timestamptz,"
            f" {_sql_str(rel_path)},"
            f" $${json.dumps(payload, ensure_ascii=False)}$$::jsonb)"
            " RETURNING id"
        )
        # Set leader if present
        leader_name = (payload.get("leader_name") or "").strip()
        if leader_name:
            sql_lines.append(
                "WITH up AS (INSERT INTO warsync.players (name) VALUES "
                f"({_sql_str(leader_name)}) ON CONFLICT (name, server)"
                " DO UPDATE SET last_seen_at=NOW() RETURNING id)"
                " UPDATE warsync.rallies SET leader_player_id = up.id"
                " FROM up WHERE rallies.id = (SELECT id FROM warsync.rallies ORDER BY id DESC LIMIT 1)"
            )
        for sq in payload.get("squads", []) or []:
            name = (sq.get("name") or "").strip()
            if not name:
                continue
            sql_lines.append(
                "WITH up AS (INSERT INTO warsync.players (name) VALUES "
                f"({_sql_str(name)}) ON CONFLICT (name, server) DO UPDATE SET last_seen_at=NOW()"
                " RETURNING id)"
                " INSERT INTO warsync.rally_squads"
                " (rally_id, player_id, squad_index, troops_total, combat_strength,"
                " troops_t1, troops_t2, troops_t3, troops_t4, troops_t5, raw_ocr_json)"
                " SELECT (SELECT id FROM warsync.rallies ORDER BY id DESC LIMIT 1), up.id,"
                f" {_sql_int(sq.get('squad_index'))}, {_sql_int(sq.get('troops_total'))},"
                f" {_sql_int(sq.get('combat_strength'))},"
                f" {_sql_int(sq.get('troops_t1'))}, {_sql_int(sq.get('troops_t2'))},"
                f" {_sql_int(sq.get('troops_t3'))}, {_sql_int(sq.get('troops_t4'))},"
                f" {_sql_int(sq.get('troops_t5'))},"
                f" $${json.dumps(sq, ensure_ascii=False)}$$::jsonb"
                " FROM up"
                " ON CONFLICT (rally_id, player_id, squad_index) DO UPDATE SET"
                "   troops_total = COALESCE(EXCLUDED.troops_total, warsync.rally_squads.troops_total),"
                "   combat_strength = COALESCE(EXCLUDED.combat_strength, warsync.rally_squads.combat_strength)"
            )
    else:
        # Default: state_map / player_profile / other
        sql_lines.append(
            "INSERT INTO warsync.scans (started_at, finished_at, scout_account, map_zone, status, notes)"
            f" VALUES (NOW(), NOW(), 'iphone_share', {_sql_str(screen_type)},"
            f" 'done', {_sql_str(json.dumps(payload.get('notes',''))[:200])}) RETURNING id"
        )
        for player in payload.get("players", []) or []:
            name = (player.get("name") or "").strip()
            if not name:
                continue
            sql_lines.append(
                "WITH up AS (INSERT INTO warsync.players (name) VALUES "
                f"({_sql_str(name)}) ON CONFLICT (name, server) DO UPDATE SET last_seen_at=NOW()"
                " RETURNING id)"
                " INSERT INTO warsync.player_positions"
                " (scan_id, player_id, world_x, world_y, strength, castle_level,"
                " alliance_tag, tile_screenshot_path, raw_ocr_json)"
                " SELECT (SELECT id FROM warsync.scans ORDER BY id DESC LIMIT 1), up.id,"
                f" {_sql_int(player.get('world_x'))}, {_sql_int(player.get('world_y'))},"
                f" {_sql_int(player.get('strength'))}, {_sql_int(player.get('castle_level'))},"
                f" {_sql_str(player.get('alliance_tag'))},"
                f" {_sql_str(rel_path)},"
                f" $${json.dumps(player, ensure_ascii=False)}$$::jsonb"
                " FROM up"
            )

    sql = ";\n".join(sql_lines) + ";"
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        input=sql.encode(), capture_output=True
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed: {proc.stderr.decode()[:400]}")


def process_file(path: Path) -> None:
    log(f"processing {path.name}")
    try:
        data = path.read_bytes()
        result = call_ollama(data)
        log(f"  → screen_type={result.get('screen_type')}  players={len(result.get('players', []) or [])}")
        insert_into_db(result, path)
        shutil.move(str(path), PROCESSED / path.name)
        # also stash a JSON sidecar for forensics
        (PROCESSED / f"{path.stem}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001
        log(f"  ✗ {exc}")
        try:
            shutil.move(str(path), FAILED / path.name)
        except Exception:
            pass


def main() -> int:
    log(f"watcher up; inbox={INBOX}")
    seen: set[str] = set()
    image_exts = {".png", ".jpg", ".jpeg", ".heic"}
    while True:
        try:
            for f in sorted(INBOX.glob("*")):
                if f.is_file() and f.suffix.lower() in image_exts and f.name not in seen:
                    seen.add(f.name)
                    # debounce: file may still be copying
                    s1 = f.stat().st_size
                    time.sleep(0.5)
                    if not f.exists():
                        continue
                    s2 = f.stat().st_size
                    if s1 != s2:
                        seen.discard(f.name)  # will re-pick next loop
                        continue
                    process_file(f)
            time.sleep(3)
        except KeyboardInterrupt:
            return 0
        except Exception as exc:  # noqa: BLE001
            log(f"loop error: {exc}")
            time.sleep(5)


if __name__ == "__main__":
    sys.exit(main())
