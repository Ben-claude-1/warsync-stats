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

Die sieben zerfallen in zwei Gruppen. Bei ZephyrusXI und Mammon90 **flackert
der Balken**: dieselbe Zeile steht im Nachbarbild unter einer anderen Farbe,
das Abzeichen bleibt gleich. Bei Puwe widersprechen sich beide durchgehend —
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
                erwartet = "A" if farbe == "gruen" else "B"
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
