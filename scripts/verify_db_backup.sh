#!/bin/zsh
# Prüft, ob das jüngste Backup wirklich zurückspielbar ist: Restore in eine
# Wegwerf-Datenbank im selben Container, danach Zeilenvergleich gegen die Live-DB.
# Ein Backup, das nie zurückgespielt wurde, ist kein Backup.
#
# Läuft wöchentlich via LaunchAgent com.onemann.warsync-backup-verify,
# kann aber jederzeit von Hand gestartet werden.

set -euo pipefail

DEST=/Users/ben/Backups/warsync-db
LOG=/Users/ben/.local/state/warsync/backup.log
DOCKER=/opt/homebrew/bin/docker
CONTAINER=supabase-db
TESTDB=warsync_restore_test
BACKUP=${1:-$DEST/latest.sql.gz}

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" | tee -a "$LOG"; }

psql_live() { "$DOCKER" exec "$CONTAINER" psql -U postgres -d postgres -t -A "$@"; }
psql_test() { "$DOCKER" exec "$CONTAINER" psql -U postgres -d "$TESTDB" -t -A "$@"; }

cleanup() {
  "$DOCKER" exec "$CONTAINER" psql -U postgres -d postgres -q \
    -c "DROP DATABASE IF EXISTS $TESTDB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ ! -f "$BACKUP" ]]; then
  log "[VERIFY-FAIL] Backup $BACKUP nicht gefunden"
  exit 1
fi

# Restore-Prozedur — identisch zu der in README.md dokumentierten.
# DROP SCHEMA zuerst, weil der Dump selbst ein CREATE SCHEMA public enthält.
# Zwei Versuche: direkt nach einem DROP DATABASE liefert der Container gelegentlich
# kurzzeitig "could not open file ...: Permission denied" auf Katalogdateien.
restore_once() {
  cleanup
  "$DOCKER" exec "$CONTAINER" psql -U postgres -d postgres -q -c "CREATE DATABASE $TESTDB;" >/dev/null 2>&1 || return 1
  "$DOCKER" exec "$CONTAINER" psql -U postgres -d "$TESTDB" -q \
    -c "DROP SCHEMA IF EXISTS public CASCADE;" >/dev/null 2>&1 || return 1
  gzip -dc "$BACKUP" | "$DOCKER" exec -i "$CONTAINER" \
    psql -U postgres -d "$TESTDB" -q -v ON_ERROR_STOP=1 >/dev/null 2>>"$LOG"
}

if ! restore_once; then
  log "[VERIFY-RETRY] Restore fehlgeschlagen, zweiter Versuch in 10 s"
  sleep 10
  if ! restore_once; then
    log "[VERIFY-FAIL] Restore von $BACKUP abgebrochen — Details im Log"
    exit 1
  fi
fi

# Zeilenzahlen aller Tabellen vergleichen
TABLES=$(psql_live -c "select tablename from pg_tables where schemaname='public' order by tablename;")
FAILED=0
COUNT=0
for t in ${(f)TABLES}; do
  a=$(psql_live -c "select count(*) from \"$t\";" 2>/dev/null || echo "ERR")
  b=$(psql_test -c "select count(*) from \"$t\";" 2>/dev/null || echo "FEHLT")
  COUNT=$((COUNT+1))
  if [[ "$a" != "$b" ]]; then
    log "[VERIFY-DIFF] $t: live=$a restore=$b"
    FAILED=$((FAILED+1))
  fi
done

if [[ $FAILED -gt 0 ]]; then
  log "[VERIFY-FAIL] $FAILED von $COUNT Tabellen weichen ab ($BACKUP)"
  exit 1
fi

log "[VERIFY-OK] $(basename "$BACKUP") vollständig zurückspielbar — $COUNT Tabellen identisch"
