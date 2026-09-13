#!/bin/zsh
# Stellt sicher, dass der Tailscale-Funnel 8443 → localhost:8000 (Kong) immer aktiv ist.
# Läuft alle 60 Sekunden via LaunchAgent.

set -euo pipefail

LOG=/Users/ben/.local/state/warsync/funnel-watchdog.log
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale

mkdir -p "$(dirname "$LOG")"

ts() { date -Iseconds; }

# Funnel-Status holen
STATUS=$("$TS" funnel status 2>&1 || true)

# Hat 8443 + zeigt auf localhost:8000?
if echo "$STATUS" | grep -q "https://mac-studio.taild5562c.ts.net:8443 (Funnel on)" && \
   echo "$STATUS" | grep -A1 ":8443 (Funnel on)" | grep -q "proxy http://localhost:8000"; then
  exit 0
fi

# Reaktivieren
echo "[$(ts)] funnel 8443 fehlt — reaktiviere" >> "$LOG"
"$TS" funnel --bg --https=8443 http://localhost:8000 >> "$LOG" 2>&1 || {
  echo "[$(ts)] FAIL beim Reaktivieren" >> "$LOG"
  exit 1
}
echo "[$(ts)] OK funnel 8443 wieder online" >> "$LOG"
