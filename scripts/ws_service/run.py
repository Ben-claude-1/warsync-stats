"""Dienst: Wuestensturm-Anmeldung aus dem Spiel lesen und ins Tool schreiben.

    .venv/bin/python -m scripts.ws_service.run              # nur lesen, Bericht
    .venv/bin/python -m scripts.ws_service.run --schreiben  # und ins Tool uebernehmen
    .venv/bin/python -m scripts.ws_service.run --pruefen    # Koordinaten kontrollieren

**Ohne `--schreiben` wird nichts veraendert.** Der Scan dauert je nach
Allianzgroesse zehn bis zwanzig Minuten; ein Fehlgriff waere die Aufstellung
einer ganzen Woche, deshalb ist Lesen die Vorgabe und Schreiben die Ausnahme.

Geschrieben wird auch dann nur, wenn die Gegenprobe aufgeht: die Zaehler ueber
der Liste („20/20 gesetzt, 10/10 Ersatz") muessen zu dem passen, was gefunden
wurde. Sonst war die Liste nicht vollstaendig durchgelaufen — und eine halb
gelesene Liste ist schlimmer als gar keine, weil sie plausibel aussieht.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

from . import belege, match, navigate, roster, tool
from .device import Geraet, GeraetFehler
from .navigate import AnmeldungGeschlossen, NavigationFehler

BERICHTE = Path.home() / ".local" / "state" / "warsync" / "ws_service"


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def pruefen(g: Geraet) -> int:
    """Zeigt, was der Dienst im aktuellen Bild erkennt — zur Kontrolle."""
    bild = g.bild()
    _log(f"Aufloesung: {bild.shape[1]}x{bild.shape[0]}")
    _log(f"Hauptkarte sichtbar: {navigate.auf_hauptkarte(g, bild)}")
    _log(f"Events offen: {navigate.events_offen(g, bild)} · "
         f"Streifen frei: {navigate.streifen_frei(g, bild)} · "
         f"Blatt: {navigate.blatt_titel(g, bild)!r}")
    _log(f"Teilnehmerliste offen: {navigate.liste_offen(g, bild)}")
    balken = roster.gruppenbalken(g, bild)
    _log(f"Rang-Balken: {balken}")
    koepfe = roster.zeitkoepfe(g, bild)
    _log(f"Zeitkopfzeilen: {[(a, b, f) for a, b, f in koepfe]}")
    if navigate.liste_offen(g, bild):
        _log(f"Zaehler: {roster.dialog_zaehler(g, bild)}")
    for y0, y1, farbe in koepfe:
        if y1 + 210 < g.cfg['list_view'][3]:
            z = roster.zeile_lesen(g, bild, y1)
            z["zeit"] = roster.kopfzeit(g, bild, y0, y1)
            _log(f"  {farbe:6s} {z['zeit']} {z['kraft']} {z['platz']:8s} "
                 f"{z['badge_signal']}  {z['name_ocr']!r}")
    return 0


def lauf(g: Geraet, team: str | None, schreiben: bool, erzwingen: bool,
         bilder: bool = False) -> int:
    aid = tool.allianz_id(g.cfg["alliance_tag"])
    _log(f"Allianz {g.cfg['alliance_tag']} = {aid}")
    stempel = datetime.now().strftime("%Y%m%d_%H%M%S")

    g.starten(log=_log)
    randdaten = navigate.zur_teilnehmerliste(g, team=team, log=_log)

    bilder_ordner = None
    if bilder:
        bilder_ordner = BERICHTE / f"bilder_{stempel}"
        bilder_ordner.mkdir(parents=True, exist_ok=True)
        _log(f"Rohbilder: {bilder_ordner}")

    # Die Beweisbilder laufen **immer** mit, nicht nur auf Wunsch. Sie kosten
    # einen Ausschnitt je gelesener Zeile — der Scan selbst dauert zehn Minuten
    # — und ohne sie ist eine Rueckfrage nach dem Lauf nicht mehr zu beantworten:
    # die Liste im Spiel zeigt dann laengst einen anderen Zustand.
    sammler = belege.Sammler(BERICHTE / f"belege_{stempel}", g.cfg)

    _log("Liste durchlaufen ...")
    roh = roster.durchlauf(g, log=_log, bilder_ordner=bilder_ordner,
                           belege=sammler)
    navigate.dialog_schliessen(g)

    stand = tool.planungsstand(aid)
    ws_time = stand.get("wsTime") or {"A": "13:00", "B": "22:00"}
    # Welches Blatt offen war, sagt seine Kampfzeit. Das steht hier oben, weil
    # zwei Dinge daran haengen: die Bedeutung der Balkenfarbe (gruen ist die
    # Zeit *dieses* Blatts, siehe roster.farb_teams) und weiter unten die
    # Gegenprobe gegen die Zaehler. Das Blatt nennt seine Kampfzeit in
    # Serverzeit, das Tool fuehrt die europaeische — beide Schreibweisen
    # zaehlen (roster.eu_zu_server).
    bz = randdaten.get("blatt_zeit")
    blatt = next((t.upper() for t, z in ws_time.items()
                  if bz and (z == bz or roster.eu_zu_server(z) == bz)),
                 (team or "").upper() or None)
    farb_team, farb_meldung = roster.farb_teams(roh["zeilen"], ws_time, blatt)
    zeilen = roster.zu_werten(roh["zeilen"], ws_time, farb_team)
    _log(f"{len(zeilen)} Zeilen mit Anmeldung gelesen "
         f"(Zeiten laut Tool: {ws_time}).")
    _log(f"Balkenfarben{' laut Blatt ' + blatt if blatt else ' gemessen'}: "
         f"{farb_team or '— keine Zuordnung'}"
         + (f" · {farb_meldung}" if farb_meldung else ""))

    kader = tool.kader(aid)
    erg = match.zuordnen(zeilen, kader)
    zuordnung = {name: t["wert"] for name, t in erg["treffer"].items() if t["wert"]}
    verteilung = Counter(zuordnung.values())
    _log(f"Zugeordnet: {dict(sorted(verteilung.items()))}")

    sammler.kopf = (f"{g.cfg['alliance_tag']} · Blatt {blatt or '?'} · "
                    f"gelesen {datetime.now().strftime('%d.%m.%Y %H:%M')}")
    beleg_index = sammler.abschliessen(
        {n: {"wert": t.get("wert"), "belege": t.get("belege"),
             "kraft": t.get("kraft")} for n, t in erg["treffer"].items()},
        ohne_beleg=[p["name"] for p in kader
                    if p.get("active") and p["name"] not in erg["treffer"]],
        # Ein Scroll-Lauf ankert die Zeilen am Zeit-Balken und sieht damit
        # ueberhaupt nur die Angemeldeten. „Kein Beleg" heisst hier deshalb
        # nicht „nicht angemeldet" — das beantwortet nur der Suchlauf, der
        # jeden Kadernamen einzeln nachschlaegt.
        hinweis="Scroll-Lauf: gesehen werden nur Zeilen mit Zeit-Balken. "
                "Wer hier keinen Beleg hat, wurde nicht gesehen — das ist "
                "keine Aussage darueber, ob er angemeldet war.")
    _log(f"Beweisbilder: {sammler.ordner} "
         f"({len(beleg_index['spieler'])} Spieler)")

    # ── Gegenprobe ────────────────────────────────────────────────────────
    # Welches Blatt offen war, sagt seine Kampfzeit — nur zu dessen Zaehlern
    # passen die gefundenen Werte.
    summe = roh["gruppen_summe"]
    probleme = []
    if farb_meldung:
        probleme.append(farb_meldung)
    if not blatt:
        probleme.append("Kampfzeit des Blattes nicht lesbar — keine Gegenprobe")
    else:
        probleme += roster.zaehler_pruefen(summe, verteilung, blatt,
                                           roh["zaehler"])
        # Zweite Gegenprobe: die Summe der Rang-Zaehler muss die Zahl ueber der
        # Liste treffen. Weichen sie voneinander ab, wurde beim Durchscrollen
        # eine ganze Rang-Gruppe uebersehen — das faellt in den Einzelzaehlern
        # allein nicht auf, weil dort dann schlicht nichts fehlt.
        gesamt = roh["zaehler"]
        soll_g = summe.get("gesetzt")
        if gesamt and soll_g is not None and gesamt.get("gesetzt") != soll_g:
            probleme.append(f"Rang-Summe {soll_g} passt nicht zur Gesamtzahl "
                            f"{gesamt.get('gesetzt')} ueber der Liste")
    if erg["offen"]:
        probleme.append(f"{len(erg['offen'])} Zeilen ohne sicheren Namenstreffer")
    if erg["konflikte"]:
        probleme.append(f"{len(erg['konflikte'])} Spieler mit widerspruechlichen Zeilen")
    streit = roster.zeit_farbe_streit(zeilen)
    if streit:
        probleme.append(streit)

    vorher = stand.get("teamAssign") or {}
    nachher = tool.zusammenfuehren(vorher, zuordnung)
    diff = tool.unterschied(vorher, nachher)
    # Dieselben Zaehler noch einmal, diesmal gegen das Ergebnis statt gegen
    # den Fund: wer aussortiert wurde und dessen Zeile dieser Lauf nicht
    # gesehen hat, bleibt sonst still auf seinem alten 'A' stehen.
    if blatt:
        probleme += roster.bestand_pruefen(nachher, blatt, summe,
                                           roh["zaehler"], zuordnung)

    bericht = {
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "allianz": g.cfg["alliance_tag"], "team_blatt": blatt,
        "blatt_zeit": randdaten.get("blatt_zeit"),
        "anmeldung_endet_in": randdaten["anmeldung_endet_in"],
        "gruppen": roh["gruppen"], "gruppen_summe": summe,
        "zaehler_gesamt": roh["zaehler"],
        "farb_team": farb_team,
        "verteilung": dict(sorted(verteilung.items())),
        "zuordnung": zuordnung,
        "beide_zeiten": match.beide_zeiten(erg["treffer"]),
        "offen": [{"name_ocr": o.get("name_ocr"), "kraft": o.get("kraft"),
                   "wert": o.get("wert"), "grund": o.get("grund")}
                  for o in erg["offen"]],
        "konflikte": [{"spieler": k["spieler"], "werte": k["werte"]}
                      for k in erg["konflikte"]],
        "probleme": probleme,
        "belege": str(sammler.ordner),
        "diff": {"neu": diff["neu"],
                 "geaendert": {k: {"vorher": a, "nachher": b}
                               for k, (a, b) in diff["geaendert"].items()},
                 "unveraendert": diff["unveraendert"]},
        "geschrieben": False,
    }

    BERICHTE.mkdir(parents=True, exist_ok=True)
    # Derselbe Stempel wie der Beleg-Ordner — sonst steht der Bericht unter
    # einer anderen Uhrzeit als seine Bilder und beide sind nicht mehr paarweise
    # zu finden.
    ziel = BERICHTE / f"scan_{stempel}.json"

    print()
    for zeile in _zusammenfassung(bericht):
        print(zeile)

    if schreiben:
        # Unabhaengig von der Teilnehmerliste: die Heldenkraft steht schon in
        # jeder sicher zugeordneten Zeile und darf auch dann aktualisiert
        # werden, wenn die Gegenprobe unten die Teilnehmerliste verwirft —
        # eine unvollstaendig gescannte Liste sagt nichts darueber, ob die
        # gelesenen Zeilen selbst falsch waeren.
        hk = tool.schreibe_heldenkraft(aid, kader, erg["treffer"])
        if hk:
            _log(f"Heldenkraft aktualisiert: {len(hk)} Spieler.")
        bericht["heldenkraft"] = {n: {"vorher": v, "nachher": nw} for n, (v, nw) in hk.items()}

    if schreiben and probleme and not erzwingen:
        _log("NICHT geschrieben — die Gegenprobe geht nicht auf (siehe oben).")
        _log("Wenn das bewusst so sein soll: nochmal mit --erzwingen.")
    elif schreiben:
        sicherung = tool.sicherung_schreiben(aid, BERICHTE / "sicherungen")
        _log(f"Sicherung des bisherigen Stands: {sicherung}")
        tool.schreibe_teamassign(aid, nachher)
        bericht["geschrieben"] = True
        bericht["sicherung"] = str(sicherung)
        _log(f"Geschrieben: {len(diff['neu'])} neu, {len(diff['geaendert'])} geaendert.")
        _log("Im Browser einmal neu laden — ein offener Tab kennt den neuen Stand nicht.")

    ziel.write_text(json.dumps(bericht, ensure_ascii=False, indent=1))
    _log(f"Bericht: {ziel}")
    return 0 if not probleme else 2


def _zusammenfassung(b: dict) -> list[str]:
    z = [f"── Wuestensturm {b['allianz']} · Blatt {b['team_blatt'] or '?'} "
         f"({b.get('blatt_zeit') or '?'}) "
         f"· Anmeldung endet in {b['anmeldung_endet_in'] or '?'} ──"]
    for wert in ("A", "AE", "B", "BE", "C"):
        namen = sorted(n for n, w in b["zuordnung"].items() if w == wert)
        z.append(f"{wert:3s} ({len(namen):2d}): {', '.join(namen) if namen else '—'}")
    z += match.beide_zeiten_text(b.get("beide_zeiten") or {})
    d = b["diff"]
    z.append(f"Gegenueber dem Tool: {len(d['neu'])} neu, "
             f"{len(d['geaendert'])} geaendert, {d['unveraendert']} unveraendert")
    if b["offen"]:
        z.append("Ohne sicheren Treffer:")
        z += [f"  {o['name_ocr']!r} ({o['kraft']}M) → {o['grund']}" for o in b["offen"]]
    if b["konflikte"]:
        z.append("Widersprueche: " + ", ".join(
            f"{k['spieler']} {k['werte']}" for k in b["konflikte"]))
    if b["probleme"]:
        z.append("PROBLEME: " + " · ".join(b["probleme"]))
    return z


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--team", default=None, choices=["A", "B"],
                   help="Auf dieses Blatt umschalten. Ohne Angabe wird "
                        "genommen, was offen ist — die Liste zeigt ohnehin "
                        "beide Teams, das Blatt bestimmt nur, welche Zaehler "
                        "zur Gegenprobe danebenstehen.")
    p.add_argument("--schreiben", action="store_true",
                   help="Ergebnis ins Tool uebernehmen (sonst nur Bericht).")
    p.add_argument("--erzwingen", action="store_true",
                   help="Auch schreiben, wenn die Gegenprobe nicht aufgeht.")
    p.add_argument("--pruefen", action="store_true",
                   help="Nur zeigen, was im aktuellen Bild erkannt wird.")
    p.add_argument("--bilder", action="store_true",
                   help="Jedes Bild des Laufs als Beleg ablegen. Grundlage, um "
                        "eine Aenderung an der Erkennung am selben Material zu "
                        "messen, statt den Scan dafuer zu wiederholen.")
    a = p.parse_args(argv)

    g = Geraet()
    try:
        if a.pruefen:
            return pruefen(g)
        return lauf(g, a.team, a.schreiben, a.erzwingen, a.bilder)
    except AnmeldungGeschlossen as e:
        _log(str(e))
        return 3
    except (GeraetFehler, NavigationFehler, roster.ScanFehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
