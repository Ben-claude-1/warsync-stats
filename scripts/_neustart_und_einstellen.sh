#!/bin/bash
set -u
REPO=/Users/ben/Projects/Warsync-stats
cd "$REPO" || exit 1
ADB=/opt/homebrew/bin/adb
DEV=127.0.0.1:5555

echo "=== BlueStacks wird beendet ==="
osascript -e 'tell application "BlueStacks" to quit' 2>/dev/null
for i in $(seq 1 30); do
    pgrep -f "BlueStacks.app/Contents/MacOS/BlueStacks" >/dev/null || break
    sleep 1
done
echo "BlueStacks ist zu."
sleep 3

echo "=== BlueStacks wird neu gestartet ==="
bash scripts/bluestacks_start.sh

echo "=== Last War wird gestartet ==="
"$ADB" -s "$DEV" shell monkey -p com.fun.lastwar.gp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
echo "Warte 35s, bis das Spiel geladen hat ..."
sleep 35

echo "=== Screenshot zur Kontrolle ==="
"$ADB" -s "$DEV" shell screencap -p /sdcard/nach_neustart.png
"$ADB" -s "$DEV" pull /sdcard/nach_neustart.png /tmp/nach_neustart.png

echo "=== FERTIG MIT NEUSTART — bereit fuer Einstell-Laeufe ==="
