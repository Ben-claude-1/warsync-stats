#!/bin/bash
# Doppelklick-Starter: nimmt, was in Fotos.app markiert ist, und legt es in die
# Galerie von BlueStacks. Bewusst als .command, damit der Lauf in einem
# sichtbaren Terminal passiert und man sieht, ob die Gegenprobe aufgeht.
cd "$(dirname "$0")/.." || exit 1
echo "── Bild nach BlueStacks ──"
echo
./scripts/bild_nach_bluestacks.sh
status=$?
echo
if [ "$status" -eq 0 ]; then
  echo "Im Spiel: Chat → Bild anhängen → Album \"WarSync\"."
else
  echo "Es hat nicht geklappt — siehe Meldung oben."
fi
echo
echo "Fenster kann geschlossen werden."
