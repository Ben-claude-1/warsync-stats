"""Wie gross die Weltkarte wirklich ist — gemessen, nicht angenommen.

    scripts/karten_archiv/im_terminal.sh kartenrand

Ein Vollscan haengt an vier Zahlen. Wer sie zu gross ansetzt, faehrt stundenlang
ueber Gebiet, das es nicht gibt; wer sie zu klein ansetzt, hat hinterher ein
Archiv, das vollstaendig aussieht und einen Rand vermissen laesst. Beides faellt
erst auf, wenn die zehn Stunden schon vorbei sind.

**Der Lupe-Dialog beantwortet die Frage selbst.** Er nimmt eine Zielkoordinate
entgegen und zeigt danach an, wo die Kamera wirklich steht. Springt man an eine
Stelle ausserhalb der Karte, kommt etwas anderes zurueck als das Gewuenschte —
und genau dieser Unterschied ist die Messung. Gesucht wird per Intervallhalbierung,
das sind rund zehn Spruenge je Rand.

**Gemessen wird die Kameramitte, nicht der aeusserste Zipfel der Karte.** Am Rand
kann die Kamera nicht weiter, obwohl dahinter noch Karte liegt — die faengt der
Scan ueber die Kachelbreite mit ein. Fuer die Zeilenplanung ist die Kameramitte
die richtige Zahl, denn genau dorthin wird gesprungen.
"""
from __future__ import annotations

import argparse
import json
import sys

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import foto, position, sprung, zoom
from scripts.karten_archiv.archiv import WURZEL
from scripts.karten_archiv.run import CFG


def anspringen(g, bild, x: int, y: int) -> tuple[int, int] | None:
    """Springen und ablesen, wo man gelandet ist. Ohne Erwartung — hier wird ja
    gerade gesucht, was plausibel ist."""
    sprung.springen(g, CFG, x, y, bild)
    sprung.dialog_sicherstellen(g, CFG, False, bild)
    return position.lesen(g, CFG, bild)


def _grenze(g, bild, achse: int, fest: int, innen: int, aussen: int,
            log=print) -> int:
    """Groesster (bzw. kleinster) Wert der Achse, der noch angefahren wird.

    `innen` ist bekannt erreichbar, `aussen` bekannt nicht. Halbiert wird, bis
    beide beieinanderliegen. Eine nicht lesbare Position gilt als *nicht
    erreicht* — lieber ein Rand eine Einheit zu eng als eine Zahl geraten.
    """
    while abs(aussen - innen) > 1:
        mitte = (innen + aussen) // 2
        ziel = (mitte, fest) if achse == 0 else (fest, mitte)
        p = anspringen(g, bild, *ziel)
        getroffen = p is not None and abs(p[achse] - mitte) <= 1
        log(f"    {'X' if achse == 0 else 'Y'}={mitte:4d} → "
            f"{p if p else 'nicht lesbar'}  {'ja' if getroffen else 'nein'}")
        if getroffen:
            innen = mitte
        else:
            aussen = mitte
    return innen


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--anker", nargs=2, type=int, default=[481, 557],
                   metavar=("X", "Y"), help="bekannt gueltige Stelle als Ausgangspunkt")
    p.add_argument("--weit", type=int, default=1400,
                   help="Wert, der sicher ausserhalb liegt")
    a = p.parse_args()

    g = Geraet()
    g.starten()
    g.app_starten()

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG, bild)
    if not zoom.lupe_da(bild(), CFG):
        print("Kein Lupe-Knopf — ohne Dialog laesst sich der Rand nicht messen.",
              file=sys.stderr)
        return 1

    ax, ay = a.anker
    p0 = anspringen(g, bild, ax, ay)
    if p0 is None or abs(p0[0] - ax) > 1 or abs(p0[1] - ay) > 1:
        print(f"Der Anker {ax}/{ay} wird selbst nicht getroffen ({p0}). "
              f"Ohne gueltigen Ausgangspunkt hat die Suche keinen Halt.",
              file=sys.stderr)
        return 1
    print(f"Anker {ax}/{ay} bestaetigt.\n")

    print("X nach Osten:")
    x_max = _grenze(g, bild, 0, ay, ax, a.weit)
    print(f"  → X max {x_max}\n")
    # Nach unten wird bei 0 angesetzt, nicht bei -weit. Das Eingabefeld nimmt
    # kein Minuszeichen an: `input text -460` kommt als `460` an, der Sprung
    # landet auf 460 und gilt zu Recht als "nicht erreicht" — die Suche findet
    # den Rand trotzdem, verplempert aber ein halbes Dutzend Spruenge auf
    # Werte, die es nie geben konnte.
    print("X nach Westen:")
    x_min = _grenze(g, bild, 0, ay, ax, 0)
    print(f"  → X min {x_min}\n")
    print("Y nach Norden:")
    y_max = _grenze(g, bild, 1, x_max, ay, a.weit)
    print(f"  → Y max {y_max}\n")
    print("Y nach Sueden:")
    y_min = _grenze(g, bild, 1, x_max, ay, 0)
    print(f"  → Y min {y_min}\n")

    satz = {"x": [x_min, x_max], "y": [y_min, y_max],
            "anker": [ax, ay],
            "_": "Kameramitte, nicht Kartenrand — gemessen ueber den Lupe-Dialog "
                 "(scripts/karten_archiv/kartenrand.py)."}
    ziel = WURZEL / "kartenrand.json"
    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_text(json.dumps(satz, indent=2, ensure_ascii=False))
    print(f"X {x_min} … {x_max}  ({x_max - x_min + 1} Einheiten)")
    print(f"Y {y_min} … {y_max}  ({y_max - y_min + 1} Einheiten)")
    print(f"\n{ziel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
