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

**Die Karte ist nicht der ganze Server.** Sie laesst ganze Allianzen aus —
am 20.09.2026 neun auf #1668, darunter HOT4 und MMAX mit zusammen 187
Mitgliedern, die ihre Listen am selben Abend frisch meldeten. „Fehlt auf der
Karte" heisst deshalb **nicht** „gibt es nicht mehr". Vollstaendig ist nur die
Mitgliederliste einer Allianz, und nur innerhalb einer geholten raeumt
`raeumen` weg, wer sie verlassen hat (`--kein-raeumen` laesst es bleiben).
Aus demselben Grund kommt der Kreis der Allianzen nicht mehr allein aus der
Karte, sondern auch aus dem, was schon einmal geholt wurde.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from scripts.lwatlas.api import KontingentKnapp, Zugang
from scripts.ws_service.tool import _anfrage

# Anteil verwaister Zeilen, ab dem lieber nachgesehen als geloescht wird.
RAEUM_ANTEIL = 0.25


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


def bekannte_allianzen(wz: int, frisch_tage: int) -> dict:
    """Allianzen, die zuletzt in `lwa_allianzen` standen — als zweite Quelle.

    **Welche Allianzen es gibt, faellt bisher allein aus der Karte ab, und die
    hat Loecher.** Am 20.09.2026 fehlten auf #1668 neun Allianzen vollstaendig,
    darunter HOT4 und MMAX mit zusammen 187 lebenden Mitgliedern. Sie waeren
    damit auch nie wieder aufgefrischt worden: kein Kartenauftritt, keine
    Anfrage, und ihre Zeilen altern still vor sich hin.

    Was wir schon einmal geholt haben, wird deshalb weiter gefragt — solange es
    nicht laenger als `frisch_tage` her ist. Danach fliegt eine wirklich tote
    Allianz von selbst aus dem Kreis, ohne sie jede Woche erneut anzufragen.
    """
    grenze = (datetime.now(timezone.utc) - timedelta(days=frisch_tage)).isoformat()
    srv = quote(f"#{wz}", safe="")
    zeilen = _alle(f"lwa_allianzen?server=eq.{srv}&select=alliance_id,tag"
                   f"&updated_at=gte.{quote(grenze, safe='')}")
    return {z["alliance_id"]: z.get("tag") for z in zeilen}


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


def _alle(pfad: str, block: int = 1000) -> list[dict]:
    """PostgREST liefert hoechstens `PGRST_DB_MAX_ROWS` (1000) Zeilen je Antwort.

    Ein groesseres `limit` allein hilft deshalb nicht — es wird still gekappt,
    und genau das waere hier gefaehrlich: die fehlenden Zeilen saehen aus wie
    Spieler, die es nicht mehr gibt.
    """
    raus, off = [], 0
    while True:
        teil = _anfrage(f"{pfad}&limit={block}&offset={off}") or []
        raus += teil
        if len(teil) < block:
            return raus
        off += block


def _loeschen(tabelle: str, srv: str, spalte: str, werte: list[str]) -> None:
    for i in range(0, len(werte), 200):
        liste = ",".join(quote(w, safe="") for w in werte[i:i + 200])
        _anfrage(f"{tabelle}?server=eq.{srv}&{spalte}=in.({liste})", "DELETE",
                 prefer="return=minimal")


def verwaiste(wz: int, zeilen: list[dict], geholt: set[str]) -> tuple[list[dict], list[dict], float]:
    """Was in der Tabelle steht und in keiner Quelle dieses Laufs mehr vorkommt.

    **Nur innerhalb geholter Mitgliederlisten.** Naheliegend waere „wer nicht
    mehr auf der Karte steht, ist weg" — und das ist falsch: der Kartenabruf
    laesst regelmaessig ganze Allianzen aus. Am 20.09.2026 fehlten auf #1668
    **neun** (HOT4, 4SEA, DEPH, BHIT, uN1T, GinS, MMAX, SEAT, PHUN, zusammen
    832 Spieler) und dazu einzelne wie `binabean`, der AR1S fuehrt. Nachgefragt
    hatten HOT4 100 und MMAX 87 Mitglieder, gesehen am selben Abend, mit
    Koordinaten mitten im Kerngebiet (428/517, 507/560). Auf die Karte allein
    gestuetzt haette dieser Lauf 836 lebende Spieler geloescht.

    Die Mitgliederliste einer Allianz ist dagegen vollstaendig — 84 der 86
    AR1S-Uids standen auch auf der Karte, die beiden fehlenden lieferte die
    Liste. Wer in ihr fehlt, hat die Allianz verlassen; seine Zeile wuerde
    sonst mit Position, Kraft und Kills von vorletzter Woche stehenbleiben und
    saehe in der Suche wie ein heutiger Nachbar aus.

    Spieler ohne Allianz und Allianzen, deren Liste dieser Lauf nicht geholt
    hat, bleiben deshalb unangetastet — ueber sie weiss er nichts.
    """
    srv = quote(f"#{wz}", safe="")
    frisch = {z["player_uid"] for z in zeilen}
    da = _alle(f"lwa_spieler?server=eq.{srv}&select=player_uid,name,allianz,alliance_id")
    pruefbar = [z for z in da if z.get("alliance_id") in geholt]
    weg = [z for z in pruefbar if z["player_uid"] not in frisch]
    # Eine Allianz faellt mit ihrem letzten Mitglied: `lwa_allianzen` traegt nur
    # Summen ueber Leute, die es dann nicht mehr gibt.
    lebend = {z.get("alliance_id") for z in zeilen}
    alli = _alle(f"lwa_allianzen?server=eq.{srv}&select=alliance_id,tag")
    weg_a = [z for z in alli if z["alliance_id"] in geholt and z["alliance_id"] not in lebend]
    return weg, weg_a, (len(weg) / len(pruefbar) if pruefbar else 0.0)


def raeumen(wz: int, zeilen: list[dict], geholt: set[str],
            erzwingen: bool, schreiben_darf: bool) -> None:
    if not geholt:
        print("  nicht geraeumt — ohne Mitgliederlisten ist „fehlt auf der Karte\" "
              "kein Beleg fuer „gibt es nicht mehr\"")
        return
    weg, weg_a, anteil = verwaiste(wz, zeilen, geholt)
    if not weg and not weg_a:
        print(f"  nichts wegzuraeumen — {len(geholt)} Mitgliederlisten decken sich "
              f"mit der Tabelle")
        return
    tags = sorted({z.get("allianz") or "(ohne)" for z in weg})
    print(f"  verwaist: {len(weg)} Spieler ({anteil:.0%} der geprueften) aus "
          f"{', '.join(tags[:10])} · {len(weg_a)} Allianz-Zeilen ohne Mitglieder")
    # Eine abgebrochene oder verkuerzte Antwort sieht von hier aus wie eine
    # Massenabwanderung. Lieber stehenlassen und melden, als den Server leeren.
    if anteil > RAEUM_ANTEIL and not erzwingen:
        print(f"  ⚠ mehr als {RAEUM_ANTEIL:.0%} — nichts geloescht. Erst nachsehen, "
              f"dann mit --raeumen-erzwingen wiederholen.")
        return
    if not schreiben_darf:
        print("  Probelauf — nichts geloescht.")
        return
    srv = quote(f"#{wz}", safe="")
    _loeschen("lwa_spieler", srv, "player_uid", [z["player_uid"] for z in weg])
    _loeschen("lwa_allianzen", srv, "alliance_id", [z["alliance_id"] for z in weg_a])
    print(f"  weggeraeumt: {len(weg)} Spieler, {len(weg_a)} Allianzen")


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
    p.add_argument("--kein-raeumen", action="store_true",
                   help="Zeilen stehenlassen, die aus einer geholten Mitgliederliste "
                        "verschwunden sind")
    p.add_argument("--raeumen-erzwingen", action="store_true",
                   help=f"auch wegraeumen, wenn mehr als {RAEUM_ANTEIL:.0%} betroffen waeren")
    p.add_argument("--schreiben", action="store_true")
    a = p.parse_args()

    zugang = Zugang()
    for wz in a.server:
        print(f"\n=== Server {wz} ===", flush=True)
        karte, allianzen, scan = karte_lesen(zugang, wz, a.frisch_tage, a.cache_h)
        print(f"  Karte: {len(karte)} Spieler, {len(allianzen)} Allianzen, Scan {str(scan)[:16]}")

        if not a.ohne_mitglieder:
            dazu = {aid: tag for aid, tag in bekannte_allianzen(wz, a.frisch_tage).items()
                    if aid not in allianzen}
            if dazu:
                print(f"  + {len(dazu)} Allianzen, die die Karte diesmal nicht zeigt: "
                      f"{', '.join(sorted(filter(None, dazu.values())))}")
                allianzen.update(dazu)

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
        if not a.kein_raeumen:
            raeumen(wz, zeilen, {k["alliance_id"] for k in kopfe},
                    a.raeumen_erzwingen, a.schreiben)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
