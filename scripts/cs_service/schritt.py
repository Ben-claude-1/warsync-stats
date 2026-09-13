"""Ein überwachter Scroll-Schritt: Mausrad-Rastung, dann nur den Listen-
Ausschnitt als Bild ablegen.

Warum getrennt vom Automatiklauf: der Durchlauf ist noch nicht stabil genug,
um unbeaufsichtigt zu laufen. Jeder Schritt wird einzeln angestossen und das
Ergebnis von Hand gegengelesen; der Ausschnitt statt des Vollbilds haelt das
Mitlesen schnell.

    .venv/bin/python -m scripts.cs_service.schritt 3     # drei Schritte
    .venv/bin/python -m scripts.cs_service.schritt 0     # nur Bild, kein Scroll
"""
from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image

from scripts.ws_service.device import Geraet

from . import roster

AUSGABE = pathlib.Path("/tmp/cs_schritt")


def ausschnitt(g: Geraet, ziel: pathlib.Path) -> None:
    x0, y0, x1, y1 = g.cfg["list_view"]
    bild = Image.fromarray(g.bild()[y0:y1, x0:x1])
    bild.save(ziel)


def main(schritte: int) -> None:
    cfg = json.loads(pathlib.Path("scripts/cs_service/config.json").read_text())
    g = Geraet(cfg)
    AUSGABE.mkdir(exist_ok=True)
    for alt in AUSGABE.glob("*.png"):
        alt.unlink()

    if schritte == 0:
        ausschnitt(g, AUSGABE / "s00.png")
        print("s00.png", flush=True)
        return

    for i in range(1, schritte + 1):
        roster.weiter(g)
        ziel = AUSGABE / f"s{i:02d}.png"
        ausschnitt(g, ziel)
        print(ziel.name, flush=True)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
