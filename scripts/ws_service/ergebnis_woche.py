"""Beide Wüstensturm-Ergebnisse der Woche lesen und eintragen — für die Routine.

Läuft in der Nacht von Freitag auf Samstag (Routine „Wüstensturm-Ergebnisse
lesen", Samstag 04:00). Die Mails von Team A und B sind dann beide da, und
Last War löscht Mails nach 30 Tagen: wer das Nachtragen vergisst, verliert die
Woche (der 25.09.2026 ist so verloren gegangen).

Ablauf: BlueStacks frisch starten → die zwei neuesten Kampfergebnis-Mails
lesen → jede eintragen, sofern sie zur gerade vergangenen Woche gehört →
BlueStacks wieder beenden.

**Nur frische Mails werden eingetragen.** Kommt eine Mail des Freitags nicht
(Event ausgefallen, Mail verspätet), wäre die zweitneueste die der Vorwoche.
Eingetragen würde dann zwar dasselbe noch einmal — aber der Lauf meldete „ok",
während die Woche fehlt. Älter als `MAX_ALTER_TAGE` heißt deshalb: nicht
eintragen und mit Code 3 enden, damit es im Protokoll auffällt.

    .venv/bin/python -u -m scripts.ws_service.ergebnis_woche          # nur lesen
    .venv/bin/python -u -m scripts.ws_service.ergebnis_woche --schreiben
"""
from __future__ import annotations

import argparse
import subprocess
from datetime import datetime

from . import ergebnis
from .device import Geraet, GeraetFehler
from .navigate import NavigationFehler, warte_auf_spiel

MAX_ALTER_TAGE = 2
ANZAHL = 2   # Team A und Team B


def _log(msg: str) -> None:
    ergebnis._log(msg)


def _alter_tage(b: dict) -> float | None:
    try:
        return (datetime.now() - datetime.fromisoformat(b["datum"])).total_seconds() / 86400
    except (KeyError, TypeError, ValueError):
        return None


def _beenden() -> None:
    """BlueStacks nach dem Lauf schließen (Vorgabe Ben, 12.10.2026)."""
    subprocess.run(["pkill", "-f", "BlueStacks.app/Contents/MacOS/BlueStacks"], check=False)
    subprocess.run(["adb", "disconnect", "127.0.0.1:5555"], check=False,
                   capture_output=True)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--schreiben", action="store_true", help="Ergebnisse ins Tool eintragen.")
    p.add_argument("--ohne-neustart", action="store_true",
                   help="BlueStacks nicht neu starten (zum Testen am laufenden Gerät).")
    p.add_argument("--offen-lassen", action="store_true",
                   help="BlueStacks am Ende nicht beenden.")
    a = p.parse_args(argv)

    code = 0
    gesehen: set[str] = set()
    try:
        g = Geraet()
        g.starten(log=_log, neu=not a.ohne_neustart)
        if not a.ohne_neustart or not g.app_laeuft():
            g.app_starten(log=_log)
            warte_auf_spiel(g, log=_log)
        g.starten = lambda **_: None   # `ergebnis.lauf` startet sonst erneut
        for nr in range(1, ANZAHL + 1):
            _log(f"── Kampfergebnis Nr. {nr} ──")
            b = ergebnis.lauf(g, nr)
            alter = _alter_tage(b)
            if not b["liste"]:
                _log(f"Nr. {nr}: keine Zeilen gelesen.")
                code = max(code, 2)
                continue
            if b["datum"] in gesehen:
                _log(f"Nr. {nr}: dieselbe Mail wie zuvor ({b['datum']}) — übersprungen.")
                code = max(code, 3)
                continue
            gesehen.add(b["datum"])
            if alter is None or alter > MAX_ALTER_TAGE:
                _log(f"Nr. {nr}: Mail vom {b['datum']} ist nicht von dieser Woche — "
                     f"nicht eingetragen. Fehlt die Mail des Freitags?")
                code = max(code, 3)
                continue
            if a.schreiben:
                r = ergebnis.ins_tool(b, erzwingen=False)
                if r:
                    _log(f"Nr. {nr}: nicht eingetragen (Code {r}), Begründung oben.")
                    code = max(code, r)
    except (GeraetFehler, NavigationFehler, ergebnis.eintragen.EintragFehler) as e:
        _log(f"ABBRUCH: {e}")
        code = 1
    finally:
        if not a.offen_lassen:
            _log("BlueStacks beenden ...")
            _beenden()
    _log(f"Fertig, Code {code}.")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
