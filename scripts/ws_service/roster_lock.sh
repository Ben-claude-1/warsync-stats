#!/bin/zsh
# Erzwingt den WS-Kader-Lock per Headless-Browser (siehe roster_lock.py).
# Zwei Schritte in getrennten Python-Umgebungen, weil der Tresor-Zugriff
# (local-ai, asyncpg) und Playwright (dieses Projekt) nicht dasselbe .venv
# teilen:
#   1. local-ai's venv liest das Dienst-Account-Passwort aus dem Tresor.
#   2. dieses Projekts venv fährt damit den Login im echten Browser.
set -euo pipefail
cd "/Users/ben/Projects/Warsync-stats"

LOCAL_AI_PY="/Users/ben/Projects/Mac Studio/local-ai/.venv/bin/python"
ZUGANG=$("$LOCAL_AI_PY" scripts/ws_service/vault_zugang.py)
export WSBOT_USER=$(echo "$ZUGANG" | sed -n 's/^NAME=//p')
export WSBOT_PW=$(echo "$ZUGANG" | sed -n 's/^PW=//p')

.venv/bin/python -m scripts.ws_service.roster_lock "$@"
