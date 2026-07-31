#!/bin/zsh
# Lokales Backup des Warsync-Postgres (Container supabase-db).
# Läuft stündlich via LaunchAgent com.onemann.warsync-backup.
# Ersetzt den seit 06.05.2026 toten Cloud-Standby-Sync (sync_local_to_cloud.sh).
#
# Ablage:   /Users/ben/Backups/warsync-db/warsync-YYYYMMDD-HHMM.sql.gz  (Schema + Daten)
#           /Users/ben/Backups/warsync-db/globals-latest.sql.gz         (Rollen/Passwörter)
#           /Users/ben/Backups/warsync-db/latest.sql.gz                 (Symlink auf neuestes)
# Aufbewahrung: 7 Tage stündlich · 180 Tage täglich · Monatserster dauerhaft.
#
# Restore siehe README.md im Backup-Verzeichnis.

set -euo pipefail

DEST=/Users/ben/Backups/warsync-db
LOG=/Users/ben/.local/state/warsync/backup.log
LOCK=/tmp/warsync-backup.lock
DOCKER=/opt/homebrew/bin/docker
CONTAINER=supabase-db
MIN_BYTES=10000   # Plausibilitätsgrenze: alles darunter ist kein echter Dump

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

mkdir -p "$(dirname "$LOG")" "$DEST"

# Single-instance: mkdir-Lock (atomar, portabel)
if ! mkdir "$LOCK.d" 2>/dev/null; then
  log "[SKIP] anderes Backup läuft noch"
  exit 0
fi
trap 'rmdir "$LOCK.d" 2>/dev/null || true' EXIT

# Docker/Colima nicht oben (z.B. direkt nach Reboot) -> kein Fehler, nächster Lauf holt es nach
if ! "$DOCKER" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  log "[SKIP] Container $CONTAINER läuft nicht"
  exit 0
fi

STAMP=$(date +%Y%m%d-%H%M)
FILE="$DEST/warsync-$STAMP.sql.gz"
TMP="$FILE.part"

# 1) Vollständiger Dump: Schema + Daten. --no-owner/--no-acl macht ihn auf jeder
#    Postgres-Instanz einspielbar, auch wenn die Supabase-Rollen dort anders heißen.
#    Bewusst OHNE --clean: dessen "DROP POLICY IF EXISTS ... ON public.ws_players"
#    setzt die Tabelle voraus und sprengt jeden Restore in eine leere DB. Stattdessen
#    räumt die Restore-Prozedur vorher das Schema ab (siehe README.md).
if ! "$DOCKER" exec "$CONTAINER" pg_dump -U postgres -d postgres \
      --schema=public --no-owner --no-acl 2>>"$LOG" | gzip -9 > "$TMP"; then
  log "[FAIL] pg_dump fehlgeschlagen"
  rm -f "$TMP"
  exit 1
fi

# 2) Integrität prüfen, bevor der Dump als gültig gilt
SIZE=$(stat -f%z "$TMP")
if [[ $SIZE -lt $MIN_BYTES ]]; then
  log "[FAIL] Dump nur $SIZE Bytes (< $MIN_BYTES) — verworfen"
  rm -f "$TMP"
  exit 1
fi
if ! gzip -t "$TMP" 2>>"$LOG"; then
  log "[FAIL] gzip-Prüfung fehlgeschlagen — verworfen"
  rm -f "$TMP"
  exit 1
fi
# Kerntabelle muss enthalten sein, sonst war der Dump inhaltlich leer
if ! gzip -dc "$TMP" | grep -q 'COPY public.ws_players'; then
  log "[FAIL] ws_players fehlt im Dump — verworfen"
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$FILE"
ln -sf "$FILE" "$DEST/latest.sql.gz"

# 3) Rollen/Passwörter separat (ändern sich selten, daher nur "latest")
"$DOCKER" exec "$CONTAINER" pg_dumpall -U postgres --globals-only --no-role-passwords \
  2>>"$LOG" | gzip -9 > "$DEST/globals-latest.sql.gz" || log "[WARN] globals-Dump fehlgeschlagen"

log "[OK] $FILE ($(du -h "$FILE" | cut -f1))"

# 4) Aufbewahrung: 7 Tage stündlich, 180 Tage täglich (erstes des Tages),
#    Monatserster dauerhaft.
/usr/bin/python3 - "$DEST" >> "$LOG" 2>&1 <<'PY'
import os, re, sys
from datetime import datetime, timedelta

dest = sys.argv[1]
pat = re.compile(r'^warsync-(\d{8})-(\d{4})\.sql\.gz$')
files = sorted(f for f in os.listdir(dest) if pat.match(f))
now = datetime.now()

first_of_day, first_of_month = {}, {}
for f in files:                      # sortiert = chronologisch
    d = pat.match(f).group(1)
    first_of_day.setdefault(d, f)
    first_of_month.setdefault(d[:6], f)

keep_day = set(first_of_day.values())
keep_month = set(first_of_month.values())
removed = 0
for f in files:
    age = (now - datetime.strptime(pat.match(f).group(1), '%Y%m%d')).days
    if age <= 7:                     # frisch: alles behalten
        continue
    if f in keep_month:              # Monatserster: dauerhaft
        continue
    if f in keep_day and age <= 180: # Tageserster: 180 Tage
        continue
    os.remove(os.path.join(dest, f))
    removed += 1
if removed:
    print(f"[{datetime.now().astimezone().isoformat()}] [PRUNE] {removed} alte Backups gelöscht")
PY

# 5) Eigenes Log beschneiden, damit es nicht wie sync.log auf 4 MB wächst
if [[ $(stat -f%z "$LOG") -gt 1000000 ]]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
