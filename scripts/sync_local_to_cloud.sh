#!/bin/zsh
# Mirror lokales Postgres (Container supabase-db) → Cloud-Supabase (Hot-Standby).
# Läuft alle 5 Min via LaunchAgent. Truncate + Insert in einer Transaktion.

set -euo pipefail

LOG=/Users/ben/.local/state/warsync/sync.log
LOCK=/tmp/warsync-sync.lock

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Single-instance: mkdir-lock (atomic, portable)
mkdir -p "$(dirname "$LOG")"
if ! mkdir "$LOCK.d" 2>/dev/null; then
  log "[SKIP] another sync still running"
  exit 0
fi
trap 'rmdir "$LOCK.d" 2>/dev/null || true' EXIT

# Das Passwort stand hier bis zum 14.09.2026 im Klartext und ist mit dem Commit
# d04f020 oeffentlich geworden — es gilt als kompromittiert und gehoert
# gewechselt. Gelesen wird es jetzt aus der Umgebung; ohne sie bricht der Lauf
# ab, statt mit einem leeren Passwort anzuklopfen.
CLOUD_PW="${CLOUD_PW:?CLOUD_PW nicht gesetzt — Passwort aus dem Tresor holen}"
CLOUD_HOST='aws-0-eu-west-1.pooler.supabase.com'
CLOUD_USER='postgres.ktdzxhyuvukontcxghte'
TABLES='public.zug_rides, public.ws_versammlungen, public.ws_rankings, public.ws_poll_votes, public.ws_polls, public.ws_player_history, public.ws_player_coords, public.ws_players, public.ws_participation, public.ws_events'

log "[START] dumping lokal → cloud"

# 1) Dump aus Lokal (data-only, public schema)
LOCAL_DUMP=$(/opt/homebrew/bin/docker exec supabase-db pg_dump -U postgres -d postgres \
  --schema=public --data-only --no-owner --no-acl 2>>"$LOG") || {
  log "[FAIL] local pg_dump"
  exit 1
}

# Cloud sieht Bytes vom lokalen pg_dump 15.8 — kein \restrict-Problem hier (das emittiert nur pg_dump 17+)

# 2) Pipe TRUNCATE + Daten in psql gegen Cloud (single transaction)
{
  echo "SET session_replication_role = replica;"
  echo "TRUNCATE $TABLES RESTART IDENTITY CASCADE;"
  echo "$LOCAL_DUMP"
  echo "SET session_replication_role = DEFAULT;"
} | /opt/homebrew/bin/docker run --rm -i \
  -e PGPASSWORD="$CLOUD_PW" \
  postgres:17 \
  psql -h "$CLOUD_HOST" -p 5432 -U "$CLOUD_USER" -d postgres \
  -v ON_ERROR_STOP=1 --single-transaction --quiet \
  >> "$LOG" 2>&1 || {
    log "[FAIL] cloud restore"
    exit 1
  }

log "[OK] sync done"
