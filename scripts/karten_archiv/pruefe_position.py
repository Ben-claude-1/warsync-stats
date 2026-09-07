"""Zeigt der Lupe-Dialog die Kameraposition — auch ohne Sprung?

    scripts/karten_archiv/im_terminal.sh pruefe_position

`position.py` behauptet im Docstring: „Der Dialog verraet die Position, ohne dass
gesprungen wird." Darauf steht der ganze Rueckfallpfad des Vollscans — wenn der
Vorlagenabgleich den Halt verliert, ist der Dialog die einzige Quelle, die die
Zeile noch retten kann.

**Belegt war die Behauptung nie.** `kartenrand.py` liest ausschliesslich direkt
nach einem `springen()`; dort sind Eingabewert und Kameraposition per Definition
gleich, und ein Dialog, der stur den letzten Eingabewert anzeigt, saehe genauso
aus. Im Vollscan vom 07.09.2026 fiel die Ablesung in **allen** drei Zeilen bei
**jeder** Stichprobe aus (`Position nicht lesbar`) — und genau dort wird nach dem
Wischen gelesen, nicht nach einem Sprung.

Dieses Skript trennt die beiden moeglichen Ursachen, die im Sweep-Log nicht zu
unterscheiden sind, weil beide als `None` herauskommen:

  A) Der Dialog zeigt den alten Sprungwert. Dann ist die Ablesung nach dem
     Wischen wertlos, die Plausibilitaetsschranke verwirft sie zu Recht, und der
     Rueckfallpfad des Sweeps existiert nur auf dem Papier.
  B) Der Dialog zeigt die neue Position, aber Tesseract liest sie nicht.
     Dann ist es ein Bildaufbereitungs-Problem und am Ausschnitt zu sehen.

Gelesen wird deshalb **ohne** Plausibilitaetsschranke — die ist ja gerade das,
was im Sweep zugeschlagen haben koennte. Die Feldausschnitte werden abgelegt,
damit im Zweifel das Auge entscheidet und nicht die Vermutung.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np
from PIL import Image

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import foto, position, sprung, wisch, zoom
from scripts.karten_archiv.archiv import WURZEL
from scripts.karten_archiv.run import CFG

ABLAGE = WURZEL / "positionspruefung"


def _ablesen(g, bild, marke: str) -> tuple[int | None, int | None]:
    """Position ablesen, Ausschnitte ablegen — ohne jede Plausibilitaetsschranke."""
    im = sprung.dialog_sicherstellen(g, CFG, True, bild)
    p = Image.fromarray(im)
    x = position._zahl(p, position.FELD_X)
    y = position._zahl(p, position.FELD_Y)
    ABLAGE.mkdir(parents=True, exist_ok=True)
    p.crop(position.FELD_X).save(ABLAGE / f"{marke}_x.png")
    p.crop(position.FELD_Y).save(ABLAGE / f"{marke}_y.png")
    p.save(ABLAGE / f"{marke}_voll.png")
    sprung.dialog_sicherstellen(g, CFG, False, bild)
    return x, y


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", nargs=2, type=int, default=[500, 500],
                    metavar=("X", "Y"))
    ap.add_argument("--wische", type=int, default=4,
                    help="Wische je Block")
    ap.add_argument("--bloecke", type=int, default=3)
    a = ap.parse_args()

    g = Geraet()
    g.starten()
    g.app_starten()

    def bild():
        return foto.bild(g)

    # Dieselbe Stufe wie der Vollscan, sonst prueft das hier eine andere Lage
    # als die, in der der Ausfall auftrat.
    scfg = dict(zoom.stufe(CFG, "sprung"), navigation="wisch")
    zoom.stufe_einstellen(g, CFG, bild)

    sx, sy = a.start
    print(f"Sprung auf {sx}/{sy} — danach muessen Eingabe und Kamera gleich sein.")
    sprung.springen(g, CFG, sx, sy, bild)
    sprung.dialog_sicherstellen(g, CFG, False, bild)
    zoom.nach_sprung(g, scfg)

    gelesen = _ablesen(g, bild, "00_nach_sprung")
    print(f"  Dialog nach Sprung: {gelesen}")
    if gelesen[0] is None or gelesen[1] is None:
        print("  Schon hier nicht lesbar — dann ist es die Ziffernerkennung, "
              "nicht der Dialoginhalt. Ausschnitte in", ABLAGE)
        return 1

    laenge = wisch.gestenlaenge(scfg, 734.0)
    erwartet_px = laenge * wisch.traegheit(scfg)
    kamera_px = 0.0
    print(f"\nJe Block {a.wische} Wische à {laenge} px Geste.")
    print(f"{'Block':>5} {'Dialog X/Y':>14} {'Kamera-Soll X':>14} {'Urteil':>18}")

    roh = bild()
    for b in range(1, a.bloecke + 1):
        for _ in range(a.wische):
            vorher = roh
            wisch.geste(g, scfg, "x+", laenge)
            roh = bild()
            px, _py, guete = wisch.versatz_nachziehen(
                vorher, roh, scfg, (erwartet_px, 0.0))
            if guete >= 0.30:
                kamera_px += px
        dx, _dy = wisch.welt_versatz(kamera_px, 0.0, scfg)
        soll = sx + dx
        p = _ablesen(g, bild, f"{b:02d}_nach_{b * a.wische}_wischen")
        if p[0] is None:
            urteil = "nicht lesbar"
        elif abs(p[0] - sx) < 1.5 and abs(soll - sx) > 3:
            urteil = "ALT (Sprungwert)"
        elif abs(p[0] - soll) <= 3:
            urteil = "NEU (Kamera)"
        else:
            urteil = "unklar"
        # Derselbe Griff, den der Sweep tut — mit Schranke. Faellt der aus,
        # waehrend der rohe oben traegt, liegt es an der Schranke und nicht am
        # Dialog. Das ist der einzige Unterschied zwischen beiden Wegen.
        mit_schranke = position.lesen(g, CFG, bild,
                                      erwartet=(round(soll), round(sy)),
                                      toleranz=6)
        print(f"{b:>5} {str(p):>14} {soll:>14.2f} {urteil:>18}"
              f"   Sweep-Weg: {mit_schranke}")
        roh = bild()

    print(f"\nAusschnitte und Vollbilder: {ABLAGE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
