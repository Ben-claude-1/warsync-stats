"""Kartenarchiv: ein Weltrechteck kachelweise abfotografieren.

    .venv/bin/python -m scripts.karten_archiv.run --von 470 540 --bis 500 580
    .venv/bin/python -m scripts.karten_archiv.run --von 0 0 --bis 999 999 --name voll
    .venv/bin/python -m scripts.karten_archiv.run --von 470 540 --bis 500 580 --lesen

`--lesen` wertet zusaetzlich sofort aus (Banner finden, Namen lesen, gegen den
Kader halten) — im Alltag ist das nicht noetig, denn die Auswertung ist bewusst
ein eigener Schritt ueber dem Archiv und darf ohne Geraet beliebig oft laufen.

**Aktiv begleiten, nicht im Hintergrund laufen lassen.** Jede Kachel schreibt
ihren Stand sofort; ein Abbruch kostet hoechstens die laufende Kachel, und ein
Neustart setzt fort.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import banner, foto, sprung, zoom
from scripts.karten_archiv.archiv import Archiv, gitter

CFG = json.loads((Path(__file__).resolve().parent / "config.json").read_text())


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--von", nargs=2, type=int, required=True, metavar=("X", "Y"))
    p.add_argument("--bis", nargs=2, type=int, required=True, metavar=("X", "Y"))
    p.add_argument("--name", default="pilot")
    p.add_argument("--lesen", action="store_true", help="Banner sofort mit auswerten")
    a = p.parse_args()

    g = Geraet()
    g.starten()
    g.app_starten()

    archiv = Archiv(a.name, CFG)
    orte = gitter(tuple(a.von), tuple(a.bis), CFG)
    print(f"Archiv {archiv.pfad}")
    print(f"{len(orte)} Kacheln (Schritt {CFG['schritt_x']}x{CFG['schritt_y']} "
          f"Welteinheiten), davon {sum(archiv.fertig(*o) for o in orte)} schon vorhanden\n",
          flush=True)

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG)
    stand = bild()
    if not zoom.lupe_da(stand, CFG):
        print("Kein Lupe-Knopf sichtbar — das Spiel ist im Uebersichtsmodus oder auf "
              "der Basis. Ohne den Knopf gibt es keinen Koordinatensprung.", file=sys.stderr)
        return 1

    letzter_hash = None
    t_start = time.time()
    for i, (x, y) in enumerate(orte, 1):
        if archiv.fertig(x, y):
            continue
        t0 = time.time()
        # `stand` ist das letzte gemachte Bild und dient zugleich als
        # Zustandspruefung — ein zweites Foto nur dafuer waere der teuerste
        # Posten je Kachel.
        sprung.springen(g, CFG, x, y, bild, bekannt=stand)
        roh = sprung.dialog_sicherstellen(g, CFG, False, bild)
        stand = roh
        im = Image.fromarray(roh)

        extra: dict = {}
        if a.lesen:
            gefunden = banner.auswerten(im, x, y, CFG)
            extra["banner"] = gefunden
            extra["banner_anzahl"] = len(gefunden)

        h = archiv.speichern(x, y, im, extra)
        # Ein unveraenderter Bildinhalt heisst: die Kamera steht. Weiterzaehlen
        # wuerde ein Archiv erzeugen, das hinterher vollstaendig aussieht.
        warnung = "  ⚠ Bild identisch zur Vorkachel — Sprung hat nicht gegriffen" \
            if h == letzter_hash else ""
        letzter_hash = h
        print(f"{i:5d}/{len(orte)}  X:{x:3d} Y:{y:3d}  {time.time()-t0:4.1f}s"
              f"{'  ' + str(extra.get('banner_anzahl')) + ' Banner' if a.lesen else ''}"
              f"{warnung}", flush=True)
        if warnung:
            print("Abbruch: erst pruefen, warum die Kamera steht.", file=sys.stderr)
            return 2

    dauer = time.time() - t_start
    print(f"\nFertig. {archiv.stand()} Kacheln im Archiv, {dauer/60:.1f} min "
          f"({dauer/max(len(orte),1):.1f} s je Kachel)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
