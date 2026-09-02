#!/bin/bash
# BlueStacks Air starten und die Last-War-Auflösung setzen.
#
# Warum das Skript: Last War ist auf Hochformat festgenagelt (2560x1440 kippt
# sofort zu 1440x2560 zurueck). Breiter als hoch geht nicht — quadratisch ist
# das Maximum und fuellt vom 16:9-Monitor 56 % statt 32 %.
#
# `wm size` ist nur ein Laufzeit-Override und ueberlebt einen Neustart der
# BlueStacks-Instanz nicht. Deshalb wird er hier bei jedem Start neu gesetzt.
#
# Voraussetzung: ADB in BlueStacks unter Einstellungen -> Erweitert eingeschaltet.
#
# Aufruf:  ./scripts/bluestacks_start.sh          # starten + Aufloesung setzen
#          ./scripts/bluestacks_start.sh reset    # zurueck auf Werkseinstellung

set -u

ADB=/opt/homebrew/bin/adb
DEV=127.0.0.1:5555
RES=2560x2560          # 1:1 — die breiteste Form, die Last War zulaesst
DENSITY=320

if [ "${1:-}" = "reset" ]; then
    "$ADB" connect "$DEV" >/dev/null 2>&1
    "$ADB" -s "$DEV" shell wm size reset
    "$ADB" -s "$DEV" shell wm density reset
    echo "Zurueckgesetzt auf Werkseinstellung."
    exit 0
fi

if ! pgrep -f "BlueStacks.app/Contents/MacOS/BlueStacks" >/dev/null; then
    echo "Starte BlueStacks Air ..."
    open -a BlueStacks
else
    echo "BlueStacks laeuft bereits."
fi

echo -n "Warte auf ADB "
for _ in $(seq 1 60); do
    "$ADB" connect "$DEV" >/dev/null 2>&1
    if "$ADB" -s "$DEV" shell true >/dev/null 2>&1; then
        echo " verbunden."
        break
    fi
    echo -n "."
    sleep 2
done

if ! "$ADB" -s "$DEV" shell true >/dev/null 2>&1; then
    echo ""
    echo "FEHLER: keine ADB-Verbindung zu $DEV."
    echo "Ist ADB in BlueStacks unter Einstellungen -> Erweitert eingeschaltet?"
    exit 1
fi

"$ADB" -s "$DEV" shell wm size "$RES"
"$ADB" -s "$DEV" shell wm density "$DENSITY"

echo "Gesetzt:"
"$ADB" -s "$DEV" shell wm size | sed 's/^/  /'
"$ADB" -s "$DEV" shell wm density | sed 's/^/  /'

# Laeuft Last War bereits, muss es neu starten, damit es die neue Groesse
# uebernimmt — die Oberflaeche wird beim Start ausgelegt, nicht laufend.
if "$ADB" -s "$DEV" shell "ps -A | grep -q com.fun.lastwar.gp"; then
    echo "Last War laeuft — Neustart, damit die neue Groesse greift ..."
    "$ADB" -s "$DEV" shell am force-stop com.fun.lastwar.gp
    sleep 2
    "$ADB" -s "$DEV" shell monkey -p com.fun.lastwar.gp \
        -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    echo "Last War neu gestartet."
fi
