"""Loest der Druecker in die Liste irgendetwas aus?

Der Gegenruck drueckt seit dem 16.09.2026 erst in die Liste, bevor er zieht
(siehe `Geraet.liste_antippen`). An der falschen Stelle wuerde das jemanden
ein- oder austeilen — ein stiller Schaden an der Aufstellung, kein Lesefehler.
Diese Pruefung haelt die Zaehler ueber der Liste, die Rang-Balken und das
Listenbild davor und danach gegeneinander.

**Sie gehoert bei jeder Aenderung an der Geste wiederholt.** Der erste Lauf
pruefte noch den kurzen `input tap` und war deshalb blind, als daraus ein
500-ms-Druecker wurde: ein halbsekundiger Druck ist in vielen Oberflaechen ein
Langdruck. Nachgemessen loest auch er nichts aus — aber das war Glueck, nicht
Absicht, und beim naechsten Mal muss es wieder gemessen werden.

Setzt voraus, dass die Anmeldung offen ist; nach dem Anmeldeschluss gibt es
„Teilnehmer auswaehlen" nicht mehr und die Navigation bricht ab.

Aufruf:  .venv/bin/python -u -m scripts.ws_service.pruefe_tipp
"""
from __future__ import annotations

import numpy as np

from scripts.ws_service import navigate, roster
from scripts.ws_service.device import Geraet


def main() -> int:
    g = Geraet()
    g.starten(log=print)
    navigate.zur_teilnehmerliste(g, team="A", log=print)
    print("Liste offen.\n")

    vorher = g.bild()
    z_vor = roster.dialog_zaehler(g,vorher)
    balken_vor = roster.gruppenbalken(g, vorher)
    print(f"  Zaehler vorher : {z_vor}")
    print(f"  Balken vorher  : {balken_vor}")

    print(f"\n  Tippen bei x={Geraet.TIPP_X}, y={g.cfg['rad']['y']} ...")
    g.liste_antippen(pause=1.2)

    nachher = g.bild()
    z_nach = roster.dialog_zaehler(g,nachher)
    balken_nach = roster.gruppenbalken(g, nachher)
    print(f"  Zaehler nachher: {z_nach}")
    print(f"  Balken nachher : {balken_nach}")

    x0, y0, x1, y1 = g.cfg["list_view"]
    a = vorher[y0:y1, x0:x1].astype(np.int16)
    b = nachher[y0:y1, x0:x1].astype(np.int16)
    abw = float(np.abs(a - b).mean())
    print(f"\n  Bildabweichung in der Liste: {abw:.2f} (0 = nichts passiert)")

    heikel = []
    if z_vor != z_nach:
        heikel.append("Die Zaehler ueber der Liste haben sich geaendert!")
    if len(balken_vor) != len(balken_nach):
        heikel.append("Die Zahl der Rang-Balken hat sich geaendert "
                      "(Gruppe auf- oder zugeklappt?)")
    if abw > 3.0:
        heikel.append(f"Das Listenbild hat sich deutlich geaendert ({abw:.2f}).")

    print()
    if heikel:
        for h in heikel:
            print(f"  ACHTUNG: {h}")
        print("\n  -> Der Tipp ist NICHT harmlos. Stelle wechseln.")
        return 1
    print("  -> Der Tipp loest nichts aus. Stelle ist brauchbar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
