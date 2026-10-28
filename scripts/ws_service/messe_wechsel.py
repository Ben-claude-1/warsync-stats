"""Wie schnell wechselt der Zeit-Balken eines Doppelmelders?

    .venv/bin/python -u -m scripts.ws_service.messe_wechsel jgShadow
    .venv/bin/python -u -m scripts.ws_service.messe_wechsel jgShadow --sekunden 30

Wer sich fuer beide Uhrzeiten gemeldet hat, zeigt die beiden Balken
abwechselnd. Der Suchlauf muss so lange hinsehen, bis er beide gesehen haben
**koennte** — und keinen Augenblick laenger. Dieses Skript schlaegt den Namen
nach und fotografiert die Zeile so schnell, wie `screencap` es hergibt; je Bild
wird nur die Farbe gemessen (keine Texterkennung), damit die Bildfolge dicht
bleibt. Heraus kommt, wie lange jede Farbe stehen bleibt.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from . import match, navigate, roster, suchlauf
from .device import Geraet


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("name")
    p.add_argument("--sekunden", type=float, default=25.0)
    a = p.parse_args(argv)

    g = Geraet()
    g.starten(log=suchlauf._log)
    navigate.zur_teilnehmerliste(g, log=suchlauf._log)
    g.tippen(*suchlauf.suchfeld(g), pause=1.5)
    if not suchlauf.name_eingeben(g, match.suchname(a.name)):
        suchlauf._log("Name kam nicht im Suchfeld an.")
        return 1

    folge = []
    t0 = time.monotonic()
    while time.monotonic() - t0 < a.sekunden:
        t = time.monotonic() - t0
        koepfe = roster.zeitkoepfe(g, g.bild())
        folge.append((round(t, 2), koepfe[0][2] if koepfe else None))

    # Laeufe gleicher Farbe zusammenfassen
    laeufe = []
    for t, f in folge:
        if laeufe and laeufe[-1]["farbe"] == f:
            laeufe[-1]["bis"] = t
        else:
            laeufe.append({"farbe": f, "von": t, "bis": t})
    abstand = [b[0] - a_[0] for a_, b in zip(folge, folge[1:])]
    for l in laeufe:
        suchlauf._log(f"  {l['farbe'] or '—':7s} {l['von']:6.2f} … {l['bis']:6.2f} s")
    wechsel = [l["von"] for l in laeufe[1:]]
    stehzeiten = [b - a_ for a_, b in zip(wechsel, wechsel[1:])]
    suchlauf._log(f"{len(folge)} Bilder, Abstand im Mittel "
                  f"{sum(abstand) / max(len(abstand), 1):.2f} s")
    suchlauf._log(f"Wechsel bei {wechsel}")
    suchlauf._log(f"volle Stehzeiten: {[round(s, 2) for s in stehzeiten]}")
    ziel = Path.home() / ".local/state/warsync/ws_service" / \
        f"wechsel_{time.strftime('%Y%m%d_%H%M%S')}.json"
    ziel.write_text(json.dumps({"name": a.name, "folge": folge, "laeufe": laeufe},
                               ensure_ascii=False, indent=1))
    suchlauf._log(f"Messung: {ziel}")
    navigate.dialog_schliessen(g)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
