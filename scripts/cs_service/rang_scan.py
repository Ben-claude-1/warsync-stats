"""Einen Rang in Häppchen scannen — mit Zwischenspeicherung nach jedem Schritt.

Der Durchlauf am Stück ist noch nicht stabil genug (siehe `weiter`); ein Abbruch
mitten in R3 hat früher den ganzen Fortschritt gekostet. Deshalb schreibt dieses
Skript nach **jedem** Scroll-Schritt weg und lässt sich beliebig oft erneut
aufrufen: bereits gelesene Karten werden über (Name, Kraft) wiedererkannt.

    .venv/bin/python -u -m scripts.cs_service.rang_scan R3 15

Ohne Schrittzahl läuft es bis zum Rang-Ende. Das Öffnen des Rangs macht der
Aufrufer — dieses Skript scrollt nur und liest.
"""
from __future__ import annotations

import json
import pathlib
import sys

from scripts.ws_service import roster as ws_roster
from scripts.ws_service.device import Geraet

from . import roster

STAND = pathlib.Path.home() / ".local/state/warsync/cs_service/scan_teamA.json"


def _laden() -> dict:
    return json.loads(STAND.read_text())


def _sichern(d: dict) -> None:
    STAND.write_text(json.dumps(d, ensure_ascii=False, indent=2))


def main(rang: str, max_schritte: int) -> None:
    cfg = json.loads(pathlib.Path("scripts/cs_service/config.json").read_text())
    g = Geraet(cfg)
    d = _laden()
    soll = d["soll"][rang]
    zeilen = d["raenge"].setdefault(rang, [])
    gesehen = {(z.get("name_ocr", z["name"]), z.get("kraft", z.get("kraft_m")))
               for z in zeilen}

    print(f"{rang}: starte bei {len(zeilen)}/{soll}", flush=True)
    leerlauf = 0
    for i in range(1, max_schritte + 1):
        vorher = len(zeilen)
        bild = g.bild()
        roster._gruppe_lesen(g, bild, gesehen, zeilen, print)
        neu = len(zeilen) - vorher
        d["raenge"][rang] = zeilen
        _sichern(d)                      # nach jedem Schritt, nicht am Ende
        print(f"  Schritt {i}: +{neu} → {len(zeilen)}/{soll}", flush=True)

        if len(zeilen) >= soll:
            print("  Sollzahl erreicht.", flush=True)
            return
        leerlauf = leerlauf + 1 if neu == 0 else 0
        if leerlauf >= 4:
            print("  Vier Schritte ohne neue Karte — halte an statt weiterzuraten.",
                  flush=True)
            return
        roster.weiter(g, variante=leerlauf)

    print(f"  Häppchen zu Ende bei {len(zeilen)}/{soll} — erneut aufrufen.", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 200)
