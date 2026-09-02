"""Lesen und Schreiben im Online-Tool — ueber PostgREST, wie die App selbst.

Der Zugang wird **aus `src/core/config.js` gelesen**, nicht hier noch einmal
hingeschrieben. Zwei Kopien desselben Schluessels laufen sonst irgendwann
auseinander, und der Dienst schreibt dann gegen eine andere Datenbank als die
Oberflaeche.

Geschrieben wird ausschliesslich `teamAssign` im Planungsstand (`key='ws'`), und
zwar zusammenfuehrend: vorhandene Eintraege bleiben stehen, wenn der Scan zu
ihnen nichts zu sagen hat. Wer sich im Spiel nicht angemeldet hat, taucht im
Scan gar nicht auf — fuer den darf hier auch nichts landen, auch kein leerer
Wert. Ein `null` waere eine Aussage, die niemand getroffen hat.
"""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_CFG_JS = (REPO / "src" / "core" / "config.js").read_text()


def _aus_config_js(name: str) -> str:
    m = re.search(rf"export const {name}\s*=\s*'([^']+)'", _CFG_JS)
    if not m:
        raise RuntimeError(f"{name} steht nicht in src/core/config.js")
    return m.group(1)


SB = _aus_config_js("SB")
KEY = _aus_config_js("KEY")


def _anfrage(pfad: str, methode: str = "GET", rumpf=None, prefer: str | None = None):
    kopf = {"apikey": KEY, "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json"}
    if prefer:
        kopf["Prefer"] = prefer
    daten = json.dumps(rumpf).encode() if rumpf is not None else None
    req = urllib.request.Request(f"{SB}/rest/v1/{pfad}", data=daten,
                                 headers=kopf, method=methode)
    with urllib.request.urlopen(req, timeout=45) as r:
        roh = r.read()
    return json.loads(roh) if roh else None


def allianz_id(tag: str) -> str:
    treffer = _anfrage(f"alliances?select=id,tag&tag=eq.{tag}")
    if not treffer:
        raise RuntimeError(f"Allianz '{tag}' gibt es nicht.")
    return treffer[0]["id"]


def kader(aid: str) -> list[dict]:
    return _anfrage(
        f"ws_players?select=name,hero_power,active&alliance_id=eq.{aid}&limit=1000")


def planungsstand(aid: str) -> dict:
    treffer = _anfrage(
        f"ws_planner_state?select=data&alliance_id=eq.{aid}&key=eq.ws")
    return (treffer[0]["data"] if treffer else {}) or {}


def zusammenfuehren(vorher: dict, neu: dict) -> dict:
    """Alt + neu. Nichts wird geloescht, nur ueberschrieben oder ergaenzt."""
    ergebnis = dict(vorher or {})
    ergebnis.update(neu)
    return ergebnis


def unterschied(vorher: dict, nachher: dict) -> dict:
    neu = {k: v for k, v in nachher.items() if k not in (vorher or {})}
    geaendert = {k: (vorher[k], v) for k, v in nachher.items()
                 if k in (vorher or {}) and vorher[k] != v}
    return {"neu": neu, "geaendert": geaendert,
            "unveraendert": len(nachher) - len(neu) - len(geaendert)}


def schreibe_teamassign(aid: str, team_assign: dict) -> None:
    """`teamAssign` im Planungsstand setzen und `savedAt` mitziehen.

    `savedAt` muss mit, sonst haelt ein offener Browser-Tab seinen aelteren
    Stand fuer den neueren und schreibt ihn beim naechsten Speichern darueber
    (siehe plannerResolve). `updated_at` setzt dagegen ein Trigger in der
    Datenbank — das gehoert nicht in den Rumpf.
    """
    stand = planungsstand(aid)
    stand["teamAssign"] = team_assign
    stand["savedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    _anfrage(f"ws_planner_state?alliance_id=eq.{aid}&key=eq.ws",
             methode="PATCH", rumpf={"data": stand}, prefer="return=minimal")


def sicherung_schreiben(aid: str, ordner: Path) -> Path:
    ordner.mkdir(parents=True, exist_ok=True)
    stand = planungsstand(aid)
    ziel = ordner / f"ws_planner_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    ziel.write_text(json.dumps(stand, ensure_ascii=False, indent=1))
    return ziel
