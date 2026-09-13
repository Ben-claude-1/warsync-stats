"""Prueft die Scroll-Geste in einer offenen Rang-Gruppe.

Gemessen wird je Schritt: der gewaehlte Ansatzpunkt, die tatsaechliche
Verschiebung in Pixeln und die Zahl sichtbarer Rang-Leisten. Die letzte Zahl
ist der eigentliche Waechter — klappt waehrend des Laufs eine Gruppe um, sind
ploetzlich mehrere Leisten im Bild, und genau das war die Ursache dafuer, dass
R3 nie vollstaendig gelesen wurde.

    .venv/bin/python -m scripts.cs_service.pruefe_scroll 12
"""
from __future__ import annotations

import json
import pathlib
import sys

from scripts.ws_service import roster as ws_roster
from scripts.ws_service.device import Geraet

from . import roster as cs
from .messe_wisch import versatz


def main() -> int:
    schritte = int(sys.argv[1]) if len(sys.argv) > 1 else 12

    cfg = json.loads(
        pathlib.Path("scripts/cs_service/config.json").read_text())
    g = Geraet(cfg)

    bild = g.bild()
    balken = ws_roster.gruppenbalken(g, bild)
    if len(balken) != 5:
        raise SystemExit(
            f"Erwartet waren fuenf eingeklappte Leisten, gefunden {len(balken)}. "
            "Erst alles zuklappen.")

    y0, y1 = balken[2]                      # R3
    print(f"R3 oeffnen (Leiste {y0}..{y1}) ...")
    g.tippen(cfg["group_arrow_x"], (y0 + y1) // 2, pause=2.0)

    still = 0
    for i in range(1, schritte + 1):
        vorher = g.bild()
        y = cs._freier_ansatz(g, vorher)
        cs.weiter(g, bild=vorher)
        nachher = g.bild()
        px, guete = versatz(vorher, nachher)
        anzahl = len(ws_roster.gruppenbalken(g, nachher))
        warnung = "" if anzahl == 1 else f"  ⚠ {anzahl} Leisten — Gruppe umgeklappt!"
        print(f"  Schritt {i:>2}: Ansatz y={y}  {str(px):>5} px "
              f"(Guete {guete:.2f}){warnung}", flush=True)
        if anzahl != 1:
            return 1
        still = still + 1 if px in (0, None) else 0
        if still >= 2:
            print("  Zweimal in Folge kein Versatz — Abbruch.")
            return 1
    print("\nDurchgehend gescrollt, keine Gruppe umgeklappt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
