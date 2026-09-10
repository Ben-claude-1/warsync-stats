"""Haelt das Halten am Endpunkt (`halten_s`) die Mausrad-Rastung stabiler?

Noch nicht live gemessen — vorbereitet fuer den naechsten offenen
Anmeldedialog (Teilnehmerliste aufgeklappt, egal ob Wuestensturm oder
Schluchtsturm, beide teilen sich `rad_schritt`). Hintergrund und Vermutung
stehen am Docstring von `device.Geraet.rad_schritt`.

Aufruf, mit der Liste bereits sichtbar:

    .venv/bin/python -m scripts.ws_service.messe_rad 0.0 0.4 0.8 --anzahl 15

Fuer jeden angegebenen `halten_s`-Wert werden `anzahl` Rastungen gefahren und
die Pixel-Verschiebung gemessen (dieselbe Vorlagen-Suche wie in
`cs_service.messe_wisch`, nur auf `list_view` aus dieser Konfiguration
zugeschnitten). Wichtig: zwischendurch nicht zurueckscrollen — nach jedem
Durchlauf steht die Liste ein Stueck weiter unten als vorher, bei genug
Wiederholungen also am Ende. Bei Bedarf zwischen den Werten mit
`--zurueck` denselben Weg rueckwaerts fahren.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import time

import cv2
import numpy as np

from scripts.ws_service.device import Geraet

CFG_PFAD = pathlib.Path("scripts/ws_service/config.json")

MUSTER_HOCH = 200
X_RAND = 60  # etwas Sicherheitsabstand zu den Badge-Spalten am rechten Rand


def _versatz(vorher: np.ndarray, nachher: np.ndarray, lv: list[int]) -> tuple[int | None, float]:
    x0, y0, x1, y1 = lv
    x0, x1 = x0 + X_RAND, x1 - X_RAND
    a = cv2.cvtColor(vorher, cv2.COLOR_RGB2GRAY)
    b = cv2.cvtColor(nachher, cv2.COLOR_RGB2GRAY)
    muster = a[y1 - MUSTER_HOCH:y1, x0:x1]
    suchraum = b[y0:y1, x0:x1]
    treffer = cv2.matchTemplate(suchraum, muster, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(treffer)
    if guete < 0.7:
        return None, guete
    return (y1 - MUSTER_HOCH) - (y0 + ort[1]), guete


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("halten_s", type=float, nargs="+",
                     help="ein oder mehrere Haltezeiten in Sekunden, z.B. 0.0 0.4 0.8")
    ap.add_argument("--anzahl", type=int, default=10,
                     help="Rastungen je Haltezeit (Standard 10)")
    ap.add_argument("--zurueck", action="store_true",
                     help="nach jeder Haltezeit denselben Weg rueckwaerts fahren")
    args = ap.parse_args()

    cfg = json.loads(CFG_PFAD.read_text())
    lv = cfg["list_view"]
    g = Geraet(cfg)

    gesamt: dict[float, list[int]] = {}
    for halten in args.halten_s:
        print(f"\n== halten_s={halten} ==")
        werte: list[int] = []
        stillstaende = 0
        for i in range(1, args.anzahl + 1):
            vorher = g.bild()
            g.rad_schritt(halten_s=halten)
            px, guete = _versatz(vorher, g.bild(), lv)
            marke = "STILLSTAND" if (px is None or px < 30) else ""
            print(f"  Schritt {i:>2}: {str(px):>6} px  (Guete {guete:.2f}) {marke}",
                  flush=True)
            if px is not None:
                werte.append(px)
                if px < 30:
                    stillstaende += 1
            else:
                stillstaende += 1
        gesamt[halten] = werte
        if werte:
            s = sorted(werte)
            print(f"  min {s[0]} · median {s[len(s)//2]} · max {s[-1]} "
                  f"· {len(werte)}/{args.anzahl} messbar · "
                  f"{stillstaende} Stillstand/nicht messbar")
        if args.zurueck:
            print("  zurueck ...")
            for _ in range(args.anzahl):
                g.rad_schritt(rueckwaerts=True, halten_s=halten)
            time.sleep(1.0)

    print("\n=== Zusammenfassung ===")
    for halten, werte in gesamt.items():
        stillstaende = args.anzahl - len(werte) + sum(1 for p in werte if p < 30)
        print(f"halten_s={halten}: {stillstaende}/{args.anzahl} Stillstand/schwach")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
