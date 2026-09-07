"""Wie viele Pixel ist eine Welteinheit — gemessen am Sprung, nicht am Raster.

    scripts/karten_archiv/im_terminal.sh pruefe_skala

`skala_x` ist die Zahl, an der im Kartenarchiv alles haengt: Kachelbreite,
Ueberlappung, jede Bannerkoordinate. Am 08.09.2026 lagen dafuer **drei**
Messungen vor, die sich widersprachen — 199,1 aus der Konfiguration, 190,9 aus
dem Vergleich von Wischversatz und Lupe-Dialog, 181,5 aus den Rasterabstaenden
der Bannerspalten. Zwischen der ersten und der letzten liegen zehn Prozent; bei
einer Kachelbreite von 1660 px sind das 0,9 Welteinheiten Unterschied, mehr als
ein halber Rasterabstand.

**Der Sprung ist der eindeutige Massstab.** Er setzt die Kamera auf eine exakte
Koordinate — das bestaetigt der Dialog unmittelbar danach. Springt man zweimal
mit bekanntem Abstand und misst, um wie viele Pixel sich der Bildinhalt dabei
verschoben hat, ist der Quotient die Antwort. Kein Raster, dessen Vielfaches man
raten muesste; keine Wischgeste, deren Traegheit mitspielt; keine Zoomkette, die
den Fehler einer anderen Stufe erbt.

Zwei Dinge, auf die es dabei ankommt:

* **Der Abstand muss klein genug fuer eine Ueberlappung sein.** Bei rund 190 px je
  Einheit und 1660 px Kachelbreite passen hoechstens acht Einheiten ins Bild;
  gemessen wird mit vier, damit die Haelfte stehen bleibt.
* **Gesucht wird ohne enge Erwartung.** Genau die Toleranzgrenze, die im Sweep die
  Messung an den Fensterrand druecken kann, wird hier weggelassen — sonst
  bestaetigte die Messung nur die Annahme, mit der sie gestartet ist.
"""
from __future__ import annotations

import argparse
import sys

import cv2
import numpy as np

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import foto, position, sprung, zoom
from scripts.karten_archiv.run import CFG


def _versatz(vor: np.ndarray, nach: np.ndarray, cfg: dict) -> tuple[float, float]:
    """Verschiebung des Bildinhalts in Pixeln — mit weitem Suchbereich."""
    x0, y0, x1, y1 = cfg["karte"]
    alt = cv2.cvtColor(vor, cv2.COLOR_RGB2GRAY)
    neu = cv2.cvtColor(nach, cv2.COLOR_RGB2GRAY)
    # Vorlage aus der Bildmitte, schmal und hoch: waagerecht wandert der Inhalt,
    # senkrecht steht er — so bleibt sie auch bei grossem Versatz im Bild.
    my = (y0 + y1) // 2
    # **Die Vorlage gehoert an den rechten Rand, nicht in die Mitte.** Waechst X,
    # wandert der Bildinhalt nach links; eine mittige Vorlage liegt nach dem Sprung
    # halb im HUD und damit ausserhalb des durchsuchbaren Streifens. Rechts
    # entnommen, wandert sie in die Mitte hinein — dorthin, wo gesucht wird.
    vx0, vx1 = x1 - 650, x1 - 350
    vorlage = alt[my - 500:my + 500, vx0:vx1]
    suche = neu[my - 560:my + 560, x0:x1]
    karte = cv2.matchTemplate(suche, vorlage, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(karte)
    return float(vx0 - (x0 + ort[0])), float(guete)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stellen", nargs="*", type=int,
                    default=[200, 400, 600, 800], help="X-Werte, an denen gemessen wird")
    ap.add_argument("--y", type=int, default=500)
    ap.add_argument("--abstand", type=int, default=4, help="Sprungweite in Welteinheiten")
    a = ap.parse_args()

    g = Geraet()
    g.starten()
    g.app_starten()

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG, bild)
    print(f"Sprungweite {a.abstand} E, Konfiguration sagt "
          f"{CFG['skala_x']:.1f} px/E → erwartet {a.abstand*CFG['skala_x']:.0f} px\n")
    print(f"{'von':>5} {'nach':>5} {'Dialog':>13} {'Versatz px':>11} {'Guete':>6} {'px/E':>8}")

    werte = []
    for x in a.stellen:
        sprung.springen(g, CFG, x, a.y, bild)
        sprung.dialog_sicherstellen(g, CFG, False, bild)
        vor = bild()
        p1 = position.lesen(g, CFG, bild, erwartet=(x, a.y), toleranz=3)

        sprung.springen(g, CFG, x + a.abstand, a.y, bild)
        sprung.dialog_sicherstellen(g, CFG, False, bild)
        nach = bild()
        p2 = position.lesen(g, CFG, bild, erwartet=(x + a.abstand, a.y), toleranz=3)

        if p1 is None or p2 is None:
            print(f"{x:>5} {x+a.abstand:>5} {'nicht lesbar':>13}   — uebersprungen")
            continue
        echt = p2[0] - p1[0]
        px, guete = _versatz(vor, nach, CFG)
        if echt <= 0 or guete < 0.3:
            print(f"{x:>5} {x+a.abstand:>5} {f'{p1[0]}→{p2[0]}':>13} {px:>11.0f} "
                  f"{guete:>6.2f}   unbrauchbar")
            continue
        s = px / echt
        werte.append(s)
        print(f"{x:>5} {x+a.abstand:>5} {f'{p1[0]}→{p2[0]}':>13} {px:>11.0f} "
              f"{guete:>6.2f} {s:>8.1f}")

    if werte:
        med = float(np.median(werte))
        print(f"\nskala_x = {med:.1f} px/E   (Konfiguration {CFG['skala_x']:.1f}, "
              f"Abweichung {100*(med-CFG['skala_x'])/CFG['skala_x']:+.1f} %)")
        b = CFG["karte"][2] - CFG["karte"][0]
        print(f"Kachelbreite damit {b/med:.2f} E statt {b/CFG['skala_x']:.2f} E")
    else:
        print("\nKeine brauchbare Messung.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
