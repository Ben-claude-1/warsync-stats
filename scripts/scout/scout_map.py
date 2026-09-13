"""Task A — Map-Scan.

Two modes:

* ONLINE (ctx without 'folder'): drive the AVD via ADB, pan around the
  world map, screencap each tile, OCR via vision model, store positions.
  STATUS: SKELETON — touch coordinates need calibration.

* OFFLINE (ctx['folder']=<path>): process existing tile screenshots that
  follow the legacy filename pattern
      pos_<N>_col<C>_row<R>_x<WX>_y<WY>.jpg
  World coordinates are read from the filename, the vision model only
  needs to extract the visible bases / players.
  STATUS: WORKING — used to bootstrap player_positions from the 113
  legacy `scan_shots/` images.

Both modes write into `warsync.player_positions` with `source` set
appropriately ('avd_scout' / 'historical_scan').
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib import request as urlrequest

# ---- shared vision helper ----------------------------------------------

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
TILE_PROMPT = """Last War Map-Tile. Antwort NUR als JSON.

In dem Bild sind Basen anderer Spieler ggf. zu sehen. Pro sichtbare Spieler-Basis
extrahiere den Spielernamen (über der Basis), das Schloss-Level (oft Zahl im
Wappen oder oben), das Allianz-Tag in eckigen Klammern wie "[AR1S]", die Macht
falls als Zahl angezeigt, und die ungefähre relative Position im Tile (links/
rechts/oben/unten/mitte).

Format:
{
  "screen_type": "state_map",
  "players": [
    {"name": "string", "alliance_tag": "string oder null",
     "castle_level": int oder null, "strength": int oder null,
     "tile_position": "tl|t|tr|l|c|r|bl|b|br oder null"}
  ]
}

Wenn keine Spieler sichtbar (leere Wüste/Meer): "players": []
"""


def _pick_model() -> str:
    """qwen2.5vl:7b is the default — small, fast, accurate on game UI.
    72b crashes on Mac/Metal under Ollama 0.21.2 (runner panic on load).
    """
    try:
        with urlrequest.urlopen("http://127.0.0.1:11434/api/tags", timeout=3) as r:
            tags = json.loads(r.read())
        names = {m.get("name") for m in tags.get("models", [])}
        if "qwen2.5vl:7b" in names:
            return "qwen2.5vl:7b"
    except Exception:
        pass
    return "llama3.2-vision:11b"


def _vision(image_bytes: bytes, model: str) -> dict:
    body = json.dumps({
        "model": model, "prompt": TILE_PROMPT,
        "images": [base64.b64encode(image_bytes).decode("ascii")],
        "stream": False, "format": "json",
        "options": {"num_ctx": 4096},
    }).encode()
    req = urlrequest.Request(OLLAMA_URL, data=body,
                             headers={"Content-Type": "application/json"})
    with urlrequest.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read())
    try:
        return json.loads(data.get("response", "{}"))
    except json.JSONDecodeError:
        return {"screen_type": "state_map", "players": [], "_raw": data.get("response", "")[:300]}


# ---- DB persistence ----------------------------------------------------

def _sql_str(s):
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''")[:300] + "'"


def _sql_int(v):
    if v is None: return "NULL"
    try: return str(int(v))
    except (TypeError, ValueError): return "NULL"


def _persist(world_x: int, world_y: int, file_path: str, payload: dict, source: str) -> int:
    """Insert one tile-scan + its players. Returns count of player rows written."""
    players = payload.get("players", []) or []
    sql_lines = [
        "INSERT INTO warsync.scans (started_at, finished_at, scout_account, map_zone, status, notes, tile_count)"
        f" VALUES (NOW(), NOW(), {_sql_str(source)}, 'state_map', 'done',"
        f" {_sql_str(json.dumps({'world_x': world_x, 'world_y': world_y, 'file': file_path}))[0:300]}, 1) RETURNING id"
    ]
    for p in players:
        name = (p.get("name") or "").strip()
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
            f" {world_x}, {world_y},"
            f" {_sql_int(p.get('strength'))}, {_sql_int(p.get('castle_level'))},"
            f" {_sql_str(p.get('alliance_tag'))},"
            f" {_sql_str(file_path)},"
            f" $${json.dumps(p, ensure_ascii=False)}$$::jsonb FROM up"
        )
    sql = ";\n".join(sql_lines) + ";"
    proc = subprocess.run(
        ["/opt/homebrew/bin/docker", "exec", "-i", "supabase-db",
         "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
        input=sql.encode(), capture_output=True
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed: {proc.stderr.decode()[:300]}")
    return len([p for p in players if (p.get("name") or "").strip()])


# ---- offline mode -----------------------------------------------------

TILE_RE = re.compile(r"pos_(\d+)_col(\d+)_row(\d+)_x(\d+)_y(\d+)\.(jpg|jpeg|png)$", re.I)


def _parse_tile_filename(name: str) -> dict | None:
    m = TILE_RE.search(name)
    if not m:
        return None
    return {
        "pos": int(m.group(1)),
        "col": int(m.group(2)),
        "row": int(m.group(3)),
        "world_x": int(m.group(4)),
        "world_y": int(m.group(5)),
    }


def process_folder(folder: Path, *, source: str = "historical_scan",
                   limit: int | None = None, log=print) -> dict:
    model = _pick_model()
    log(f"scout_map.process_folder model={model} folder={folder}")
    tiles_processed = 0
    players_total = 0
    skipped = 0
    files = sorted(folder.glob("*.jpg")) + sorted(folder.glob("*.jpeg")) + sorted(folder.glob("*.png"))
    for f in files:
        if limit and tiles_processed >= limit:
            break
        meta = _parse_tile_filename(f.name)
        if not meta:
            skipped += 1
            continue
        try:
            payload = _vision(f.read_bytes(), model)
            written = _persist(meta["world_x"], meta["world_y"], str(f), payload, source)
            tiles_processed += 1
            players_total += written
            log(f"  [{tiles_processed}/{len(files)}] {f.name} → {written} players")
        except Exception as exc:  # noqa: BLE001
            log(f"  [{tiles_processed}/{len(files)}] {f.name} → ERR {exc}")
    return {
        "tiles_processed": tiles_processed,
        "players_total": players_total,
        "skipped": skipped,
        "model": model,
    }


# ---- entry point used by scout_loop ------------------------------------

# ---- online (AVD) mode -------------------------------------------------

ADB = "/opt/homebrew/bin/adb"
COORDS_FILE = Path(__file__).resolve().parent / "coords.json"


def _adb_device() -> str:
    out = subprocess.check_output([ADB, "devices"], text=True).splitlines()
    dev = next((l.split("\t")[0] for l in out[1:] if "\tdevice" in l), None)
    if not dev:
        raise RuntimeError("no AVD device found via adb")
    return dev


def _load_coords() -> dict:
    if not COORDS_FILE.exists():
        raise RuntimeError(f"missing {COORDS_FILE} — run calibration first")
    return json.loads(COORDS_FILE.read_text())


def _tap(dev: str, x: int, y: int) -> None:
    subprocess.run([ADB, "-s", dev, "shell", "input", "tap", str(x), str(y)], check=True)


def _type(dev: str, text: str) -> None:
    subprocess.run([ADB, "-s", dev, "shell", "input", "text", text], check=True)


def _clear_field(dev: str) -> None:
    """Select-all + delete to make the focused field empty."""
    # KEYCODE_MOVE_END=123, KEYCODE_DEL=67 — delete back from end up to ~6 chars
    for _ in range(6):
        subprocess.run([ADB, "-s", dev, "shell", "input", "keyevent", "67"], check=True)


def _screencap(dev: str) -> bytes:
    return subprocess.check_output([ADB, "-s", dev, "exec-out", "screencap", "-p"])


def _teleport(dev: str, coords: dict, world_x: int, world_y: int,
              wait_after: float = 3.5) -> None:
    """Open Favorit dialog → fill X/Y → tap Go. Leaves AVD on the new view."""
    import time
    sx, sy = coords["search_icon"]
    xx, xy_ = coords["coord_x_field"]
    yx, yy = coords["coord_y_field"]
    gx, gy = coords["coord_go_button"]
    _tap(dev, sx, sy); time.sleep(1.2)
    _tap(dev, xx, xy_); time.sleep(0.4)
    _clear_field(dev); time.sleep(0.2)
    _type(dev, str(world_x)); time.sleep(0.4)
    _tap(dev, yx, yy); time.sleep(0.4)
    _clear_field(dev); time.sleep(0.2)
    _type(dev, str(world_y)); time.sleep(0.4)
    _tap(dev, gx, gy)
    time.sleep(wait_after)


def scan_grid(center_x: int, center_y: int, *, step: int = 10,
              radius: int = 1, source: str = "avd_scout",
              save_dir: Path | None = None, log=print) -> dict:
    """Smoke-test scan: (2*radius+1)^2 tiles around (center_x, center_y).

    radius=1 → 3×3 grid, radius=2 → 5×5, etc.
    Each tile is teleported to, screencapped, vision-parsed, persisted.
    """
    dev = _adb_device()
    coords = _load_coords()
    model = _pick_model()
    log(f"scan_grid center=({center_x},{center_y}) step={step} radius={radius}"
        f" tiles={(2*radius+1)**2} model={model} dev={dev}")
    if save_dir:
        save_dir = Path(save_dir); save_dir.mkdir(parents=True, exist_ok=True)

    tiles_processed = 0
    players_total = 0
    errors = 0

    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            wx = center_x + dx * step
            wy = center_y + dy * step
            try:
                _teleport(dev, coords, wx, wy)
                png = _screencap(dev)
                if save_dir:
                    f = save_dir / f"avd_x{wx:04d}_y{wy:04d}.png"
                    f.write_bytes(png)
                payload = _vision(png, model)
                file_label = str(save_dir / f"avd_x{wx:04d}_y{wy:04d}.png") if save_dir else f"avd_x{wx}_y{wy}"
                written = _persist(wx, wy, file_label, payload, source)
                tiles_processed += 1
                players_total += written
                names = [p.get("name") for p in payload.get("players", [])][:5]
                log(f"  tile ({wx},{wy}) → {written} players: {names}")
            except Exception as exc:  # noqa: BLE001
                errors += 1
                log(f"  tile ({wx},{wy}) → ERR {exc}")
    return {
        "tiles_processed": tiles_processed,
        "players_total": players_total,
        "errors": errors,
        "model": model,
        "center": [center_x, center_y],
        "step": step,
        "radius": radius,
    }


# ---- entry point used by scout_loop ------------------------------------

def run(ctx: dict[str, Any]) -> dict:
    folder = ctx.get("folder")
    if folder:
        return process_folder(Path(folder), limit=ctx.get("limit"))
    cx, cy = ctx.get("center", (None, None))
    if cx is None or cy is None:
        return {"task": "map", "status": "no-center",
                "todo": "ctx must include 'center': (x, y) for online scan"}
    return scan_grid(cx, cy,
                     step=ctx.get("step", 10),
                     radius=ctx.get("radius", 1),
                     save_dir=ctx.get("save_dir"))
