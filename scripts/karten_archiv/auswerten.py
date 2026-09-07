"""Auswertung ueber dem Archiv — ohne Geraet, ohne BlueStacks, ohne Sperre.

    .venv/bin/python -m scripts.karten_archiv.auswerten --name pilot
    .venv/bin/python -m scripts.karten_archiv.auswerten --name pilot --neu

Das ist der eigentliche Zweck des Archivs: die Erkennung darf beliebig oft und
beliebig lange laufen, auch waehrend das Spiel fuer den WS-Dienst gebraucht wird.
`--neu` liest die gespeicherten Bilder noch einmal — damit laesst sich eine
verbesserte Erkennung an genau demselben Material messen, statt sie an einem
frischen Bildschirmfoto zu erraten.

**Das Modell kommt aus dem Manifest**, nicht aus der aktuellen `config.json`:
wird der Massstab spaeter nachgeeicht, bleiben alte Archive richtig lesbar.

Zusammengefasst wird ueber die Weltkoordinate. An den Kachelraendern sieht man
dieselbe Basis in zwei Kacheln; taeten wir das nicht, stuende sie zweimal in der
Liste. Der Abgleich ist zugleich eine Selbstpruefung: liefern beide Kacheln
verschiedene Koordinaten fuer dieselbe Basis, stimmt der Massstab nicht.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image

from scripts.karten_archiv import banner
from scripts.karten_archiv.archiv import WURZEL
from scripts.ws_service import match
from scripts.ws_service.tool import _anfrage, allianz_id


def laden(name: str, neu: bool) -> tuple[dict, list[dict]]:
    pfad = WURZEL / name
    manifest = json.loads((pfad / "manifest.json").read_text())
    cfg = dict(manifest["modell"], karte=manifest["zuschnitt"])
    zeilen = []
    for js in sorted((pfad / "kacheln").glob("*.json")):
        satz = json.loads(js.read_text())
        kx, ky = satz["kamera"]
        if neu or "banner" not in satz:
            im = Image.open(js.with_suffix(".png")).convert("RGB")
            gefunden = banner.auswerten(im, kx, ky, cfg,
                                        versatz_px=tuple(manifest["zuschnitt"][:2]))
        else:
            gefunden = satz["banner"]
        for b in gefunden:
            zeilen.append({**b, "kachel": [kx, ky]})
    return manifest, zeilen


def zusammenfassen(treffer: dict) -> dict:
    """Dieselbe Basis aus mehreren Kacheln zu einer Zeile."""
    je_name = defaultdict(list)
    for name, t in treffer.items():
        je_name[name].append(t)
    aus = {}
    for name, ts in je_name.items():
        xs = [t["x"] for t in ts]
        ys = [t["y"] for t in ts]
        aus[name] = {"x": round(sum(xs) / len(xs)), "y": round(sum(ys) / len(ys)),
                     "kacheln": len(ts),
                     "streuung": round(max(max(xs) - min(xs), max(ys) - min(ys)), 2)}
    return aus


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="pilot")
    p.add_argument("--neu", action="store_true", help="Bilder neu erkennen statt Kachel-JSON")
    p.add_argument("--tag", default="XP33")
    a = p.parse_args()

    manifest, zeilen = laden(a.name, a.neu)
    print(f"Archiv {a.name}: {len({tuple(z['kachel']) for z in zeilen})} Kacheln mit "
          f"Bannern, {len(zeilen)} Bannerfunde")
    gelesen = [z for z in zeilen if len(z.get("name_ocr", "")) >= 3]
    print(f"davon {len(gelesen)} mit lesbarem Text\n")

    aid = allianz_id(a.tag)
    kader = _anfrage(f"ws_players?select=name,hero_power&alliance_id=eq.{aid}&limit=1000")
    erg = match.zuordnen(gelesen, kader)
    zusammen = zusammenfassen(erg["treffer"])

    print(f"{'Spieler':24s} {'X':>5s} {'Y':>5s} {'Kacheln':>8s} {'Streuung':>9s}")
    print("-" * 56)
    for name, t in sorted(zusammen.items(), key=lambda kv: (-kv[1]["y"], kv[1]["x"])):
        print(f"{name:24s} {t['x']:5d} {t['y']:5d} {t['kacheln']:8d} {t['streuung']:9.2f}")
    print(f"\n{len(zusammen)} Spieler des Kaders zugeordnet")

    offen = [o for o in erg["offen"] if len(o.get("name_ocr", "")) >= 3]
    if offen:
        print(f"\n{len(offen)} gelesene Banner ohne Kadertreffer "
              f"(fremde Allianzen oder Lesefehler):")
        for o in offen[:20]:
            print(f"  {o['name_ocr'][:26]!r:30s} X:{o['x']:.1f} Y:{o['y']:.1f}")
    mehrfach = [t for t in zusammen.values() if t["kacheln"] > 1]
    if mehrfach:
        schlimm = max(t["streuung"] for t in mehrfach)
        print(f"\nSelbstpruefung: {len(mehrfach)} Basen in mehreren Kacheln gesehen, "
              f"groesste Abweichung {schlimm:.2f} Welteinheiten "
              f"({'in Ordnung' if schlimm < 0.5 else 'zu gross — Massstab pruefen'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
