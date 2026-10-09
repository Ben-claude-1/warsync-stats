"""Holt die Zugangsdaten des WS-Routine-Bots aus dem local-ai-Tresor.

Eigener Prozess, läuft mit local-ai's eigenem .venv (asyncpg, cryptography —
hat dieses Projekt nicht und soll sie sich auch nicht nachinstallieren, siehe
roster_lock.py). Gibt `NAME=...` und `PW=...` auf stdout aus, zum Einlesen
durch roster_lock.sh — nicht fürs Protokoll, der Aufrufer darf das nicht
mitloggen.
"""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, "/Users/ben/Projects/Mac Studio/local-ai/src")


async def main() -> int:
    from local_ai import pg
    from local_ai.services import vault

    await pg.get_pool()
    try:
        felder = await vault.get_secret("warsync_ws_routine_bot", actor="automation")
    finally:
        await pg.close_pool()
    if not felder:
        print("Vault-Eintrag 'warsync_ws_routine_bot' fehlt", file=sys.stderr)
        return 1
    print(f"NAME={felder['user']}")
    print(f"PW={felder['password']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
