"""Gesamtkraft der Helden aus dem Schluchtsturm-Scan ins Tool uebernehmen.

    .venv/bin/python -m scripts.cs_service.update_hero_power              # nur Bericht
    .venv/bin/python -m scripts.cs_service.update_hero_power --schreiben  # und schreiben

Die Teilnehmerliste zeigt bei **jeder** Karte "Gesamtkampfkraft der Helden" —
unabhaengig davon, ob registriert oder nicht (`_alle_karten_anker` in
roster.py). Ein CS-Scan liest also nebenbei die Heldenkraft der ganzen
Allianz, nicht nur der Bewerber. Quelle ist die zuletzt gespeicherte
`scan_team<Truppe>.json` (siehe scan_rang.py) — dieses Skript scannt selbst
nicht neu.

Geschrieben wird wie im Profil/Allianz-Detail des Tools: `ws_players.
hero_power` wird gesetzt und **zugleich** eine neue Zeile in
`ws_player_history` angelegt, ein Schnappschuss aus t1..t4/total_power des
aktuellen Spielerstands plus der neuen Heldenkraft — genau das Muster aus
`savePlayerHistory` (src/core/players.js). `t1_updated_at` bleibt unberuehrt,
das gilt nur fuer T1.

Geschrieben wird nur, wenn der Name **sicher** einem Kadereintrag zugeordnet
werden konnte (`match.zuordnen`, dieselbe Schwelle wie beim Team-Scan) —
unsichere Zeilen werden gemeldet, nicht geraten. Eine Karte, deren Kraft sich
gegenueber dem Tool um mehr als 50% aendert, gilt als moeglicher Fehlgriff
(OCR-Verwechslung zweier Karten) und wird ebenfalls nur gemeldet, nicht
geschrieben — echte Kraftspruenge in dieser Groessenordnung sind zwischen zwei
Scans nicht plausibel.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from scripts.ws_service import match
from scripts.ws_service.tool import SB, KEY, _anfrage, allianz_id  # noqa: F401

STAND = Path.home() / ".local" / "state" / "warsync" / "cs_service"
SPRUNG_MAX = 0.5  # 50% Abweichung zum bisherigen Wert gilt als unplausibel


def _kader_voll(aid: str) -> list[dict]:
    return _anfrage(
        f"ws_players?select=name,hero_power,t1,t2,t3,t4,total_power,active"
        f"&alliance_id=eq.{aid}&limit=1000")


def _zeilen_aus_scan(team: str) -> list[dict]:
    pfad = STAND / f"scan_team{team}.json"
    daten = json.loads(pfad.read_text())
    out = []
    for rang, info in daten.get("raenge", {}).items():
        for m in info.get("mitglieder", []):
            if m.get("kraft_m") is None:
                continue
            out.append({"name_ocr": m["name"], "kraft": m["kraft_m"], "rang": rang})
    return out


def plan(aid: str, team: str = "A") -> dict:
    zeilen = _zeilen_aus_scan(team)
    kader_liste = _kader_voll(aid)
    erg = match.zuordnen(zeilen, kader_liste)
    kader_je_name = {p["name"]: p for p in kader_liste}

    aktualisieren, unveraendert, unplausibel = [], [], []
    for name, treffer in erg["treffer"].items():
        p = kader_je_name.get(name)
        neu_bp = round(treffer["kraft"] * 1_000_000)
        alt_bp = p.get("hero_power") if p else None
        if alt_bp:
            abweichung = abs(neu_bp - alt_bp) / alt_bp
            if abweichung > SPRUNG_MAX:
                unplausibel.append({"name": name, "alt_m": round(alt_bp / 1e6, 1),
                                    "neu_m": treffer["kraft"], "abweichung": round(abweichung, 2)})
                continue
        if alt_bp == neu_bp:
            unveraendert.append(name)
            continue
        aktualisieren.append({"name": name, "alt_m": round(alt_bp / 1e6, 1) if alt_bp else None,
                              "neu_m": treffer["kraft"], "neu_bp": neu_bp, "spieler": p})

    return {"aktualisieren": aktualisieren, "unveraendert": unveraendert,
            "unplausibel": unplausibel, "offen": erg["offen"], "aid": aid}


def schreiben(aid: str, aktualisieren: list[dict]) -> None:
    jetzt = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    for e in aktualisieren:
        p = e["spieler"]
        _anfrage(f"ws_players?alliance_id=eq.{aid}&name=eq.{quote(e['name'])}",
                 methode="PATCH", rumpf={"hero_power": e["neu_bp"]}, prefer="return=minimal")
        _anfrage("ws_player_history", methode="POST", prefer="return=minimal", rumpf={
            "player_name": e["name"], "alliance_id": aid,
            "t1": p.get("t1"), "t2": p.get("t2"), "t3": p.get("t3"), "t4": p.get("t4"),
            "total_power": p.get("total_power"), "hero_power": e["neu_bp"],
            "recorded_at": jetzt, "changed_by": "cs_scan",
        })


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--schreiben", action="store_true")
    p.add_argument("--team", default="A")
    p.add_argument("--tag", default="XP33")
    a = p.parse_args(argv)

    aid = allianz_id(a.tag)
    erg = plan(aid, a.team)

    print(f"── Heldenkraft {a.tag} ──")
    print(f"{len(erg['aktualisieren'])} zu aktualisieren, "
          f"{len(erg['unveraendert'])} unveraendert, "
          f"{len(erg['unplausibel'])} unplausibel (>{int(SPRUNG_MAX*100)}% Sprung, uebersprungen), "
          f"{len(erg['offen'])} ohne sicheren Namenstreffer.")
    for e in sorted(erg["aktualisieren"], key=lambda x: x["name"]):
        print(f"  {e['name']:20s} {e['alt_m']!s:>8} -> {e['neu_m']} M")
    if erg["unplausibel"]:
        print("Unplausibel (nicht geschrieben):")
        for e in erg["unplausibel"]:
            print(f"  {e['name']!r}: {e['alt_m']}M -> {e['neu_m']}M ({e['abweichung']*100:.0f}%)")
    if erg["offen"]:
        print("Ohne sicheren Treffer:")
        for o in erg["offen"]:
            print(f"  {o.get('name_ocr')!r} ({o.get('kraft')}M) -> {o.get('grund')}")

    if a.schreiben:
        schreiben(aid, erg["aktualisieren"])
        print(f"Geschrieben: {len(erg['aktualisieren'])} Spieler.")
    else:
        print("Nur Bericht — mit --schreiben tatsaechlich schreiben.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
