"""Wie weit traegt ein `input swipe` in der Teilnehmerliste wirklich?

Gemessen wird in Pixeln, nicht in Karten — Karten zaehlen heisst raten, sobald
ein Schritt mehr als einen Bildschirm ueberspringt.

Drei Dinge, die den Wisch bzw. die Messung sonst still zerstoeren:

- **Nicht auf der Rang-Leiste ansetzen.** Die offene Leiste klebt oben in der
  Liste (y ~1075-1190); ganz eingeklappt liegen die Leisten als gewoehnliche
  Zeilen darunter. Ein Wisch, der dort beginnt, gilt als Tipp und klappt die
  Gruppe zu — so ging bei der ersten Messreihe R4 zu und jede Messung kam als
  0 zurueck.
- **Nicht unter dem Listenende ansetzen.** Die Liste endet bei y~1926, darunter
  sitzt „Teilnahme erbitten"; ein Wisch von dort scrollt nichts.
- **Das Vergleichsmuster muss ganz in der Liste liegen.** `list_view` reicht
  bis 2090 und damit ueber das Listenende in den unbeweglichen Fussbereich.
  Ein Muster von dort passt immer auf sich selbst — gemessen wird 0, obwohl
  gescrollt wurde. Deshalb rechnet dieses Modul mit LISTE_UNTEN statt mit
  `list_view[3]`.

Der Suchraum begrenzt zugleich die groesste messbare Strecke: das Muster sitzt
direkt ueber LISTE_UNTEN und wird nach oben bis LISTE_OBEN gesucht. Ein Schritt,
der weiter traegt als dieser Abstand, ist nicht mehr messbar und liefert wegen
der einander sehr aehnlichen Karten leicht einen Scheintreffer — die Schrittweite
gehoert deshalb deutlich darunter.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import time

import cv2
import numpy as np

from scripts.ws_service.device import Geraet

ADB = "/opt/homebrew/bin/adb"
DEV = "127.0.0.1:5555"

LISTE_OBEN = 1075       # Oberkante der Liste (unter dem Suchfeld)
LISTE_UNTEN = 1926      # gemessene Unterkante — darunter beginnt der Fussbereich
X_VON, X_BIS = 700, 1900

Y_UNTEN = 1890          # tiefster sicherer Ansatzpunkt (ueber dem Knopf)
Y_OBEN_MIN = 1250       # hoechster sicherer Endpunkt (unter der Leiste)

MUSTER_HOCH = 200


def swipe(y_von: int, y_bis: int, dauer_ms: int, x: int = 1280) -> None:
    subprocess.run(
        [ADB, "-s", DEV, "shell", "input", "swipe",
         str(x), str(y_von), str(x), str(y_bis), str(dauer_ms)],
        check=True, capture_output=True)


def versatz(vorher: np.ndarray, nachher: np.ndarray) -> tuple[int | None, float]:
    """Um wie viele Pixel ist der Listeninhalt nach oben gerutscht?

    Gibt (Pixel, Guete) zurueck. Die Guete steht mit im Protokoll, damit ein
    Scheintreffer nicht als Messwert durchgeht.
    """
    a = cv2.cvtColor(vorher, cv2.COLOR_RGB2GRAY)
    b = cv2.cvtColor(nachher, cv2.COLOR_RGB2GRAY)
    muster = a[LISTE_UNTEN - MUSTER_HOCH:LISTE_UNTEN, X_VON:X_BIS]
    suchraum = b[LISTE_OBEN:LISTE_UNTEN, X_VON:X_BIS]
    treffer = cv2.matchTemplate(suchraum, muster, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(treffer)
    if guete < 0.7:
        return None, guete
    return (LISTE_UNTEN - MUSTER_HOCH) - (LISTE_OBEN + ort[1]), guete


def main() -> int:
    strecke = int(sys.argv[1]) if len(sys.argv) > 1 else 450
    dauer = int(sys.argv[2]) if len(sys.argv) > 2 else 2500
    anzahl = int(sys.argv[3]) if len(sys.argv) > 3 else 8

    y_bis = Y_UNTEN - strecke
    if y_bis < Y_OBEN_MIN:
        raise SystemExit(
            f"Strecke {strecke} zu gross — Endpunkt {y_bis} laege auf der Leiste.")
    grenze = LISTE_UNTEN - MUSTER_HOCH - LISTE_OBEN
    print(f"Strecke {strecke} px, Dauer {dauer} ms, {anzahl} Schritte "
          f"(messbar bis {grenze} px)")

    cfg = json.loads(
        pathlib.Path("scripts/cs_service/config.json").read_text())
    g = Geraet(cfg)
    werte: list[int] = []
    for i in range(1, anzahl + 1):
        vorher = g.bild()
        swipe(Y_UNTEN, y_bis, dauer)
        time.sleep(1.6)
        px, guete = versatz(vorher, g.bild())
        print(f"  Schritt {i:>2}: {str(px):>6} px  (Guete {guete:.2f})",
              flush=True)
        if px is not None:
            werte.append(px)
    if werte:
        s = sorted(werte)
        print(f"\nmin {s[0]} · median {s[len(s)//2]} · max {s[-1]} "
              f"· {len(werte)}/{anzahl} messbar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
