"""Misst, wie gut das Team-Abzeichen gelesen wird — gegen die Balkenfarbe.

    .venv/bin/python -m scripts.ws_service.pruefe_team_abzeichen <bilderordner>

Der Dienst nahm das Team bis zum 16.09.2026 aus der Farbe des Balkens ueber der
Zeile. Diese Pruefung stellt beide Auskuenfte nebeneinander und zeigt, wo sie
auseinandergehen — das ist die Stelle, an der eine von beiden falsch ist.

Erwartet wird **keine** vollstaendige Uebereinstimmung: genau die Abweichungen
sind der Grund fuer den Umbau. Gemessen an den 220 Bildern des Mitschnitts
`20260916_124554_lauf9_hand`:

    belegte Felder           219
    Abzeichen gelesen        219
    stimmt mit dem Balken    212
    weicht ab                  7   (ZephyrusXI 1x, Mammon90 3x, Puwe 3x)

Die sieben zerfallen in zwei Gruppen. ZephyrusXI und Mammon90 haben sich fuer
**beide Kampfzeiten** gemeldet: ihr Balken wechselt staendig zwischen den zwei
Farben und Uhrzeiten, das Abzeichen bleibt gleich. Das ist kein Flackern der
Anzeige, sondern die Auskunft „waere in beiden Teams einsetzbar"
(`match.beide_zeiten`). Bei Puwe widersprechen sich beide durchgehend —
der Balken nennt die gemeldete Zeit, das Abzeichen die Einteilung, und die
muessen nicht dasselbe sein.

Was hier auffallen soll, ist der andere Fall: **kein** Abzeichen gelesen,
obwohl ein Feld belegt ist. Dann stimmt der Ausschnitt nicht mehr — etwa nach
einer Aenderung an `badge_x` oder an der Aufloesung.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

from . import roster, vision as v
from .mitlesen import _Ohne
from .device import CONFIG


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print(__doc__)
        return 1
    ordner = Path(argv[0]).expanduser()
    bilder = sorted(ordner.glob("bild_*.png"))
    if not bilder:
        print(f"Keine Bilder in {ordner}")
        return 1
    # Welches Blatt gescannt wurde, entscheidet, was gruen bedeutet: gruen sind
    # die, die sich fuer die Zeit **dieses** Blatts gemeldet haben (siehe
    # roster.farb_teams). Vorher stand hier fest „gruen = A", und ueber einen
    # Mitschnitt von Blatt B meldete das Skript prompt 163 Scheinabweichungen —
    # eine Messung, die ihre eigene Annahme misst.
    blatt = (argv[1] if len(argv) > 1 else "A").upper()
    farb_team = {"gruen": blatt, "orange": "B" if blatt == "A" else "A"}
    print(f"Gescanntes Blatt: {blatt} → {farb_team}")

    g = _Ohne(CONFIG)
    _, _, _, view_unten = g.cfg["list_view"]
    nx0, nx1 = g.cfg["name_box_x"]
    schwelle = g.cfg["schwellen"]["badge_blau_minus_rot"]

    zahl = Counter()
    abweichungen = []
    for pfad in bilder:
        bild = np.array(Image.open(pfad).convert("RGB"))
        for y0, y1, farbe in roster.zeitkoepfe(g, bild):
            if y1 + 210 >= view_unten:
                continue
            for rolle, x in g.cfg["badge_x"].items():
                if v.blau_signal(bild, x, y1 + 40, y1 + 230) <= schwelle:
                    continue
                zahl["belegte Felder"] += 1
                buchstabe = roster.team_abzeichen(bild, y1, x)
                if buchstabe is None:
                    zahl["nicht gelesen"] += 1
                    abweichungen.append((pfad.name, farbe, rolle, "—"))
                    continue
                zahl["gelesen"] += 1
                erwartet = farb_team[farbe]
                if buchstabe == erwartet:
                    zahl["wie der Balken"] += 1
                else:
                    zahl["gegen den Balken"] += 1
                    name = roster._name_vision(bild, (nx0, y1 + 8, nx1, y1 + 205))
                    abweichungen.append((pfad.name, farbe, rolle, f"{buchstabe} ({name})"))

    print(f"{len(bilder)} Bilder aus {ordner.name}")
    for k, n in zahl.items():
        print(f"  {k:20s} {n}")
    if abweichungen:
        print("\nAbweichungen (Bild · Balken · Feld · Abzeichen):")
        for a in abweichungen:
            print("  " + " · ".join(a))
    return 0


if __name__ == "__main__":
    sys.exit(main())
