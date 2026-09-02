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

from . import match, navigate, roster, tool
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


def lauf(g: Geraet, team: str | None, schreiben: bool, erzwingen: bool) -> int:
    aid = tool.allianz_id(g.cfg["alliance_tag"])
    _log(f"Allianz {g.cfg['alliance_tag']} = {aid}")

    g.starten(log=_log)
    randdaten = navigate.zur_teilnehmerliste(g, team=team, log=_log)

    _log("Liste durchlaufen ...")
    roh = roster.durchlauf(g, log=_log)
    navigate.dialog_schliessen(g)

    stand = tool.planungsstand(aid)
    ws_time = stand.get("wsTime") or {"A": "13:00", "B": "22:00"}
    zeilen = roster.zu_werten(roh["zeilen"], ws_time)
    _log(f"{len(zeilen)} Zeilen mit Anmeldung gelesen "
         f"(Zeiten laut Tool: {ws_time}).")

    kader = tool.kader(aid)
    erg = match.zuordnen(zeilen, kader)
    zuordnung = {name: t["wert"] for name, t in erg["treffer"].items() if t["wert"]}
    verteilung = Counter(zuordnung.values())
    _log(f"Zugeordnet: {dict(sorted(verteilung.items()))}")

    # ── Gegenprobe ────────────────────────────────────────────────────────
    # Welches Blatt offen war, sagt seine Kampfzeit — nur zu dessen Zaehlern
    # passen die gefundenen Werte.
    summe = roh["gruppen_summe"]
    blatt = next((t.upper() for t, z in ws_time.items()
                  if z == randdaten.get("blatt_zeit")), (team or "").upper() or None)
    probleme = []
    if not blatt:
        probleme.append("Kampfzeit des Blattes nicht lesbar — keine Gegenprobe")
    else:
        soll_g, soll_e = summe.get("gesetzt"), summe.get("ersatz")
        ist_g, ist_e = verteilung.get(blatt, 0), verteilung.get(blatt + "E", 0)
        if soll_g is None or soll_e is None:
            probleme.append("Rang-Zaehler nicht vollstaendig lesbar — keine Gegenprobe")
        else:
            if ist_g != soll_g:
                probleme.append(f"gesetzt {blatt}: gefunden {ist_g}, Spiel sagt {soll_g}")
            if ist_e != soll_e:
                probleme.append(f"Ersatz {blatt}: gefunden {ist_e}, Spiel sagt {soll_e}")
        # Zweite Gegenprobe: die Summe der Rang-Zaehler muss die Zahl ueber der
        # Liste treffen. Weichen sie voneinander ab, wurde beim Durchscrollen
        # eine ganze Rang-Gruppe uebersehen — das faellt in den Einzelzaehlern
        # allein nicht auf, weil dort dann schlicht nichts fehlt.
        gesamt = roh["zaehler"]
        if gesamt and soll_g is not None and gesamt.get("gesetzt") != soll_g:
            probleme.append(f"Rang-Summe {soll_g} passt nicht zur Gesamtzahl "
                            f"{gesamt.get('gesetzt')} ueber der Liste")
    if erg["offen"]:
        probleme.append(f"{len(erg['offen'])} Zeilen ohne sicheren Namenstreffer")
    if erg["konflikte"]:
        probleme.append(f"{len(erg['konflikte'])} Spieler mit widerspruechlichen Zeilen")

    vorher = stand.get("teamAssign") or {}
    nachher = tool.zusammenfuehren(vorher, zuordnung)
    diff = tool.unterschied(vorher, nachher)

    bericht = {
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "allianz": g.cfg["alliance_tag"], "team_blatt": blatt,
        "blatt_zeit": randdaten.get("blatt_zeit"),
        "anmeldung_endet_in": randdaten["anmeldung_endet_in"],
        "gruppen": roh["gruppen"], "gruppen_summe": summe,
        "zaehler_gesamt": roh["zaehler"],
        "verteilung": dict(sorted(verteilung.items())),
        "zuordnung": zuordnung,
        "offen": [{"name_ocr": o.get("name_ocr"), "kraft": o.get("kraft"),
                   "wert": o.get("wert"), "grund": o.get("grund")}
                  for o in erg["offen"]],
        "konflikte": [{"spieler": k["spieler"], "werte": k["werte"]}
                      for k in erg["konflikte"]],
        "probleme": probleme,
        "diff": {"neu": diff["neu"],
                 "geaendert": {k: {"vorher": a, "nachher": b}
                               for k, (a, b) in diff["geaendert"].items()},
                 "unveraendert": diff["unveraendert"]},
        "geschrieben": False,
    }

    BERICHTE.mkdir(parents=True, exist_ok=True)
    ziel = BERICHTE / f"scan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

    print()
    for zeile in _zusammenfassung(bericht):
        print(zeile)

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
    a = p.parse_args(argv)

    g = Geraet()
    try:
        if a.pruefen:
            return pruefen(g)
        return lauf(g, a.team, a.schreiben, a.erzwingen)
    except AnmeldungGeschlossen as e:
        _log(str(e))
        return 3
    except (GeraetFehler, NavigationFehler, roster.ScanFehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
