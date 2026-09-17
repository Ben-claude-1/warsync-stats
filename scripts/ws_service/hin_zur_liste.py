"""Zur Teilnehmerliste navigieren und melden, ob die Zeit-Balken da sind.

Kein Scrollen, kein Schreiben — nur der Weg dorthin und ein Befund. Gebaut
fuer den Fall vom 17.09.2026: nach einem Neustart von Last War will man
wissen, **bevor** jemand zehn Minuten von Hand durch die Liste scrollt, ob
das Spiel die farbigen Zeit-Balken wieder zeichnet. Ohne sie liest der
Dienst null Zeilen, und mit ihnen faellt auch die Auskunft weg, wer sich
ueberhaupt angemeldet hat (siehe `roster.zeitkoepfe`).

    .venv/bin/python -m scripts.ws_service.hin_zur_liste --team A
"""
from __future__ import annotations

import argparse
import sys

from . import navigate, roster
from .device import Geraet


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--team", default=None, choices=["A", "B"])
    a = p.parse_args(argv)

    g = Geraet()
    if not g.verbunden():
        print("Keine ADB-Verbindung zu BlueStacks.")
        return 1

    randdaten = navigate.zur_teilnehmerliste(g, team=a.team)
    print(f"Blatt: {randdaten}")

    bild = g.bild()
    zeit = navigate.blatt_zeit(g, bild)
    koepfe = roster.zeitkoepfe(g, bild)
    print(f"Kampfzeit des Blattes: {zeit or '— LEER'}")
    print(f"Zeit-Balken im Bild: {len(koepfe)}")
    if not koepfe:
        print("KEINE Zeit-Balken — das Spiel ist noch verrendert. "
              "Erst 'am force-stop com.fun.lastwar.gp' und neu starten, "
              "dann erneut hierher. Scrollen bringt in diesem Zustand nichts.")
        return 2
    print("Balken sind da — der Mitschnitt kann losgehen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
