"""Die Tagespunkte ins Werkzeug schreiben — ueber PostgREST, wie die App selbst.

Der Zugang kommt aus `src/core/config.js` (`ws_service.tool` liest ihn dort
ebenfalls); zwei Kopien desselben Schluessels laufen sonst auseinander.

Geschrieben wird in zwei Tabellen, und die zweite ist nicht schmueckendes
Beiwerk: `vs_tage` haelt die Punkte je Spieler und Tag, `vs_tage_lauf` haelt,
**wie viele Zeilen der Lauf an dem Tag ueberhaupt gesehen hat**. Ohne diese
Zahl ist ein fehlender Spieler nicht zu deuten — er kann null Punkte gemacht
haben oder unterhalb der 100er-Schnittkante der Spielliste stehen. Die
Auswertung darf den Unterschied nicht raten.
"""
from __future__ import annotations

from datetime import date

from scripts.ws_service.tool import _anfrage, allianz_id, kader  # noqa: F401

# Die Rangliste im Spiel endet bei 100 Zeilen. Findet ein Lauf weniger, war
# nichts abgeschnitten — dann ist ein Fehlender tatsaechlich nicht angetreten.
LISTEN_GRENZE = 100


def tage_lesen(aid: str, von: date, bis: date) -> list[dict]:
    return _anfrage(f"vs_tage?select=datum,player_name,pts,rang&alliance_id=eq.{aid}"
                    f"&datum=gte.{von}&datum=lte.{bis}&limit=5000") or []


def schreibe_tag(aid: str, tag: date, zeilen: list[dict],
                 vollstaendig: bool, gelesen: int | None = None) -> dict:
    """Die Zeilen eines Tages eintragen und den Lauf daneben protokollieren.

    `zeilen` sind bereits dem Kader zugeordnete Eintraege
    (`{"name", "pts", "rang"}`) — wer nicht sicher zugeordnet werden konnte,
    gehoert nicht hierher, sondern in den Bericht. Ein falsch zugeordneter Name
    schriebe die Punkte eines Fremden auf einen Allianzspieler.

    **`gelesen` ist die Zahl der Zeilen im Spiel, nicht die der zugeordneten.**
    Die beiden gehen auseinander, sobald ein Name offen bleibt — am 17.09.2026
    waren es 99 Zeilen und 98 Treffer. An dieser Zahl haengt aber die Frage, ob
    die Liste an ihrer 100er-Grenze abgeschnitten war: mit den Treffern
    gerechnet saehe eine volle Liste mit zwei offenen Namen wie eine nicht volle
    aus, und die Auswertung erklaerte jeden Fehlenden zum Nuller.
    """
    rumpf = [{"alliance_id": aid, "datum": str(tag), "player_name": z["name"],
              "pts": int(z["pts"]), "rang": z.get("rang"), "quelle": "scan"}
             for z in zeilen]
    if rumpf:
        # **Der Tag wird ersetzt, nicht ergaenzt.** Die Tagesliste ist eine
        # Momentaufnahme des ganzen Tages; ein zweiter Lauf ist die bessere
        # Fassung derselben Auskunft, nicht eine Ergaenzung. Wuerde nur
        # zusammengefuehrt, blieben die Zeilen eines misslungenen Laufs fuer
        # immer daneben stehen — und sie saehen genauso aus wie richtige.
        _anfrage(f"vs_tage?alliance_id=eq.{aid}&datum=eq.{tag}",
                 methode="DELETE", prefer="return=minimal")
        _anfrage("vs_tage?on_conflict=alliance_id,datum,player_name",
                 methode="POST", rumpf=rumpf,
                 prefer="resolution=merge-duplicates,return=minimal")
    lauf = {"alliance_id": aid, "datum": str(tag),
            "gelesen": len(zeilen) if gelesen is None else int(gelesen),
            "letzter_rang": max((z.get("rang") or 0) for z in zeilen) if zeilen else None,
            "min_pts": min((int(z["pts"]) for z in zeilen), default=None),
            "vollstaendig": bool(vollstaendig)}
    _anfrage("vs_tage_lauf?on_conflict=alliance_id,datum",
             methode="POST", rumpf=lauf,
             prefer="resolution=merge-duplicates,return=minimal")
    return lauf
