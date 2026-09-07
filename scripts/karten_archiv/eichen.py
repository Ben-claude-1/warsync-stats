"""Massstab und Bannerversatz der eingestellten Zoomstufe messen.

    .venv/bin/python -m scripts.karten_archiv.eichen --anker 481 557 --name "Little Kong"

**Der Versatz braucht keinen Fit, sondern einen Anker.** Das Modell lautet

    welt_x = kamera_x + (banner_x - 1280 - ox) / skala_x
    welt_y = kamera_y - (banner_y - 1280 - oy) / skala_y

Springt man auf die Koordinate einer Basis, steht **diese Basis in der
Kameramitte**. Ihr Banner liegt dann per Definition bei (1280 + ox, 1280 + oy) —
beide Versaetze sind damit direkt abgelesen statt geschaetzt. Voraussetzung ist
eine Basis, deren Koordinate wirklich gemessen wurde (Stern-Dialog), nicht eine
gerechnete.

**Der Massstab kommt aus dem Raster.** Basen stehen 3 Welteinheiten auseinander;
der Abstand benachbarter Bannerspalten ist also 3 x skala_x, der benachbarter
Bannerzeilen 3 x skala_y. Gemessen wird am selben Bild — kein Sprung, keine
Korrelation, keine Skalenkette, die Fehler ueber Stufen aufsammelt.

Warum nicht die Phasenkorrelation: bei rund 100-200 px je Welteinheit schiebt
schon ein Sprung von wenigen Einheiten das Bild aus jedem Vergleichsfenster, und
im Hive rastet sie ohnehin auf der Rasterperiode ein statt auf der Verschiebung.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import banner, foto, sprung, zoom
from scripts.karten_archiv.run import CFG

# Ueber den Stern-Dialog gemessene Wahrheiten (Session 5723e3d1, Allianz XP33).
# Gerechnete Werte gehoeren hier ausdruecklich nicht hinein.
WAHRHEITEN = {
    "IIBlackJackII": (478, 554),
    "Snailnuts": (481, 551),
    "Little Kong": (481, 557),
    "Maggo1979": (484, 551),
    "bestbrudi": (481, 572),
}


def _anker_banner(roh, im, cfg, erwartet_xy, name) -> tuple[float, float] | None:
    """Das Banner der Ankerbasis, gesucht in der Naehe der erwarteten Stelle.

    Gesucht wird ueber den **Namen**, nicht ueber die Naehe allein: bei dicht
    stehenden Basen ist die naechstgelegene nicht zwingend die gemeinte, und eine
    Eichung auf die falsche Basis faellt hinterher nicht auf.
    """
    orte = banner.finde(roh, cfg)
    if not orte:
        return None
    kurz = name.lower().replace(" ", "")[:6]
    nach_naehe = sorted(orte, key=lambda o: (o[0] - erwartet_xy[0]) ** 2
                                            + (o[1] - erwartet_xy[1]) ** 2)
    for cx, cy, w, h in nach_naehe[:4]:
        if kurz in banner.lesen(im, cx, cy, w, h).lower().replace(" ", ""):
            return cx, cy
    return None


def massstab_ueber_sprung(g, cfg, bild, anker, name, p0, d, achse) -> float | None:
    """Massstab aus der Verschiebung **einer identifizierten Basis**.

    Das Raster taugt dafuer nicht: sind nur zwei Bannerspalten im Bild, ist nicht
    zu entscheiden, ob sie 3 oder 6 Welteinheiten auseinander liegen — der
    Massstab waere um den Faktor zwei daneben, ohne dass etwas auffiele.

    Verschiebt man dagegen die Kamera um `d` Einheiten und verfolgt dieselbe,
    namentlich erkannte Basis, ist die Zuordnung eindeutig.
    """
    ziel = (anker[0] - d, anker[1]) if achse == "x" else (anker[0], anker[1] - d)
    sprung.springen(g, cfg, ziel[0], ziel[1], bild)
    roh = sprung.dialog_sicherstellen(g, cfg, False, bild)
    im = Image.fromarray(roh)
    # Kamera nach links/unten → Basis wandert nach rechts/oben
    grob = cfg["skala_x"] if achse == "x" else cfg["skala_y"]
    erwartet = (p0[0] + d * grob, p0[1]) if achse == "x" else (p0[0], p0[1] - d * grob)
    p1 = _anker_banner(roh, im, cfg, erwartet, name)
    if p1 is None:
        return None
    return ((p1[0] - p0[0]) if achse == "x" else (p0[1] - p1[1])) / d


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--anker", nargs=2, type=int, default=[481, 557], metavar=("X", "Y"))
    p.add_argument("--name", default="Little Kong", help="Basis, die auf dem Anker steht")
    p.add_argument("--schreiben", action="store_true", help="config.json aktualisieren")
    a = p.parse_args()

    if tuple(a.anker) != WAHRHEITEN.get(a.name):
        print(f"Warnung: {a.name} ist unter {tuple(a.anker)} nicht als gemessene "
              f"Wahrheit hinterlegt — die Eichung waere dann auf einen geschaetzten "
              f"Wert geeicht.")
        return 1

    g = Geraet()
    g.starten()
    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG)
    stand = bild()
    if not zoom.lupe_da(stand, CFG):
        print("Kein Lupe-Knopf — Detailmodus noetig.")
        return 1

    # ── Versatz aus dem Anker ─────────────────────────────────────────────
    # Springt man auf die Koordinate einer Basis, steht diese in der Kameramitte;
    # ihr Banner liegt dann bei (1280+ox, 1280+oy).
    sprung.springen(g, CFG, a.anker[0], a.anker[1], bild, bekannt=stand)
    roh = sprung.dialog_sicherstellen(g, CFG, False, bild)
    im = Image.fromarray(roh)
    p0 = _anker_banner(roh, im, CFG,
                       (banner.MITTE, banner.MITTE + CFG["banner_versatz"]), a.name)
    if p0 is None:
        print(f"{a.name!r} am Anker nicht gefunden — steht die Basis dort noch?")
        return 1
    ox, oy = p0[0] - banner.MITTE, p0[1] - banner.MITTE
    print(f"Anker X:{a.anker[0]} Y:{a.anker[1]}: {a.name!r} sitzt bei "
          f"({p0[0]:.0f}, {p0[1]:.0f})")
    print(f"→ Versatz X {ox:+.0f} px · Versatz Y {oy:+.0f} px"
          f"   (bisher X {CFG.get('versatz_x', 0):+d}, Y {CFG['banner_versatz']:+d})\n")

    # ── Massstab ueber zwei Sprünge mit derselben Basis ───────────────────
    d = 4
    sx = massstab_ueber_sprung(g, CFG, bild, a.anker, a.name, p0, d, "x")
    sy = massstab_ueber_sprung(g, CFG, bild, a.anker, a.name, p0, d, "y")
    print(f"skala_x {CFG['skala_x']:6.1f} → "
          f"{f'{sx:.1f}' if sx else 'nicht messbar':>6s} px je Welteinheit")
    print(f"skala_y {CFG['skala_y']:6.1f} → "
          f"{f'{sy:.1f}' if sy else 'nicht messbar':>6s} px je Welteinheit")

    neu = dict(CFG)
    if sx:
        neu["skala_x"] = round(sx, 1)
    if sy:
        neu["skala_y"] = round(sy, 1)
    neu["versatz_x"] = round(ox)
    neu["banner_versatz"] = round(oy)

    # ── Gegenprobe an den uebrigen Wahrheiten ─────────────────────────────
    sprung.springen(g, CFG, a.anker[0], a.anker[1], bild)
    roh = sprung.dialog_sicherstellen(g, CFG, False, bild)
    im = Image.fromarray(roh)
    print(f"\n{'Basis':18s} {'gemessen':>12s} {'gerechnet':>16s} {'Abweichung':>11s}")
    print("-" * 62)
    getroffen = 0
    for cx, cy, w, h in banner.finde(roh, CFG):
        name = banner.lesen(im, cx, cy, w, h).lower().replace(" ", "")
        for wahr, (wx, wy) in WAHRHEITEN.items():
            if wahr.lower().replace(" ", "")[:6] in name:
                rx = a.anker[0] + (cx - banner.MITTE - neu["versatz_x"]) / neu["skala_x"]
                ry = a.anker[1] - (cy - banner.MITTE - neu["banner_versatz"]) / neu["skala_y"]
                print(f"{wahr:18s} {f'{wx}/{wy}':>12s} {f'{rx:.2f}/{ry:.2f}':>16s}"
                      f" {abs(rx-wx)+abs(ry-wy):10.2f}")
                getroffen += 1
                break
    if not getroffen:
        print("(keine der gemessenen Wahrheiten im Bild erkannt)")

    if a.schreiben:
        pfad = Path(__file__).resolve().parent / "config.json"
        alt = json.loads(pfad.read_text())
        alt.update({k: neu[k] for k in ("skala_x", "skala_y", "banner_versatz", "versatz_x")})
        pfad.write_text(json.dumps(alt, indent=2, ensure_ascii=False) + "\n")
        print(f"\nconfig.json aktualisiert.")
    else:
        print(f"\n(nur Bericht — mit --schreiben in config.json uebernehmen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
