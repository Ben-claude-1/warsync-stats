"""Misst, wie sich die VS-Tagesliste scrollen laesst — und ob sie haengt.

Der Wuestensturm-Dienst scheitert seit Wochen genau daran: die Teilnehmerliste
nimmt die Geste unregelmaessig nicht an (siehe `device.rad_schritt` und
`docs/themen/bluestacks-steuerung.md`). Bevor hier ein zweiter Dienst auf
dieselbe Annahme gebaut wird, wird sie an *dieser* Liste gemessen — sie ist
eine andere Oberflaeche und kann sich anders verhalten.

Das Skript tippt **nichts** und schreibt nichts in die Datenbank. Es scrollt die
bereits geoeffnete Liste und misst je Schritt die Verschiebung in Pixeln
(dieselbe Vorlagen-Suche wie `ws_service.messe_rad`).

Aufruf, mit der Liste bereits sichtbar (Rang -> Tagesrang -> Tag -> Haken
„Deine Allianz"):

    .venv/bin/python -u -m scripts.vs_service.pruefe_scroll --schritte 25

Ablage: ~/.local/state/warsync/vs_service/pruefe_<zeit>/
          bild_000.png …   je ein Bild vor jedem Schritt
          bericht.json     die Messwerte
"""
from __future__ import annotations

import argparse
import json
import pathlib
import time
from datetime import datetime

import cv2
import numpy as np

from scripts.ws_service.device import CONFIG as WS_CONFIG, Geraet

from .navigate import tag_waehlen, zum_rang

CFG_PFAD = pathlib.Path(__file__).with_name("config.json")
ABLAGE = pathlib.Path.home() / ".local/state/warsync/vs_service"

MUSTER_HOCH = 200
X_RAND = 60
# Weniger als so viele Pixel gelten als Stillstand — unter der Zeilenhoehe waere
# der Schritt ohnehin wertlos, weil dieselbe Zeile zweimal gelesen wuerde.
STILL_PX = 30


def versatz(vorher: np.ndarray, nachher: np.ndarray, lv: list[int]) -> tuple[int | None, float]:
    """Um wie viele Pixel ist der Inhalt gewandert? None = nicht wiedererkannt."""
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
    ap.add_argument("--schritte", type=int, default=25)
    ap.add_argument("--name", default="pruefe")
    ap.add_argument("--hin", action="store_true",
                     help="erst zur Liste navigieren (sonst muss sie offen sein)")
    ap.add_argument("--tag", help="zusaetzlich diesen Wochentag waehlen")
    args = ap.parse_args()

    # Die allgemeinen Koordinaten (Basis-Knopf, Ansicht-Fenster) stehen in der
    # Konfiguration des WS-Dienstes; `navigate` braucht sie.
    cfg = {**WS_CONFIG, **json.loads(CFG_PFAD.read_text())}
    lv = cfg["list_view"]
    ordner = ABLAGE / f"{args.name}_{datetime.now():%Y%m%d_%H%M%S}"
    (ordner).mkdir(parents=True, exist_ok=True)

    g = Geraet(cfg)
    w, h = g.aufloesung()
    if (w, h) != tuple(cfg["screen"]):
        print(f"ABBRUCH: Aufloesung {w}x{h}, erwartet {cfg['screen'][0]}x{cfg['screen'][1]}.")
        return 2

    if args.hin:
        zum_rang(g, log=print)
        if args.tag:
            tag_waehlen(g, args.tag, log=print)
    print(f"Ablage: {ordner}")
    print(f"{args.schritte} Schritte, Rastung {cfg['rad']['weite_px']} px, "
          f"Pause {cfg['rad']['pause_nach_s']} s\n")

    werte: list[int] = []
    stillstaende = 0
    schritte: list[dict] = []
    vorher = g.bild()
    cv2.imwrite(str(ordner / "bild_000.png"), cv2.cvtColor(vorher, cv2.COLOR_RGB2BGR))

    for i in range(1, args.schritte + 1):
        t0 = time.monotonic()
        g.rad_schritt()
        nachher = g.bild()
        px, guete = versatz(vorher, nachher, lv)
        still = px is None or px < STILL_PX
        marke = "  STILLSTAND" if still else ""
        print(f"  Schritt {i:>3}: {str(px):>6} px  (Guete {guete:.2f}, "
              f"{time.monotonic() - t0:.1f}s){marke}", flush=True)
        cv2.imwrite(str(ordner / f"bild_{i:03d}.png"), cv2.cvtColor(nachher, cv2.COLOR_RGB2BGR))
        schritte.append({"n": i, "px": px, "guete": round(guete, 3), "stillstand": bool(still)})
        if still:
            stillstaende += 1
        else:
            werte.append(int(px))
        vorher = nachher

    bericht = {
        "zeit": datetime.now().isoformat(timespec="seconds"),
        "schritte": schritte,
        "bewegt": len(werte),
        "stillstaende": stillstaende,
        "median_px": int(np.median(werte)) if werte else None,
        "max_px": int(max(werte)) if werte else None,
        "min_px": int(min(werte)) if werte else None,
        "fensterhoehe_px": lv[3] - lv[1],
        "zeilen_hoehe_px": cfg["zeilen_hoehe"],
    }
    (ordner / "bericht.json").write_text(json.dumps(bericht, indent=1, ensure_ascii=False))

    print(f"\nBewegt {len(werte)} von {args.schritte}, Stillstaende {stillstaende}")
    if werte:
        print(f"Median {bericht['median_px']} px, kleinster {bericht['min_px']}, "
              f"groesster {bericht['max_px']} px")
        # Bewegung < Fensterhoehe ist die Bedingung, unter der keine Zeile
        # durchfallen kann — dieselbe Regel wie beim Wuestensturm-Dienst.
        if bericht["max_px"] >= bericht["fensterhoehe_px"]:
            print(f"WARNUNG: groesster Schritt {bericht['max_px']} px erreicht die "
                  f"Fensterhoehe {bericht['fensterhoehe_px']} px — es koennen Zeilen "
                  f"durchfallen.")
        else:
            zeilen = bericht["max_px"] / cfg["zeilen_hoehe"]
            print(f"Groesster Schritt sind {zeilen:.1f} Zeilen bei "
                  f"{bericht['fensterhoehe_px'] / cfg['zeilen_hoehe']:.1f} sichtbaren.")
    print(f"\nBilder und bericht.json: {ordner}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
