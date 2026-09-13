#!/bin/bash
# Ein Bild vom Mac in die Galerie von BlueStacks legen — so, dass Last War es findet.
#
# Der naheliegende Weg (Datei in den BlueStacks-Shared-Folder kopieren) sieht aus,
# als ginge er: die Datei liegt danach im Dateisystem und jeder Dateimanager zeigt
# sie an. Im Spiel taucht sie trotzdem nicht auf.
#
# Grund: Last War (`com.fun.lastwar.gp`, targetSdk 35) fordert **keine einzige
# Speicher-Berechtigung** an. Ohne Berechtigung darf es nicht selbst im
# Dateisystem stoebern, sondern muss den System-Photo-Picker nehmen — und der
# liest ausschliesslich den **MediaStore**, den Medien-Index von Android. Der
# Ordner-Sync von BlueStacks traegt dort nichts ein. Deshalb wird hier nach dem
# Kopieren ausdruecklich der Media-Scanner angestossen.
#
# Nach jedem *Ueberschreiben* erneut scannen: gleicher Dateiname heisst nicht
# gleicher Inhalt, und der Index merkt das von allein nicht — der Picker liefert
# sonst die alte Fassung.
#
#   scripts/bild_nach_bluestacks.sh                 # aktuelle Auswahl in Fotos.app
#   scripts/bild_nach_bluestacks.sh bild.jpg [...]  # bestimmte Dateien
set -u

ADB="${ADB:-/opt/homebrew/bin/adb}"
GERAET="${GERAET:-127.0.0.1:5555}"
ZIEL="/sdcard/Pictures/WarSync"

adbs(){ "$ADB" -s "$GERAET" "$@"; }

if ! adbs get-state >/dev/null 2>&1; then
  echo "Kein Geraet unter $GERAET. Laeuft BlueStacks? (scripts/bluestacks_start.sh)" >&2
  exit 1
fi

# ── Quelle bestimmen ──────────────────────────────────────────────────────
tmp=""
if [ "$#" -gt 0 ]; then
  dateien=("$@")
else
  # Ohne Argument: was in Fotos.app gerade markiert ist. Der Export geht bewusst
  # ohne `using originals` — dann liefert Fotos JPEG statt womoeglich HEIC, das
  # der Photo-Picker im Spiel nicht zuverlaessig anzeigt.
  tmp="$(mktemp -d /tmp/warsync_bild.XXXXXX)"
  if ! osascript >/dev/null 2>&1 <<OSA
tell application "Photos"
  set sel to (get selection)
  if (count of sel) = 0 then error "keine Auswahl"
  export sel to (POSIX file "$tmp")
end tell
OSA
  then
    echo "In Fotos.app ist nichts markiert (oder der Zugriff fehlt)." >&2
    echo "Bild in Fotos anklicken und nochmal starten — oder Datei als Argument angeben." >&2
    rm -rf "$tmp"; exit 1
  fi
  dateien=()
  while IFS= read -r f; do dateien+=("$f"); done < <(find "$tmp" -type f ! -name '.*')
  if [ "${#dateien[@]}" -eq 0 ]; then
    echo "Fotos.app hat nichts exportiert." >&2; rm -rf "$tmp"; exit 1
  fi
fi

adbs shell mkdir -p "$ZIEL" >/dev/null 2>&1

fehler=0
for quelle in "${dateien[@]}"; do
  if [ ! -f "$quelle" ]; then echo "  ! $quelle gibt es nicht"; fehler=1; continue; fi
  name="$(basename "$quelle")"
  if ! adbs push "$quelle" "$ZIEL/$name" >/dev/null 2>&1; then
    echo "  ! $name liess sich nicht uebertragen"; fehler=1; continue
  fi
  # Der entscheidende Schritt: ohne ihn liegt die Datei da, steht aber in keinem
  # Index — und fuer den Photo-Picker existiert sie nicht.
  adbs shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE \
    -d "file://$ZIEL/$name" >/dev/null 2>&1
  groesse=$(stat -f%z "$quelle")
  # Gegenprobe: im MediaStore nachsehen, und zwar auf die Groesse genau. Ein
  # alter Eintrag mit gleichem Namen sieht sonst wie ein Erfolg aus.
  if adbs shell content query --uri content://media/external/images/media \
       --projection _display_name:_size 2>/dev/null \
       | grep -q "_display_name=$name, _size=$groesse"; then
    echo "  ✓ $name ($((groesse/1024)) KB) — im MediaStore"
  else
    echo "  ! $name uebertragen, aber nicht im MediaStore — Picker zeigt es nicht"
    fehler=1
  fi
done

[ -n "$tmp" ] && rm -rf "$tmp"
if [ "$fehler" -eq 0 ]; then
  echo
  echo "Fertig. Im Spiel: Chat → Bild anhaengen → Album \"WarSync\"."
fi
exit "$fehler"
