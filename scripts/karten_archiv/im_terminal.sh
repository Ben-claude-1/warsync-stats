#!/bin/zsh
# Ein Skript des Kartenarchivs in einem SICHTBAREN Terminal-Fenster starten.
#
# Projektregel: Laeufe, die BlueStacks steuern, duerfen nicht im Hintergrund
# laufen — der Fortschritt muss jederzeit mitlesbar sein. Die Ausgabe geht
# zusaetzlich in eine Logdatei, damit sie auch nachtraeglich zu pruefen ist.
#
#   scripts/karten_archiv/im_terminal.sh eichen_reihen --stufe wisch
#
# `python -u` ist Absicht: ohne das puffert Python hinter der Pipe, und im
# Fenster stuende minutenlang nichts.
#
# **`tee` muss Strg-C ignorieren.** Ein Strg-C im Fenster geht an die ganze
# Vordergrund-Prozessgruppe, also auch an `tee`. Stirbt das, bekommt Python beim
# naechsten `print` ein SIGPIPE und ist weg — mitten in dem Aufraeumen, das
# gerade das Strg-C ausgeloest hat. Am 07.09.2026 blieben davon die letzten
# Meldungen des Sweeps aus, obwohl er sie sauber schreiben wollte. Mit `trap ''
# INT` bleibt die Pipe stehen, und Python entscheidet selbst, wann es geht.
set -e
repo="$(cd "$(dirname "$0")/../.." && pwd)"
modul="$1"; shift
log="/tmp/karten_archiv_${modul}.log"
rm -f "$log"
befehl="cd '$repo' && .venv/bin/python -u -m scripts.karten_archiv.$modul $* 2>&1 | { trap '' INT; tee '$log'; }; echo '--ENDE--' | tee -a '$log'"
osascript -e "tell application \"Terminal\" to do script \"$befehl\"" >/dev/null
echo "$log"
