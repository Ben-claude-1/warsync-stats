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
set -e
repo="$(cd "$(dirname "$0")/../.." && pwd)"
modul="$1"; shift
log="/tmp/karten_archiv_${modul}.log"
rm -f "$log"
befehl="cd '$repo' && .venv/bin/python -u -m scripts.karten_archiv.$modul $* 2>&1 | tee '$log'; echo '--ENDE--' | tee -a '$log'"
osascript -e "tell application \"Terminal\" to do script \"$befehl\"" >/dev/null
echo "$log"
