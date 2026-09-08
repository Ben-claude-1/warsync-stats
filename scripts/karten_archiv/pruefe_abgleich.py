"""Warum der Vorlagenabgleich aufgibt — am abgelegten Archiv, ohne Geraet.

    .venv/bin/python -m scripts.karten_archiv.pruefe_abgleich --name karte_nah --zeile 4

Jeder schwache Abgleich kostet eine Positionsablesung: Dialog auf, OCR, Dialog zu,
rund drei Sekunden — bei einer Kachel, die sonst 2,7 s braucht. Im Lauf vom
08.09.2026 traf das jede zehnte Kachel und war damit der groesste Einzelposten
nach dem Wischen selbst.

**Nachgestellt wird mit der echten Funktion.** Die abgelegte Kachel wird in ein
Vollbild an ihren Platz zurueckgelegt und dann durch `wisch.versatz_nachziehen`
geschickt — dieselbe Geometrie, dieselbe Toleranz, derselbe Code wie im Lauf. Eine
Nachbildung waere hier wertlos: die Frage ist ja gerade, ob es an den Parametern
liegt, und die stecken in genau dieser Funktion.

Was der Vergleich **nicht** nachstellen kann: den Augenblick. Im Lauf entsteht das
zweite Bild direkt nach dem Wisch, hier sind beide Kacheln ausgeglitten. Findet der
Abgleich hier, was er im Lauf verloren hat, liegt es am Zeitpunkt der Aufnahme —
nicht am Gelaende und nicht an den Parametern.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from scripts.karten_archiv import wisch, zoom
from scripts.karten_archiv.archiv import WURZEL
from scripts.karten_archiv.run import CFG

GRENZE = 0.30          # dieselbe Schwelle wie in sweep.py


def _vollbild(kachel: Path, cfg: dict) -> np.ndarray:
    """Die abgelegte Kachel zurueck an ihren Platz im Vollbild.

    Ausserhalb bleibt es schwarz statt HUD. Fuer den Abgleich ist das ohne Belang:
    Vorlage und Suchfenster liegen innerhalb des Kartenrechtecks.
    """
    x0, y0, x1, y1 = cfg["karte"]
    voll = np.zeros((2560, 2560, 3), dtype=np.uint8)
    voll[y0:y1, x0:x1] = np.asarray(Image.open(kachel).convert("RGB"))
    return voll


def paare(pfad: Path, zeile: int):
    js = sorted((pfad / "kacheln").glob(f"z{zeile:03d}_*.json"),
                key=lambda p: int(p.stem.split("_k")[1]))
    for a, b in zip(js, js[1:]):
        xa = json.loads(a.read_text())["kamera"][0]
        xb = json.loads(b.read_text())["kamera"][0]
        yield xa, xb - xa, a.with_suffix(".png"), b.with_suffix(".png")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="karte_nah")
    p.add_argument("--zeile", type=int, default=4)
    a = p.parse_args()

    pfad = WURZEL / a.name
    manifest = json.loads((pfad / "manifest.json").read_text())
    scfg = dict(manifest["modell"], karte=manifest["zuschnitt"], navigation="wisch")
    skala = scfg["skala_x"]

    ps = [t for t in paare(pfad, a.zeile) if t[2].exists() and t[3].exists()]
    if not ps:
        print(f"Keine Kacheln fuer Zeile {a.zeile} in {pfad}")
        return 1

    # Die Erwartung, mit der der Lauf gearbeitet hat: die nominale Schrittweite.
    erwartet_px = float(np.median([dx * skala for _, dx, _, _ in ps]))
    print(f"Archiv {a.name}, Zeile {a.zeile}: {len(ps)} Kachelpaare, "
          f"Schritt median {erwartet_px:.0f} px ({erwartet_px/skala:.2f} E)\n")

    guten = []
    for xa, dx, pa, pb in ps:
        vorher, nachher = _vollbild(pa, scfg), _vollbild(pb, scfg)
        sx, _sy, g = wisch.versatz_nachziehen(vorher, nachher, scfg,
                                              (erwartet_px, 0.0))
        guten.append((xa, dx * skala, sx, g))

    werte = [g for _, _, _, g in guten]
    schwach = [t for t in guten if t[3] < GRENZE]
    print(f"{'X':>7} {'wahr px':>8} {'gemessen':>9} {'Guete':>6}")
    print("-" * 34)
    for xa, wahr, sx, g in guten:
        mark = "  ← schwach" if g < GRENZE else ""
        print(f"{xa:7.1f} {wahr:8.0f} {sx:9.0f} {g:6.2f}{mark}")

    print(f"\nGuete: median {np.median(werte):.2f}, min {min(werte):.2f}, "
          f"max {max(werte):.2f}")
    print(f"Unter der Schwelle {GRENZE}: {len(schwach)} von {len(guten)} "
          f"({100*len(schwach)/len(guten):.0f} %)")
    fehl = [t for t in guten if abs(t[2] - t[1]) > 40 and t[3] >= GRENZE]
    if fehl:
        print(f"\n{len(fehl)} Messungen ueber 40 px daneben trotz guter Guete — "
              f"das waere die gefaehrliche Sorte:")
        for xa, wahr, sx, g in fehl:
            print(f"  X {xa:.1f}: gemessen {sx:.0f} statt {wahr:.0f} (Guete {g:.2f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
