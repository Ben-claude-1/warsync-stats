"""Schluchtsturm: jeden Kadernamen einzeln im Suchfeld nachschlagen — und belegen.

    .venv/bin/python -m scripts.cs_service.suchlauf
    .venv/bin/python -m scripts.cs_service.suchlauf --namen "Ben_the_men" "Puwe"
    .venv/bin/python -m scripts.cs_service.suchlauf --schreiben
    .venv/bin/python -m scripts.cs_service.suchlauf --schreiben --routine   # Hub, Mo 03:00

Das Gegenstueck zu `scripts/ws_service/suchlauf.py` (seit 15.11.2026). Der
Scroll-Lauf (`run.py`) haengt an derselben Liste wie beim Wuestensturm und damit
am selben Scroll-Haenger; das Suchfeld „Mitglieder suchen" gibt es im
CS-Dialog genauso, und es zeigt je Name genau eine Zeile.

Der Weg: Events → Reiter „Schluchtsturm" → Einsatztruppe A → „Verwalten".
**Truppe A genuegt** — gesucht wird ueber alle Mitglieder, nicht nur ueber die
Bewerber einer Truppe.

Was eine Zeile sagt (live am 15.11.2026 an `Ben the men` gesehen):

- **Zeit-Balken** („Lokale Zeit: 2026-11-19 15:00 ~ 15:30") = angemeldet. Wer
  beide Zeiten waehlt, zeigt die Balken abwechselnd (gruen/orange), genau wie
  beim Wuestensturm. Kein Balken = nicht angemeldet.
- **Rotes Feld „Bitte um Einsatz fuer Truppe [A]"** = Wunsch Truppe A. Es
  erscheint nur auf dem Bildschirm der *geoeffneten* Truppe; ein Angemeldeter
  ohne das Feld hat demnach Truppe B gewuenscht (siehe `cs_service/__init__.py`).
- **Gesetzt-/Ersatz-Feld** rechts: Buchstabe der Truppe, in die das Spiel ihn
  schon eingeteilt hat — unabhaengig von der geoeffneten Truppe. Schlaegt den
  Wunsch.

Geschrieben werden nur `AC`/`BC` (Regel „Scan ohne Teams", wie beim WS). Wer
im Tool schon einen Platz derselben Truppe hat (`A`/`AE` bzw. `B`/`BE`, von
Hand gesetzt), **behaelt ihn** — sonst loeschte der Montagslauf die Ersatzwahl
der R4 eine Stunde vor dem Anmeldeschluss des Tools (Mo 04:00). Das gilt nur,
wenn der Stand in dieser Anmeldewoche gespeichert wurde (ab Di 03:00); ein
aelterer ist die Einteilung eines vergangenen Kampfes. Wer nicht angemeldet
ist, faellt heraus.

Exit-Codes wie beim WS-Suchlauf: 0 ok, 1 Abbruch, 2 Probleme (nicht geschrieben).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

from scripts.ws_service import belege, match
from scripts.ws_service import navigate as ws_nav
from scripts.ws_service import roster as ws_roster
from scripts.ws_service import suchlauf as ws_such
from scripts.ws_service import tool as ws_tool
from scripts.ws_service.device import Geraet, GeraetFehler
from scripts.ws_service.navigate import NavigationFehler

from . import navigate, roster, tool

BERICHTE = Path.home() / ".local" / "state" / "warsync" / "cs_service"
CONFIG = Path(__file__).resolve().parent / "config.json"

# Der CS-Dialog hat ueber dem Zaehler-Block das Auswahlfeld „Zeit auswaehlen";
# das Suchfeld sitzt deshalb tiefer als beim WS. Gemessen 15.11.2026: der Name
# im Feld steht bei y≈1040, beim WS bei y≈955. Mit diesem Versatz treffen
# `feld_text` und der Rueckfall-Tipp von `ws_such.suchfeld` das Feld.
SUCHFELD_VERSATZ = 85

_log = ws_such._log


def _proben(g: Geraet, sammler: belege.Sammler) -> list[dict]:
    """Wie `ws_suchlauf._proben`, nur mit der CS-Zeile (Wunsch-Feld statt Abzeichen).

    So lange hinsehen, wie ein Balkenwechsel dauert, und je Balkenfarbe eine
    Zeile behalten. Ohne Balken wird am Trennstreifen geankert — der Beleg fuer
    „nicht angemeldet".
    """
    gesehen: dict[str | None, dict] = {}
    erster_balken = None
    ohne_balken = 0
    beginn = time.monotonic()
    while True:
        bild = g.bild()
        jetzt = time.monotonic()
        koepfe = ws_roster.zeitkoepfe(g, bild)
        if koepfe:
            erster_balken = erster_balken or jetzt
            kopf = koepfe[0]
        else:
            # Der erste Trennstreifen liegt ueber der Rang-Leiste; die Zeile
            # beginnt am letzten.
            koepfe = ws_roster.zeilenkoepfe(g, bild)
            kopf = koepfe[-1] if koepfe else None
            if kopf:
                ohne_balken += 1
        if kopf and kopf[2] not in gesehen:
            y0, y1, farbe = kopf
            z = roster.zeile_lesen_cs(g, bild, y1, registriert=bool(farbe))
            z["farbe"] = farbe
            z["zeit"] = ws_roster.kopfzeit(g, bild, y0, y1) if farbe else None
            z["beleg"] = sammler.merken(bild, y0, y1)
            gesehen[farbe] = z
        if len([f for f in gesehen if f]) >= 2:
            break
        if erster_balken and jetzt - erster_balken >= ws_such.WECHSEL_FENSTER:
            break
        if not erster_balken and ohne_balken >= ws_such.OHNE_BALKEN_BILDER:
            break
        if jetzt - beginn >= ws_such.WECHSEL_FENSTER + 1.0:
            break
    if any(f for f in gesehen):
        gesehen.pop(None, None)
    return list(gesehen.values())


def wert_aus_zeilen(gruppe: list[dict]) -> tuple[str | None, str]:
    """Zeilen eines Spielers → ('AC'|'BC'|None, Begruendung)."""
    angemeldet = [z for z in gruppe if z.get("farbe")]
    if not angemeldet:
        return None, "kein Balken"
    for feld, rolle in (("gesetzt", "im Spiel gesetzt"), ("ersatz", "im Spiel Ersatz")):
        b = {z.get(feld) for z in angemeldet} & {"A", "B"}
        if len(b) == 1:
            return b.pop() + "C", rolle
    if any(z.get("wunsch") for z in angemeldet):
        return "AC", "Wunsch Truppe A"
    return "BC", "angemeldet, kein Wunsch fuer A"


def wochenbeginn(jetzt: datetime | None = None) -> datetime:
    """Letzter Dienstag 03:00 (Ortszeit) — dort schliesst das Spiel die
    CS-Anmeldung der Vorwoche (live 15.11.2026: „endet in 1d 03:11" am So 23:49)."""
    from datetime import timedelta
    jetzt = jetzt or datetime.now()
    d = jetzt - timedelta(days=(jetzt.weekday() - 1) % 7)
    grenze = d.replace(hour=3, minute=0, second=0, microsecond=0)
    return grenze if grenze <= jetzt else grenze - timedelta(days=7)


def plaetze_aktuell(stand: dict, jetzt: datetime | None = None) -> bool:
    """Ist der gespeicherte Stand aus dieser Anmeldewoche? Nur dann sind seine
    A/AE/B/BE eine Entscheidung fuer *diesen* Kampf und nicht die einer alten
    Woche (am 15.11.2026 stand noch die Einteilung vom September drin)."""
    s = stand.get("savedAt")
    if not s:
        return False
    try:
        gespeichert = datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return False
    return gespeichert.replace(tzinfo=None) >= wochenbeginn(jetzt)


def zusammensetzen(vorher: dict, gelesen: dict[str, str]) -> dict:
    """Neues `csTeamAssign`: gelesene Werte, aber ein Platz derselben Truppe
    aus dem Tool bleibt stehen (A/AE bzw. B/BE). Wer nicht gelesen wurde
    (= nicht angemeldet), faellt heraus. `vorher` ist leer, wenn der Stand
    nicht aus dieser Woche ist (`plaetze_aktuell`)."""
    neu = {}
    for name, wert in gelesen.items():
        alt = vorher.get(name)
        neu[name] = alt if alt in ("A", "AE", "B", "BE") and alt[0] == wert[0] else wert
    return neu


def lauf(g: Geraet, namen: list[str] | None, schreiben: bool, erzwingen: bool) -> int:
    aid = ws_tool.allianz_id(g.cfg["alliance_tag"])
    stempel = datetime.now().strftime("%Y%m%d_%H%M%S")
    ordner = BERICHTE / f"suche_{stempel}"
    ordner.mkdir(parents=True, exist_ok=True)

    alle = {p["name"]: p for p in ws_tool.kader(aid)}
    aktiv = sorted(n for n, p in alle.items() if p.get("active"))
    if namen:
        fehlt = [n for n in namen if n not in alle]
        if fehlt:
            _log(f"Nicht im Kader: {', '.join(fehlt)}")
        namen = [n for n in namen if n in alle]
    else:
        namen = aktiv
    _log(f"{len(namen)} Namen nachzuschlagen (~{len(namen) * 15 // 60} Minuten).")

    g.starten(log=_log)
    if not g.app_laeuft():
        g.app_starten(log=_log)
    ws_nav.warte_auf_spiel(g, log=_log)
    navigate.zur_teilnehmerliste(g, "A", log=_log)
    ws_such._VERSATZ = SUCHFELD_VERSATZ

    sammler = belege.Sammler(ordner / "belege", g.cfg)
    je_spieler: dict[str, list[dict]] = {}
    unsicher: list[str] = []
    nicht_gefunden: list[str] = []

    g.tippen(*ws_such.suchfeld(g), pause=1.5)
    for i, name in enumerate(namen, 1):
        getippt = match.suchname(name)
        _log(f"[{i}/{len(namen)}] {name!r}"
             + (f" — im Spiel {getippt!r}" if getippt != name else ""))
        # Scheitert die Feldprobe, trotzdem die Zeile ansehen: die Gegenprobe
        # an der Zeile (Name oder Heldenkraft) entscheidet ohnehin. Am
        # 16.11.2026 las die Erkennung `xmxmxmxmxmxmx` im Feld viermal als
        # `XAMXmXxmxmımımx` — der Name stand richtig da, und der eine Spieler
        # hielt den ganzen Lauf vom Schreiben ab, jede Woche wieder.
        feld_ok = ws_such.name_eingeben(g, getippt)
        if not feld_ok:
            time.sleep(ws_such.TREFFER_RUHE)
        gefunden = _proben(g, sammler)
        if not feld_ok and not gefunden:
            unsicher.append(name)
            _log("     ⚠ Feld nicht bestaetigt und keine Zeile — nur gemeldet")
            continue
        if not gefunden:
            nicht_gefunden.append(name)
            _log("     keine Zeile — im Spiel nicht gefunden")
            continue
        sicher = any(ws_such._bestaetigt(getippt, z.get("name_ocr"), z.get("kraft"),
                                         alle[name].get("hero_power")) for z in gefunden)
        if not sicher:
            unsicher.append(name)
            _log("     ⚠ Zeile nicht als seine bestaetigt — nur gemeldet")
            continue
        je_spieler[name] = gefunden
        wert, warum = wert_aus_zeilen(gefunden)
        farben = sorted({z["farbe"] for z in gefunden if z["farbe"]})
        _log(f"     {wert or 'nicht angemeldet'} ({warum}"
             + (f"; Balken {', '.join(farben)}" if farben else "") + ")")

    ws_nav.dialog_schliessen(g)

    # ── Heldenkraft: wie beim WS-Suchlauf, immer wenn sie gelesen wurde ──────
    # Neben jedem Namen steht die Heldenkraft; vor dem 18.11.2026 fiel sie hier
    # unter den Tisch. Nur aus Zeilen, die als die des Gesuchten bestaetigt
    # sind — sonst bekaeme ein Spieler die Kraft eines Fremden. Ohne
    # `--schreiben` wie beim WS (Vorgabe Ben, 30.09.2026): die Kraft ist eine
    # Aussage ueber die einzelne Zeile, nicht ueber die ganze Liste.
    treffer = {}
    for name, gruppe in je_spieler.items():
        getippt = match.suchname(name)
        kraft = next((z.get("kraft") for z in gruppe if z.get("kraft") and ws_such._bestaetigt(
            getippt, z.get("name_ocr"), z.get("kraft"), alle[name].get("hero_power"))), None)
        if kraft:
            treffer[name] = {"kraft": kraft}
    heldenkraft = ws_tool.schreibe_heldenkraft(aid, list(alle.values()), treffer)
    _log(f"Heldenkraft aktualisiert: {len(heldenkraft)} von {len(treffer)} gelesenen.")

    zuordnung: dict[str, str] = {}
    gruende: dict[str, str] = {}
    nicht_angemeldet: list[str] = []
    for name, gruppe in sorted(je_spieler.items()):
        wert, warum = wert_aus_zeilen(gruppe)
        gruende[name] = warum
        if wert:
            zuordnung[name] = wert
        else:
            nicht_angemeldet.append(name)
    beide_zeiten = sorted(n for n, gr in je_spieler.items()
                          if len({z["farbe"] for z in gr if z["farbe"]}) >= 2)
    verteilung = Counter(zuordnung.values())
    _log(f"Zugeordnet: {dict(sorted(verteilung.items()))}")

    sammler.kopf = (f"{g.cfg['alliance_tag']} · Schluchtsturm · "
                    f"Suchlauf {datetime.now().strftime('%d.%m.%Y %H:%M')}")
    beleg_index = sammler.abschliessen(
        {n: {"wert": zuordnung.get(n), "kraft": gr[0].get("kraft"),
             "belege": [z["beleg"] for z in gr if z.get("beleg")]}
         for n, gr in je_spieler.items()},
        ohne_beleg=nicht_gefunden,
        hinweis="Schluchtsturm-Suchlauf: jeder Kadername einzeln nachgeschlagen. "
                "Ohne Zeit-Balken = nicht angemeldet. Rotes Feld „Truppe [A]“ = "
                "Wunsch A; angemeldet ohne rotes Feld = Wunsch B.")
    try:
        n = ws_tool.schreibe_belege(aid, "cs", "suchlauf", sammler.ordner,
                                    beleg_index["spieler"])
        _log(f"Beweisbilder ins Tool hochgeladen: {n}")
    except Exception as e:
        _log(f"Beweisbilder-Upload fehlgeschlagen: {e}")

    probleme = []
    if unsicher:
        probleme.append(f"{len(unsicher)} Zeilen nicht als die des Gesuchten bestaetigt")
    # Ein Fehllauf (falscher Bildschirm, Suchfeld trifft nicht) liefert lauter
    # „nicht gefunden". Ein Viertel ist weit mehr als Austritte je Woche.
    if len(nicht_gefunden) > max(5, len(namen) // 4):
        probleme.append(f"{len(nicht_gefunden)} von {len(namen)} Namen nicht gefunden")

    stand = tool.planungsstand(aid)
    vorher = stand.get("csTeamAssign") or {}
    aktuell = plaetze_aktuell(stand)
    neu = zusammensetzen(vorher if aktuell else {}, zuordnung)
    if not aktuell:
        _log("Gespeicherter CS-Stand ist aelter als diese Anmeldewoche — "
             "keine Plaetze daraus uebernommen.")
    bericht = {
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "art": "cs_suchlauf", "allianz": g.cfg["alliance_tag"],
        "nachgeschlagen": namen,
        "verteilung": dict(sorted(verteilung.items())),
        "zuordnung": zuordnung, "gruende": gruende,
        "beide_zeiten": beide_zeiten,
        "zeiten": {n: sorted({z["zeit"] or z["farbe"] for z in gr if z["farbe"]})
                   for n, gr in je_spieler.items()},
        "nicht_angemeldet": sorted(nicht_angemeldet),
        "nicht_gefunden": sorted(nicht_gefunden),
        "unsicher": sorted(unsicher),
        "vorher": vorher, "neu": neu,
        "probleme": probleme, "belege": str(sammler.ordner),
        "heldenkraft": {n: {"vorher": a, "nachher": b} for n, (a, b) in heldenkraft.items()},
        "geschrieben": False,
    }

    print()
    print(f"── Schluchtsturm-Suchlauf {g.cfg['alliance_tag']} ──")
    for wert in ("AC", "BC"):
        nn = sorted(x for x, w in zuordnung.items() if w == wert)
        if nn:
            print(f"{wert:3s} ({len(nn):2d}): {', '.join(nn)}")
    print(f"beide Zeiten ({len(beide_zeiten)}): {', '.join(beide_zeiten) or '—'}")
    print(f"nicht angemeldet ({len(nicht_angemeldet)}): "
          f"{', '.join(sorted(nicht_angemeldet)) or '—'}")
    if nicht_gefunden:
        print(f"im Spiel nicht gefunden ({len(nicht_gefunden)}): "
              f"{', '.join(sorted(nicht_gefunden))}")
    print("PROBLEME: " + (" · ".join(probleme) if probleme else "keine"))

    if schreiben and probleme and not erzwingen:
        _log("NICHT geschrieben — siehe Probleme.")
    elif schreiben:
        if namen != aktiv:
            _log("NICHT geschrieben — nur ein Teil des Kaders nachgeschlagen. "
                 "Der Suchlauf ersetzt `csTeamAssign`; mit einer Teilliste "
                 "loeschte er den Rest.")
        else:
            sicherung = tool.sicherung_schreiben(aid, BERICHTE / "sicherungen")
            _log(f"Sicherung des bisherigen Stands: {sicherung}")
            tool.schreibe_teamassign(aid, neu)
            bericht["geschrieben"] = True
            bericht["sicherung"] = str(sicherung)
            behalten = sum(1 for n in neu if neu[n] != zuordnung[n])
            _log(f"Geschrieben: {len(neu)} Werte (ersetzend, {behalten} Plaetze "
                 f"aus dem Tool behalten).")

    (ordner / "bericht.json").write_text(json.dumps(bericht, ensure_ascii=False, indent=1))
    _log(f"Bericht: {ordner / 'bericht.json'}")
    return 0 if not probleme else 2


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--namen", nargs="*", default=None,
                   help="Nur diese Namen nachschlagen (dann wird nie geschrieben).")
    p.add_argument("--schreiben", action="store_true",
                   help="Ergebnis ins Tool uebernehmen (csTeamAssign, ersetzend).")
    p.add_argument("--erzwingen", action="store_true")
    p.add_argument("--routine", action="store_true",
                   help="Fuer den Hub: BlueStacks frisch starten und am Ende beenden.")
    a = p.parse_args(argv)

    g = None
    try:
        g = Geraet(json.loads(CONFIG.read_text()))
        if a.routine:
            g.starten(log=_log, neu=True)
            g.starten = lambda **_: None
        return lauf(g, a.namen, a.schreiben, a.erzwingen)
    except (GeraetFehler, NavigationFehler, ws_roster.ScanFehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1
    finally:
        if a.routine and g is not None:
            _log("BlueStacks beenden ...")
            subprocess.run(["pkill", "-f", "BlueStacks.app/Contents/MacOS/BlueStacks"],
                           check=False)
            subprocess.run(["adb", "disconnect", "127.0.0.1:5555"], check=False,
                           capture_output=True)


if __name__ == "__main__":
    sys.exit(main())
