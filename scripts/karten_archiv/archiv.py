"""Ablage des Kartenarchivs.

Drei Festlegungen, die den spaeteren Umgang bestimmen:

* **Der Dateiname ist die Kameraposition, nicht eine laufende Nummer.** Wer die
  Gegend um X:640 Y:210 auswerten will, rechnet sich die Kacheln aus, statt einen
  Index zu befragen.
* **Gespeichert wird der Zuschnitt, nicht das Vollbild.** Die HUD-Raender sind
  ohnehin unbrauchbar; das Zuschnitt-Rechteck steht im Manifest, damit
  Bildkoordinaten spaeter zurueckgerechnet werden koennen.
* **Das Modell liegt im Manifest, nicht im Auswertecode.** Wird der Massstab
  spaeter nachgeeicht, lassen sich alte Archive weiter richtig lesen.

Nach jeder Kachel wird gesichert, nicht am Ende: ein vorhandenes Kachel-JSON
heisst „fertig", ein Neustart ueberspringt sie. Ein Lauf ueber Stunden muss an
jeder Stelle abbrechbar und fortsetzbar sein.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

WURZEL = Path.home() / ".local/state/warsync/kartenarchiv"


class Archiv:
    def __init__(self, name: str, cfg: dict):
        self.pfad = WURZEL / name
        self.kacheln = self.pfad / "kacheln"
        self.kacheln.mkdir(parents=True, exist_ok=True)
        self.manifest_pfad = self.pfad / "manifest.json"
        if not self.manifest_pfad.exists():
            felder = ("skala_x", "skala_y", "versatz_x", "banner_versatz",
                      "banner_breite", "banner_hoehe", "y_modell",
                      "zoom_saettigen", "zoom_stufe", "raus_gesten",
                      "zoom_rein", "zoom_raus", "zoom_raus_gross",
                      "schritt_x", "schritt_y", "stufe")
            self.manifest_pfad.write_text(json.dumps({
                "erstellt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "aufloesung": [2560, 2560],
                "zuschnitt": cfg["karte"],
                "navigation": cfg.get("navigation", "sprung"),
                "modell": {k: cfg[k] for k in felder if k in cfg},
            }, indent=2, ensure_ascii=False))
        self.cfg = cfg

    # ── Kacheln ───────────────────────────────────────────────────────────
    def _stamm(self, x: int, y: int) -> Path:
        return self.kacheln / f"x{x:04d}_y{y:04d}"

    def fertig(self, x: int, y: int) -> bool:
        return self._stamm(x, y).with_suffix(".json").exists()

    def speichern(self, x: int, y: int, im: Image.Image, extra: dict,
                  stamm: str | None = None) -> str:
        """Eine Kachel ablegen; `stamm` ueberschreibt den Dateinamen.

        Beim Sprung ist die Kameraposition ganzzahlig und taugt als Name. Beim
        Wisch ist sie es **nicht** — sie ergibt sich aus gemessenen
        Verschiebungen und liegt zwischen den Einheiten. Der Dateiname wird
        deshalb dort aus Zeile und Spalte gebildet, die genaue Position steht im
        JSON. Sie zu runden hiesse, an genau der Stelle Genauigkeit wegzuwerfen,
        an der die Koordinatenrechnung sie braucht.
        """
        p = self.kacheln / stamm if stamm else self._stamm(int(x), int(y))
        zu = im.crop(tuple(self.cfg["karte"]))
        bild_pfad = p.with_suffix(".png")
        zu.save(bild_pfad)
        h = hashlib.sha256(bild_pfad.read_bytes()).hexdigest()[:16]
        satz = {"kamera": [round(float(x), 3), round(float(y), 3)],
                "zeit": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "hash": h, **extra}
        p.with_suffix(".json").write_text(json.dumps(satz, indent=2, ensure_ascii=False))
        return h

    def stand(self) -> int:
        return len(list(self.kacheln.glob("*.json")))

    def zeile_fertig(self, nr: int) -> bool:
        return (self.pfad / f"zeile_{nr:03d}.done").exists()

    def zeile_abschliessen(self, nr: int, satz: dict) -> None:
        """Eine Zeile als erledigt vermerken.

        Beim Wisch ist die Zeile die Einheit des Fortschritts, nicht die Kachel:
        ein Neustart mitten in der Zeile faende die Kamera nicht wieder, weil die
        Position dort aus der Kette der Verschiebungen kommt. Eine angefangene
        Zeile wird deshalb neu gefahren — sie kostet ein paar Minuten, ein
        falsch verorteter Wiedereinstieg kostet den ganzen Lauf.
        """
        (self.pfad / f"zeile_{nr:03d}.done").write_text(
            json.dumps(satz, indent=2, ensure_ascii=False))


def gitter(von: tuple[int, int], bis: tuple[int, int], cfg: dict) -> list[tuple[int, int]]:
    """Kachelmittelpunkte fuer ein Weltrechteck, zeilenweise.

    Der Schritt richtet sich nach der HUD-freien Flaeche, nicht nach der
    Bildgroesse: eine Basis unter dem HUD ist verloren und muss in der
    Nachbarkachel frei liegen.
    """
    sx, sy = cfg["schritt_x"], cfg["schritt_y"]
    xs = list(range(von[0], bis[0] + 1, sx))
    ys = list(range(von[1], bis[1] + 1, sy))
    return [(x, y) for y in ys for x in xs]
