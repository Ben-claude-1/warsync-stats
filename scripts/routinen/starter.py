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
    GET  /skripte/<name>/laeufe          alle aufgehobenen Läufe mit Ausgang
    GET  /skripte/<name>/laeufe/<datei>  das Protokoll eines einzelnen Laufs
    POST /skripte/<name>/start startet ihn  (?von=routine für das Protokoll)
    POST /skripte/<name>/stop  bricht ihn ab

Start von Hand:
    .venv/bin/python -m scripts.routinen.starter
"""
from __future__ import annotations

import json
import os
import re
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
    "allianz-protokoll": Skript(
        name="allianz-protokoll",
        titel="Allianz-Protokoll lesen (Zu- und Abgaenge)",
        beschreibung=(
            "Liest in Last War Allianz → Verlauf → Mitglieder von neu nach alt, "
            "bis die Eintraege zum Kader passen, und traegt sie ein: Abgaenge "
            "werden stillgelegt, Rueckkehrer wieder aktiv, Raenge nachgezogen. "
            "Ersetzt den Kaderabgleich ueber LW Atlas."
        ),
        befehl=[PY, "-u", "-m", "scripts.allianz_protokoll.run", "--schreiben"],
        hinweis=(
            "Braucht BlueStacks mit Last War. Neuzugaenge, die nicht im Kader "
            "stehen, werden angelegt (seit 28.10.2026), zweifelhafte nur gemeldet."
        ),
    ),
    "ws-ergebnis": Skript(
        name="ws-ergebnis",
        titel="Wuestensturm-Ergebnisse lesen",
        beschreibung=(
            "Liest die beiden neuesten Kampfergebnis-Mails (Team A und B) aus Last "
            "War und traegt Punkte, Sieg/Niederlage und Fehlende ins Werkzeug ein. "
            "Eine Mail, die aelter als zwei Tage ist, wird nicht eingetragen — "
            "dann fehlt die des Freitags, und der Lauf endet mit Code 3."
        ),
        befehl=[PY, "-u", "-m", "scripts.ws_service.ergebnis_woche", "--schreiben"],
        hinweis=(
            "Braucht BlueStacks mit Last War; startet es frisch und beendet es am "
            "Ende wieder. Laeuft Samstag 04:00, vor dem Allianz-Protokoll um 04:30."
        ),
    ),
    "ws-anmeldung": Skript(
        name="ws-anmeldung",
        titel="Wuestensturm-Anmeldung lesen",
        beschreibung=(
            "Schlaegt jeden aktiven Kadernamen im Suchfeld der Teilnehmerliste nach, "
            "legt je Name ein Belegbild ab und schreibt die Anmeldungen ersetzend als "
            "teamAssign ins Werkzeug. Geht die Gegenprobe nicht auf, wird nichts "
            "geschrieben (Code 2); ist die Anmeldung schon zu, endet er mit Code 3."
        ),
        befehl=[PY, "-u", "-m", "scripts.ws_service.suchlauf", "--schreiben", "--routine"],
        hinweis=(
            "Braucht BlueStacks mit Last War; startet es frisch und beendet es am "
            "Ende wieder. Rund 35 Minuten. Laeuft Dienstag 04:00 und Mittwoch 19:00 "
            "— beides vor dem Anmeldeschluss Donnerstag 04:00."
        ),
    ),
    "cs-anmeldung": Skript(
        name="cs-anmeldung",
        titel="Schluchtsturm-Anmeldung lesen",
        beschreibung=(
            "Schlaegt jeden aktiven Kadernamen im Suchfeld der Schluchtsturm-"
            "Teilnehmerliste (Einsatztruppe A → Verwalten) nach, legt je Name ein "
            "Belegbild ab und schreibt die Anmeldungen als AC/BC ersetzend in "
            "csTeamAssign. Plaetze, die in dieser Woche im Werkzeug gesetzt wurden, "
            "bleiben stehen. Bei Problemen wird nichts geschrieben (Code 2)."
        ),
        befehl=[PY, "-u", "-m", "scripts.cs_service.suchlauf", "--schreiben", "--routine"],
        hinweis=(
            "Braucht BlueStacks mit Last War; startet es frisch und beendet es am "
            "Ende wieder. Rund 25 Minuten. Laeuft Montag 03:00 — vor dem "
            "Anmeldeschluss des Werkzeugs (Mo 04:00); das Spiel schliesst Di 03:00."
        ),
    ),
    # Gesamtablauf (Vorgabe Ben, 18.11.2026): Mitglieder → Anmeldung +
    # Heldenkraft → Aufstellung → Last War → zurueck ins Werkzeug. Bewusst
    # noch ohne Zeitplan — wann er laeuft, legt Ben im Hub fest.
    "ws-ablauf": Skript(
        name="ws-ablauf",
        titel="Wuestensturm komplett (Mitglieder, Anmeldung, Aufstellung, Last War)",
        beschreibung=(
            "Aktualisiert die Mitgliederliste aus dem Allianz-Protokoll, liest die "
            "Wuestensturm-Anmeldung samt Heldenkraft ins Werkzeug, rechnet die "
            "Verteilung mit der Logik des Reiters 🧮 Verteilung und stellt die Teams "
            "in Last War ein. Erst wenn dort nichts offen blieb, kommt die Einteilung "
            "ins Werkzeug zurueck. Schickt am Ende eine Pushover-Nachricht."
        ),
        befehl=[PY, "-u", "-m", "scripts.event_ablauf", "ws", "--schreiben", "--pushover"],
        hinweis=(
            "Braucht BlueStacks mit Last War; startet es frisch und beendet es am "
            "Ende. Rund eine Stunde. Muss vor dem Anmeldeschluss Do 04:00 laufen."
        ),
    ),
    "cs-ablauf": Skript(
        name="cs-ablauf",
        titel="Schluchtsturm komplett (Mitglieder, Anmeldung, Aufstellung, Last War)",
        beschreibung=(
            "Aktualisiert die Mitgliederliste aus dem Allianz-Protokoll, liest die "
            "Schluchtsturm-Anmeldung samt Heldenkraft ins Werkzeug, rechnet die "
            "Aufstellung (Rotation und Gebaeude) mit der Logik des Werkzeugs und "
            "stellt die Truppen in Last War ein. Erst wenn dort nichts offen blieb, "
            "kommen Einteilung und Gebaeude-Plaene ins Werkzeug zurueck. Pushover am Ende."
        ),
        befehl=[PY, "-u", "-m", "scripts.event_ablauf", "cs", "--schreiben", "--pushover"],
        hinweis=(
            "Braucht BlueStacks mit Last War; startet es frisch und beendet es am "
            "Ende. Rund 50 Minuten. Das Spiel schliesst die Anmeldung Di 03:00."
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
    """Der Zeiger auf das Protokoll des letzten Laufs — ein Symlink."""
    return _ordner(name) / "letzter_lauf.log"


# So viele Protokolle bleiben liegen. Ein Lauf schreibt ein paar Kilobyte.
LAEUFE_BEHALTEN = 90


def _lauf_log(name: str, zeit: datetime) -> Path:
    """Je Lauf ein eigenes Protokoll.

    **Vorher wurde `letzter_lauf.log` bei jedem Start ueberschrieben**, und
    genau das hat am 12.10.2026 die Ursache gekostet: sechs Naechte lang brach
    der VS-Scan ab, die Fehlermeldung stand jeweils bis zum naechsten Start um
    05:00 da und war danach weg. Nachzuweisen war hinterher nur noch, *dass* er
    abbrach — nicht, woran.
    """
    d = _ordner(name) / "laeufe"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{zeit:%Y%m%d_%H%M%S}.log"


def _zeiger_setzen(name: str, ziel: Path) -> None:
    link = _log_pfad(name)
    tmp = link.with_suffix(".log.neu")
    tmp.unlink(missing_ok=True)
    # Relativ, damit der Zeiger auch dann noch stimmt, wenn der Ordner
    # verschoben oder gesichert wird.
    os.symlink(Path(ziel.parent.name) / ziel.name, tmp)
    os.replace(tmp, link)


def _alte_laeufe_raeumen(name: str) -> None:
    alle = sorted((_ordner(name) / "laeufe").glob("*.log"))
    for p in alle[:-LAEUFE_BEHALTEN]:
        p.unlink(missing_ok=True)


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
    zeit = datetime.now()
    log = _lauf_log(name, zeit)
    with log.open("w") as f:
        f.write(f"# {s.titel} — gestartet {zeit:%Y-%m-%d %H:%M:%S} ({von})\n"
                f"# {' '.join(s.befehl)}\n\n")
        f.flush()
        # `start_new_session` loest den Lauf von diesem Dienst: ein Neustart des
        # Starters beendet einen laufenden Scan dann nicht mitten in der Liste.
        # **Auf BlueStacks warten statt ausfallen.** Die Sperre in
        # `ws_service/device.py` gibt sonst nach 15 s auf. Nachts liegen die
        # Routinen dicht (Di 04:00 Suchlauf ~35 min, 04:30 Allianz-Protokoll,
        # 05:00 VS) — der spaetere wartet jetzt bis zu 90 Minuten, bis der
        # vorige BlueStacks freigibt (seit 15.11.2026).
        env = {**os.environ, "WARSYNC_SPERRE_WARTEN_S": "5400"}
        p = subprocess.Popen(s.befehl, cwd=str(REPO), stdout=f,
                             stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             start_new_session=True, env=env)
    _zeiger_setzen(name, log)
    _alte_laeufe_raeumen(name)
    _stand_pfad(name).write_text(json.dumps({
        "pid": p.pid, "gestartet_at": zeit.isoformat(timespec="seconds"),
        "ausgeloest_von": von, "ergebnis": None, "log": str(log),
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
    ergebnis = "ok" if rc == 0 else f"Fehler (Code {rc})"
    _ende_vermerken(letzter.get("log"), ergebnis)
    letzter.update(beendet_at=datetime.now().isoformat(timespec="seconds"),
                   ergebnis=ergebnis)
    _stand_pfad(name).write_text(json.dumps(letzter, indent=1))


# **Der Ausgang steht im Protokoll selbst**, nicht nur in `letzter_lauf.json`.
# Die Stand-Datei kennt nur den jeweils letzten Lauf; wer im Scheduler eine
# Woche zurückblättert, braucht den Ausgang jedes einzelnen (seit 13.11.2026).
ENDE_PRAEFIX = "# Ende "


def _ende_vermerken(log: str | None, ergebnis: str) -> None:
    if not log:
        return
    try:
        with open(log, "a") as f:
            f.write(f"\n{ENDE_PRAEFIX}{datetime.now():%Y-%m-%d %H:%M:%S} — {ergebnis}\n")
    except OSError:
        pass


LAUF_DATEI = re.compile(r"^\d{8}_\d{6}\.log$")


def laeufe(name: str) -> list[dict[str, Any]]:
    """Alle aufgehobenen Läufe, neueste zuerst — mit Ausgang und Dauer."""
    d = _ordner(name) / "laeufe"
    letzter = _lesen(name)
    aktuell = Path(letzter["log"]).name if letzter.get("log") else None
    laeuft = _laeuft(letzter.get("pid"))
    out = []
    for p in sorted(d.glob("*.log"), reverse=True):
        start = datetime.strptime(p.stem, "%Y%m%d_%H%M%S")
        try:
            zeilen = p.read_text(errors="replace").splitlines()
        except OSError:
            zeilen = []
        von = None
        if zeilen and zeilen[0].startswith("# ") and zeilen[0].rstrip().endswith(")"):
            von = zeilen[0].rsplit("(", 1)[-1].rstrip(")")
        ende = next((z for z in reversed(zeilen) if z.startswith(ENDE_PRAEFIX)), None)
        if ende:
            stempel, _, ergebnis = ende[len(ENDE_PRAEFIX):].partition(" — ")
            try:
                dauer = int((datetime.strptime(stempel, "%Y-%m-%d %H:%M:%S") - start).total_seconds())
            except ValueError:
                dauer = None
        elif p.name == aktuell and laeuft:
            ergebnis, dauer = "läuft", None
        elif p.name == aktuell:
            ergebnis, dauer = letzter.get("ergebnis") or "unbekannt", None
        else:
            # Protokolle von vor dem 13.11.2026 tragen den Ausgang nicht; ein
            # „ABBRUCH" im Text ist dann die einzige Auskunft.
            abbruch = any("ABBRUCH" in z for z in zeilen)
            ergebnis, dauer = ("Fehler (laut Protokoll)" if abbruch else "unbekannt"), None
        out.append({"datei": p.name, "gestartet_at": start.isoformat(timespec="seconds"),
                    "ausgeloest_von": von, "ergebnis": ergebnis, "dauer_s": dauer,
                    "zeilen": len(zeilen)})
    return out


def lauf_protokoll(name: str, datei: str) -> list[str] | None:
    if not LAUF_DATEI.match(datei):      # kein Pfad, nur ein Dateiname
        return None
    p = _ordner(name) / "laeufe" / datei
    if not p.is_file():
        return None
    return p.read_text(errors="replace").splitlines()


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
    _ende_vermerken(letzter.get("log"), "abgebrochen")
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
        if len(teile) == 3 and teile[0] == "skripte" and teile[2] == "laeufe" \
                and teile[1] in SKRIPTE:
            return self._antwort(200, laeufe(teile[1]))
        if len(teile) == 4 and teile[0] == "skripte" and teile[2] == "laeufe" \
                and teile[1] in SKRIPTE:
            zeilen = lauf_protokoll(teile[1], teile[3])
            if zeilen is None:
                return self._antwort(404, {"fehler": "kein solcher Lauf"})
            return self._antwort(200, {"name": teile[1], "datei": teile[3], "zeilen": zeilen})
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
