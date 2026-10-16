"""Misst, ob ein haengendes Ladefenster als solches erkannt wird.

Vom 08. bis zum 12.10.2026 stand die VS-Rangliste jede Nacht auf „Wird
geladen", und der Lauf hielt das fuer einen Tag ohne Teilnehmer: vier
Scrollschritte ins Leere, dreimal Stillstand, „Listenende", null Zeilen. Im
Bericht stand danach, 98 Kadermitglieder seien nicht angetreten. Die
Tagespunkte der Woche vom 05.-10.10. sind damit verloren — die Reiter werden
Sonntag um 24:00 zurueckgesetzt.

`liste.laedt_noch` ist die Schranke dagegen. Geprueft wird sie an genau dem
Bild, das `navigate.warte_auf_liste` im Lauf zu sehen bekommt: dem **ersten**
jedes Tages, vor dem ersten Scrollschritt. Spaetere Bilder taugen dafuer
nicht — die Geste schiebt den Text halb aus dem Fenster, von „Wird geladen"
bleibt „Wird" uebrig. Dagegen steht die zweite Sicherung in `run.tag_lesen`:
null Zeilen sind nie ein Tag.

    .venv/bin/python -m scripts.vs_service.pruefe_laden
    .venv/bin/python -m scripts.vs_service.pruefe_laden --wurzel <ordner>
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2

from . import liste

STAND = Path.home() / ".local/state/warsync/vs_service"

# Die Laeufe, an denen gemessen wurde — und was dabei herauskommen muss.
# „haengt" sind die fuenf Naechte mit dem Ladefenster, „gut" der letzte Lauf
# davor, der die Liste bekommen hat.
HAENGT = ("20261008_050001", "20261009_050001", "20261010_050002",
          "20261011_050001", "20261012_050001")
GUT = ("20261001_050001",)


def tage(lauf: Path) -> list[Path]:
    return sorted(p for p in lauf.iterdir() if p.is_dir()) if lauf.is_dir() else []


def pruefe(wurzel: Path, laeufe: tuple[str, ...], soll: bool) -> tuple[int, int, int]:
    treffer = daneben = fehlt = 0
    for name in laeufe:
        for tag in tage(wurzel / name):
            bild_pfad = tag / "bild_000.png"
            if not bild_pfad.exists():
                fehlt += 1
                continue
            bild = cv2.cvtColor(cv2.imread(str(bild_pfad)), cv2.COLOR_BGR2RGB)
            ist = liste.laedt_noch(bild)
            if ist == soll:
                treffer += 1
            else:
                daneben += 1
                print(f"  DANEBEN  {name}/{tag.name}: laedt_noch={ist}, "
                      f"erwartet {soll}")
    return treffer, daneben, fehlt


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wurzel", default=str(STAND), help="Ablage der Laeufe")
    args = ap.parse_args()
    wurzel = Path(args.wurzel)

    print(f"Ablage: {wurzel}\n")
    print("Haengende Laeufe (08.-12.10.2026) — muessen als 'laedt noch' gelten:")
    t1, d1, f1 = pruefe(wurzel, HAENGT, soll=True)
    print(f"  erkannt {t1}, daneben {d1}, Bild fehlt {f1}\n")

    print("Guter Lauf (01.10.2026) — darf nicht als 'laedt noch' gelten:")
    t2, d2, f2 = pruefe(wurzel, GUT, soll=False)
    print(f"  richtig {t2}, Fehlalarm {d2}, Bild fehlt {f2}\n")

    if f1 + f2 and not (t1 + t2):
        print("Keine Bilder gefunden — die Laeufe liegen nicht mehr in der Ablage.")
        return 2
    print(f"Ergebnis: {t1 + t2} richtig, {d1 + d2} daneben.")
    return 0 if d1 + d2 == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
