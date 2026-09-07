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
    """Zwei Merkmale an verschiedenen Stellen, nicht eines.

    **Der Suchknopf allein taeuscht.** Seine Box liegt oberhalb des
    Kartenausschnitts — bei geschlossenem Dialog steht dort die Karte selbst, und
    was blau genug ist, besteht die Pruefung: Wasser, ein blaues Dach, ein
    Ereignis-Banner. Die Funktion meldet dann dauerhaft „offen", `dialog_sicher-
    stellen` tippt gegen einen Dialog an, den es nicht gibt, und oeffnet ihn dabei
    jedes Mal neu. Am 08.09.2026 starben daran zwei Zeilen des Vollscans an
    derselben Stelle — X 458,0 und X 458,05, was den Zufall ausschliesst.

    Das zweite Merkmal ist die **Graustufigkeit der unteren Dialogflaeche**: dort
    liegt ein grosser, farbloser Kasten, dessen drei Farbkanaele dicht
    beieinanderliegen (gemessen 14,5 Einheiten Spanne). Gelaende ist nie farblos —
    ueber vier Aufnahmen lag die Spanne dort bei 41 bis 88. Nicht die Helligkeit:
    das Feld ist durchscheinend und ueber heller Wueste selbst hell.
    """
    x0, y0, x1, y1 = cfg["suchknopf_box"]
    m = bild_rgb[y0:y1, x0:x1].reshape(-1, 3).mean(axis=0)
    if not (m[2] > 200 and m[0] < 150):
        return False
    fx0, fy0, fx1, fy1 = cfg["dialog_grau_box"]
    f = bild_rgb[fy0:fy1, fx0:fx1].reshape(-1, 3).mean(axis=0)
    return bool(float(max(f) - min(f)) < 25)


def dialog_sicherstellen(g, cfg: dict, offen: bool, bild,
                         bekannt: np.ndarray | None = None) -> np.ndarray:
    """`bild` liefert ein frisches Vollbild; `bekannt` ein schon vorhandenes.

    **Beim Schliessen ist die Zurueck-Taste der zweite Weg.** Dreimal auf dieselbe
    Stelle zu tippen hilft nicht, wenn dort etwas anderes liegt: Last War schiebt
    im Betrieb Angebots- und Ereignis-Ueberlagerungen ueber die Karte, und der Tap
    trifft dann das Overlay statt der Lupe. Am 08.09.2026 endete daran eine Zeile
    des Vollscans bei X 458. `KEYCODE_BACK` schliesst die oberste Ueberlagerung
    und ist auf der Weltkarte harmlos — beim *Oeffnen* taugt sie dagegen nicht,
    deshalb nur in dieser Richtung.
    """
    im = bekannt if bekannt is not None else bild()
    for versuch in range(4):
        if dialog_offen(im, cfg) == offen:
            return im
        if not offen and versuch:
            g.zurueck(pause=1.0)
        else:
            g.tippen(*cfg["lupe"], pause=1.0)
        im = bild()
    # **Der Fehlschlag hinterlaesst ein Bild.** Am 08.09.2026 starben zwei Zeilen
    # des Vollscans hieran, und weder Log noch Nachstellen am Geraet gaben die
    # Ursache her — an derselben Koordinate lief derselbe Ablauf danach sauber
    # durch. Ohne eine Aufnahme aus dem Moment des Scheiterns bleibt es beim
    # Raten; ein PNG kostet nichts und beendet das.
    try:
        from datetime import datetime
        from PIL import Image as _Image
        from scripts.karten_archiv.archiv import WURZEL
        ordner = WURZEL / "stoerfaelle"
        ordner.mkdir(parents=True, exist_ok=True)
        wohin = ordner / f"dialog_{datetime.now():%Y%m%d_%H%M%S}_offen{int(offen)}.png"
        _Image.fromarray(im).save(wohin)
    except Exception:                    # Beweissicherung darf nie selbst werfen
        wohin = None
    raise SprungFehler(f"Dialog liess sich nicht auf offen={offen} bringen"
                       + (f" — Bild: {wohin}" if wohin else ""))


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
