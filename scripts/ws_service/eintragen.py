"""Ein gelesenes Kampfergebnis ins Tool eintragen — Punkte, Fehlende, Aussetzen.

Aufgerufen ueber `ergebnis.py --schreiben` (frischer Lauf) oder
`ergebnis.py --bericht <ordner> --schreiben` (ein schon gelesener Bericht).

Was geschrieben wird:

- **das Event** — eigene und gegnerische Gesamtpunkte, Sieg/Niederlage, der
  Gegner (Server), der MVP (Platz 1 der Rangliste);
- **je Kaderzeile** `played`, `individual_pts`, `rank`. Die Liste aus dem Spiel
  ist die Quelle: wer im fixierten Kader steht und dort fehlt, bekommt
  `played=false` — genau das zeigt die Oberflaeche als „Gefehlt";
- **wer gespielt hat, ohne im Kader zu stehen**, bekommt eine Zeile mit
  `registered=false` — wie in `saveResult2`;
- **wer gefehlt hat, setzt beim naechsten Wuestensturm aus** (`ws_aussetzen`,
  Event eine Woche spaeter).

Was nicht geschrieben wird: Namen, die keinem Kadermitglied zuzuordnen sind.
Sie stehen im Bericht — lieber eine Luecke als Punkte beim Falschen.

**`registered` bleibt, wie es zum Anmeldeschluss festgeschrieben wurde.** Das
Ergebnis sagt, wer gespielt hat, nicht wer angemeldet war — dieselbe Regel wie
in `saveResult2` (siehe CLAUDE.md, „Anmeldeschluss und fixierter Kader").

**Wer entschuldigt ist oder auf der Warteliste stand, setzt nicht aus.** Beides
steht schon in der Kaderzeile (`excused`, `waitlisted`); „durfte nicht" ist
keine Absage.

**Die Ersatzbank zaehlt mit.** Im Wuestensturm spielen alle 30 gleichzeitig —
am 11.09.2026 standen 17 Gesetzte und alle 10 Ersatzspieler in der Rangliste.
Wer als Ersatz eingeplant war und nicht auftaucht, hat also ebenfalls gefehlt.

Drei Sperren gegen das Schreiben an die falsche Stelle, alle mit `--erzwingen`
zu uebergehen: die Gegenprobe der Liste muss aufgehen, mindestens die Haelfte
der gelesenen Spieler muss im Kader dieses Events stehen (sonst ist es die Mail
des anderen Teams), und es duerfen nicht mehr als `MAX_FEHLEND` fehlen.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

from . import tool

MAX_FEHLEND = 10


class EintragFehler(RuntimeError):
    pass


def kandidaten(aid: str, datum: str) -> list[dict]:
    """Die Events, zu denen die Mail passen kann — meist genau eines.

    Die Mail kommt zum Kampfende (13:00 → 13:30), gemeint ist also die letzte
    Startzeit davor. Der Start um 03:00 gehoert zum Freitag davor und steht dort
    im Kalender. Zwei Kandidaten gibt es, wenn A und B zur selben Zeit spielen;
    dann entscheidet `planen` am Kader.
    """
    tag, zeit = datum.split(" ")
    zeit = zeit[:5]
    vortag = str(date.fromisoformat(tag) - timedelta(days=1))
    evs = tool._anfrage(f"ws_events?select=*&alliance_id=eq.{aid}&mode=eq.ws"
                        f"&event_date=in.({vortag},{tag})")
    passend = [e for e in evs if e["event_date"] == tag and (e.get("time_slot") or "") <= zeit]
    if not passend:
        passend = [e for e in evs if e["event_date"] == vortag
                   and (e.get("time_slot") or "") < "06:00"]
    if not passend:
        raise EintragFehler(f"Kein Wuestensturm-Event zur Mail vom {datum}.")
    spaet = max(e.get("time_slot") or "" for e in passend)
    return [e for e in passend if (e.get("time_slot") or "") == spaet]


def _seiten(kopf: dict, server: str | None) -> tuple[dict, dict]:
    """(unsere, gegner) — erkannt an der Servernummer, nicht an der Seite."""
    l, r = kopf.get("links") or {}, kopf.get("rechts") or {}
    norm = lambda s: (s or "").replace(" ", "")
    if server and norm(r.get("server")) == norm(server) != norm(l.get("server")):
        return r, l
    return l, r


def planen(b: dict, aid: str, server: str | None) -> dict:
    """Was geschrieben wuerde — ohne etwas zu schreiben."""
    liste = b["liste"]
    gespielt = {z["spieler"]: z for z in liste if z.get("spieler")}
    bewertet = []
    for e in kandidaten(aid, b["datum"]):
        k = tool._anfrage(f"ws_participation?select=*&event_id=eq.{e['id']}")
        bewertet.append((sum(1 for r in k if r["player_name"] in gespielt), e, k))
    _, ev, kader = max(bewertet, key=lambda t: t[0])
    if not ev.get("roster_locked_at"):
        raise EintragFehler(
            f"Der Kader von Team {ev['team']} am {ev['event_date']} ist nicht fixiert — "
            f"ohne ihn ist nicht zu sagen, wer gefehlt hat.")
    im_kader = {r["player_name"] for r in kader}

    patches, fehlend, entschuldigt = [], [], []
    for r in kader:
        z = gespielt.get(r["player_name"])
        if z:
            patches.append((r, {"played": True, "individual_pts": z["punkte"],
                                "rank": z["platz"]}))
            continue
        patches.append((r, {"played": False, "individual_pts": None, "rank": None}))
        if r.get("waitlisted") or not r.get("registered"):
            continue
        (entschuldigt if r.get("excused") else fehlend).append(r)

    neu = [{"alliance_id": aid, "event_id": ev["id"], "player_name": name,
            "registered": False, "played": True, "excused": False, "substitute": False,
            "individual_pts": z["punkte"], "rank": z["platz"]}
           for name, z in gespielt.items() if name not in im_kader]

    unsere, gegner = _seiten(b.get("kopf") or {}, server)
    ev_patch = {}
    if unsere.get("punkte") and gegner.get("punkte"):
        ev_patch = {"our_pts": unsere["punkte"], "opp_pts": gegner["punkte"],
                    "result": "win" if unsere["punkte"] > gegner["punkte"] else "loss"}
    if not ev.get("opponent") and gegner.get("server"):
        ev_patch["opponent"] = gegner["server"].replace(" ", "")
    if liste and liste[0].get("spieler"):
        ev_patch["mvp_overall"] = liste[0]["spieler"]

    naechstes = str(date.fromisoformat(ev["event_date"]) + timedelta(days=7))
    grund = f"Gefehlt beim Wüstensturm am {ev['event_date']} (Team {ev['team']})"
    aussetzen = [{"alliance_id": aid, "player_name": r["player_name"], "mode": "ws",
                  "event_date": naechstes, "grund": grund, "quelle_event_id": ev["id"]}
                 for r in fehlend]

    return {"event": ev, "ev_patch": ev_patch, "kader": kader, "patches": patches,
            "neu": neu, "fehlend": fehlend, "entschuldigt": entschuldigt,
            "aussetzen": aussetzen, "naechstes": naechstes,
            "offen": [z for z in liste if not z.get("spieler")],
            "treffer_im_kader": sum(1 for n in gespielt if n in im_kader)}


def sperren(b: dict, plan: dict) -> list[str]:
    """Gruende, nicht zu schreiben. Leer heisst: es darf geschrieben werden."""
    gruende = [f"Gegenprobe: {h}" for h in b.get("gegenprobe") or []]
    liste = b["liste"]
    for a, c in zip(liste, liste[1:]):
        if c["punkte"] > a["punkte"]:
            gruende.append(f"Punkte steigen von Platz {a['platz']} zu {c['platz']}")
    if liste and plan["treffer_im_kader"] < len(liste) / 2:
        gruende.append(
            f"Nur {plan['treffer_im_kader']} von {len(liste)} gelesenen Spielern stehen im "
            f"Kader von Team {plan['event']['team']} — ist das die Mail des anderen Teams?")
    if len(plan["fehlend"]) > MAX_FEHLEND:
        gruende.append(f"{len(plan['fehlend'])} Fehlende sind unplausibel viele "
                       f"(Grenze {MAX_FEHLEND}).")
    return gruende


def schreiben(plan: dict, ordner: Path, log=print) -> None:
    ev = plan["event"]
    sicherung = ordner / "sicherung_vor_eintrag.json"
    sicherung.write_text(json.dumps({
        "event": ev, "kader": plan["kader"],
        "aussetzen": tool._anfrage(
            f"ws_aussetzen?select=*&alliance_id=eq.{ev['alliance_id']}"
            f"&event_date=eq.{plan['naechstes']}"),
    }, ensure_ascii=False, indent=2))
    log(f"  Sicherung: {sicherung}")

    if plan["ev_patch"]:
        tool._anfrage(f"ws_events?id=eq.{ev['id']}", "PATCH", plan["ev_patch"])
    for r, patch in plan["patches"]:
        tool._anfrage(f"ws_participation?id=eq.{r['id']}", "PATCH", patch)
    if plan["neu"]:
        tool._anfrage("ws_participation", "POST", plan["neu"])
    if plan["aussetzen"]:
        tool._anfrage("ws_aussetzen?on_conflict=alliance_id,player_name,mode,event_date",
                      "POST", plan["aussetzen"],
                      prefer="resolution=merge-duplicates,return=minimal")
    log(f"  Eingetragen: Event, {len(plan['patches'])} Kaderzeilen, "
        f"{len(plan['neu'])} ausserhalb des Kaders, "
        f"{len(plan['aussetzen'])} zum Aussetzen am {plan['naechstes']}.")


def plan_drucken(plan: dict) -> None:
    ev, p = plan["event"], plan["ev_patch"]
    print(f"\nEvent: Wuestensturm {ev['event_date']} Team {ev['team']} ({ev.get('time_slot')})")
    if p.get("result"):
        print(f"  {'Sieg' if p['result'] == 'win' else 'Niederlage'} "
              f"{p['our_pts']:,} : {p['opp_pts']:,}".replace(",", ".")
              + (f" gegen {p['opponent']}" if p.get("opponent") else ""))
    gespielt = sum(1 for _, x in plan["patches"] if x["played"])
    print(f"  Kader {len(plan['kader'])}: {gespielt} gespielt, "
          f"{len(plan['fehlend'])} gefehlt, {len(plan['entschuldigt'])} entschuldigt")
    if plan["fehlend"]:
        print("\nGefehlt — setzen am " + plan["naechstes"] + " aus:")
        for r in sorted(plan["fehlend"], key=lambda r: (r.get("substitute"), r["player_name"])):
            print(f"  - {r['player_name']}  ({'Ersatz' if r.get('substitute') else 'gesetzt'})")
    if plan["entschuldigt"]:
        print("\nEntschuldigt (setzen nicht aus):")
        for r in plan["entschuldigt"]:
            print(f"  - {r['player_name']}")
    if plan["neu"]:
        print("\nGespielt ohne Platz im Kader:")
        for r in plan["neu"]:
            print(f"  - {r['player_name']}  {r['individual_pts']:,}".replace(",", "."))
    if plan["offen"]:
        print("\nNicht eingetragen (kein Kadername):")
        for z in plan["offen"]:
            print(f"  - Platz {z['platz']}: {z['name_ocr']}  {z['punkte']:,}".replace(",", "."))
