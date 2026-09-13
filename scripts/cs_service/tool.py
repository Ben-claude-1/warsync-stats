"""Lesen und Schreiben im Online-Tool, fuer den Schluchtsturm.

Zugang (SB/KEY), `allianz_id`, `kader` und die Roh-Anfrage sind identisch zum
Wuestensturm-Dienst und werden von dort uebernommen — nur der Planungsstand-
Schluessel ('cs' statt 'ws') und das Feld darin ('csTeamAssign' statt
'teamAssign') unterscheiden sich.

Geschrieben wird zusammenfuehrend, aber **nicht** blind ueberschreibend wie
beim Wuestensturm: dort misst der Scan die Gesetzt/Ersatz-Rolle direkt, hier
nur den Team-Wunsch ('A'/'B'). Eine von Hand gesetzte Ersatz-Markierung
('AE'/'BE') traegt mehr Information als das, was der Scan sehen kann, und darf
deshalb nicht verloren gehen, solange sich am Team nichts geaendert hat.
"""
from __future__ import annotations

from datetime import datetime, timezone

from scripts.ws_service.tool import SB, KEY, _anfrage, allianz_id, kader  # noqa: F401

REG_WERTE = ("A", "AE", "B", "BE", "C")


def team_von(wert: str | None) -> str | None:
    """'AE' -> 'A', 'C'/None -> None. Wie core/rotation.js:teamOf."""
    if wert in ("A", "AE"):
        return "A"
    if wert in ("B", "BE"):
        return "B"
    return None


def planungsstand(aid: str) -> dict:
    treffer = _anfrage(
        f"ws_planner_state?select=data&alliance_id=eq.{aid}&key=eq.cs")
    return (treffer[0]["data"] if treffer else {}) or {}


def zusammenfuehren(vorher: dict, gefunden: dict) -> dict:
    """Alt + neu gefundene Team-Wuensche ('A'/'B' je Name).

    Ein bestehender Wert bleibt stehen, wenn sein Team zum neu gefundenen
    passt (auch als 'AE'/'BE') — sonst ginge jede von Hand gesetzte
    Ersatz-Markierung beim naechsten Lauf verloren, obwohl sich am Wunsch
    nichts geaendert hat. Nur ein echter Teamwechsel (oder ein bisher
    fehlender Eintrag) wird geschrieben.
    """
    ergebnis = dict(vorher or {})
    for name, team in gefunden.items():
        alt = ergebnis.get(name)
        if alt and team_von(alt) == team:
            continue
        ergebnis[name] = team
    return ergebnis


def unterschied(vorher: dict, nachher: dict) -> dict:
    neu = {k: v for k, v in nachher.items() if k not in (vorher or {})}
    geaendert = {k: (vorher[k], v) for k, v in nachher.items()
                 if k in (vorher or {}) and vorher[k] != v}
    return {"neu": neu, "geaendert": geaendert,
            "unveraendert": len(nachher) - len(neu) - len(geaendert)}


def schreibe_teamassign(aid: str, cs_team_assign: dict) -> None:
    """`csTeamAssign` im 'cs'-Planungsstand setzen, alles andere darin
    (csPlanA, csSlotsA, csPresets, ...) unangetastet lassen.
    """
    stand = planungsstand(aid)
    stand["csTeamAssign"] = cs_team_assign
    stand["savedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    _anfrage(f"ws_planner_state?alliance_id=eq.{aid}&key=eq.cs",
             methode="PATCH", rumpf={"data": stand}, prefer="return=minimal")


def sicherung_schreiben(aid: str, ordner) -> "Path":
    from pathlib import Path
    import json
    ordner = Path(ordner)
    ordner.mkdir(parents=True, exist_ok=True)
    stand = planungsstand(aid)
    ziel = ordner / f"cs_planner_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    ziel.write_text(json.dumps(stand, ensure_ascii=False, indent=1))
    return ziel
