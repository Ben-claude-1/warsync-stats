"""Kartenarchiv per Wisch-Navigation — zeilenweise ueber ein Weltrechteck.

    scripts/karten_archiv/im_terminal.sh sweep --von 470 540 --bis 500 580
    scripts/karten_archiv/im_terminal.sh sweep --von 470 540 --bis 500 580 --stufe wisch

Der Unterschied zu `run.py` ist die Navigation, nicht das Ergebnis:

* `run.py` springt je Kachel ueber den Lupe-Dialog. Exakt, aber 5,5 s je Kachel
  — und der Sprung **setzt den Zoom zurueck**, die Stufe ist damit nicht waehlbar.
* `sweep.py` springt nur an den **Zeilenanfang** und wischt die Zeile entlang.
  1,4 s je Kachel, und die Zoomstufe bleibt stehen.

**Der Zeilenanfang ist der Anker.** Die Kette der Verschiebungen sammelt Fehler;
ein Sprung setzt sie auf einen exakten Wert zurueck. Eine Zeile ist damit die
groesste Strecke, ueber die geraten wird — und selbst dort wird nicht geraten:

1. **Der Versatz wird gemessen, nicht angenommen.** Zwei aufeinander folgende
   Kacheln ueberlappen sich zu einem Drittel; ein Vorlagenabgleich liefert die
   Verschiebung auf wenige Pixel genau, ohne Geraetezeit zu kosten.
2. **Der Lupe-Dialog ist die Stichprobe.** Alle `--pruefen` Kacheln wird die
   gerechnete Position gegen die abgelesene gehalten. Weicht sie ab, bricht die
   Zeile ab — eine still verschobene Zeile waere die schlimmste Fehlerart,
   weil das Archiv hinterher vollstaendig aussieht.

**Ohne Ueberlappung keine Messung.** Der Kachelschritt bleibt deshalb bewusst
unter der Kachelbreite. Das ist kein Verlust: die Ueberlappung ist zugleich die
Selbstpruefung der Auswertung, weil dieselbe Basis in zwei Kacheln dieselbe
Koordinate ergeben muss.
"""
from __future__ import annotations

import argparse
import sys
import time
import numpy as np
from PIL import Image

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import banner, foto, position, sprung, wisch, zoom
from scripts.karten_archiv.archiv import Archiv
from scripts.karten_archiv.run import CFG


class ZeileAbgebrochen(RuntimeError):
    pass


def _kachel_breite(scfg: dict) -> float:
    x0, _, x1, _ = scfg["karte"]
    return (x1 - x0) / scfg["skala_x"]


def zeile_fahren(g, scfg, archiv, bild, nr, von_x, bis_x, y, laenge, pruefen, lesen):
    """Eine Zeile: Sprung an den Anfang, dann wischen bis zum Ende."""
    sprung.springen(g, CFG, von_x, y, bild)
    roh = sprung.dialog_sicherstellen(g, CFG, False, bild)
    zoom.nach_sprung(g, scfg)
    if scfg.get("raus_gesten"):
        roh = bild()

    pos_x, pos_y = float(von_x), float(y)
    # Die Erwartung startet beim konfigurierten Traegheitsfaktor und wird danach
    # aus den eigenen Messungen fortgeschrieben. Der Faktor aus der Datei ist ein
    # Startwert, kein Messwert: er wurde auf einer Zoomstufe gemessen und muss
    # auf einer anderen nicht gelten — am 07.09.2026 lag er um 15 % daneben.
    erwartet_px = laenge * wisch.traegheit(scfg)
    k = 0
    gemessen: list[float] = []
    gemessen_px: list[float] = []
    while True:
        extra = {"zeile": nr, "spalte": k}
        if lesen:
            gefunden = banner.auswerten(Image.fromarray(roh), pos_x, pos_y, scfg)
            extra["banner"] = gefunden
            extra["banner_anzahl"] = len(gefunden)
        archiv.speichern(pos_x, pos_y, Image.fromarray(roh), extra,
                         stamm=f"z{nr:03d}_k{k:04d}")
        print(f"  {nr:3d}/{k:4d}  X:{pos_x:7.2f} Y:{pos_y:7.2f}"
              f"{'  ' + str(extra['banner_anzahl']) + ' Banner' if lesen else ''}",
              flush=True)
        if pos_x >= bis_x:
            return k + 1, gemessen, gemessen_px

        vorher = roh
        wisch.geste(g, scfg, "x+", laenge)
        roh = bild()
        sx, sy, guete = wisch.versatz_nachziehen(vorher, roh, scfg,
                                                 (erwartet_px, 0.0))
        dx, dy = wisch.welt_versatz(sx, sy, scfg)
        if guete >= 0.30:
            gemessen_px.append(sx)
            erwartet_px = float(np.median(gemessen_px[-5:]))
        if guete < 0.30:
            # Strukturloses Gelaende: der Abgleich ist nicht belastbar. Statt zu
            # raten wird die Position erfragt — teuer, aber selten.
            print(f"      Abgleich schwach (Guete {guete:.2f}) — Position wird "
                  f"erfragt", flush=True)
            p = position.lesen(g, CFG, bild,
                               erwartet=(round(pos_x + dx), round(pos_y + dy)),
                               toleranz=4)
            if p is None:
                raise ZeileAbgebrochen(
                    f"Zeile {nr}: Versatz weder messbar (Guete {guete:.2f}) noch "
                    f"ablesbar. Ohne Position keine Kachel — hier wird nicht geraten.")
            pos_x, pos_y = float(p[0]), float(p[1])
            roh = bild()
        else:
            pos_x, pos_y = pos_x + dx, pos_y + dy
            gemessen.append(dx)
        k += 1

        if pruefen and k % pruefen == 0:
            p = position.lesen(g, CFG, bild,
                               erwartet=(round(pos_x), round(pos_y)), toleranz=6)
            if p is None:
                print(f"      Stichprobe: Position nicht lesbar — weiter mit der "
                      f"gerechneten", flush=True)
            else:
                ab = max(abs(p[0] - pos_x), abs(p[1] - pos_y))
                print(f"      Stichprobe: Dialog {p[0]}/{p[1]}, gerechnet "
                      f"{pos_x:.2f}/{pos_y:.2f} — Abweichung {ab:.2f} E", flush=True)
                if ab > 2.5:
                    raise ZeileAbgebrochen(
                        f"Zeile {nr}: gerechnete Position {pos_x:.2f}/{pos_y:.2f} "
                        f"weicht um {ab:.2f} Einheiten vom Dialog ab.")
                if ab > 0.75:
                    # Uebernommen wird der Dialog, nicht die Kette. Er ist auf
                    # ganze Einheiten gerundet — das kostet bis zu 0,5 Einheiten
                    # und beendet dafuer jede Drift. Eine Kette aus gemessenen
                    # Verschiebungen kann beliebig weit weglaufen; ein abgelesener
                    # Wert nicht.
                    print(f"      → Position auf den Dialogwert gesetzt.", flush=True)
                    pos_x, pos_y = float(p[0]), float(p[1])
            roh = bild()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--von", nargs=2, type=int, required=True, metavar=("X", "Y"))
    p.add_argument("--bis", nargs=2, type=int, required=True, metavar=("X", "Y"))
    p.add_argument("--name", default="sweep")
    p.add_argument("--stufe", default="sprung",
                   help="Zoomstufe aus config.json (sprung = die, auf der der "
                        "Sprung landet; wisch = eine Geste weiter draussen)")
    p.add_argument("--ueberlappung", type=float, default=0.35,
                   help="Anteil der Kachelbreite, um den sich zwei Kacheln "
                        "ueberschneiden — darunter misst der Abgleich nichts mehr")
    p.add_argument("--pruefen", type=int, default=15,
                   help="alle N Kacheln die Position im Dialog gegenlesen (0 = nie)")
    p.add_argument("--lesen", action="store_true", help="Banner sofort mit auswerten")
    p.add_argument("--pause", type=float, default=None,
                   help="Beruhigungspause nach dem Wisch in Sekunden. Zu kurz "
                        "heisst: fotografiert wird, waehrend die Karte noch "
                        "gleitet — die Kachel gehoert dann nicht zu der Position, "
                        "unter der sie abgelegt wird.")
    a = p.parse_args()

    scfg = dict(zoom.stufe(CFG, a.stufe), navigation="wisch")
    if a.pause is not None:
        scfg["wisch_geste"] = dict(scfg["wisch_geste"], pause=a.pause)
    g = Geraet()
    g.starten()
    g.app_starten()

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG, bild)
    if not zoom.lupe_da(bild(), CFG):
        print("Kein Lupe-Knopf — ohne Detailmodus gibt es weder Sprung noch Banner.",
              file=sys.stderr)
        return 1

    breite = _kachel_breite(scfg)
    schritt = breite * (1 - a.ueberlappung)
    laenge = wisch.gestenlaenge(scfg, schritt * scfg["skala_x"])
    tatsaechlich = laenge * wisch.traegheit(scfg) / scfg["skala_x"]
    zeilen = list(range(a.von[1], a.bis[1] + 1, scfg["schritt_y"]))
    je_zeile = int((a.bis[0] - a.von[0]) / tatsaechlich) + 1

    archiv = Archiv(a.name, scfg)
    print(f"Archiv {archiv.pfad}")
    print(f"Stufe {a.stufe!r}: {scfg['skala_x']:.1f} px je Welteinheit, Kachel "
          f"{breite:.1f} x {(scfg['karte'][3]-scfg['karte'][1])/scfg['skala_y']:.1f} E")
    print(f"Wisch {laenge} px → {tatsaechlich:.1f} E Schritt "
          f"({100*(1-tatsaechlich/breite):.0f} % Ueberlappung)")
    print(f"{len(zeilen)} Zeilen x rund {je_zeile} Kacheln = {len(zeilen)*je_zeile}\n",
          flush=True)

    t_start = time.time()
    kacheln = 0
    for nr, y in enumerate(zeilen):
        if archiv.zeile_fertig(nr):
            print(f"Zeile {nr} (Y {y}) schon fertig — uebersprungen", flush=True)
            continue
        print(f"── Zeile {nr}  Y {y}  X {a.von[0]} → {a.bis[0]}", flush=True)
        t0 = time.time()
        try:
            n, gemessen, gem_px = zeile_fahren(g, scfg, archiv, bild, nr, a.von[0], a.bis[0],
                                       y, laenge, a.pruefen, a.lesen)
        except (ZeileAbgebrochen, wisch.WischFehler, sprung.SprungFehler) as e:
            print(f"\n{e}\nAbbruch. Die Zeile bleibt unvollstaendig und wird beim "
                  f"naechsten Lauf neu gefahren.", file=sys.stderr)
            return 2
        dauer = time.time() - t0
        faktor = (float(np.median(gem_px)) / laenge) if gem_px else None
        archiv.zeile_abschliessen(nr, {"y": y, "kacheln": n,
                                       "sekunden": round(dauer, 1),
                                       "wischlaenge_px": laenge,
                                       "pixel_faktor_gemessen":
                                           round(faktor, 3) if faktor else None,
                                       "schritte_welt": [round(v, 2) for v in gemessen]})
        if faktor:
            print(f"   Traegheitsfaktor gemessen: {faktor:.3f} "
                  f"(Konfiguration {wisch.traegheit(scfg)})", flush=True)
        kacheln += n
        print(f"   {n} Kacheln in {dauer/60:.1f} min ({dauer/n:.2f} s je Kachel)\n",
              flush=True)

    ges = time.time() - t_start
    print(f"Fertig. {kacheln} Kacheln in {ges/60:.1f} min"
          + (f" ({ges/kacheln:.2f} s je Kachel)" if kacheln else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
