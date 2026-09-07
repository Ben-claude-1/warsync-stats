"""Wie weit darf man herauszoomen, ohne die Namen zu verlieren?

    scripts/karten_archiv/im_terminal.sh pruefe_stufen

Eine Zoomgeste weiter draussen deckt die vierfache Flaeche ab und halbiert damit
den Vollscan — von rund zehn auf knapp fuenf Stunden. Das ist der groesste
Einzelhebel im ganzen Archiv, groesser als Ueberlappung und Schrittweite
zusammen. Der Preis steht dagegen: bei 38 px Bannerhoehe bleiben der Schrift
zwoelf Pixel Versalhoehe, und daran scheitert Tesseract. Gemessen wurden auf der
weiten Stufe 5 von rund 16 Kadernamen, auf der nahen 30.

**Zwischen beiden liegt ungemessenes Land.** Die Konfiguration kennt zwei
Zoomgesten — `zoom_raus_gross` (700→580) und das deutlich kleinere `zoom_raus`
(700→665). Fuer die weite Stufe wird bisher nur die grosse benutzt, es gibt also
keinen Befund darueber, was ein oder zwei kleine Gesten liefern. Genau dort
koennte der Punkt liegen, an dem die Namen noch tragen und der Lauf trotzdem
deutlich kuerzer wird.

Dieses Skript faehrt dieselbe Stelle auf mehreren Stufen an und misst je Stufe:

* den **Zoomfaktor** aus dem Bildvergleich — rein geometrisch, ohne ein gelesenes
  Wort, und damit Massstab und Bannergroesse der Stufe;
* wie viele **Banner** der Finder ueberhaupt sieht;
* wie viele davon **Text** liefern, und wie lang er ist.

Die Zahl, auf die es ankommt, ist die letzte. Banner zu finden ist auf der weiten
Stufe kein Problem — die Namen zu lesen schon.

**Gemessen wird am Geraet, nicht am Schreibtisch.** Dieselbe Pruefung an einer
verkleinerten Aufnahme der nahen Stufe lieferte bei Bannerhoehe 37 noch 9 von 11
Namen: das Spiel rendert weit draussen schlechter, als sauberes Verkleinern es
taete. Eine Simulation waere also zu optimistisch.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import banner, eichen_reihen, foto, sprung, zoom
from scripts.karten_archiv.archiv import WURZEL
from scripts.karten_archiv.run import CFG

ABLAGE = WURZEL / "stufenpruefung"

# Jede Stufe als Folge von Zoom-Gesten ab der Sprung-Stufe. `gross` ist
# `zoom_raus_gross`, `klein` ist `zoom_raus` — der Unterschied ist genau das,
# was hier zur Debatte steht.
STUFEN = [
    ("sprung", []),
    ("klein_1", ["klein"]),
    ("klein_2", ["klein", "klein"]),
    ("gross_1", ["gross"]),
]


def _gesten(g, cfg: dict, folge: list[str]) -> None:
    for art in folge:
        zoom.pinch(g, *(cfg["zoom_raus_gross"] if art == "gross" else cfg["zoom_raus"]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wo", nargs=2, type=int, default=[481, 557], metavar=("X", "Y"),
                    help="Stelle mit dichter Besiedlung — sonst misst man leeres Land")
    a = ap.parse_args()

    g = Geraet()
    g.starten()
    g.app_starten()

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG, bild)
    ABLAGE.mkdir(parents=True, exist_ok=True)
    wx, wy = a.wo

    print(f"{'Stufe':>9} {'Faktor':>7} {'px/E':>7} {'Kachel':>13} {'Banner':>7} "
          f"{'mit Text':>9} {'Kacheln':>8} {'Zeit':>6}")
    grund = None
    for name, folge in STUFEN:
        # Jede Stufe beginnt beim Sprung — der setzt den Zoom hart zurueck und ist
        # damit der einzige Ausgangspunkt, der fuer alle Stufen derselbe ist.
        sprung.springen(g, CFG, wx, wy, bild)
        sprung.dialog_sicherstellen(g, CFG, False, bild)
        vor = bild()
        if grund is None:
            grund = vor
        _gesten(g, CFG, folge)
        nach = bild()

        if folge:
            f, _vx, _vy, guete = eichen_reihen.zoomfaktor(grund, nach, CFG)
        else:
            f, guete = 1.0, 1.0
        skala = CFG["skala_x"] * f
        scfg = dict(CFG, skala_x=skala, skala_y=CFG["skala_y"] * f,
                    banner_hoehe=CFG["banner_hoehe"] * f,
                    banner_breite=CFG["banner_breite"] * f,
                    banner_versatz=CFG["banner_versatz"] * f)

        im = Image.fromarray(nach)
        im.save(ABLAGE / f"{name}.png")
        gefunden = banner.auswerten(im, wx, wy, scfg)
        mit_text = [b for b in gefunden if len(b["name_ocr"].strip()) >= 3]

        breite = (CFG["karte"][2] - CFG["karte"][0]) / skala
        schritt = breite * 0.75
        spalten = int(999 / schritt) + 1
        # Der Zeilenabstand waechst mit der Kachelhoehe im selben Verhaeltnis.
        zeilen = int(999 / (CFG["schritt_y"] / f)) + 1
        n = spalten * zeilen

        print(f"{name:>9} {f:>7.3f} {skala:>7.1f} {breite:>6.1f} E     "
              f"{len(gefunden):>7d} {len(mit_text):>9d} {n:>8d} {n*2.62/3600:>5.1f} h"
              + ("" if guete > 0.5 or not folge else "   (Faktor unsicher)"))

    print(f"\nBilder: {ABLAGE}")
    print("Die Namen selbst gehoeren angesehen — 'mit Text' zaehlt Zeichen, "
          "nicht Richtigkeit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
