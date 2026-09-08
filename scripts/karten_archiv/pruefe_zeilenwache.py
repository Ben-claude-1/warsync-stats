"""Die Rettungsleiter einer Zeile — am Schreibtisch, ohne Geraet.

    .venv/bin/python -m scripts.karten_archiv.pruefe_zeilenwache

Am 08.09.2026 endete der Vollscan zum vierten Mal, und jedes Mal an derselben
Bruchstelle: **ein einzelner misslungener Griff toetete eine ganze Zeile.** Von 43
schwachen Abgleichen fing die Ablesung 39 auf; die vier uebrigen kosteten drei
Zeilen in Folge und damit den Lauf. Die Reparatur ist eine Leiter aus drei Sprossen
— zweiter Blick, Ablesung mit Anlaeufen, Notsprung —, und jede davon muss greifen,
*bevor* die naechste bemueht wird.

Am Geraet ist das nicht pruefbar: die Ausfaelle sind selten, augenblicksgebunden
und liessen sich an derselben Koordinate nie nachstellen. Hier wird deshalb der
Fehlschlag gestellt statt abgewartet — `versatz_nachziehen`, `position.lesen` und
`springen` sind ausgetauscht, der Rest der Zeile laeuft echt.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from scripts.karten_archiv import archiv as archiv_modul
from scripts.karten_archiv import position, sprung, sweep, wisch, zoom
from scripts.karten_archiv.archiv import Archiv
from scripts.karten_archiv.run import CFG

STUFE = "nah"


class FalschesGeraet:
    """Nimmt jede Geste entgegen und merkt sie sich."""

    def __init__(self):
        self.spur: list[str] = []

    def tippen(self, *a, **k):
        self.spur.append("tippen")

    def zurueck(self, *a, **k):
        self.spur.append("zurueck")

    def _sh(self, *a, **k):
        self.spur.append("sh")


class Buehne:
    """Ein Lauf mit vorgegebenen Fehlschlaegen.

    `abgleich_schwach` und `ablesung_tot` sind Mengen von Kachelnummern: bei
    genau diesen Schritten liefert der Vorlagenabgleich bzw. die Ablesung nichts.
    """

    def __init__(self, scfg, abgleich_schwach=(), ablesung_tot=(),
                 blick_hilft=(), dialog_wirft=()):
        self.scfg = scfg
        self.abgleich_schwach = set(abgleich_schwach)
        self.ablesung_tot = set(ablesung_tot)
        self.blick_hilft = set(blick_hilft)
        self.dialog_wirft = set(dialog_wirft)
        self.schritt = 0
        self.blicke = 0
        self.ablesungen = 0
        self.spruenge: list[tuple[int, int]] = []
        self.zoom_nachgezogen = 0
        # Die wahre Kamera. Sie wandert nur, wenn die Geste ankommt — bei einem
        # gestellten Ausfall bleibt sie stehen, genau wie im echten Fehlerfall.
        self.wahr_x = 0.0

    # ── ausgetauschte Bausteine ──────────────────────────────────────────
    def versatz_nachziehen(self, vorher, nachher, cfg, erwartet, **k):
        soll = float(erwartet[0])
        if self.schritt in self.abgleich_schwach:
            self.blicke += 1
            if self.schritt in self.blick_hilft and self.blicke > 1:
                self.wahr_x += soll / cfg["skala_x"]
                return soll, 0.0, 0.88
            return soll, 0.0, 0.0
        self.wahr_x += soll / cfg["skala_x"]
        return soll, 0.0, 0.91

    def lesen(self, g, cfg, bild, erwartet=None, toleranz=6):
        self.ablesungen += 1
        if self.schritt in self.dialog_wirft:
            raise sprung.SprungFehler("Dialog liess sich nicht auf offen=False bringen")
        if self.schritt in self.ablesung_tot:
            return None
        return round(self.wahr_x), int(erwartet[1]) if erwartet else 0

    def springen(self, g, cfg, x, y, bild, bekannt=None):
        self.spruenge.append((x, y))
        self.wahr_x = float(x)

    def dialog_sicherstellen(self, g, cfg, offen, bild, bekannt=None):
        return bild()

    def nach_sprung(self, g, cfg):
        self.zoom_nachgezogen += 1

    # ── Auskunft ─────────────────────────────────────────────────────────
    @property
    def notspruenge(self) -> int:
        """Jede Zeile beginnt mit einem Sprung — der zaehlt hier nicht mit."""
        return max(0, len(self.spruenge) - 1)

    def geste(self, g, cfg, richtung, laenge):
        self.schritt += 1
        self.blicke = 0


def _bild_folge():
    """Jedes Bild anders — sonst schlaegt die Stillstandswache zu Recht an."""
    n = {"i": 0}

    def bild():
        n["i"] += 1
        a = np.zeros((2560, 2560, 3), dtype=np.uint8)
        a[:, :, 0] = n["i"] % 251
        return a

    return bild


def fahren(buehne: Buehne, bis_x: int = 60, pruefen: int = 5):
    """Eine Zeile mit ausgetauschten Bausteinen fahren."""
    alt = (wisch.versatz_nachziehen, wisch.geste, position.lesen, sprung.springen,
           sprung.dialog_sicherstellen, zoom.nach_sprung)
    wisch.versatz_nachziehen = buehne.versatz_nachziehen
    wisch.geste = buehne.geste
    position.lesen = buehne.lesen
    sprung.springen = buehne.springen
    sprung.dialog_sicherstellen = buehne.dialog_sicherstellen
    zoom.nach_sprung = buehne.nach_sprung
    try:
        with tempfile.TemporaryDirectory() as d:
            # Die Pruefung legt ihre Kacheln im Wegwerf-Ordner ab, nicht neben
            # den echten Archiven — sie schreibt schliesslich Bilder.
            wurzel_alt = archiv_modul.WURZEL
            archiv_modul.WURZEL = Path(d)
            try:
                archiv = Archiv("pruefung", buehne.scfg)
            finally:
                archiv_modul.WURZEL = wurzel_alt
            return sweep.zeile_fahren(FalschesGeraet(), buehne.scfg, archiv,
                                      _bild_folge(), 0, 0, bis_x, 0,
                                      laenge=1020, pruefen=pruefen, lesen=False)
    finally:
        (wisch.versatz_nachziehen, wisch.geste, position.lesen, sprung.springen,
         sprung.dialog_sicherstellen, zoom.nach_sprung) = alt


def main() -> int:
    scfg = dict(zoom.stufe(CFG, STUFE), navigation="wisch")
    faelle: list[tuple[str, bool, str]] = []

    # Die Faelle 1–6 fahren ohne Stichprobe (`pruefen=0`): sie zaehlen
    # Ablesungen, und eine Stichprobe ist auch eine — sie wuerde die Aussage
    # verwaessern, welche Sprosse der Leiter gegriffen hat.

    # 1 — der zweite Blick loest es allein, ohne Dialog und ohne Sprung.
    b = Buehne(scfg, abgleich_schwach={3}, blick_hilft={3})
    n, *_ = fahren(b, pruefen=0)
    faelle.append(("Zweiter Blick faengt den schwachen Abgleich",
                   b.ablesungen == 0 and b.notspruenge == 0 and n > 5,
                   f"{n} Kacheln, {b.ablesungen} Ablesungen, "
                   f"{b.notspruenge} Notspruenge"))

    # 2 — der Blick hilft nicht, die Ablesung schon: kein Sprung noetig.
    b = Buehne(scfg, abgleich_schwach={3})
    n, *_ = fahren(b, pruefen=0)
    faelle.append(("Ablesung faengt, wo der Blick nicht traegt",
                   b.ablesungen == 1 and b.notspruenge == 0 and n > 5,
                   f"{n} Kacheln, {b.ablesungen} Ablesungen, "
                   f"{b.notspruenge} Notspruenge"))

    # 3 — der Fall, der bis heute die Zeile toetete: beides faellt aus.
    b = Buehne(scfg, abgleich_schwach={3}, ablesung_tot={3})
    n, *_ = fahren(b, pruefen=0)
    faelle.append(("Notsprung statt Zeilenausfall",
                   b.notspruenge == 1 and b.zoom_nachgezogen == 2 and n > 5,
                   f"{n} Kacheln, {b.notspruenge} Notsprung auf {b.spruenge[-1]}, "
                   f"Zoom {b.zoom_nachgezogen}x nachgezogen"))

    # 4 — der Dialog wirft, statt nur nichts zu liefern (X 458 am 08.09.2026).
    b = Buehne(scfg, abgleich_schwach={3}, dialog_wirft={3})
    n, *_ = fahren(b, pruefen=0)
    faelle.append(("SprungFehler beendet die Zeile nicht",
                   b.notspruenge == 1 and n > 5,
                   f"{n} Kacheln, {b.ablesungen} Ablesungen, "
                   f"{b.notspruenge} Notsprung"))

    # 5 — die Ablesung bekommt wirklich mehrere Anlaeufe, nicht nur einen.
    b = Buehne(scfg, abgleich_schwach={3}, ablesung_tot={3})
    fahren(b, pruefen=0)
    faelle.append(("Ablesung mit mehreren Anlaeufen",
                   b.ablesungen == sweep.ABLESE_VERSUCHE,
                   f"{b.ablesungen} Anlaeufe (erwartet {sweep.ABLESE_VERSUCHE})"))

    # 6 — die Grenze bleibt: dauerhaft blind heisst weiterhin Abbruch. Die Zeile
    # muss dafuer laenger sein als die Zahl der erlaubten Notspruenge.
    b = Buehne(scfg, abgleich_schwach=set(range(1, 99)),
               ablesung_tot=set(range(1, 99)))
    try:
        fahren(b, bis_x=400, pruefen=0)
        ok, wie = False, "keine Ausnahme"
    except sweep.ZeileAbgebrochen as e:
        ok, wie = b.notspruenge == sweep.NOTSPRUNG_MAX, str(e)[:60]
    faelle.append((f"Abbruch nach {sweep.NOTSPRUNG_MAX} Notspruengen", ok,
                   f"{b.notspruenge} Notspruenge — {wie}"))

    # 7 — eine dauerhaft unlesbare Stichprobe darf nicht blind weiterfahren.
    b = Buehne(scfg, dialog_wirft=set(range(1, 40)))
    try:
        fahren(b, bis_x=400, pruefen=5)
        ok, wie = False, "keine Ausnahme"
    except sweep.ZeileAbgebrochen as e:
        ok, wie = "Stichproben in Folge" in str(e), str(e)[:70]
    faelle.append(("Abbruch nach 3 blinden Stichproben", ok, wie))

    print(f"Stufe {STUFE!r}, Kachel {sweep._kachel_breite(scfg):.1f} E breit\n")
    for name, ok, wie in faelle:
        print(f"  {'ok ' if ok else 'FEHL'}  {name:44s}  {wie}")
    schlecht = [f for f in faelle if not f[1]]
    print(f"\n{len(faelle) - len(schlecht)}/{len(faelle)} bestanden.")
    return 1 if schlecht else 0


if __name__ == "__main__":
    raise SystemExit(main())
