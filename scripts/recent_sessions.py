#!/usr/bin/env python3
"""SessionStart hook — Liste der zuletzt verwendeten Sessions im aktuellen Projekt.

Liest die Claude-Session-Dateien unter ~/.claude/projects/<encoded-cwd>/*.jsonl,
sortiert nach mtime, zeigt die 5 neuesten mit Alter, ID, Größe, erste Nachricht.
Output als JSON mit `systemMessage` für Claude Code.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def fmt_age(secs: float) -> str:
    if secs < 60:
        return f"{int(secs)}s"
    if secs < 3600:
        return f"{int(secs / 60)}m"
    if secs < 86400:
        return f"{int(secs / 3600)}h"
    return f"{int(secs / 86400)}d"


def fmt_size(b: int) -> str:
    if b < 1024:
        return f"{b}B"
    if b < 1024**2:
        return f"{b / 1024:.0f}K"
    if b < 1024**3:
        return f"{b / 1024**2:.0f}M"
    return f"{b / 1024**3:.1f}G"


def first_user_msg(p: Path) -> str:
    try:
        with p.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                rec = json.loads(line)
                if rec.get("type") != "user":
                    continue
                content = rec.get("message", {}).get("content")
                text = ""
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "text":
                            text = c.get("text", "")
                            break
                text = text.strip()
                if not text or text.startswith("<"):
                    continue
                first = text.splitlines()[0]
                return first[:80] + ("…" if len(first) > 80 else "")
    except Exception:
        pass
    return ""


def main() -> int:
    cwd = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    encoded = cwd.replace("/", "-")
    proj_dir = Path.home() / ".claude" / "projects" / encoded
    if not proj_dir.is_dir():
        print(json.dumps({}))
        return 0

    current_id = ""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        current_id = (payload.get("session_id") or "").strip()
    except Exception:
        pass

    sessions = sorted(
        proj_dir.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    sessions = [s for s in sessions if s.stem != current_id][:5]

    if not sessions:
        print(json.dumps({}))
        return 0

    now = time.time()
    lines = ["Letzte Sessions in diesem Projekt:", ""]
    lines.append(f"  {'Alter':>5}  {'ID':<8}  {'Größe':>6}  Erste Nachricht")
    for s in sessions:
        st = s.stat()
        age = fmt_age(now - st.st_mtime)
        sid = s.stem[:8]
        size = fmt_size(st.st_size)
        preview = first_user_msg(s)
        lines.append(f"  {age:>5}  {sid:<8}  {size:>6}  {preview}")
    lines.append("")
    lines.append("Fortsetzen: claude -r <ID-Anfang>   ·   Picker: claude -r")

    print(json.dumps({"systemMessage": "\n".join(lines)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
