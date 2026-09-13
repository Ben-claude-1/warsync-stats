#!/usr/bin/env python3
"""Run qwen2.5vl:7b on all /tmp/grid5x5/r{R}c{C}.png tiles, dump JSON.

No world-coord computation yet — just (row, col, players[]) per tile.
Output: /tmp/grid5x5/result.json + console summary.
"""
from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path
from urllib import request

OLLAMA = "http://127.0.0.1:11434/api/generate"
MODEL = "qwen2.5vl:7b"
PROMPT = """Last War Welt-Map. Welche Spieler-Basen siehst du? Liste pro Basis: name, alliance_tag (in []), castle_level. Ignoriere UI. JSON: {"players":[{"name":"..","alliance_tag":"[..]","castle_level":N}]}"""

def call_vision(img_bytes: bytes) -> dict:
    # Downscale to ~1280 wide — qwen2.5vl:7b returns empty for 2560x1600 tiles.
    from io import BytesIO

    from PIL import Image

    im = Image.open(BytesIO(img_bytes)).convert("RGB")
    if im.size[0] > 1400:
        new_w = 1280
        new_h = int(im.size[1] * new_w / im.size[0])
        im = im.resize((new_w, new_h), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, "JPEG", quality=85)
    img_small = buf.getvalue()

    body = json.dumps({
        "model": MODEL, "prompt": PROMPT,
        "images": [base64.b64encode(img_small).decode()],
        "stream": False, "format": "json",
        "options": {"num_ctx": 4096},
    }).encode()
    req = request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read())
    try:
        return json.loads(data.get("response", "{}"))
    except json.JSONDecodeError:
        return {"players": [], "_raw": data.get("response", "")[:200]}


TILE_RE = re.compile(r"r(\d+)c(\d+)\.png$")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_dir", default="/tmp/grid_scan")
    ap.add_argument("--out", default=None, help="defaults to <in_dir>/result.json")
    args = ap.parse_args()
    in_dir = Path(args.in_dir)
    out_file = Path(args.out) if args.out else in_dir / "result.json"

    tiles = sorted(in_dir.glob("r?c?.png"))
    results = []
    print(f"processing {len(tiles)} tiles via {MODEL}")
    for t in tiles:
        m = TILE_RE.search(t.name)
        if not m:
            continue
        row, col = int(m.group(1)), int(m.group(2))
        try:
            payload = call_vision(t.read_bytes())
        except Exception as e:
            payload = {"players": [], "_err": str(e)[:200]}
        players = payload.get("players", []) or []
        results.append({"row": row, "col": col, "file": t.name, "players": players})
        names = [(p.get("alliance_tag") or "").strip() + (p.get("name") or "?") for p in players]
        print(f"  r{row}c{col}: {len(players):2d} players  {', '.join(names[:5])}{'...' if len(names) > 5 else ''}")

    out_file.write_text(json.dumps(results, ensure_ascii=False, indent=2))

    # summary
    total = sum(len(r["players"]) for r in results)
    unique = set()
    for r in results:
        for p in r["players"]:
            tag = (p.get("alliance_tag") or "").strip()
            name = (p.get("name") or "").strip()
            if name:
                unique.add(f"{tag}{name}".strip())
    print()
    print(f"TOTAL: {total} positions, {len(unique)} unique names")
    print(f"saved: {out_file}")


if __name__ == "__main__":
    main()
