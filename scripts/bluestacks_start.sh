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
#          ./scripts/bluestacks_start.sh neu      # erst beenden, dann frisch starten
#          ./scripts/bluestacks_start.sh reset    # zurueck auf Werkseinstellung
#
# `neu` ist fuer die naechtlichen Dienste: eine lange laufende Instanz liefert
# keine brauchbaren Daten mehr. Am 12.10.2026 stand die VS-Rangliste fuenf
# Naechte lang auf „Wird geladen", waehrend dieselbe Instanz seit Tagen offen
# war. Ein Kaltstart kostet zwei Minuten und ist das billigere Uebel.

set -u

ADB=/opt/homebrew/bin/adb
DEV=127.0.0.1:5555
RES=2560x2560          # 1:1 — die breiteste Form, die Last War zulaesst
DENSITY=320
PROC="BlueStacks.app/Contents/MacOS/BlueStacks"
BS="/Applications/$PROC"
PKG=com.fun.lastwar.gp

if [ "${1:-}" = "reset" ]; then
    "$ADB" connect "$DEV" >/dev/null 2>&1
    "$ADB" -s "$DEV" shell wm size reset
    "$ADB" -s "$DEV" shell wm density reset
    echo "Zurueckgesetzt auf Werkseinstellung."
    exit 0
fi

NEU=""
[ "${1:-}" = "neu" ] && NEU=1

if [ -n "$NEU" ] && pgrep -f "$PROC" >/dev/null; then
    echo "Beende die laufende Instanz ..."
    # **`osascript -e 'quit app "BlueStacks"'` tut hier nichts** — am
    # 12.10.2026 gemessen: 30 Sekunden gewartet, der Prozess lief unveraendert
    # weiter. Genommen wird deshalb gleich SIGTERM; BlueStacks faehrt darauf
    # seine virtuelle Maschine selbst herunter.
    pkill -f "$PROC"
    for _ in $(seq 1 20); do
        pgrep -f "$PROC" >/dev/null || break
        sleep 1
    done
    if pgrep -f "$PROC" >/dev/null; then
        echo "  reagiert nicht auf SIGTERM — beende hart."
        pkill -9 -f "$PROC"
        sleep 5
    fi
    "$ADB" disconnect "$DEV" >/dev/null 2>&1
    # **Die Pause danach ist nicht Zierrat, sie ist gemessen.** Am 12.10.2026
    # startete das Skript zehn Sekunden nach dem SIGTERM neu: die neue Instanz
    # blieb auf dem Startbild „Starte BlueStacks Air" stehen, bei 0,5 % CPU und
    # ohne geoeffnetes Plattenabbild — die alte hatte die virtuelle Maschine
    # noch nicht freigegeben. Mit 20 Sekunden Abstand war ADB nach 4 min 31 s da.
    sleep 20
fi

# **`open -a BlueStacks` startet nur die Huelle, nicht die Android-Instanz.**
# Am 13.10.2026 gemessen: danach steht das Fenster auf dem Launcher („Store /
# My games"), die virtuelle Maschine laeuft nicht, und auf 5555 antwortet zwar
# etwas, aber jede Shell bricht mit `error: closed` ab — `getprop` und `dumpsys`
# gehen, `echo`, `wm` und `input` nicht. Das sieht wie ein kaputtes ADB aus und
# ist in Wahrheit „es gibt noch kein Android".
#
# Der Startbefehl von BlueStacks selbst fährt sie hoch und startet Last War in
# einem Zug; im Protokoll steht dann „[VIRT] Yes, I will be over hvf
# hypervisor!". Deshalb wird hier nicht die App geoeffnet, sondern die App
# gestartet.
#
# **`nohup` und `disown`, nicht nur `&`.** Dieser Prozess *ist* die virtuelle
# Maschine — er laeuft weiter, wenn das Startskript langst fertig ist. Ohne das
# naehme er beim Ende des Skripts das Abhaengesignal mit und der Scan stuende
# wieder vor einem toten ADB.
starte_instanz() {
    nohup "$BS" --cmd launchApp --package "$PKG" >/dev/null 2>&1 &
    disown
}

# **Aus dem Kalten startet `open`, nicht `launchApp`.** Am 13.10.2026 zweimal
# gemessen: `--cmd launchApp` auf einen *nicht* laufenden BlueStacks setzt den
# Befehl ab und beendet sich wieder — danach stand kein Prozess mehr da, und
# das Startprotokoll meldete `cmd: Can't find service: window`. Der Befehl ist
# ein Zuruf an eine laufende Huelle, kein Startbefehl. `open -a BlueStacks`
# fuhr dagegen beide Male sauber durch.
if ! pgrep -f "$PROC" >/dev/null; then
    echo "Starte BlueStacks Air ..."
    open -a BlueStacks
elif [ -n "$NEU" ]; then
    echo "BlueStacks laeuft — Android-Instanz mit Last War hochfahren ..."
    starte_instanz
else
    echo "BlueStacks laeuft bereits."
fi

# **Ein Kaltstart braucht laenger als zwei Minuten.** Am 12.10.2026 lief der
# Zaehler bei 60 Versuchen (120 s) ab, waehrend im Fenster noch der Fortschritts-
# balken „Starte BlueStacks Air" stand — der Lauf brach ab, obwohl nichts kaputt
# war. Wer BlueStacks schon laufen hat, ist dagegen in Sekunden verbunden; die
# laengere Frist kostet dort nichts.
VERSUCHE=60
[ -n "$NEU" ] && VERSUCHE=180

# **Gewartet wird auf Android, nicht auf ADB.** `adb shell true` gelingt schon
# zwei Sekunden nach dem Start — da laeuft `adbd`, aber der System-Server noch
# nicht. Am 13.10.2026 meldete das Skript deshalb zweimal „verbunden." nach
# einem einzigen Punkt und lief danach in `cmd: Can't find service: window`:
# `wm size` lief ins Leere, die Aufloesung blieb ungesetzt, und der ganze Lauf
# stand auf falschen Koordinaten. `wm size` ist die ehrlichere Probe — sie
# gelingt erst, wenn das da ist, was danach gebraucht wird.
echo -n "Warte auf Android "
for _ in $(seq 1 "$VERSUCHE"); do
    "$ADB" connect "$DEV" >/dev/null 2>&1
    if "$ADB" -s "$DEV" shell wm size 2>/dev/null | grep -q "size:"; then
        echo " oben."
        break
    fi
    echo -n "."
    sleep 2
done

if ! "$ADB" -s "$DEV" shell wm size 2>/dev/null | grep -q "size:"; then
    echo ""
    echo "FEHLER: Android ist nicht ansprechbar unter $DEV."
    if "$ADB" -s "$DEV" shell getprop ro.product.model 2>/dev/null | grep -q .; then
        echo "ADB antwortet, aber der 'window'-Dienst fehlt — die Instanz ist"
        echo "nur halb oben. Meist hilft: BlueStacks beenden und neu starten."
    fi
    # **„BlueStacks laeuft" heisst nicht „die Android-Instanz laeuft".** Nach
    # einem Kaltstart steht oft nur das native Fenster „My games" da; die
    # virtuelle Maschine faehrt erst hoch, wenn dort eine App gestartet wird —
    # und bis dahin lauscht auf 5555 nichts. Am 12.10.2026 hat genau dieser
    # Unterschied eine Stunde gekostet, weil die Meldung nur „keine
    # ADB-Verbindung" sagte und BlueStacks sichtbar offen war.
    if pgrep -f "$PROC" >/dev/null; then
        if lsof -nP -p "$(pgrep -f "$PROC" | head -1)" 2>/dev/null | grep -qi listen; then
            echo "BlueStacks laeuft und lauscht, antwortet aber nicht."
            echo "Haengt eine alte Verbindung? '$ADB kill-server' und noch einmal."
        else
            echo "BlueStacks laeuft, aber die Android-Instanz nicht —"
            echo "das Fenster zeigt vermutlich den Launcher ('My games')."
            echo "Dort einmal Last War starten; danach ist ADB da."
        fi
    else
        echo "BlueStacks laeuft gar nicht."
    fi
    echo "Sonst: ist ADB in BlueStacks unter Einstellungen -> Erweitert eingeschaltet?"
    exit 1
fi

"$ADB" -s "$DEV" shell wm size "$RES"
"$ADB" -s "$DEV" shell wm density "$DENSITY"

echo "Gesetzt:"
"$ADB" -s "$DEV" shell wm size | sed 's/^/  /'
"$ADB" -s "$DEV" shell wm density | sed 's/^/  /'

# Laeuft Last War bereits, muss es neu starten, damit es die neue Groesse
# uebernimmt — die Oberflaeche wird beim Start ausgelegt, nicht laufend.
#
# Nach einem Kaltstart laeuft es gar nicht — dann wird es hier gestartet, und
# zwar **immer**, nicht nur mit `neu`. Jeder Aufrufer dieses Skripts will
# anschliessend Last War bedienen; ohne den Start kaeme der Dienst auf einen
# leeren Android-Startbildschirm und „Komme nicht auf die Hauptkarte" waere die
# einzige Auskunft.
if "$ADB" -s "$DEV" shell "ps -A | grep -q $PKG"; then
    echo "Last War laeuft — Neustart, damit die neue Groesse greift ..."
    "$ADB" -s "$DEV" shell am force-stop "$PKG"
    sleep 2
    "$ADB" -s "$DEV" shell monkey -p "$PKG" \
        -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    echo "Last War neu gestartet."
else
    echo "Starte Last War ..."
    "$ADB" -s "$DEV" shell monkey -p "$PKG" \
        -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi
