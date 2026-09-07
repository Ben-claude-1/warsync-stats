"""Navigation per Wischgeste statt per Koordinatensprung.

**Der Sprung setzt den Zoom zurueck, der Wisch nicht** (gemessen 07.09.2026: nach
2, 4 und 6 Herauszoom-Gesten stand hinter dem Sprung jedes Mal derselbe
Massstab). Das entscheidet mehr als das Tempo: auf der erzwungenen Standardstufe
deckt eine Kachel 8,3 x 12,5 Welteinheiten ab, eine Zoomgeste weiter draussen
13,2 x 19,9 — viermal so viel Flaeche je Aufnahme.

| | je Kachel | Zoom | Kachel deckt | ganze Karte |
|---|---|---|---|---|
| Sprung | 5,5 s | zurueckgesetzt | 8,3 x 12,5 E | 16 h |
| **Wisch** | **1,4 s** | bleibt stehen | 13,2 x 19,9 E | **~2,5 h** |

Woran alle frueheren Anlaeufe gescheitert sind: sie mussten die Schwenkweite
**raten** und sammelten dabei Fehler auf. Das ist erledigt, und zwar doppelt:

* **Der Lupe-Dialog verraet die Kameraposition, ohne zu springen.** Nur „Suchen"
  setzt den Zoom zurueck; Oeffnen und Schliessen lassen ihn stehen. Er kostet
  aber zwei Taps und zwei Bildschirmfotos — als Anker je Zeile und als Stichprobe
  taugt er, als Messung je Kachel waere er der teuerste Posten.
* **Die Ueberlappung misst den Versatz umsonst.** Zwei aufeinander folgende
  Kacheln zeigen dasselbe Gelaende; ein Vorlagenabgleich liefert die
  Verschiebung auf wenige Pixel genau, ohne das Geraet auch nur anzufassen.

Damit ist die Traegheit der Geste kein Problem mehr: sie wird nicht vermieden,
sondern gemessen.

**Der Abgleich braucht ein Fenster.** Ohne Einschraenkung rastet er im Hive auf
der Rasterperiode ein (Basen stehen alle 3 Welteinheiten, bei 125 px/E also alle
377 px) und meldet eine um genau eine Rasterweite falsche Verschiebung — die
schlimmste Fehlerart, weil sie plausibel aussieht. Gesucht wird deshalb nur in
einem engen Fenster um die erwartete Stelle.

**Und er darf das HUD nicht sehen.** Die Oberflaechenraender stehen still; eine
Vorlage, die sie enthaelt, passt am besten bei Verschiebung null. Der Abgleich
arbeitet ausschliesslich im HUD-freien Rechteck.
"""
from __future__ import annotations

import time

import cv2
import numpy as np


class WischFehler(RuntimeError):
    pass


def gestenlaenge(cfg: dict, ziel_px: float) -> int:
    """Wischstrecke, die den Bildinhalt um `ziel_px` verschiebt.

    Die Geste schleudert nach: der Inhalt wandert weiter als der Finger, um den
    gemessenen `pixel_faktor` (siehe `traegheit`). Gerechnet wird in Pixeln, nicht
    in Welteinheiten — „9 Welteinheiten je Wisch" gilt nur auf der Stufe, auf der
    es gemessen wurde, und war genau deshalb eine Fehlerquelle.
    """
    w = cfg["wisch_geste"]
    return int(min(w["max_px"], max(200.0, ziel_px / traegheit(cfg))))


def traegheit(cfg: dict) -> float:
    """Der Traegheitsfaktor der Stufe, sonst der allgemeine aus `wisch_geste`.

    Er **ist** stufenabhaengig, entgegen der urspruenglichen Annahme: auf der
    Sprung-Stufe wurden 1,51 gemessen, eine Zoomgeste weiter draussen 1,24. Wer
    ihn fuer eine reine Eigenschaft der Geste haelt, waehlt die Wischlaenge um
    ein Fuenftel falsch — und verliert damit die Ueberlappung, aus der der
    Versatz ueberhaupt erst gemessen wird.
    """
    return float(cfg.get("pixel_faktor", cfg["wisch_geste"]["pixel_faktor"]))


def geste(g, cfg: dict, richtung: str, laenge_px: int) -> None:
    """Eine Wischgeste in Weltrichtung `x+`, `x-`, `y+` oder `y-`.

    Die Karte bewegt sich der Geste entgegen: wischt man nach links, wandert die
    Kamera nach OSTEN (X waechst). Gewischt wird um die konfigurierte Mitte
    herum, damit beide Endpunkte auf der Karte liegen und nicht im HUD — ein
    Wisch, der auf einem Bedienelement beginnt, wird zum Tap darauf.
    """
    w = cfg["wisch_geste"]
    mx, my = w["mitte"]
    h = laenge_px / 2
    orte = {"x+": (mx + h, my, mx - h, my), "x-": (mx - h, my, mx + h, my),
            "y-": (mx, my + h, mx, my - h), "y+": (mx, my - h, mx, my + h)}
    if richtung not in orte:
        raise WischFehler(f"Unbekannte Richtung {richtung!r}")
    x1, y1, x2, y2 = (int(round(v)) for v in orte[richtung])
    g._sh("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(w["dauer"]),
          timeout=int(w["dauer"] / 1000) + 20)
    time.sleep(w.get("pause", 0.4))


def _vorlage_fenster(cfg: dict, sx: float, sy: float, toleranz: int,
                     max_b: int = 600, max_h: int = 1400
                     ) -> tuple[int, int, int, int]:
    """Ausschnitt des **alten** Bildes, der im neuen vollstaendig sichtbar bleibt.

    **Die Vorlage darf schmal und hoch sein.** Ist der Schritt gross, bleibt
    waagerecht nur ein schmaler Streifen Ueberlappung — senkrecht aber die ganze
    Kartenhoehe. Ein quadratischer Ausschnitt verschenkt das: er waere entweder
    zu breit fuer die Ueberlappung oder unnoetig niedrig. 180 x 1400 px tragen
    fuer den Abgleich mehr Struktur als 400 x 400.
    """
    x0, y0, x1, y1 = cfg["karte"]
    ax0 = x0 + max(0.0, sx) + toleranz
    ax1 = x1 + min(0.0, sx) - toleranz
    ay0 = y0 + max(0.0, sy) + toleranz
    ay1 = y1 + min(0.0, sy) - toleranz
    if ax1 - ax0 < 100 or ay1 - ay0 < 100:
        raise WischFehler(
            f"Ueberlappung zu klein fuer einen Vorlagenabgleich: bei einem Schritt "
            f"von {sx:.0f} px und Toleranz {toleranz} px bleiben "
            f"{ax1-ax0:.0f} x {ay1-ay0:.0f} px. Kuerzer wischen (mehr Ueberlappung).")
    mx, my = (ax0 + ax1) / 2, (ay0 + ay1) / 2
    hw = min(max_b, ax1 - ax0) / 2
    hh = min(max_h, ay1 - ay0) / 2
    return int(mx - hw), int(my - hh), int(mx + hw), int(my + hh)


def versatz(vorher: np.ndarray, nachher: np.ndarray, cfg: dict,
            erwartet: tuple[float, float], toleranz: int = 140
            ) -> tuple[float, float, float]:
    """Tatsaechliche Verschiebung des Bildinhalts in Pixeln, plus Guete 0…1.

    `erwartet` ist die Verschiebung, mit der gerechnet wird — ein Merkmal bei
    (x, y) im alten Bild steht danach bei (x - sx, y - sy). Gesucht wird nur
    innerhalb `toleranz` Pixel darum.

    **Ein Treffer am Rand des Suchfensters ist keiner.** Liegt der wahre Versatz
    ausserhalb, rastet die Korrelation am naechstgelegenen Rand ein und meldet
    einen zu kleinen Wert — mit ordentlicher Guete, denn die Vorlage passt dort
    fast. Am 07.09.2026 hat genau das eine Zeile schleichend um 3 Welteinheiten
    verschoben: die Erwartung stammte aus einem auf einer anderen Zoomstufe
    gemessenen Traegheitsfaktor und lag 170 px daneben, die Toleranz betrug 160.
    Randtreffer werden deshalb mit Guete 0 gemeldet — der Aufrufer soll die
    Erwartung nachziehen oder die Position erfragen, nicht den Randwert nehmen.

    Die Guete ist sonst die normierte Kreuzkorrelation am Treffer. Sie faellt
    auch ab, wenn das Gelaende strukturlos ist (offenes Wasser, gleichfoermige
    Wueste) — dann ist die Verschiebung schlicht nicht messbar.
    """
    ex, ey = float(erwartet[0]), float(erwartet[1])
    tx0, ty0, tx1, ty1 = _vorlage_fenster(cfg, ex, ey, toleranz)
    alt = cv2.cvtColor(vorher, cv2.COLOR_RGB2GRAY)
    neu = cv2.cvtColor(nachher, cv2.COLOR_RGB2GRAY)
    vorlage = alt[ty0:ty1, tx0:tx1]

    sx0 = int(round(tx0 - ex - toleranz))
    sy0 = int(round(ty0 - ey - toleranz))
    sx1 = int(round(tx1 - ex + toleranz))
    sy1 = int(round(ty1 - ey + toleranz))
    h, b = neu.shape
    sx0, sy0 = max(0, sx0), max(0, sy0)
    sx1, sy1 = min(b, sx1), min(h, sy1)
    suche = neu[sy0:sy1, sx0:sx1]
    if suche.shape[0] <= vorlage.shape[0] or suche.shape[1] <= vorlage.shape[1]:
        raise WischFehler("Suchfenster kleiner als die Vorlage")

    karte = cv2.matchTemplate(suche, vorlage, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(karte)
    rand = 2
    am_rand = (ort[0] <= rand or ort[1] <= rand
               or ort[0] >= karte.shape[1] - 1 - rand
               or ort[1] >= karte.shape[0] - 1 - rand)
    return (float(tx0 - (sx0 + ort[0])), float(ty0 - (sy0 + ort[1])),
            0.0 if am_rand else float(guete))


def versatz_nachziehen(vorher: np.ndarray, nachher: np.ndarray, cfg: dict,
                       erwartet: tuple[float, float], toleranz: int = 140,
                       anlaeufe: int = 3) -> tuple[float, float, float]:
    """Wie `versatz`, zieht die Erwartung aber an einen Randtreffer heran.

    Ein Randtreffer sagt nicht „nicht messbar", sondern „weiter draussen". Das
    Fenster wandert deshalb dorthin und sucht erneut — nach ein bis zwei
    Anlaeufen liegt der wahre Versatz darin. Das ist derselbe Vorgang wie beim
    ersten Ausrichten einer Waage und kostet nichts: es sind Rechnungen auf
    Bildern, die ohnehin schon da sind.

    Erst wenn auch das nicht traegt, ist der Versatz wirklich unbestimmt — dann
    ist das Gelaende strukturlos oder die Geste ist gar nicht angekommen.
    """
    ex, ey = float(erwartet[0]), float(erwartet[1])
    for _ in range(anlaeufe):
        sx, sy, guete = versatz(vorher, nachher, cfg, (ex, ey), toleranz)
        if guete > 0.0:
            return sx, sy, guete
        if abs(sx - ex) < 1 and abs(sy - ey) < 1:
            break                       # Rand, aber ohne Richtung — hilft nicht
        ex, ey = sx, sy
    return ex, ey, 0.0


def welt_versatz(sx: float, sy: float, cfg: dict) -> tuple[float, float]:
    """Pixelverschiebung des Bildinhalts → Verschiebung der Kamera in Welteinheiten.

    Gemessen wird in der Bildmitte, und dort ist die Neigungskorrektur per
    Definition 1 — die Kamera bewegt sich entlang der eigenen Mittellinie. Der
    perspektivische Faktor aus `ymodell` gehoert also an die Banner, nicht hierher.
    """
    return sx / cfg["skala_x"], -sy / cfg["skala_y"]
