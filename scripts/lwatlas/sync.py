"""Spieler und Allianzen eines Servers nach `lwa_spieler` / `lwa_allianzen`.

    .venv/bin/python -m scripts.lwatlas.sync --server 1668
    .venv/bin/python -m scripts.lwatlas.sync --server 1668 --schreiben
    .venv/bin/python -m scripts.lwatlas.sync --server 1646 1657 1664 --schreiben

Zwei Quellen, die sich ergaenzen:

- **Die Karte** (`/warzones/{id}/bases`) kennt *alle* Spieler des Servers, auch
  die ohne Allianz — aber weder Kampfkraft noch Kills. Eine Anfrage je Server.
- **Die Mitgliederlisten** (`/alliances/{id}/members`) bringen `power`,
  `armyPower` und `armyKill` — aber nur fuer Spieler in einer Allianz, und sie
  kosten eine Anfrage **je Allianz** (rund 110 auf einem Server).

Welche Allianzen es gibt, faellt aus der Karte ab; dafuer braucht es keine
eigene Abfrage. `--ohne-mitglieder` laesst den teuren Teil weg, `--nur-allianz`
holt ihn fuer einzelne Kuerzel:

    .venv/bin/python -m scripts.lwatlas.sync --server 1655 --nur-allianz cult --schreiben

Das ist der Fall „VS-Gegner": von einem fremden Server interessiert genau eine
Allianz, und zwei Anfragen (Karte + eine Mitgliederliste) sind billiger als 110.

**Der Schluessel ist `player_uid`.** Ein Spieler, der sich umbenennt, bleibt
dieselbe Zeile — und der alte Name faellt damit von selbst aus der Tabelle,
statt als Karteileiche neben der neuen Zeile zu stehen.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from scripts.lwatlas.api import KontingentKnapp, Zugang
from scripts.ws_service.tool import _anfrage


def _jetzt() -> str:
    return datetime.now(timezone.utc).isoformat()


def karte_lesen(zugang: Zugang, wz: int, frisch_tage: int, cache_h: float = 0.0) -> tuple[list[dict], dict, str | None]:
    """Alle Basen des Servers → Spielerzeilen und die Allianzen, die vorkommen.

    **Allianzen werden nach Frische ausgewaehlt, nicht vollstaendig.** Auf der
    Karte stehen auch Kuerzel, deren letzte Basis im Dezember gesehen wurde; auf
    #1668 sind das 159 gegen rund 110 lebende. Jede davon kostet eine Anfrage am
    Kontingent, und geliefert wird die Mitgliederliste einer Allianz, die es so
    nicht mehr gibt.
    """
    d = zugang.hole(f"warzones/{wz}/bases", cache_h)
    # `lastSeenAt` kommt ohne Zeitzone — deshalb naiv vergleichen, wie im Kartenimport.
    grenze = (datetime.now() - timedelta(days=frisch_tage)).isoformat()
    spieler, allianzen = [], {}
    for f in d.get("features", []):
        p = f["properties"]
        x, y = f["geometry"]["coordinates"]
        aid = (p.get("allianceId") or "").strip() or None
        tag = (p.get("allianceAbbr") or "").strip() or None
        if aid and (p.get("lastSeenAt") or "") >= grenze:
            allianzen[aid] = tag
        spieler.append({
            "server": f"#{wz}", "player_uid": p["playerUid"], "name": p.get("playerName"),
            "level": p.get("level"), "allianz": tag, "alliance_id": aid,
            "rang": p.get("allianceRank"), "x": x, "y": y,
            "gesehen_at": p.get("lastSeenAt"), "quelle": "karte"})
    return spieler, allianzen, d.get("lastScanAt")


def mitglieder_lesen(zugang: Zugang, wz: int, allianzen: dict, cache_h: float = 0.0) -> tuple[list[dict], list[dict]]:
    zeilen, kopfe = [], []
    for i, (aid, tag) in enumerate(sorted(allianzen.items(), key=lambda kv: (kv[1] or "")), 1):
        try:
            d = zugang.hole(f"alliances/{aid}/members", cache_h)
        except KontingentKnapp:
            print(f"  abgebrochen bei {i}/{len(allianzen)} — {zugang.bericht()}", flush=True)
            break
        m = d.get("members") or []
        kopfe.append({
            "server": f"#{wz}", "alliance_id": aid, "tag": d.get("allianceAbbr") or tag,
            "mitglieder": d.get("memberCount"), "gemeldet": d.get("reportedMemberCount"),
            "power": sum(x.get("power") or 0 for x in m),
            "kills": sum(x.get("armyKill") or 0 for x in m),
            "gescannt_at": d.get("lastUpdatedAt")})
        for x in m:
            zeilen.append({
                "server": f"#{wz}", "player_uid": x["playerUid"], "name": x.get("playerName"),
                "level": x.get("level"), "allianz": d.get("allianceAbbr") or tag,
                "alliance_id": aid, "rang": x.get("allianceRank"),
                "x": x.get("x"), "y": x.get("y"), "power": x.get("power"),
                "army_power": x.get("armyPower"), "army_kill": x.get("armyKill"),
                "last_active_at": x.get("lastActiveAt"), "gesehen_at": x.get("lastSeenAt"),
                "beobachtet_at": x.get("observedAt"), "quelle": "mitglieder"})
        if i % 25 == 0:
            print(f"  {i}/{len(allianzen)} Allianzen · {zugang.bericht()}", flush=True)
    return zeilen, kopfe


def zusammenfuehren(karte: list[dict], mitglieder: list[dict]) -> list[dict]:
    """Mitgliederdaten gewinnen — sie sind frischer und tragen Kraft und Kills."""
    nach_uid = {z["player_uid"]: z for z in karte}
    for z in mitglieder:
        vorher = nach_uid.get(z["player_uid"], {})
        nach_uid[z["player_uid"]] = {**vorher, **{k: v for k, v in z.items() if v is not None}}
    return list(nach_uid.values())


def schreiben(tabelle: str, zeilen: list[dict], konflikt: str) -> None:
    """PostgREST verlangt in einem Sammel-POST ueberall dieselben Spalten.

    Die Zeilen aus der Karte kennen weder Kraft noch Kills, die aus den
    Mitgliederlisten schon — ungleiche Schluessel quittiert PostgREST mit 400.
    Deshalb wird die Vereinigung gebildet und Fehlendes ausdruecklich auf NULL
    gesetzt.
    """
    spalten = sorted({s for z in zeilen for s in z})
    for i in range(0, len(zeilen), 500):
        teil = [{**{s: None for s in spalten}, **z, "updated_at": _jetzt()}
                for z in zeilen[i:i + 500]]
        _anfrage(f"{tabelle}?on_conflict={konflikt}", "POST", teil,
                 prefer="resolution=merge-duplicates,return=minimal")
        print(f"  {min(i + 500, len(zeilen))}/{len(zeilen)} → {tabelle}", flush=True)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--server", type=int, nargs="+", default=[1668])
    p.add_argument("--frisch-tage", type=int, default=14,
                   help="Mitgliederlisten nur fuer Allianzen mit Basis aus dieser Zeit")
    p.add_argument("--ohne-mitglieder", action="store_true",
                   help="nur die Karte holen — eine Anfrage statt rund 110 je Server")
    p.add_argument("--nur-allianz", nargs="+", metavar="TAG", default=None,
                   help="Mitgliederliste nur fuer diese Kuerzel — fuer den VS-Gegner, "
                        "von dem auf einem fremden Server nur eine Allianz interessiert")
    p.add_argument("--cache-h", type=float, default=6.0,
                   help="hinterlegte Antworten dieses Alters wiederverwenden (0 = immer neu)")
    p.add_argument("--schreiben", action="store_true")
    a = p.parse_args()

    zugang = Zugang()
    for wz in a.server:
        print(f"\n=== Server {wz} ===", flush=True)
        karte, allianzen, scan = karte_lesen(zugang, wz, a.frisch_tage, a.cache_h)
        print(f"  Karte: {len(karte)} Spieler, {len(allianzen)} Allianzen, Scan {str(scan)[:16]}")

        if a.nur_allianz:
            gesucht = {t.casefold() for t in a.nur_allianz}
            allianzen = {aid: tag for aid, tag in allianzen.items()
                         if (tag or "").casefold() in gesucht}
            gefunden = {(t or "").casefold() for t in allianzen.values()}
            # Ein Tippfehler im Kuerzel saehe sonst aus wie „Allianz gibt es nicht
            # mehr": leere Mitgliederliste, keine Meldung, Karte ohne Kraft.
            for fehlt in sorted(gesucht - gefunden):
                print(f"  ⚠ Kein Kuerzel {fehlt!r} auf diesem Server (oder aelter "
                      f"als {a.frisch_tage} Tage)")
            print(f"  nur {sorted(filter(None, allianzen.values()))} — "
                  f"{len(allianzen)} statt aller Mitgliederlisten")

        mitglieder, kopfe = [], []
        if not a.ohne_mitglieder:
            if not zugang.reicht_fuer(len(allianzen)):
                print(f"  Kontingent reicht nicht fuer {len(allianzen)} Mitgliederlisten "
                      f"({zugang.bericht()}) — uebersprungen.")
            else:
                mitglieder, kopfe = mitglieder_lesen(zugang, wz, allianzen, a.cache_h)
                print(f"  Mitglieder: {len(mitglieder)} Zeilen aus {len(kopfe)} Allianzen")

        zeilen = zusammenfuehren(karte, mitglieder)
        mit_kills = sum(1 for z in zeilen if z.get("army_kill") is not None)
        print(f"  zusammengefuehrt: {len(zeilen)} Spieler, davon {mit_kills} mit Kills")
        print(f"  {zugang.bericht()}")

        if a.schreiben:
            schreiben("lwa_spieler", zeilen, "server,player_uid")
            if kopfe:
                schreiben("lwa_allianzen", kopfe, "server,alliance_id")
        else:
            print("  Probelauf — nichts geschrieben.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
