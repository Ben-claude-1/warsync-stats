"""Basen von LW Atlas nachtragen — die zweite Quelle neben dem eigenen Scan.

    .venv/bin/python -m scripts.karten_archiv.lwatlas
    .venv/bin/python -m scripts.karten_archiv.lwatlas --schreiben

`https://api.lwatlas.com` liefert die Basen einer Warzone als GeoJSON, aus den
Spieldaten selbst: Koordinate, Name, Stufe, Allianz-Kuerzel. Das ist genau das,
was der eigene Scan aus dem Bild lesen muss — nur ohne Lesefehler. Namen in
japanischer, kyrillischer und chinesischer Schrift stehen dort richtig da, wo
die Texterkennung `5 1 ZaoTail` statt `ザオタイ ZaoTai` liefert.

**Nur, was hoechstens `TAGE` alt ist.** Die Fremdquelle fuehrt Basen weiter, die
laengst umgezogen oder aufgehoert haben — ueber die Haelfte ihrer Eintraege
wurde zuletzt im Dezember gesehen. Ein altes `lastSeenAt` in unsere Karte zu
uebernehmen hiesse, eine Basis zu behaupten, die es nicht mehr gibt.

**Der Ort wird berichtigt.** Weicht unsere Koordinate um bis zu `ORT_MAX` ab und
der Name passt, ist es dieselbe Basis an der falschen Stelle — dann zieht die
Zeile um. Den Namen uebernimmt erst `--namen` (siehe `namen_uebernehmen`).

Ohne Namensaehnlichkeit wird **nicht** verschoben. Auf zwei Nachbarfeldern
koennen sehr wohl zwei verschiedene Basen stehen; die Zeile zoege dann einer
fremden Basis auf den Platz.
"""
from __future__ import annotations

import argparse
import difflib
import json
import unicodedata
import urllib.request
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from scripts.ws_service import match
from scripts.ws_service.ergebnis import _skelett
from scripts.ws_service.tool import _anfrage

API = "https://api.lwatlas.com/v1/warzones/{wz}/bases"
ABLAGE = Path.home() / ".local/state/warsync/lwatlas"

TAGE = 7          # aelter gesehen = nicht uebernehmen
ORT_MAX = 2       # bis hierhin gilt eine Abweichung als dieselbe Basis
NAME_MIN = 0.75   # ... sofern der Name das bestaetigt
KERN_MIN_LAENGE = 4   # kuerzer ist ein gemeinsames Stueck kein Beweis


def holen(warzone: int, frisch: bool) -> dict:
    ABLAGE.mkdir(parents=True, exist_ok=True)
    datei = ABLAGE / f"bases_{warzone}.json"
    if frisch or not datei.exists():
        req = urllib.request.Request(
            API.format(wz=warzone),
            headers={"Accept": "application/json",
                     "Origin": "https://lwatlas.com",
                     "Referer": "https://lwatlas.com/",
                     "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                                   "Chrome/150.0.0.0 Safari/537.36"})
        with urllib.request.urlopen(req, timeout=90) as r:
            datei.write_bytes(r.read())
    return json.loads(datei.read_text())


def frische(roh: dict, tage: int) -> list[dict]:
    grenze = (datetime.now() - timedelta(days=tage)).isoformat()
    aus = []
    for f in roh["features"]:
        p = f["properties"]
        if (p.get("lastSeenAt") or "") < grenze:
            continue
        x, y = f["geometry"]["coordinates"]
        aus.append({"x": x, "y": y,
                    "name": (p.get("playerName") or "").strip() or None,
                    "allianz": (p.get("allianceAbbr") or "").strip() or None,
                    "level": p.get("level"),
                    "gesehen_at": p["lastSeenAt"]})
    return aus


def unsere(server: str) -> list[dict]:
    ort = f"server=eq.{quote(server)}"
    da, versatz = [], 0
    while True:                              # PostgREST deckelt bei 1000 Zeilen
        block = _anfrage(f"karte_basen?select=id,x,y,name,name_roh,allianz,level,quelle"
                         f"&{ort}&limit=1000&offset={versatz}") or []
        da += block
        if len(block) < 1000:
            return da
        versatz += 1000


def _norm(s: str | None) -> str:
    return match.norm(_skelett(unicodedata.normalize("NFKC", s or "")))


def _aehnlich(a: str, b: str) -> float:
    """Zeichenaehnlichkeit **oder** gemeinsamer Kern — es zaehlt der bessere.

    Der reine Aehnlichkeitswert verfehlt genau die Namen, um die es hier geht:
    verziert geschriebene (`ஐ YiiChi ஐ` gegen gelesenes `g0 YiiChi g`, 0,71)
    stimmen in der Mitte ueberein und weichen nur im Zierrat ab. Gemessen am
    kuerzeren Namen ist derselbe Fall 0,75 — und `TiniTwoCents` gegen
    `TiniTraveler` bleibt bei 0,42, denn dort ist nur der Vorname gemeinsam.
    """
    grund = difflib.SequenceMatcher(None, a, b).ratio()
    kurz = min(len(a), len(b))
    if kurz < KERN_MIN_LAENGE:
        return grund
    kern = difflib.SequenceMatcher(None, a, b).find_longest_match(
        0, len(a), 0, len(b)).size
    return max(grund, kern / kurz if kern >= KERN_MIN_LAENGE else 0.0)


def zuordnen(fremd: list[dict], eigen: list[dict]) -> dict:
    """Jede fremde Basis bekommt hoechstens eine eigene Zeile — und umgekehrt.

    Zugeordnet wird in der Reihenfolge der Namensaehnlichkeit, nicht in der der
    Tabelle: sonst greift die erste Zeile den Platz weg, den die zweite besser
    verdient haette.
    """
    nach_ort = {}
    for e in eigen:
        nach_ort.setdefault((e["x"], e["y"]), []).append(e)

    paare = []
    for f in fremd:
        for dx in range(-ORT_MAX, ORT_MAX + 1):
            for dy in range(-ORT_MAX, ORT_MAX + 1):
                for e in nach_ort.get((f["x"] + dx, f["y"] + dy), []):
                    aehnl = _aehnlich(_norm(f["name"]), _norm(e["name"]))
                    paare.append((max(abs(dx), abs(dy)), aehnl, f, e))
    paare.sort(key=lambda p: (p[0] > 0, -p[1], p[0]))

    vergeben_f, vergeben_e = set(), set()
    gleich, umzug, unklar = [], [], []
    for abstand, aehnl, f, e in paare:
        if id(f) in vergeben_f or id(e) in vergeben_e:
            continue
        if abstand == 0:
            gleich.append((f, e, aehnl))
        elif aehnl >= NAME_MIN:
            umzug.append((f, e, aehnl, abstand))
        else:
            unklar.append((f, e, aehnl, abstand))
            continue                          # bleibt fuer beide Seiten offen
        vergeben_f.add(id(f))
        vergeben_e.add(id(e))

    neu = [f for f in fremd if id(f) not in vergeben_f]
    return {"gleich": gleich, "umzug": umzug, "neu": neu, "unklar": unklar}


def namen_uebernehmen(paare: list[tuple[dict, dict]]) -> int:
    """Den Namen der Fremdquelle setzen, den gelesenen als `name_roh` bewahren.

    Das ist **kein** Bruch mit der Regel „`name` ist, was auf der Karte stand"
    (siehe `auswerten.basen_bauen`): dort ging es darum, einen gelesenen Namen
    nicht durch den aehnlichsten Kadernamen zu ersetzen — geraten gegen 279
    Kandidaten. Hier steht die Zuordnung ueber den Ort schon fest, und die
    Fremdquelle liest denselben Namen nicht vom Bildschirm ab, sondern fuehrt
    ihn aus den Spieldaten. `ZLIL 22` war nie der Name, `zLiL` ist es.

    Der gelesene Text geht dabei nicht verloren: wo `name_roh` leer ist, ruecken
    ihn die alten `name` nach. Er ist der Beleg, an dem sich eine verbesserte
    Erkennung spaeter messen laesst.
    """
    geaendert = 0
    for f, e in paare:
        if (f["name"] or "") == (e["name"] or ""):
            continue
        satz = {"name": f["name"]}
        if not e.get("name_roh") and e.get("name"):
            satz["name_roh"] = e["name"]
        _anfrage(f"karte_basen?id=eq.{e['id']}", "PATCH", satz,
                 prefer="return=minimal")
        geaendert += 1
    return geaendert


def schreiben(server: str, neu: list[dict], umzug: list, belegt: set) -> None:
    """Erst umziehen, dann anlegen — der Umzug raeumt Plaetze frei."""
    offen = list(umzug)
    for runde in (1, 2):                      # Ringtausch braucht zwei Anlaeufe
        nochmal = []
        for f, e, *_ in offen:
            ziel = (f["x"], f["y"])
            if ziel in belegt:
                nochmal.append((f, e))
                continue
            _anfrage(f"karte_basen?id=eq.{e['id']}", "PATCH",
                     {"x": f["x"], "y": f["y"]}, prefer="return=minimal")
            belegt.discard((e["x"], e["y"]))
            belegt.add(ziel)
        offen = nochmal
        if not offen:
            break
    if offen:
        print(f"  {len(offen)} Umzuege stehen aus — Zielfeld ist belegt")

    zeilen = [{"server": server, "x": f["x"], "y": f["y"], "name": f["name"],
               "allianz": f["allianz"], "level": f["level"],
               "gesehen_at": f["gesehen_at"], "quelle": "lwatlas"}
              for f in neu if (f["x"], f["y"]) not in belegt]
    for i in range(0, len(zeilen), 500):
        _anfrage("karte_basen?on_conflict=server,x,y", "POST", zeilen[i:i + 500],
                 prefer="resolution=merge-duplicates,return=minimal")
        print(f"  {min(i + 500, len(zeilen))}/{len(zeilen)} angelegt", flush=True)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--warzone", type=int, default=1668)
    p.add_argument("--server", default="#1668")
    p.add_argument("--tage", type=int, default=TAGE)
    p.add_argument("--frisch", action="store_true", help="neu von der API holen")
    p.add_argument("--namen", action="store_true",
                   help="abweichende Namen der Fremdquelle uebernehmen, "
                        "gelesenen Text nach name_roh retten")
    p.add_argument("--schreiben", action="store_true")
    a = p.parse_args()

    roh = holen(a.warzone, a.frisch)
    fremd = frische(roh, a.tage)
    print(f"LW Atlas, Stand {roh.get('lastScanAt')}: {len(roh['features'])} Basen, "
          f"davon {len(fremd)} in den letzten {a.tage} Tagen gesehen")

    eigen = unsere(a.server)
    print(f"karte_basen auf {a.server}: {len(eigen)} Zeilen")

    z = zuordnen(fremd, eigen)
    print(f"\n  {len(z['gleich'])} am selben Ort"
          f"\n  {len(z['umzug'])} Koordinate berichtigen"
          f"\n  {len(z['neu'])} fehlen und werden angelegt"
          f"\n  {len(z['unklar'])} daneben, aber anderer Name — unberuehrt")

    versatz = Counter((f["x"] - e["x"], f["y"] - e["y"]) for f, e, *_ in z["umzug"])
    if versatz:
        print("  Versatz (dx,dy):", versatz.most_common(6))
    paare = [(f, e) for f, e, *_ in z["gleich"]] + [(f, e) for f, e, *_ in z["umzug"]]
    abw = [(f, e) for f, e in paare if (f["name"] or "") != (e["name"] or "")]
    print(f"  {len(abw)} Namen weichen ab"
          + (" und werden uebernommen" if a.namen else " (bleiben stehen, --namen uebernimmt sie)"))

    if not a.schreiben:
        print("\nProbelauf — nichts geschrieben. Mit --schreiben eintragen.")
        return 0

    belegt = {(e["x"], e["y"]) for e in eigen}
    schreiben(a.server, z["neu"], z["umzug"], belegt)
    if a.namen:
        print(f"  {namen_uebernehmen(abw)} Namen uebernommen")
    print("fertig")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
