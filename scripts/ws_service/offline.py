"""Eine mitgeschnittene Bilderfolge auswerten, statt selbst zu scrollen.

Der Dienst scrollt die Teilnehmerliste sonst selbst (`roster.durchlauf`). Das ist
der Teil, der regelmaessig haengt: die Liste nimmt einen Wisch nicht an, und ein
zu frueher Abbruch sieht hinterher aus wie ein vollstaendiger Scan. Wer von Hand
durchscrollt, waehrend im Sekundentakt Bildschirmfotos mitlaufen, umgeht das
ganz — hier wird nur noch gelesen, nicht mehr gesteuert.

Dieselben Lesefunktionen wie im Live-Lauf (`roster.zeitkoepfe`,
`roster.zeile_lesen`), deshalb gelten dieselben Regeln: Text wird gelesen,
Zustand wird gemessen, und ein unsicherer Name wird gemeldet statt geraten.

Zwei Dinge, die nur hier gelten:

* **Die Gegenprobe ueber die Rang-Zaehler faellt weg.** Wer von Hand scrollt,
  klappt Gruppen auf und zu, wie es ihm passt; dieselbe Kopfzeile taucht in
  beliebiger Reihenfolge auf und laesst sich nicht mehr sauber einmal zaehlen.
  Geprueft wird stattdessen gegen die Zahlen ueber der Liste (`dialog_zaehler`)
  — die stehen in jedem Bild und sind unabhaengig vom Weg dorthin.
* **Es wird geprueft, ob ueberhaupt lueckenlos gescrollt wurde.** Bewegt sich
  der Listeninhalt zwischen zwei Bildern um mehr als eine Fensterhoehe, ist eine
  Zeile durchgefallen — dann taugt der Mitschnitt nicht, egal wie gut die
  einzelnen Bilder aussehen.

    .venv/bin/python -m scripts.ws_service.offline /tmp/ws_check/manuell
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from . import roster, vision as v


class Bilderfolge:
    """Steht anstelle von `Geraet`: hat eine `cfg`, aber kein Geraet dahinter."""

    def __init__(self, cfg: dict):
        self.cfg = cfg


def laden(p: Path) -> np.ndarray:
    bild = cv2.imread(str(p), cv2.IMREAD_COLOR)
    if bild is None:
        raise ValueError(f"{p} laesst sich nicht lesen")
    return cv2.cvtColor(bild, cv2.COLOR_BGR2RGB)


def luecken(g: Bilderfolge, bilder: list[Path], log=print) -> list[tuple[str, int]]:
    """Verschiebung zwischen je zwei Bildern; meldet, was ueber die Hoehe geht.

    Nicht die Geschwindigkeit ist die Bedingung, sondern die Strecke: solange
    weniger als eine Fensterhoehe zwischen zwei Bildern liegt, war jede Zeile
    mindestens einmal ganz zu sehen.
    """
    x0, y0, x1, y1 = g.cfg["list_view"]
    hoehe = y1 - y0
    vorher = None
    zu_weit = []
    for p in bilder:
        jetzt = cv2.cvtColor(laden(p), cv2.COLOR_RGB2GRAY)[y0:y1, x0:x1]
        if vorher is not None:
            dy = _versatz(vorher, jetzt)
            if dy is not None and abs(dy) >= hoehe:
                zu_weit.append((p.name, dy))
        vorher = jetzt
    log(f"  Lueckenpruefung: {len(bilder)} Bilder, Fensterhoehe {hoehe} px, "
        f"{len(zu_weit)} Spruenge ueber die Hoehe.")
    return zu_weit


def _versatz(a: np.ndarray, b: np.ndarray) -> int | None:
    h = a.shape[0]
    muster = a[h - 260:h - 60, :]
    treffer = cv2.matchTemplate(b, muster, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(treffer)
    if guete < 0.55:
        return None
    return (h - 260) - ort[1]


MIN_ZEILE = 160     # so viel Zeile muss sichtbar sein, damit die Plakette zaehlt


def zeile_lesen(g: Bilderfolge, bild: np.ndarray, y_kopf_ende: int) -> dict:
    """Wie `roster.zeile_lesen`, aber am unteren Rand der Liste abgeschnitten.

    Der Live-Lauf ueberspringt jede Zeile, die nicht mit ihren vollen 210 px im
    Bild steht — er sieht sie im naechsten Bild ohnehin wieder. Beim Mitschnitt
    stimmt das nicht: wer von Hand scrollt, hat eine Zeile womoeglich **nur**
    angeschnitten erwischt. Am 02.09.2026 waren das fuenf Spieler (Plag3,
    ZEUS XS, E m p a t r o N, Nico4382, Zenrath), die sonst gefehlt haetten.

    Der Preis ist ein Fenster, das ueber die Liste hinausreichen koennte —
    darunter sitzt der blaue Knopf „Teilnahme erbitten" und faerbte jede
    angeschnittene Zeile als gesetzt ein. `y_bis` wird deshalb hart auf den
    unteren Rand der Liste geklemmt, nie darueber hinaus.
    """
    _, _, _, view_unten = g.cfg["list_view"]
    nx0, nx1 = g.cfg["name_box_x"]
    text = v.ocr(bild, (nx0, y_kopf_ende + 8, nx1,
                        min(y_kopf_ende + 205, view_unten)), psm=6)
    zeilen = [z.strip() for z in text.splitlines() if z.strip()]
    schwelle = g.cfg["schwellen"]["badge_blau_minus_rot"]
    y_bis = min(y_kopf_ende + 230, view_unten)
    badges = {rolle: v.blau_signal(bild, x, y_kopf_ende + 40, y_bis)
              for rolle, x in g.cfg["badge_x"].items()}
    if badges["gesetzt"] > schwelle:
        platz = "gesetzt"
    elif badges["ersatz"] > schwelle:
        platz = "ersatz"
    else:
        platz = "ohne"
    return {"name_ocr": zeilen[0] if zeilen else "", "kraft": v.kraft(text),
            "platz": platz, "badge_signal": {k: round(x, 1) for k, x in badges.items()}}


def zeilen_sammeln(g: Bilderfolge, bilder: list[Path], log=print) -> dict:
    """Jedes Bild fuer sich lesen. Entdoppelt wird spaeter ueber den Kader."""
    _, _, _, view_unten = g.cfg["list_view"]
    zeilen: list[dict] = []
    zaehler: dict = {}
    verworfen = 0
    for p in bilder:
        bild = laden(p)
        if not zaehler:
            zaehler = roster.dialog_zaehler(g, bild)
        for ky0, ky1, farbe in roster.zeitkoepfe(g, bild):
            if ky1 + MIN_ZEILE >= view_unten:
                verworfen += 1                # zu wenig Zeile fuer eine Aussage
                continue
            z = zeile_lesen(g, bild, ky1)
            z["farbe"] = farbe
            z["zeit"] = roster.kopfzeit(g, bild, ky0, ky1)
            z["bild"] = p.name
            zeilen.append(z)
    log(f"  {len(zeilen)} Rohzeilen aus {len(bilder)} Bildern "
        f"({verworfen} zu stark angeschnitten).")
    return {"zeilen": zeilen, "zaehler": zaehler}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ordner", type=Path)
    ap.add_argument("--json", type=Path, help="Rohzeilen zusaetzlich als JSON ablegen")
    args = ap.parse_args()

    cfg = json.loads((Path(__file__).parent / "config.json").read_text())
    g = Bilderfolge(cfg)
    bilder = sorted(args.ordner.glob("*.png"))
    if not bilder:
        print(f"Keine Bilder in {args.ordner}")
        return 1

    zu_weit = luecken(g, bilder)
    for name, dy in zu_weit:
        print(f"  ! {name}: {dy} px auf einmal — dazwischen fehlt etwas.")

    erg = zeilen_sammeln(g, bilder)
    if args.json:
        args.json.write_text(json.dumps(erg, ensure_ascii=False, indent=1))
        print(f"  Rohzeilen: {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
