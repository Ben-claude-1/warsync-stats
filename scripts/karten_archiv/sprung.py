"""Koordinatensprung ueber den Lupe-Dialog.

Der Dialog ist der Grund, warum dieses Vorhaben ueberhaupt traegt: er springt auf
eine eingegebene Weltkoordinate und zeigt die Kameraposition als Text. Damit
entfaellt die Schwenk-Kalibrierung, an der alle frueheren Anlaeufe gescheitert
sind — es gibt kein Schwenk-Delta, keinen aufsummierten Fehler, jede Kachel landet
exakt dort, wo sie soll.

Drei Eigenheiten, die Zeit gekostet haben und nicht wegoptimiert werden duerfen:

* **Der Lupe-Knopf schaltet um.** Ist der Dialog offen, schliesst ihn ein weiterer
  Tap. Wer stur draufhaut, arbeitet ab dem zweiten Sprung blind.
* **Nach „Suchen" bleibt der Dialog mal offen und mal nicht.** Ob er offen ist,
  entscheidet die Farbe des Suchknopfes, nicht die Annahme.
* **Ein Tap schaltet den Fokus um, er trifft nicht einfach das Ziel.** Ist ein Feld
  fokussiert, wird der naechste Tap verbraucht; das Feld darunter bleibt unberuehrt
  und der folgende `input text` landet im Nichts. Genau daran scheiterte jeder
  Y-Sprung, waehrend X zufaellig funktionierte (dort war nichts fokussiert).

**Der Zustand wird mitgefuehrt, nicht jedes Mal neu erfragt.** Eine Zustandspruefung
kostet ein Bildschirmfoto, und das ist der teuerste Posten je Kachel. Gemerkt wird
deshalb, wie der Dialog beim letzten Bild aussah; geprueft wird erst wieder an dem
Bild, das ohnehin gemacht wird. Ein *Unterstellen* ist das nicht — die Quelle ist
immer ein echtes Bild, nur eben eines, das doppelt genutzt wird.
"""
from __future__ import annotations

import time

import numpy as np


class SprungFehler(RuntimeError):
    pass


def dialog_offen(bild_rgb: np.ndarray, cfg: dict) -> bool:
    x0, y0, x1, y1 = cfg["suchknopf_box"]
    m = bild_rgb[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
    return bool(m[2] > 200 and m[0] < 150)


def dialog_sicherstellen(g, cfg: dict, offen: bool, bild,
                         bekannt: np.ndarray | None = None) -> np.ndarray:
    """`bild` liefert ein frisches Vollbild; `bekannt` ein schon vorhandenes."""
    im = bekannt if bekannt is not None else bild()
    for _ in range(3):
        if dialog_offen(im, cfg) == offen:
            return im
        g.tippen(*cfg["lupe"], pause=1.0)
        im = bild()
    raise SprungFehler(f"Dialog liess sich nicht auf offen={offen} bringen")


def _feld_fuellen(g, cfg: dict, feld, wert: int) -> None:
    # Entfokus-Tap: ohne ihn wird der naechste Tap verbraucht und die Eingabe
    # landet im Nichts.
    g.tippen(*cfg["neutral"], pause=cfg.get("pause_entfokus", 0.35))
    g.tippen(*feld, pause=cfg.get("pause_feld", 0.5))
    g._sh("shell", "input", "text", str(int(wert)))
    time.sleep(cfg.get("pause_entfokus", 0.35))


def springen(g, cfg: dict, x: int, y: int, bild,
             bekannt: np.ndarray | None = None) -> None:
    dialog_sicherstellen(g, cfg, True, bild, bekannt=bekannt)
    _feld_fuellen(g, cfg, cfg["feld_x"], x)
    _feld_fuellen(g, cfg, cfg["feld_y"], y)
    g.tippen(*cfg["neutral"], pause=cfg.get("pause_entfokus", 0.35))
    g.tippen(*cfg["suchen"], pause=cfg.get("pause_suchen", 2.2))
