"""Der Bannerfinder gegen eine von Hand abgelesene Wahrheit.

    .venv/bin/python -m scripts.karten_archiv.pruefe_banner
    .venv/bin/python -m scripts.karten_archiv.pruefe_banner --bild        # Overlay ablegen

Ohne Geraet, ohne BlueStacks: gemessen wird an `eichung/wisch_nach.png`, dem
Bild, das beim Eichen der weiten Zoomstufe entstanden ist. Die 21 Bannermitten
darin sind am 07.09.2026 von Hand an einem Koordinatengitter abgelesen — die
einzige Wahrheit, die nicht vom Finder selbst stammt und deshalb die einzige,
gegen die sich eine Verbesserung ehrlich messen laesst.

**Die weite Stufe ist der Pruefstein, nicht die Sprung-Stufe.** Dort stehen die
Basen dicht, die Banner beruehren einander und die Bauwerke — genau der Fall, an
dem die alte Helligkeitsschwelle zerbrach (6 von 21). Was hier traegt, traegt
naeher dran erst recht.

Fuenf der 21 Banner laufen am linken Rand des HUD-freien Rechtecks aus dem Bild.
Sie zaehlen mit, aber ihre Mitte ist zwangslaeufig verschoben — deshalb wird die
Mittengenauigkeit nur an den 16 vollstaendigen gemessen.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from scripts.karten_archiv import banner
from scripts.karten_archiv.archiv import WURZEL

BILD = WURZEL / "eichung" / "wisch_nach.png"

# (x, y, angeschnitten) im Vollbild 2560x2560, Stufe 'wisch'
WAHRHEIT = [
    (702, 651, True), (965, 651, False), (1240, 651, False), (1581, 651, False),
    (698, 880, True), (965, 880, False), (1267, 880, False), (1598, 880, False),
    (685, 1115, True), (968, 1115, False), (1252, 1115, False), (1585, 1115, False),
    (682, 1363, True), (967, 1363, False), (1285, 1363, False),
    (677, 1613, True), (957, 1613, False), (1273, 1613, False),
    (685, 1873, True), (1273, 1873, False), (1618, 1873, False),
]

# So weit darf ein Fund von der abgelesenen Mitte abweichen und noch als
# derselbe gelten. Grosszuegig in X (der Balken ist breit und die Wahrheit von
# Hand abgelesen), eng in Y (die Zeile entscheidet ueber die Welt-Koordinate).
TOLERANZ_X, TOLERANZ_Y = 110, 30


def _stufe(name: str) -> dict:
    cfg = json.loads((Path(__file__).resolve().parent / "config.json").read_text())
    return dict(cfg, **cfg["stufen"][name]) if name in cfg.get("stufen", {}) else cfg


def pruefen(overlay: bool = False, schwelle: float | None = None
            ) -> tuple[int, int, int, float]:
    im = Image.open(BILD).convert("RGB")
    cfg = _stufe("wisch")
    if schwelle is not None:
        cfg = dict(cfg, banner_schwelle=schwelle)
    treffer = banner.finde(np.asarray(im), cfg)

    offen = list(WAHRHEIT)
    zuordnung, falsch = {}, []
    for cx, cy, w, h in treffer:
        nah = [t for t in offen if abs(t[0] - cx) < TOLERANZ_X and abs(t[1] - cy) < TOLERANZ_Y]
        if not nah:
            falsch.append((cx, cy))
            continue
        t = min(nah, key=lambda t: (t[0] - cx) ** 2 + (t[1] - cy) ** 2)
        offen.remove(t)
        zuordnung[t] = (cx, cy, w, h)

    abweichung = [abs(f[0] - t[0]) for t, f in zuordnung.items() if not t[2]]
    med = float(np.median(abweichung)) if abweichung else float("nan")

    print(f"{len(treffer)} Funde · {len(zuordnung)} von {len(WAHRHEIT)} Bannern getroffen · "
          f"{len(falsch)} ohne Entsprechung")
    print(f"Mittenfehler an den vollstaendigen Bannern: median {med:.0f} px "
          f"= {med / cfg['skala_x']:.2f} Welteinheiten")
    for x, y, ang in offen:
        print(f"  verpasst: {x},{y}" + (" (angeschnitten)" if ang else ""))
    for cx, cy in falsch:
        print(f"  ohne Entsprechung: {cx:.0f},{cy:.0f}")

    if overlay:
        d = ImageDraw.Draw(im)
        for x, y, _ in WAHRHEIT:
            d.ellipse([x - 9, y - 9, x + 9, y + 9], outline=(0, 255, 0), width=4)
        for cx, cy, w, h in treffer:
            d.rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
                        outline=(255, 0, 0), width=4)
        ziel = WURZEL / "eichung" / "banner_pruefung.png"
        im.crop(tuple(cfg["karte"])).save(ziel)
        print(f"Overlay: {ziel}")
    return len(treffer), len(zuordnung), len(falsch), med


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--bild", action="store_true", help="Overlay mit Wahrheit und Funden ablegen")
    p.add_argument("--mindestens", type=int, default=19,
                   help="so viele der 21 Banner muessen getroffen werden")
    p.add_argument("--mindestens-schwach", type=int, default=20,
                   help="dasselbe fuer die Schwelle, mit der das Archiv sucht — "
                        "der gemessene Stand, nicht ein Wunsch: das eine fehlende "
                        "Banner laeuft am Bildrand aus dem Bild")
    a = p.parse_args()
    if not BILD.exists():
        print(f"Eichbild fehlt: {BILD}\n"
              f"Es entsteht beim Eichen der weiten Stufe (eichen_reihen.py --stufe wisch).")
        return 2
    _, getroffen, falsch, med = pruefen(a.bild)
    # **Die Archiv-Auswertung sucht tiefer.** `banner.auswerten` setzt
    # `SCHWELLE_SCHWACH`, weil echte Basen knapp unter der sicheren Schwelle
    # lagen; was dabei zusaetzlich anfaellt, muss in `basen_bauen` eine Stufe
    # oder ein Kuerzel mitbringen. Diese zweite Zeile misst genau das, sonst
    # pruefte das Skript eine Einstellung, die im Archiv gar nicht laeuft.
    print(f"\nSo sucht die Archiv-Auswertung (Schwelle {banner.SCHWELLE_SCHWACH}):")
    _, getroffen_s, falsch_s, _ = pruefen(False, banner.SCHWELLE_SCHWACH)
    if getroffen < a.mindestens:
        print(f"\nZU WENIG: {getroffen} < {a.mindestens}")
        return 1
    if getroffen_s < a.mindestens_schwach:
        print(f"\nZU WENIG (schwache Schwelle): {getroffen_s} < {a.mindestens_schwach}")
        return 1
    print("\nIn Ordnung.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
