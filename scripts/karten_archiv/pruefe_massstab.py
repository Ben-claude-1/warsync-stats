"""Massstab mit derselben Maschinerie messen, die der Sweep benutzt.

    scripts/karten_archiv/im_terminal.sh pruefe_massstab --um 10

Der Sweep rechnet Pixelversatz in Welteinheiten um. Zwei Dinge koennen dabei
falsch sein, und sie sehen im Ergebnis gleich aus:

* `skala_x` stimmt nicht,
* oder der Vorlagenabgleich misst den Versatz falsch.

Auseinanderzuhalten sind sie nur mit einer Verschiebung, deren Weltbetrag
**bekannt** ist. Genau das liefert der Lupe-Sprung: er setzt die Kamera exakt
auf eine Koordinate. Zwei Sprünge im Abstand `--um` Einheiten, dazwischen der
Abgleich — der gemessene Pixelversatz geteilt durch `--um` ist der Massstab.

Ergibt das den eingetragenen Wert, ist die Umrechnung in Ordnung und ein
Restfehler im Sweep stammt aus der Wischgeste selbst (etwa aus einer Kamera, die
beim Fotografieren noch gleitet). Ergibt es etwas anderes, ist der Eintrag falsch.

**Der Sprung darf nicht zu weit sein.** Ueberlappen sich die beiden Aufnahmen
nicht mehr, hat der Abgleich nichts zu vergleichen; bei 199 px je Einheit und
1660 px HUD-freier Breite sind hoechstens 8 Einheiten drin, sinnvoll sind 4–6.
"""
from __future__ import annotations

import argparse

import numpy as np

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import foto, position, sprung, wisch, zoom
from scripts.karten_archiv.run import CFG


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--stufe", default="sprung")
    p.add_argument("--von", nargs=2, type=int, default=[478, 553], metavar=("X", "Y"))
    p.add_argument("--um", type=int, default=5, help="Sprungweite in Welteinheiten")
    p.add_argument("--wiederholungen", type=int, default=3)
    a = p.parse_args()

    scfg = zoom.stufe(CFG, a.stufe)
    g = Geraet()
    g.starten()

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG, bild)
    print(f"Stufe {a.stufe!r}: eingetragen skala_x {scfg['skala_x']:.1f}, "
          f"skala_y {scfg['skala_y']:.1f}\n", flush=True)

    werte = []
    for i in range(a.wiederholungen):
        x, y = a.von[0] + i, a.von[1]
        sprung.springen(g, CFG, x, y, bild)
        vor = sprung.dialog_sicherstellen(g, CFG, False, bild)
        zoom.nach_sprung(g, scfg)
        if scfg.get("raus_gesten"):
            vor = bild()

        sprung.springen(g, CFG, x + a.um, y, bild)
        nach = sprung.dialog_sicherstellen(g, CFG, False, bild)
        zoom.nach_sprung(g, scfg)
        if scfg.get("raus_gesten"):
            nach = bild()

        erw = a.um * scfg["skala_x"]
        sx, sy, guete = wisch.versatz_nachziehen(vor, nach, scfg, (erw, 0.0),
                                                 toleranz=200)
        if guete <= 0:
            print(f"  {x} → {x+a.um}: kein belastbarer Abgleich", flush=True)
            continue
        werte.append(sx / a.um)
        print(f"  {x} → {x+a.um}:  Versatz {sx:7.1f} px  (Guete {guete:.2f})  "
              f"→ skala_x {sx/a.um:6.1f}   Y-Versatz {sy:+5.1f} px", flush=True)

    if not werte:
        print("\nNichts messbar.")
        return 1
    m = float(np.median(werte))
    ab = (m - scfg["skala_x"]) / scfg["skala_x"] * 100
    print(f"\nskala_x gemessen {m:.1f} px je Welteinheit "
          f"(eingetragen {scfg['skala_x']:.1f}, Unterschied {ab:+.1f} %)")
    if abs(ab) < 2:
        print("→ Die Umrechnung stimmt. Ein Restfehler im Sweep kommt aus der "
              "Wischgeste, nicht aus dem Massstab.")
    else:
        print("→ Der eingetragene Massstab ist es. Er gehoert korrigiert, sonst "
              "traegt jede Kachel denselben Fehler.")

    p2 = position.lesen(g, CFG, bild)
    print(f"Kameraposition zum Schluss: {p2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
