"""Zu- und Abgänge der Allianz aus dem Spiel lesen — nachts, ohne LW Atlas.

Der Weg (vorgemacht von Ben am 28.10.2026, Mitschnitt
`~/.local/state/warsync/aufnahme/20261028_005604_allianz_zu_abgaenge`):
Basis → „Allianz" → „Verlauf" → Reiter „Mitglieder" → nach unten scrollen.

    .venv/bin/python -u -m scripts.allianz_protokoll.run               # lesen, Bericht
    .venv/bin/python -u -m scripts.allianz_protokoll.run --schreiben   # und eintragen
    .venv/bin/python -u -m scripts.allianz_protokoll.run --alles       # bis ans Listenende
    .venv/bin/python -m scripts.allianz_protokoll.run --ordner <pfad>  # aus Bildern neu rechnen

**Warum das Protokoll und nicht die Mitgliederliste.** LW Atlas lieferte zwei
Stände, und der Unterschied war zu erraten — die Hälfte der vermeintlichen
Abgänge am 12.09.2026 waren Umbenennungen. Das Protokoll sagt es ausdrücklich:
„X hat die Allianz verlassen", „Y hat X entfernt", „Y hat die
Beitrittsanfrage von X akzeptiert", dazu jede Rangänderung — mit Uhrzeit.

**Gelesen wird nur, was neu ist.** Der Lauf scrollt, bis er auf einen Eintrag
stößt, der älter ist als der neueste in `allianz_protokoll` — eine Nacht kostet
damit ein, zwei Bilder statt der ganzen Liste. `--alles` liest bis ans Ende
(erster Lauf, oder wenn eine Nacht ausgefallen ist und man sichergehen will).

**`--schreiben` trägt zweierlei ein.** Erst die Einträge selbst nach
`allianz_protokoll`, dann die Folgen in `ws_players`: wer zuletzt gegangen ist,
wird `active=false`, wer zuletzt beigetreten ist und im Kader stand, wieder
`active=true`, und der letzte Rang aus dem Protokoll wird `role`. Maßgeblich ist
je Spieler der **jüngste** Eintrag — skyluna ist am 23.10. gegangen und am 24.10.
wiedergekommen, und genau so steht sie dann im Kader.

Nicht angewendet wird, was nicht sicher ist: ein Name ohne sicheren
Kadertreffer, und ein Eintrag, dessen Symbolfarbe dem Satz widerspricht
(`lesen.py`). Beides steht im Bericht.

**Ein Neuzugang wird angelegt** (Vorgabe Ben, 28.10.2026: „die Informationen
sollen automatisch ein Update im Tool machen"), mit dem gelesenen Namen — der
haeufigsten Lesung ueber alle Bilder — und dem Rang aus dem Protokoll, sonst
R1. Der Name kommt aus der Texterkennung; jeder angelegte steht deshalb im
Bericht, und `ws_service.suchlauf --namen <name>` prueft, ob das Spiel ihn
unter genau diesem Namen kennt.

Ablage: ~/.local/state/warsync/allianz_protokoll/<zeit>/
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from scripts.ws_service import ergebnis, match, tool
from scripts.ws_service.device import CONFIG, Geraet, GeraetFehler
from scripts.ws_service.navigate import NavigationFehler, warte_auf_spiel, zur_hauptkarte

from . import lesen

STAND = Path.home() / ".local/state/warsync/allianz_protokoll"
# So viele Bilder ohne einen einzigen neuen Eintrag gelten als Listenende.
STILLSTAND = 3
MAX_SCHRITTE = 150
# Eine Einblendung („… erhalten!") steht ein, zwei Sekunden.
EINBLENDUNG_WARTEN_S = 2.5
MITGLIEDSCHAFT = ("zugang", "abgang", "entfernt")
# So viele Zu-/Abgaenge in Folge, die schon zum Kader passen, beenden das Lesen.
# **Nicht einer.** In der Aufnahme vom 28.10.2026 passte skyluna (Zugang 24.10.)
# bereits — direkt dahinter standen lemon小木瓜 und I54I (Abgang 23.10.), beide
# im Tool noch aktiv. Beim ersten Treffer abzubrechen haette genau sie verloren.
PASST_IN_FOLGE = 3

# Wo die Knöpfe stehen (2560×2560, Aufnahme 28.10.2026). Gesucht wird das Wort
# im Ausschnitt, getippt wird dort, wo es steht — die Ausschnitte sind nur der
# Suchbereich.
BOX_ALLIANZ = (2100, 1700, 2560, 2000)     # Beschriftung unter dem Allianz-Symbol
BOX_LEISTE = (500, 2350, 1900, 2560)       # Verlauf · Bewerber · Allianzstern …
BOX_TITEL = (0, 0, 1300, 160)
BOX_REITER = (0, 200, 1800, 360)           # Krieg · Mitglieder · Nachricht · Event


def _log(msg: str = "") -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}" if msg else "", flush=True)


# ── Navigation ───────────────────────────────────────────────────────────
def _texte(g: Geraet, box, bild=None) -> list[dict]:
    """Vision statt Tesseract: die Knopfschrift ist verziert, Tesseract fand
    am 28.10.2026 weder „Allianz" noch „Verlauf"."""
    bild = g.bild() if bild is None else bild
    return ergebnis.zeilen_lesen(bild, box)


def _finde(texte: list[dict], wort: str) -> dict | None:
    ziel = match.norm(wort)
    return next((t for t in texte if ziel in match.norm(t["t"])), None)


def _titel(g: Geraet, bild=None) -> str:
    return " ".join(t["t"] for t in _texte(g, BOX_TITEL, bild))


def _warte_auf_titel(g: Geraet, wort: str, sekunden: float = 10.0) -> bool:
    ende = time.monotonic() + sekunden
    while time.monotonic() < ende:
        if match.norm(wort) in match.norm(_titel(g)):
            return True
        time.sleep(1.0)
    return False


def _tippe_wort(g: Geraet, box, wort: str, dy: int = 0) -> None:
    t = _finde(_texte(g, box), wort)
    if not t:
        raise NavigationFehler(f"'{wort}' ist nicht zu sehen.")
    g.tippen(int(t["x"] + t["w"] / 2), int(t["y"] + t["h"] / 2) + dy, pause=2.0)


def zum_protokoll(g: Geraet, log=print) -> None:
    """Von wo auch immer bis in den Reiter „Mitglieder" der Allianz-Protokolle."""
    if not _warte_auf_titel(g, "Allianz-Protokolle", sekunden=1):
        zur_hauptkarte(g, log=log)
        log("  Allianz oeffnen ...")
        # Getippt wird aufs Symbol, nicht auf die Beschriftung darunter — dort hat
        # Ben getippt, und dort ist die Flaeche groesser.
        _tippe_wort(g, BOX_ALLIANZ, "Allianz", dy=-30)
        if not _warte_auf_titel(g, "Allianz"):
            raise NavigationFehler("Die Allianz-Seite hat sich nicht geoeffnet.")
        log("  Verlauf oeffnen ...")
        _tippe_wort(g, BOX_LEISTE, "Verlauf")
        if not _warte_auf_titel(g, "Allianz-Protokolle"):
            raise NavigationFehler("Die Allianz-Protokolle haben sich nicht geoeffnet.")
    # Erst ein anderer Reiter, dann „Mitglieder": stand die Liste schon offen
    # und heruntergescrollt, faengt sie so wieder oben an — gelesen wird von
    # neu nach alt, und der Anfang ist genau das Neue.
    log("  Reiter 'Krieg', dann 'Mitglieder' ...")
    _tippe_wort(g, BOX_REITER, "Krieg")
    _tippe_wort(g, BOX_REITER, "Mitglieder")
    time.sleep(1.5)


# ── Lesen ────────────────────────────────────────────────────────────────
def passt_zum_kader(roh: list[dict], kader_: list[dict]) -> int:
    """Wie viele Zu-/Abgaenge, vom neuesten an, schon zum Kader passen — in Folge.

    Gezaehlt wird ab dem ersten passenden; ein unpassender dazwischen setzt die
    Zaehlung zurueck. **Ein Eintrag, den ein juengerer desselben Spielers
    ueberholt hat, zaehlt nicht** — skylunas Abgang vom 23.10. ist durch ihren
    Zugang vom 24.10. erledigt und sagt ueber den Stand des Tools nichts.
    Namen ohne sicheren Kadertreffer zaehlen ebenso nicht: ein Abgang, der im
    Kader nie stand, passt trivial und beweist nichts.

    Rangaenderungen zaehlen nicht mit. Raenge werden auch von Hand gepflegt
    und koennen stimmen, obwohl ein Austritt davor fehlt.
    """
    eintraege = lesen.zusammenfuehren(roh)
    zuordnen(eintraege, kader_)
    nach_name = {p["name"]: p for p in kader_}
    gesehen, folge, beste = set(), 0, 0
    for x in eintraege:                         # neueste zuerst
        name = x["spieler_kader"]
        if x["art"] not in MITGLIEDSCHAFT or not name or x["unsicher"]:
            continue
        if name in gesehen:
            continue
        gesehen.add(name)
        passt = bool(nach_name[name].get("active")) == (x["art"] == "zugang")
        folge = folge + 1 if passt else 0
        beste = max(beste, folge)
    return beste



def durchlesen(g: Geraet, ordner: Path, bis: str | None, kader_: list[dict],
               log=print) -> dict:
    """Nach unten scrollen, bis Bekanntes erreicht ist oder die Liste endet.

    Zwei Wege, Bekanntes zu erkennen:

    - `bis`, der Zeitstempel des neuesten Eintrags in `allianz_protokoll`.
      Sobald ein Bild einen **aelteren** zeigt, ist alles Neue gesehen.
    - Der Kader selbst (Vorgabe Ben, 28.10.2026: „sobald du eine Zeile
      findest, die schon mit dem aktuellen Stand zusammenpasst, kannst du
      abbrechen"). Das traegt auch dann, wenn die Tabelle leer ist oder eine
      Nacht fehlt — gezaehlt werden `PASST_IN_FOLGE` Zu-/Abgaenge in Folge.
    """
    ordner.mkdir(parents=True, exist_ok=True)
    roh, gesehen, still = [], set(), 0
    grund = "Schrittgrenze erreicht"
    for n in range(MAX_SCHRITTE):
        bild = g.bild()
        eintraege, einblendung = lesen.eintraege_im_bild(bild, erstes_bild=(n == 0))
        for _ in range(2):
            if not einblendung:
                break
            time.sleep(EINBLENDUNG_WARTEN_S)
            bild = g.bild()
            eintraege, einblendung = lesen.eintraege_im_bild(bild, erstes_bild=(n == 0))
        Image.fromarray(bild).save(ordner / f"bild_{n:03d}.png")
        for x in eintraege:
            x["bild"] = n
        roh += eintraege
        neu = {(x["zeit"], x["art"]) for x in eintraege} - gesehen
        gesehen |= neu
        log(f"  Bild {n:3d}: {len(eintraege)} Eintraege, {len(neu)} neu"
            + (f", aeltester {min(x['zeit'] for x in eintraege)}" if eintraege else ""))
        if bis and any(x["zeit"] < bis for x in eintraege):
            grund = f"Bekanntes erreicht (neuester bekannter Eintrag {bis})"
            break
        if kader_ and passt_zum_kader(roh, kader_) >= PASST_IN_FOLGE:
            grund = (f"Stand des Kaders erreicht ({PASST_IN_FOLGE} Zu-/Abgaenge "
                     f"in Folge passen schon)")
            break
        still = 0 if neu else still + 1
        if still >= STILLSTAND:
            grund = "Listenende"
            break
        g.liste_weiter(variante=still)
    log(f"  Ende: {grund}")
    (ordner / "roh.json").write_text(json.dumps(
        {"grund": grund, "bis": bis, "roh": roh}, ensure_ascii=False, indent=1))
    return {"roh": roh, "grund": grund}


def aus_bildern(ordner: Path) -> dict:
    roh = []
    for n, p in enumerate(sorted(ordner.glob("bild_*.png"))):
        bild = cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB)
        eintraege, _ = lesen.eintraege_im_bild(bild, erstes_bild=(n == 0))
        roh += eintraege
    return {"roh": roh, "grund": "aus Bildern"}


# ── Zuordnen und Schreiben ───────────────────────────────────────────────
def kader(aid: str) -> list[dict]:
    return tool._anfrage(
        f"ws_players?select=name,active,role,hero_power&alliance_id=eq.{aid}&limit=1000")


def zuordnen(eintraege: list[dict], kader_: list[dict]) -> None:
    """`spieler_kader` an jeden Eintrag — der ganze Kader, auch die Stillgelegten:
    wer wiederkommt, steht dort als `active=false`."""
    tabelle = match.namenstabelle(kader_)
    for x in eintraege:
        u = match.eine_zeile({"name_ocr": x["spieler"]}, tabelle)
        x["spieler_kader"] = u["spieler"]
        x["vermutlich"] = None if u["spieler"] else u.get("bester")


def bestand(aid: str) -> list[dict]:
    return tool._anfrage(
        f"allianz_protokoll?select=id,zeit,art,spieler,spieler_kader,rang_nach,symbol"
        f"&alliance_id=eq.{aid}&order=zeit.desc&limit=5000") or []


def _zeit(z: str) -> str:
    """PostgREST liefert `2026-10-27T11:31:42`, gelesen wird `2026-10-27 11:31:42`."""
    return z.replace("T", " ")[:19]


def schreibe_eintraege(aid: str, eintraege: list[dict], alt: list[dict]) -> list[dict]:
    """Neue Einträge eintragen; was schon dasteht, bleibt unberührt.

    **„Schon da" heißt: gleiche Sekunde, gleiche Art, ähnlicher Name.** Der
    eindeutige Schlüssel der Tabelle vergleicht den Namen wörtlich, und die
    Texterkennung liest `I54I` in einer Nacht als `154I`, in der nächsten als
    `1541`. Ohne den unscharfen Vergleich stünde derselbe Austritt zweimal da.
    Ein `sonstig` von früher, zu dem jetzt ein lesbarer Satz kam, wird ersetzt.
    """
    neu = []
    for x in eintraege:
        gleiche = [a for a in alt if _zeit(a["zeit"]) == x["zeit"]]
        if x["art"] == "sonstig" and gleiche:
            continue
        if any(a["art"] == x["art"] and lesen._aehnlich(a["spieler"], x["spieler"]) >= 0.6
               for a in gleiche):
            continue
        for a in gleiche:
            if a["art"] == "sonstig":
                tool._anfrage(f"allianz_protokoll?id=eq.{a['id']}", methode="DELETE")
        neu.append(x)
    if neu:
        tool._anfrage("allianz_protokoll", methode="POST", prefer="return=minimal", rumpf=[{
            "alliance_id": aid, "zeit": x["zeit"], "art": x["art"],
            "spieler": x["spieler"], "spieler_kader": x["spieler_kader"],
            "akteur": x["akteur"], "rang_von": x["rang_von"], "rang_nach": x["rang_nach"],
            "text": x["text"], "symbol": x["symbol"]} for x in neu])
    return neu


def folgen(protokoll: list[dict], kader_: list[dict]) -> list[dict]:
    """Was das Protokoll für `ws_players` heißt — je Spieler der jüngste Stand.

    Gerechnet über **alle** Einträge in der Tabelle, nicht nur die dieser
    Nacht: dann ist es egal, ob eine Nacht ausgefallen ist, und ein zweiter
    Lauf ändert nichts mehr (idempotent).
    """
    nach_name = {p["name"]: p for p in kader_}
    mitglied, rang = {}, {}
    for e in sorted(protokoll, key=lambda e: _zeit(e["zeit"])):
        name = e.get("spieler_kader")
        if not name or name not in nach_name:
            continue
        soll = lesen.FARBE_VON.get(e["art"])
        if soll and e.get("symbol") and e["symbol"] != soll:
            continue                            # Satz und Symbol widersprechen sich
        if e["art"] in MITGLIEDSCHAFT:
            mitglied[name] = e
        elif e["art"] == "rang" and e.get("rang_nach"):
            rang[name] = e
    out = []
    for name, e in mitglied.items():
        aktiv = e["art"] == "zugang"
        if bool(nach_name[name].get("active")) != aktiv:
            out.append({"name": name, "feld": "active", "alt": nach_name[name].get("active"),
                        "neu": aktiv, "grund": f"{e['art']} {_zeit(e['zeit'])}"})
    for name, e in rang.items():
        # Wer zuletzt gegangen ist, behaelt seinen alten Rang im Kader — er
        # zaehlt dort ohnehin nicht mehr mit.
        if name in mitglied and mitglied[name]["art"] != "zugang":
            continue
        soll = f"R{e['rang_nach']}"
        if nach_name[name].get("role") != soll:
            out.append({"name": name, "feld": "role", "alt": nach_name[name].get("role"),
                        "neu": soll, "grund": f"rang {_zeit(e['zeit'])}"})
    return out


def folgen_schreiben(aid: str, aenderungen: list[dict]) -> None:
    for a in aenderungen:
        tool._anfrage(
            f"ws_players?alliance_id=eq.{aid}&name=eq.{urllib.parse.quote(a['name'])}",
            methode="PATCH", rumpf={a["feld"]: a["neu"]}, prefer="return=minimal")


# Aehnelt ein unbekannter Name einem Kadernamen so stark, wird er nicht
# angelegt, sondern gemeldet — eher eine Fehllesung eines Bekannten als ein
# neuer Spieler. `match.eine_zeile` verlangt fuer einen Treffer mehr; dazwischen
# liegt genau der Bereich, in dem ein Doppel im Kader entstuende.
ANLEGEN_HOECHSTENS = 0.6


def neuzugaenge(protokoll: list[dict], kader_: list[dict]) -> list[dict]:
    """Wer zuletzt beigetreten ist und im Kader keinen Treffer hat.

    Gruppiert wird ueber den gelesenen Namen (aehnlich, nicht gleich — dieselbe
    Lesart schwankt von Nacht zu Nacht). Wer nach dem Beitritt wieder gegangen
    ist, wird nicht angelegt: er waere sofort wieder stillzulegen.
    """
    gruppen: list[list[dict]] = []
    for e in sorted(protokoll, key=lambda e: _zeit(e["zeit"])):
        if e.get("spieler_kader") or e["art"] == "sonstig":
            continue
        for gr in gruppen:
            if lesen._aehnlich(gr[0]["spieler"], e["spieler"]) >= 0.8:
                gr.append(e)
                break
        else:
            gruppen.append([e])
    out = []
    for gr in gruppen:
        mitglied = [e for e in gr if e["art"] in MITGLIEDSCHAFT]
        if not mitglied or mitglied[-1]["art"] != "zugang":
            continue
        soll = lesen.FARBE_VON["zugang"]
        if mitglied[-1].get("symbol") and mitglied[-1]["symbol"] != soll:
            continue
        name = mitglied[-1]["spieler"].strip()
        if len(match.norm(name)) < 2:
            continue
        rang = [e for e in gr if e["art"] == "rang" and e.get("rang_nach")]
        u = match.eine_zeile({"name_ocr": name}, match.namenstabelle(kader_))
        if u["aehnlichkeit"] >= ANLEGEN_HOECHSTENS:
            out.append({"name": name, "zweifel": f"aehnlich {u['bester']!r} "
                        f"({u['aehnlichkeit']:.2f}) — nicht angelegt",
                        "role": None, "zeit": _zeit(mitglied[-1]["zeit"]), "lesarten": []})
            continue
        out.append({"name": name, "role": f"R{rang[-1]['rang_nach']}" if rang else "R1",
                    "zeit": _zeit(mitglied[-1]["zeit"]),
                    "lesarten": sorted({e["spieler"] for e in gr})})
    return out


def neuzugaenge_anlegen(aid: str, angelegt: list[dict]) -> None:
    """Wie „Neuen Spieler anlegen" im Admin-Bereich (`adminCreatePlayer`),
    danach die Protokollzeilen auf den neuen Kadernamen zeigen lassen — sonst
    legte der naechste Lauf ihn ein zweites Mal an."""
    for a in angelegt:
        tool._anfrage("ws_players", methode="POST", prefer="return=minimal", rumpf=[{
            "alliance_id": aid, "name": a["name"], "role": a["role"],
            "profession": "Ingenieur", "active": True}])
        for lesart in a["lesarten"]:
            tool._anfrage(
                f"allianz_protokoll?alliance_id=eq.{aid}&spieler_kader=is.null"
                f"&spieler=eq.{urllib.parse.quote(lesart)}",
                methode="PATCH", rumpf={"spieler_kader": a["name"]}, prefer="return=minimal")


# ── Bericht ──────────────────────────────────────────────────────────────
WORT = {"zugang": "Zugang", "abgang": "Abgang", "entfernt": "Entfernt",
        "rang": "Rang", "sonstig": "Sonstig"}


def bericht_zeigen(eintraege: list[dict], log=print) -> None:
    for x in eintraege:
        name = x["spieler"]
        if x["spieler_kader"] and x["spieler_kader"] != name:
            name += f" (= {x['spieler_kader']})"
        elif not x["spieler_kader"]:
            name += " (nicht im Kader" + (f", aehnlich {x['vermutlich']!r}"
                                         if x.get("vermutlich") else "") + ")"
        zusatz = ""
        if x["art"] == "rang":
            zusatz = f" R{x['rang_von']} → R{x['rang_nach']}"
        if x["akteur"]:
            zusatz += f"  durch {x['akteur']}"
        if x["unsicher"]:
            zusatz += f"  UNSICHER (Symbol {x['symbol']})"
        if x["art"] == "sonstig":
            zusatz = f"  Text: {x['text']!r}"
        log(f"  {x['zeit']}  {WORT[x['art']]:8s} {name}{zusatz}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--schreiben", action="store_true",
                    help="Eintraege speichern und den Kader nachziehen")
    ap.add_argument("--alles", action="store_true",
                    help="bis ans Listenende lesen, nicht nur bis zum Bekannten")
    ap.add_argument("--ordner", help="nicht scannen, sondern aus diesen Bildern rechnen")
    ap.add_argument("--neustart", action="store_true",
                    help="BlueStacks vorher frisch starten (siehe vs_service/run.py)")
    args = ap.parse_args()

    aid = tool.allianz_id(CONFIG["alliance_tag"])
    kader_ = kader(aid)
    alt = bestand(aid)
    bis = None if args.alles or not alt else _zeit(alt[0]["zeit"])
    _log(f"Allianz {CONFIG['alliance_tag']}, {len(kader_)} im Kader "
         f"({sum(1 for p in kader_ if p.get('active'))} aktiv), "
         f"{len(alt)} Eintraege bekannt" + (f", neuester {bis}" if bis else ""))

    if args.ordner:
        wurzel = Path(args.ordner)
        erg = aus_bildern(wurzel)
    else:
        wurzel = STAND / f"{datetime.now():%Y%m%d_%H%M%S}"
        try:
            g = Geraet(CONFIG)
            g.starten(log=_log, neu=args.neustart)
            if args.neustart or not g.app_laeuft():
                g.app_starten(log=_log)
            # **Immer abwarten, bevor getippt wird.** Am 28.10.2026 lief der
            # Suchlauf direkt nach einem Neustart an, Last War lud noch, und
            # sechsmal „Zurueck" beendete das Spiel. warte_auf_spiel schaut nur.
            # Steht das Protokoll schon offen (etwa nach einer Vorfuehrung), gibt
            # es nichts zu warten — warte_auf_spiel sucht die Basis und saehe sie
            # drei Minuten lang nicht.
            if not _warte_auf_titel(g, "Allianz-Protokolle", sekunden=1):
                warte_auf_spiel(g, log=_log)
            zum_protokoll(g, log=_log)
            erg = durchlesen(g, wurzel, bis, None if args.alles else kader_, log=_log)
            # Zurueck auf die Basis — der naechste Lauf (VS um 05:00) soll dort anfangen.
            try:
                zur_hauptkarte(g, log=_log)
            except NavigationFehler:
                pass
        except (GeraetFehler, NavigationFehler) as e:
            _log(f"ABBRUCH: {e}")
            return 2
    _log(f"Ablage: {wurzel}")

    eintraege = lesen.zusammenfuehren(erg["roh"])
    zuordnen(eintraege, kader_)
    if bis:
        eintraege = [x for x in eintraege if x["zeit"] >= bis]
    _log()
    _log(f"{len(eintraege)} Eintraege gelesen ({erg['grund']}):")
    bericht_zeigen(eintraege, log=_log)

    neu, aenderungen = [], []
    if args.schreiben:
        neu = schreibe_eintraege(aid, eintraege, alt)
        _log()
        _log(f"Neu eingetragen: {len(neu)} (schon bekannt: {len(eintraege) - len(neu)})")
        aenderungen = folgen(bestand(aid), kader_)
    else:
        # Ohne --schreiben zeigen, was der Kader nachziehen wuerde — gerechnet
        # ueber Bekanntes plus Gelesenes.
        aenderungen = folgen(alt + [{**x} for x in eintraege], kader_)
    _log()
    _log(f"Kader: {len(aenderungen)} Aenderung(en)"
         + ("" if args.schreiben else " — nur Vorschau, ohne --schreiben"))
    for a in aenderungen:
        _log(f"  {a['name']}: {a['feld']} {a['alt']} → {a['neu']}  ({a['grund']})")
    if args.schreiben and aenderungen:
        folgen_schreiben(aid, aenderungen)
        _log("  eingetragen.")

    angelegt = neuzugaenge(bestand(aid) if args.schreiben
                           else alt + [{**x} for x in eintraege], kader_)
    if angelegt:
        _log()
        _log(f"Neu in der Allianz, noch nicht im Kader ({len(angelegt)})"
             + ("" if args.schreiben else " — nur Vorschau, ohne --schreiben") + ":")
        for a in angelegt:
            _log(f"  {a['name']}  {a.get('zweifel') or a['role']}  (aufgenommen {a['zeit']})")
        if args.schreiben:
            neuzugaenge_anlegen(aid, [a for a in angelegt if not a.get("zweifel")])
            _log("  angelegt (ausser den zweifelhaften).")

    (wurzel / "bericht.json").write_text(json.dumps({
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "grund": erg["grund"], "bis": bis, "eintraege": eintraege,
        "neu_eingetragen": len(neu), "kader_aenderungen": aenderungen,
        "angelegt": angelegt,
        "geschrieben": args.schreiben,
    }, ensure_ascii=False, indent=1, default=str))
    _log(f"Bericht: {wurzel / 'bericht.json'}")

    # Wie beim VS-Dienst: ein Lauf ohne einen einzigen lesbaren Eintrag ist
    # ein Fehler, keine ruhige Nacht. Das Protokoll ist nie leer — selbst ohne
    # Neues steht der zuletzt bekannte Eintrag im ersten Bild.
    if not erg["roh"]:
        _log("FEHLER: kein einziger Eintrag gelesen. Die Bilder zeigen, was dastand.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
