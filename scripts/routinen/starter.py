"""Startet bekannte WarSync-Skripte auf Zuruf — für die Routinen im Hub.

Die Routinen des Portals (`local-ai`, „Routinen") kennen als allgemeine Aktion
nur `http`. Dieser Dienst ist die Gegenstelle dazu: er nimmt einen POST entgegen
und startet das dahinterliegende Skript.

**Es gibt keinen frei wählbaren Befehl, sondern eine Positivliste.** Der Aufruf
nennt nur den *Namen*; was ausgeführt wird, steht allein hier im Quelltext. Ein
Endpunkt, der ein beliebiges Kommando entgegennimmt, wäre eine Fernsteuerung für
jeden, der ihn erreicht.

**Gebunden wird auf 127.0.0.1**, nicht auf alle Schnittstellen. Das Portal läuft
auf demselben Rechner und kommt heran; aus dem Tailnet erreicht diesen Port
niemand. Das Portal selbst hängt dort ohne eigene Anmeldung — es ist deshalb
keine Schicht, auf die man sich verlassen sollte.

**Gestartet wird losgelöst, nicht abgewartet.** Der VS-Scan läuft eine
Viertelstunde, die `http`-Aktion einer Routine bricht nach zehn Sekunden ab. Der
Aufruf antwortet sofort mit „gestartet"; das Ergebnis steht danach im Protokoll
und unter `GET /skripte/<name>`.

**Zweimal gleichzeitig geht nicht.** Die Skripte steuern BlueStacks, und das
verträgt nur einen Bediener (`ws_service/device.py` hält dafür eine eigene
Sperre). Ein zweiter Start antwortet 409, statt eine zweite Sitzung aufzumachen.

    GET  /skripte              alle Skripte samt Stand
    GET  /skripte/<name>       Stand eines Skripts, mit den letzten Zeilen
    GET  /skripte/<name>/log   das ganze Protokoll des letzten Laufs
    POST /skripte/<name>/start startet ihn  (?von=routine für das Protokoll)
    POST /skripte/<name>/stop  bricht ihn ab

Start von Hand:
    .venv/bin/python -m scripts.routinen.starter
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

REPO = Path(__file__).resolve().parents[2]
STAND = Path.home() / ".local/state/warsync/routinen"
HOST = "127.0.0.1"
# Eingetragen in ~/.claude/PORTS.md — vor jedem neuen Dienst dort nachsehen.
PORT = int(os.environ.get("PORT", "8793"))


@dataclass(frozen=True)
class Skript:
    name: str
    titel: str
    beschreibung: str
    befehl: list[str]
    hinweis: str = ""


PY = str(REPO / ".venv/bin/python")

SKRIPTE: dict[str, Skript] = {
    "vs-tage": Skript(
        name="vs-tage",
        titel="VS-Tagespunkte lesen",
        beschreibung=(
            "Liest im Allianzduell den Tagesrang je Wochentag aus Last War und "
            "traegt die Punkte je Spieler ins Werkzeug ein. Bereits vollstaendig "
            "gelesene, abgeschlossene Tage werden uebersprungen — es laeuft also "
            "meist nur der gestrige und der laufende Tag."
        ),
        befehl=[PY, "-u", "-m", "scripts.vs_service.run", "--schreiben", "--nur-fehlende"],
        hinweis=(
            "Braucht BlueStacks mit Last War. Laeuft das Spiel gerade auf einem "
            "anderen Geraet, meldet es das beim Start — der Lauf bricht dann ab, "
            "statt die Sitzung zu uebernehmen."
        ),
    ),
    # **Ein Eintrag, der nichts anfasst.** Die Kette Hub → Routine → Starter →
    # Prozess laesst sich sonst nur pruefen, indem man einen echten Scan
    # startet — und der faehrt zehn Minuten durch Last War. Der Selbsttest
    # beantwortet dieselbe Frage in einer Sekunde und beruehrt weder BlueStacks
    # noch die Datenbank.
    "selbsttest": Skript(
        name="selbsttest",
        titel="Selbsttest",
        beschreibung=("Schreibt nur eine Zeile ins Protokoll. Damit laesst sich pruefen, "
                      "ob eine Routine den Starter erreicht, ohne einen echten Scan zu fahren."),
        befehl=[PY, "-c",
                "import datetime,sys;"
                "print('Selbsttest ok —', datetime.datetime.now().isoformat(timespec='seconds'));"
                "print('Python:', sys.version.split()[0])"],
        hinweis="Beruehrt weder BlueStacks noch die Datenbank.",
    ),
}


# ── Zustand eines Laufs ──────────────────────────────────────────────────
def _ordner(name: str) -> Path:
    d = STAND / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def _log_pfad(name: str) -> Path:
    return _ordner(name) / "letzter_lauf.log"


def _stand_pfad(name: str) -> Path:
    return _ordner(name) / "letzter_lauf.json"


def _lesen(name: str) -> dict[str, Any]:
    p = _stand_pfad(name)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {}


def _laeuft(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    return True


def protokoll(name: str, zeilen: int | None = None) -> list[str]:
    p = _log_pfad(name)
    if not p.exists():
        return []
    try:
        alle = p.read_text(errors="replace").splitlines()
    except OSError:
        return []
    return alle if zeilen is None else alle[-zeilen:]


def stand(name: str) -> dict[str, Any]:
    s = SKRIPTE[name]
    letzter = _lesen(name)
    laeuft = _laeuft(letzter.get("pid"))
    return {
        "name": s.name,
        "titel": s.titel,
        "beschreibung": s.beschreibung,
        "hinweis": s.hinweis,
        "befehl": " ".join(s.befehl),
        "laeuft": laeuft,
        "pid": letzter.get("pid") if laeuft else None,
        "gestartet_at": letzter.get("gestartet_at"),
        "ausgeloest_von": letzter.get("ausgeloest_von"),
        # Der Ausgang steht erst fest, wenn der Prozess weg ist — vorher waere
        # jede Angabe dazu geraten.
        "ergebnis": None if laeuft else letzter.get("ergebnis"),
        "log": str(_log_pfad(name)),
        "letzte_zeilen": protokoll(name, zeilen=8),
    }


def starten(name: str, von: str = "manuell") -> dict[str, Any]:
    s = SKRIPTE[name]
    if stand(name)["laeuft"]:
        raise RuntimeError(
            f"'{name}' laeuft bereits seit {stand(name)['gestartet_at']}")
    log = _log_pfad(name)
    with log.open("w") as f:
        f.write(f"# {s.titel} — gestartet {datetime.now():%Y-%m-%d %H:%M:%S} ({von})\n"
                f"# {' '.join(s.befehl)}\n\n")
        f.flush()
        # `start_new_session` loest den Lauf von diesem Dienst: ein Neustart des
        # Starters beendet einen laufenden Scan dann nicht mitten in der Liste.
        p = subprocess.Popen(s.befehl, cwd=str(REPO), stdout=f,
                             stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             start_new_session=True)
    _stand_pfad(name).write_text(json.dumps({
        "pid": p.pid, "gestartet_at": datetime.now().isoformat(timespec="seconds"),
        "ausgeloest_von": von, "ergebnis": None,
    }, indent=1))
    threading.Thread(target=_abwarten, args=(name, p), daemon=True).start()
    return {"gestartet": True, "name": name, "pid": p.pid, "log": str(log)}


def _abwarten(name: str, p: subprocess.Popen) -> None:
    """Auf das Ende warten, den Ausgang festhalten — und das Kind abholen.

    **Ohne das bliebe jeder fertige Lauf ein Zombie.** Ein beendetes Kind
    verschwindet erst, wenn der Vater es abholt; bis dahin gelingt `os.kill(pid, 0)`
    weiterhin, und der Starter haelt es fuer laufend. Der naechste Start bekaeme
    dann fuer immer eine 409 — aufgefallen am 17.09.2026 beim ersten Selbsttest.
    Nebenbei steht damit der Rueckgabewert fest statt nur „fertig".
    """
    rc = p.wait()
    letzter = _lesen(name)
    if letzter.get("pid") != p.pid:
        return                     # inzwischen laeuft ein neuerer Lauf
    letzter.update(beendet_at=datetime.now().isoformat(timespec="seconds"),
                   ergebnis="ok" if rc == 0 else f"Fehler (Code {rc})")
    _stand_pfad(name).write_text(json.dumps(letzter, indent=1))


def abbrechen(name: str) -> dict[str, Any]:
    """Die ganze Prozessgruppe beenden, nicht nur den Vater.

    Der Scan startet Hilfsprozesse (adb, die Texterkennung als Dienst). Nur den
    Python-Prozess zu beenden liesse sie als Waisen zurueck.
    """
    letzter = _lesen(name)
    pid = letzter.get("pid")
    if not _laeuft(pid):
        return {"beendet": False, "grund": "laeuft nicht"}
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError) as e:
        return {"beendet": False, "grund": str(e)}
    letzter.update(ergebnis="abgebrochen",
                   beendet_at=datetime.now().isoformat(timespec="seconds"))
    _stand_pfad(name).write_text(json.dumps(letzter, indent=1))
    return {"beendet": True, "pid": pid}


# ── HTTP ─────────────────────────────────────────────────────────────────
class Griff(BaseHTTPRequestHandler):
    server_version = "WarSyncRoutinen/1.0"

    def _antwort(self, code: int, rumpf: Any) -> None:
        roh = json.dumps(rumpf, ensure_ascii=False, indent=1).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(roh)))
        self.end_headers()
        self.wfile.write(roh)

    def _teile(self) -> tuple[list[str], dict[str, list[str]]]:
        u = urlparse(self.path)
        return [t for t in u.path.split("/") if t], parse_qs(u.query)

    def do_GET(self) -> None:  # noqa: N802
        teile, _q = self._teile()
        if not teile or teile == ["skripte"]:
            return self._antwort(200, [stand(n) for n in sorted(SKRIPTE)])
        if len(teile) == 2 and teile[0] == "skripte" and teile[1] in SKRIPTE:
            return self._antwort(200, stand(teile[1]))
        if len(teile) == 3 and teile[0] == "skripte" and teile[2] == "log" \
                and teile[1] in SKRIPTE:
            return self._antwort(200, {"name": teile[1], "zeilen": protokoll(teile[1])})
        return self._antwort(404, {"fehler": "unbekannt", "pfad": self.path})

    def do_POST(self) -> None:  # noqa: N802
        teile, q = self._teile()
        if len(teile) == 3 and teile[0] == "skripte" and teile[1] in SKRIPTE:
            name, was = teile[1], teile[2]
            if was == "start":
                try:
                    return self._antwort(202, starten(name, von=q.get("von", ["manuell"])[0]))
                except RuntimeError as e:
                    # 409 und nicht 500: „laeuft schon" ist kein Fehler des
                    # Aufrufers, sondern eine Auskunft ueber den Zustand.
                    return self._antwort(409, {"fehler": str(e), **stand(name)})
            if was == "stop":
                return self._antwort(200, abbrechen(name))
        return self._antwort(404, {"fehler": "unbekannt", "pfad": self.path})

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[{datetime.now():%H:%M:%S}] {fmt % args}\n")


def main() -> int:
    STAND.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer((HOST, PORT), Griff)
    print(f"Routinen-Starter auf http://{HOST}:{PORT} — "
          f"{len(SKRIPTE)} Skript(e): {', '.join(sorted(SKRIPTE))}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
