"""Gesamtablauf je Event: Mitglieder → Anmeldung + Heldenkraft → Aufstellung → Last War.

    .venv/bin/python -u -m scripts.event_ablauf ws               # Trockenlauf
    .venv/bin/python -u -m scripts.event_ablauf ws --schreiben   # ernst
    .venv/bin/python -u -m scripts.event_ablauf cs --schreiben --pushover

Vorgabe Ben, 18.11.2026: „Das Skript fuer Wuestensturm und Schluchtsturm soll
jeweils auslesen, ins Tool eintragen, auch die Kampfkraft analysieren und ins
Tool uebertragen. Danach die Aufstellung berechnen und dann die Teams in Last
War zuweisen. Am Anfang des Skripts soll die Mitgliederliste aktualisiert und
im Tool eingetragen werden."

Der Ablauf **baut nichts nach**, er ruft die vorhandenen Dienste nacheinander:

1. **Mitgliederliste** — `allianz_protokoll.run --neustart` (Zu-/Abgaenge,
   Rang; Neuzugaenge werden angelegt). BlueStacks startet dabei frisch. Geht
   das schief, laeuft der Rest trotzdem weiter: der Kader ist dann der vom
   letzten Lauf, und die Pushover-Nachricht sagt das.
2. **Anmeldung + Heldenkraft** — der Suchlauf des Events schlaegt jeden
   Kadernamen nach, schreibt `teamAssign`/`csTeamAssign` (nur AC/BC/ABC) und
   die Heldenkraft. Meldet er Probleme, **endet der Ablauf hier**: eine
   Aufstellung aus einer halb gelesenen Anmeldung waere eine falsche.
3. **Aufstellung** — mit der Logik des Werkzeugs, headless:
   `zuteilung_plan.mjs` (WS, Reiter 🧮 Verteilung) bzw. `cs_plan.mjs`
   (CS, `csRosterGroups` + Auto-Verteilung der Gebaeude).
4. **Last War** — der Einsteller des Events mit genau diesem Plan.
5. **Zurueck ins Werkzeug** — erst wenn im Spiel **nichts offen** blieb, wird
   die Einteilung (A/AE/B/BE) ins Werkzeug geschrieben, beim CS samt der
   Gebaeude-Plaene. Vorher eine Sicherung. Blieb etwas offen, bleibt das
   Werkzeug beim Stand nach dem Suchlauf, und die Nachricht nennt die Namen.

Ohne `--schreiben` ist jeder Schritt ein Trockenlauf (nichts geschrieben,
nichts angetippt). Am Ende wird BlueStacks beendet.

Exit-Codes: 0 alles gesetzt · 2 fertig, aber etwas offen/Probleme · 1 Abbruch.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PY = str(WURZEL / ".venv" / "bin" / "python")
STAND = Path.home() / ".local" / "state" / "warsync" / "event_ablauf"
NAME = {"ws": "Wüstensturm", "cs": "Schluchtsturm"}
BERICHTE = {"ws": Path.home() / ".local/state/warsync/ws_service",
            "cs": Path.home() / ".local/state/warsync/cs_service"}


def _log(msg: str = "") -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def _schritt(titel: str) -> None:
    print(flush=True)
    _log(f"══ {titel} ══")


def _modul(args: list[str]) -> int:
    """Einen Dienst als eigenen Prozess — mit sichtbarer Ausgabe, ohne Pipe."""
    _log("$ " + " ".join(["python -m", *args]))
    return subprocess.run([PY, "-u", "-m", *args], cwd=WURZEL, check=False).returncode


def _neuester_bericht(event: str, seit: float) -> dict | None:
    kandidaten = [p for p in BERICHTE[event].glob("suche_*/bericht.json")
                  if p.stat().st_mtime >= seit]
    if not kandidaten:
        return None
    return json.loads(max(kandidaten, key=lambda p: p.stat().st_mtime).read_text())


def pushover(titel: str, text: str) -> None:
    """Ueber claude_handoff — die Zugangsdaten liest es selbst aus der Datei."""
    pfad = Path("/Users/ben/.local/share/claude-handoff/bin/claude_handoff.py")
    try:
        spec = importlib.util.spec_from_file_location("claude_handoff", pfad)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.pushover_notify(titel, text[:1000])
        _log("Pushover gesendet.")
    except Exception as e:  # Benachrichtigung darf den Ablauf nicht kippen
        _log(f"Pushover fehlgeschlagen: {e}")


def plan_rechnen(event: str, tag: str, ziel: Path) -> dict:
    skript = "scripts/zuteilung_plan.mjs" if event == "ws" else "scripts/cs_plan.mjs"
    _log(f"$ node {skript} {tag}")
    roh = subprocess.run(["node", skript, tag], cwd=WURZEL, capture_output=True, text=True,
                         check=False)
    if roh.returncode != 0:
        raise RuntimeError(f"{skript} fehlgeschlagen:\n{roh.stderr.strip()[-1500:]}")
    plan = json.loads(roh.stdout)
    ziel.write_text(json.dumps(plan, ensure_ascii=False, indent=1))
    _log(f"Plan: {ziel}")
    return plan


def plan_zeigen(event: str, plan: dict) -> list[str]:
    zeilen = []
    for t, d in plan["teams"].items():
        if event == "ws":
            ges, ers = [m["name"] for m in d["gesetzt"]], [m["name"] for m in d["ersatz"]]
        else:
            ges, ers = d["fest"] + d["rotationHaupt"], d["ersatz"]
        zeilen.append(f"Team {t}: {len(ges)}/20 gesetzt, {len(ers)}/10 Ersatz")
        _log(zeilen[-1])
        _log(f"  gesetzt: {' · '.join(ges)}")
        _log(f"  Ersatz : {' · '.join(ers) or '—'}")
    if plan.get("offen"):
        _log(f"  OFFEN im Plan: {', '.join(o.get('name', str(o)) for o in plan['offen'])}")
    return zeilen


def einstellen(event: str, plan: dict, schreiben: bool) -> tuple[int, list[str]]:
    """Den Einsteller im selben Prozess — nur so kommt sein Bericht zurueck."""
    from scripts.ws_service import einstellen as ws_einst
    from scripts.ws_service import roster as ws_roster
    from scripts.ws_service.device import Geraet, GeraetFehler
    from scripts.ws_service.navigate import NavigationFehler
    fehler = [ws_einst.EinstellFehler, NavigationFehler, GeraetFehler, ws_roster.ScanFehler]
    try:
        if event == "ws":
            g = Geraet()
        else:
            from scripts.cs_service import einstellen as cs_einst
            from scripts.cs_service import roster as cs_roster
            from scripts.cs_service.suchlauf import CONFIG as CS_CONFIG
            fehler.append(cs_roster.MusterAbweichung)
            g = Geraet(json.loads(CS_CONFIG.read_text()))
            cs_einst.einrichten(g)
        # Laeuft BlueStacks nicht schon vom Suchlauf her (`--ohne-suchlauf`),
        # startet `lauf` es kalt und sucht sofort die Hauptkarte — am 18.11.2026
        # um 02:17 kam der Abbruch nach acht Sekunden, Last War lud noch.
        # Darum hier hochfahren und warten, bis das Spiel etwas zeigt.
        from scripts.ws_service import navigate as ws_nav
        g.starten(log=_log)
        g.app_starten(log=_log)
        ws_nav.warte_auf_spiel(g, log=_log)
        g.starten = lambda **_: None
        ws_einst.LETZTE_BERICHTE = None
        rc = ws_einst.lauf(g, ["A", "B"], plan, schreiben=schreiben, max_klicks=200,
                           durchgaenge=5, bilder=False, ueber_suche=True)
    except ws_einst.Genug as e:
        _log(str(e))
        return 1, [f"Tipp-Grenze erreicht: {e}"]
    except getattr(ws_einst, "AnmeldungGeschlossen", ()) as e:
        _log(f"Anmeldung geschlossen: {e}")
        return 1, [f"Anmeldung geschlossen: {e}"]
    except tuple(fehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1, [f"Abbruch: {e}"]
    offen = [o for b in (ws_einst.LETZTE_BERICHTE or []) for o in b.get("offen", [])]
    if ws_einst.LETZTE_BERICHTE is None:
        offen = ["kein Bericht vom Einsteller"]
    return rc, offen


def zurueckschreiben(event: str, plan: dict) -> str:
    """Die im Spiel gesetzte Einteilung ins Werkzeug — mit Sicherung davor."""
    if event == "ws":
        from scripts.ws_service import tool
        aid = tool.allianz_id(plan["tag"])
        sicherung = tool.sicherung_schreiben(aid, BERICHTE["ws"] / "sicherungen")
        tool.schreibe_teamassign(aid, plan["soll"])
        return f"teamAssign geschrieben ({len(plan['soll'])}), Sicherung {sicherung.name}"
    from scripts.cs_service import tool
    from scripts.ws_service.tool import _anfrage
    aid = tool.allianz_id(plan["tag"])
    sicherung = tool.sicherung_schreiben(aid, BERICHTE["cs"] / "sicherungen")
    # **Ein** Schreibzugriff fuer Einteilung, Gebaeude-Plaene und Schalter —
    # zwei hintereinander liessen dazwischen einen halben Stand stehen, den
    # ein offener Browser-Tab genau dann abholen koennte.
    stand = tool.planungsstand(aid)
    stand["csTeamAssign"] = plan["soll"]
    jetzt = datetime.now(timezone.utc)
    stand["savedAt"] = jetzt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{jetzt.microsecond // 1000:03d}Z"
    stand["csPlanA"] = plan["teams"]["A"]["plan"]
    stand["csPlanB"] = plan["teams"]["B"]["plan"]
    if not plan.get("anmeldungGeschlossen"):
        # Rest der Vorwoche: sonst zeigte das Werkzeug weiter die eingefrorene
        # Aufstellung des vergangenen Events statt der eben gesetzten.
        stand["csAnmeldungClosed"] = False
    _anfrage(f"ws_planner_state?alliance_id=eq.{aid}&key=eq.cs",
             methode="PATCH", rumpf={"data": stand}, prefer="return=minimal")
    return (f"csTeamAssign ({len(plan['soll'])}) + Gebaeude-Plaene geschrieben, "
            f"Sicherung {sicherung.name}")


def bluestacks_beenden() -> None:
    _log("BlueStacks beenden ...")
    subprocess.run(["pkill", "-f", "BlueStacks.app/Contents/MacOS/BlueStacks"], check=False)
    subprocess.run(["adb", "disconnect", "127.0.0.1:5555"], check=False, capture_output=True)


def ablauf(event: str, schreiben: bool, mitglieder: bool, in_spiel: bool,
           suchen: bool = True) -> tuple[int, list[str]]:
    tag = json.loads((WURZEL / "scripts/ws_service/config.json").read_text())["alliance_tag"]
    stempel = datetime.now().strftime("%Y%m%d_%H%M%S")
    STAND.mkdir(parents=True, exist_ok=True)
    nachricht: list[str] = []
    w = ["--schreiben"] if schreiben else []
    if not schreiben:
        nachricht.append("TROCKENLAUF")

    # 1 ── Mitgliederliste ──────────────────────────────────────────────
    if mitglieder:
        _schritt("1/5 Mitgliederliste (Allianz-Protokoll)")
        rc = _modul(["scripts.allianz_protokoll.run", "--neustart", *w])
        if rc == 0:
            nachricht.append("Mitgliederliste aktualisiert")
        else:
            nachricht.append(f"⚠ Mitgliederliste NICHT aktualisiert (rc {rc})")
            _log("Weiter mit dem bisherigen Kader.")
    else:
        _schritt("1/5 Mitgliederliste — übersprungen")

    # 2 ── Anmeldung + Heldenkraft ──────────────────────────────────────
    if not suchen:
        # Die Anmeldung steht schon im Werkzeug — von Hand nachgetragen oder aus
        # einem Suchlauf, der nur an einem einzelnen Namen scheiterte (18.11.2026:
        # Sewo44, Suchfeld las 'Sewolhl').
        _schritt("2/5 Anmeldung — übersprungen, Stand im Werkzeug gilt")
        nachricht.append("Anmeldung: Stand im Werkzeug (Suchlauf ausgelassen)")
    else:
        _schritt(f"2/5 Anmeldung {NAME[event]} + Heldenkraft (Suchlauf)")
        seit = datetime.now().timestamp()
        modul = "scripts.ws_service.suchlauf" if event == "ws" else "scripts.cs_service.suchlauf"
        # WS: nur die Anmeldung nach dem Zeit-Balken — die Plaetze im Spiel sind
        # die Einteilung vom vorigen Mal (18.11.2026: Narddiggity/FLY1984).
        extra = ["--nur-anmeldung"] if event == "ws" else []
        rc = _modul([modul, *w, *extra])
        bericht = _neuester_bericht(event, seit) or {}
        hk = len(bericht.get("heldenkraft") or {})
        vert = bericht.get("verteilung") or {}
        if not vert and bericht.get("zuordnung"):
            from collections import Counter
            vert = dict(Counter(bericht["zuordnung"].values()))
        if rc != 0:
            grund = {2: "Probleme — nicht geschrieben", 3: "Anmeldung im Spiel geschlossen"}.get(
                rc, f"Abbruch (rc {rc})")
            nachricht.append(f"✖ Suchlauf: {grund}")
            for p in bericht.get("probleme") or []:
                nachricht.append(f"  · {p}")
            for k in ("unsicher", "nicht_gefunden"):
                if bericht.get(k):
                    nachricht.append(f"  {k}: {', '.join(bericht[k])}")
            nachricht.append("Aufstellung und Last War NICHT angefasst.")
            return 1, nachricht
        nachricht.append(f"Anmeldung gelesen: {dict(sorted(vert.items()))}, "
                         f"Heldenkraft {hk} aktualisiert")
        if bericht.get("nicht_gefunden"):
            nachricht.append(f"  im Spiel nicht gefunden: {', '.join(bericht['nicht_gefunden'])}")

    # 3 ── Aufstellung ───────────────────────────────────────────────────
    _schritt("3/5 Aufstellung berechnen (Logik des Werkzeugs, headless)")
    plan = plan_rechnen(event, tag, STAND / f"plan_{event}_{stempel}.json")
    nachricht += plan_zeigen(event, plan)
    if plan.get("abgewieseneSchreibzugriffe"):
        _log(f"(abgewiesene Schreibzugriffe der Rechnung: "
             f"{', '.join(plan['abgewieseneSchreibzugriffe'])} — gewollt)")

    if not in_spiel:
        _schritt("4/5 Last War — übersprungen (--ohne-spiel)")
        return 0, nachricht

    # 4 ── Last War ──────────────────────────────────────────────────────
    _schritt("4/5 Teams in Last War zuweisen")
    rc, offen = einstellen(event, plan, schreiben)
    if rc != 0 or offen:
        nachricht.append(f"✖ Last War: {len(offen)} offen" if rc == 0 else "✖ Last War: Abbruch")
        nachricht += [f"  · {o}" for o in offen[:15]]
        nachricht.append("Werkzeug bleibt beim Stand nach dem Suchlauf.")
        return 2, nachricht
    nachricht.append("Last War: alle Plätze gesetzt" + ("" if schreiben else " (trocken)"))

    # 5 ── zurück ins Werkzeug ──────────────────────────────────────────
    _schritt("5/5 Einteilung ins Werkzeug")
    if schreiben:
        nachricht.append(zurueckschreiben(event, plan))
        _log(nachricht[-1])
    else:
        _log("Trockenlauf — nichts geschrieben.")
    return 0, nachricht


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("event", choices=["ws", "cs"])
    p.add_argument("--schreiben", action="store_true",
                   help="ernst machen: ins Tool schreiben und im Spiel tippen")
    p.add_argument("--ohne-mitglieder", action="store_true",
                   help="Schritt 1 (Allianz-Protokoll) auslassen")
    p.add_argument("--ohne-suchlauf", action="store_true",
                   help="Schritt 2 auslassen: die Anmeldung im Werkzeug gilt")
    p.add_argument("--ohne-spiel", action="store_true",
                   help="nach der Aufstellung aufhoeren (Last War nicht anfassen)")
    p.add_argument("--pushover", action="store_true", help="am Ende Pushover schicken")
    p.add_argument("--bluestacks-lassen", action="store_true",
                   help="BlueStacks am Ende nicht beenden")
    a = p.parse_args(argv)

    # Der Mac darf waehrend des Laufs nicht schlafen; caffeinate endet mit uns.
    koffein = subprocess.Popen(["caffeinate", "-d", "-i", "-s", "-u", "-w", str(os.getpid())])
    beginn = datetime.now()
    _log(f"{NAME[a.event]}: Gesamtablauf {'(SCHREIBEN)' if a.schreiben else '(Trockenlauf)'}")
    try:
        rc, nachricht = ablauf(a.event, a.schreiben, not a.ohne_mitglieder, not a.ohne_spiel,
                              suchen=not a.ohne_suchlauf)
    except Exception as e:
        traceback.print_exc()
        rc, nachricht = 1, [f"✖ Fehler: {e}"]
    finally:
        if not a.bluestacks_lassen:
            bluestacks_beenden()
        koffein.terminate()
    dauer = int((datetime.now() - beginn).total_seconds() // 60)
    titel = f"{NAME[a.event]}: " + ("fertig" if rc == 0 else "unvollständig" if rc == 2
                                    else "abgebrochen") + f" ({dauer} min)"
    print(flush=True)
    _log(titel)
    for z in nachricht:
        _log("  " + z)
    if a.pushover:
        pushover(titel, "\n".join(nachricht))
    return rc


if __name__ == "__main__":
    sys.exit(main())
