"""Zugang zu api.lwatlas.com — mit Blick auf das Kontingent.

Der Schluessel liegt **ausserhalb des Repos** in `~/.config/warsync/lwatlas.env`
(Rechte 600). Er wurde einmalig per E-Mail zugestellt und ist nicht
wiederherstellbar; die Website zeigt nur eine gekuerzte Vorschau.

**Das Kontingent ist die knappe Ressource, nicht die Zeit.** Die kostenlose Stufe
hat 10.000 Anfragen je 30 Tage — die Mitgliederlisten aller rund 110 Allianzen
eines Servers kosten schon 110 davon. Deshalb zaehlt `Zugang` bei jeder Antwort
mit, was die Kopfzeilen melden, und bricht ab, **bevor** der Vorrat aufgebraucht
ist (`RESERVE`): ein leeres Kontingent legt auch den taeglichen Kartenabruf
lahm, und es fuellt sich erst zum Stichtag wieder auf.

Der Burst von 60 Anfragen je Minute wird eingehalten, indem zwischen zwei
Anfragen mindestens `ABSTAND_S` liegt. Das ist billiger als ein 429 mit
`Retry-After`, und es hoert sich fuer die Gegenseite nicht wie ein Angriff an.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

BASIS = "https://api.lwatlas.com/v1"
SCHLUESSEL_DATEI = Path.home() / ".config/warsync/lwatlas.env"
CACHE = Path.home() / ".local/state/warsync/lwatlas/cache"

RESERVE = 500      # so viele Anfragen bleiben unangetastet
ABSTAND_S = 1.1    # 60/min ist die Grenze, 55/min der Gang
WARNUNG_AB = 0.25  # unter einem Viertel Restkontingent wird gewarnt


class KontingentKnapp(RuntimeError):
    """Der Vorrat reicht nicht mehr — lieber nichts tun als alles verbrauchen."""


def _schluessel() -> str:
    if os.environ.get("LWATLAS_KEY"):
        return os.environ["LWATLAS_KEY"]
    if not SCHLUESSEL_DATEI.exists():
        raise RuntimeError(
            f"Kein Schluessel. Erwartet in {SCHLUESSEL_DATEI} als LWATLAS_KEY=…")
    for zeile in SCHLUESSEL_DATEI.read_text().splitlines():
        if zeile.startswith("LWATLAS_KEY="):
            return zeile.split("=", 1)[1].strip()
    raise RuntimeError(f"LWATLAS_KEY steht nicht in {SCHLUESSEL_DATEI}")


class Zugang:
    def __init__(self, still: bool = False):
        self._key = _schluessel()
        self._zuletzt = 0.0
        self.still = still
        self.anfragen = 0
        self.rest = None          # X-Quota-Remaining der letzten Antwort
        self.grenze = None
        self.start_rest = None

    def _warten(self) -> None:
        pause = ABSTAND_S - (time.monotonic() - self._zuletzt)
        if pause > 0:
            time.sleep(pause)
        self._zuletzt = time.monotonic()

    def _kontingent_merken(self, kopf) -> None:
        rest, grenze = kopf.get("X-Quota-Remaining"), kopf.get("X-Quota-Limit")
        if rest is None:
            return
        self.rest, self.grenze = int(rest), int(grenze or 0)
        if self.start_rest is None:
            self.start_rest = self.rest
        if self.rest <= RESERVE:
            raise KontingentKnapp(
                f"Nur noch {self.rest} Anfragen frei (Reserve {RESERVE}) — abgebrochen.")

    def hole(self, pfad: str, cache_h: float = 0.0) -> dict:
        """`cache_h` > 0: eine hinterlegte Antwort dieses Alters gilt als frisch.

        Ein misslungener Schreibvorgang soll nicht noch einmal achtzig Anfragen
        kosten — das Kontingent fuellt sich erst zum Stichtag wieder auf.
        """
        ablage = CACHE / (pfad.strip("/").replace("/", "_") + ".json")
        if cache_h and ablage.exists():
            alter_h = (time.time() - ablage.stat().st_mtime) / 3600
            if alter_h < cache_h:
                return json.loads(ablage.read_text())
        self._warten()
        req = urllib.request.Request(
            f"{BASIS}/{pfad.lstrip('/')}",
            headers={"X-Api-Key": self._key, "Accept": "application/json",
                     # Cloudflare weist die Python-Kennung mit 403 ab, bevor die
                     # API sie ueberhaupt sieht.
                     "User-Agent": "WarSyncStats/1.0 (+https://github.com/Ben-claude-1/warsync-stats)"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                roh, kopf = r.read(), r.headers
        except urllib.error.HTTPError as e:
            if e.code == 429:
                raise KontingentKnapp(
                    f"429 vom Server: {e.read()[:200].decode('utf-8', 'replace')}") from e
            raise
        self.anfragen += 1
        self._kontingent_merken(kopf)
        CACHE.mkdir(parents=True, exist_ok=True)
        ablage.write_bytes(roh)
        return json.loads(roh)

    def bericht(self) -> str:
        if self.rest is None:
            return f"{self.anfragen} Anfragen"
        verbraucht = (self.start_rest - self.rest) if self.start_rest else self.anfragen
        anteil = self.rest / self.grenze if self.grenze else 1.0
        text = (f"{self.anfragen} Anfragen · Kontingent {self.rest}/{self.grenze} frei "
                f"({anteil:.0%}), dieser Lauf kostete {verbraucht}")
        if anteil < WARNUNG_AB:
            text += "  ⚠ wird knapp"
        return text

    def reicht_fuer(self, anzahl: int) -> bool:
        """Vor einem groesseren Vorhaben fragen, statt mittendrin abzubrechen."""
        return self.rest is None or self.rest - anzahl > RESERVE
