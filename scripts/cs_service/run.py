"""Dienst: Schluchtsturm-Anmeldung aus dem Spiel lesen und ins Tool uebernehmen.

    .venv/bin/python -m scripts.cs_service.run              # nur lesen, Bericht
    .venv/bin/python -m scripts.cs_service.run --schreiben  # und ins Tool uebernehmen
    .venv/bin/python -m scripts.cs_service.run --pruefen    # Koordinaten kontrollieren

Anders als beim Wuestensturm reicht ein Durchlauf ueber Truppe A fuer **beide**
Truppen — das Gesetzt-/Ersatz-Feld zeigt den tatsaechlichen Buchstaben
unabhaengig davon, welche Truppe gerade geoeffnet ist (siehe __init__.py und
`roster.zu_werten_einzeln`). Ohne `--schreiben` wird nichts veraendert.

Geschrieben wird nur, wenn die Gegenprobe je Truppe aufgeht: die Summe der
Rang-Zaehler (Gesetzt/Ersatz, vom Spiel selbst gefuehrt) muss zu den Zahlen
ueber der Liste passen. Diese Zahlen sagen nichts ueber den hier gelesenen
Team-*Wunsch* aus (das ist eine reine Anmelde-Absicht, keine Spielrolle) —
sie zeigen nur, ob wirklich jede Rang-Gruppe gesehen wurde und keine beim
Scrollen verlorengegangen ist. Genau dieselbe Rolle spielen sie beim
Wuestensturm-Dienst.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from scripts.ws_service import match
from scripts.ws_service import navigate as ws_nav
from scripts.ws_service.device import Geraet, GeraetFehler
from scripts.ws_service.navigate import NavigationFehler

from . import navigate, roster, scan_rang, tool

BERICHTE = Path.home() / ".local" / "state" / "warsync" / "cs_service"


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def pruefen(g: Geraet) -> int:
    """Zeigt, was der Dienst im aktuellen Bild erkennt — zur Kontrolle.

    Laeuft gegen den Bildschirm, der gerade offen ist (typischerweise schon
    eine geoeffnete Teilnehmerliste, wie bei ws_service --pruefen) — navigiert
    selbst nicht dorthin, damit eine bereits offene Anmeldephase nicht durch
    einen Fehlversuch beim Navigieren gestoert wird.
    """
    bild = g.bild()
    _log(f"Aufloesung: {bild.shape[1]}x{bild.shape[0]}")
    _log(f"Hauptkarte sichtbar: {ws_nav.auf_hauptkarte(g, bild)}")
    _log(f"Teilnehmerliste offen: {ws_nav.liste_offen(g, bild)}")
    balken = roster.ws_roster.gruppenbalken(g, bild)
    _log(f"Rang-Balken: {balken}")
    _log(f"Zaehler (Kommandant verworfen, Gesetzt/Ersatz): {roster.ws_roster.dialog_zaehler(g, bild)}")
    _log(f"Teilnehmer gesamt laut Fusszeile: {roster.dialog_gesamt(g, bild)}")
    koepfe = roster.ws_roster.zeitkoepfe(g, bild)
    _log(f"Gruene Zeitbaender: {[(a, b, f) for a, b, f in koepfe]}")
    for y0, y1, farbe in koepfe:
        if y1 + 210 < g.cfg["list_view"][3]:
            z = roster.zeile_lesen_cs(g, bild, y1)
            _log(f"  {z['kraft']}M  Wunsch={z['wunsch']} (Rotanteil {z['wunsch_anteil']})  {z['name_ocr']!r}")
    return 0


def _scan_offen(g: Geraet, aid: str) -> dict:
    """Ein einziger Durchlauf ueber die gerade geoeffnete Truppe — liefert die
    Team-Zuordnung fuer **beide** Truppen (siehe `roster.zu_werten_einzeln`).

    Bis zum 06.09.2026 brauchte es dafuer je einen Durchlauf pro Truppe, weil
    nur das rote Wunsch-Overlay ausgewertet wurde. Live bestaetigt: das
    Gesetzt-/Ersatz-Feld zeigt den tatsaechlichen Buchstaben unabhaengig vom
    offenen Bildschirm — ein zweiter Durchlauf ist damit nur noch eine
    optionale Gegenprobe, keine Voraussetzung mehr.
    """
    navigate.zur_teilnehmerliste(g, "A", log=_log)

    _log("Rang fuer Rang durchgehen (ein Durchlauf reicht fuer beide Truppen) ...")
    roh = scan_rang.scan_alle("A", log=_log)
    gesamt = roster.dialog_gesamt(g, g.bild())
    ws_nav.dialog_schliessen(g)

    zeilen = roster.zu_werten_einzeln(roh["zeilen"], "A")
    kader_liste = tool.kader(aid)
    erg = match.zuordnen(zeilen, kader_liste)
    zuordnung = {n: t["wert"] for n, t in erg["treffer"].items() if t.get("wert")}
    gesetzt_gelesen = sum(1 for t in erg["treffer"].values() if t.get("rolle") in ("gesetzt", "ersatz"))
    _log(f"{len(zuordnung)} Spieler zugeordnet ({gesetzt_gelesen} davon direkt aus dem "
         f"Gesetzt-/Ersatz-Feld, Rest aus dem Wunsch abgeleitet), "
         f"{len(roh['zeilen'])} gruene Baender (Anmeldungen) insgesamt.")

    probleme = []
    for rolle in ("gesetzt", "ersatz"):
        werte = [z.get(rolle) for z in roh["gruppen"].values()]
        if any(w is None for w in werte):
            probleme.append(f"Rang-Zaehler {rolle} nicht in jeder Gruppe lesbar — Deckung unsicher")
    gemeldet_werte = [z.get("gemeldet") for z in roh["gruppen"].values()]
    gemeldet_soll = None if any(w is None for w in gemeldet_werte) else sum(gemeldet_werte)
    if gemeldet_soll is not None and gemeldet_soll != len(roh["zeilen"]):
        probleme.append(f"laut Rang-Kopfzeilen {gemeldet_soll} Anmeldungen, "
                        f"beim Durchlauf aber {len(roh['zeilen'])} gruene Baender gefunden — "
                        f"vermutlich beim Scrollen etwas uebersprungen (oder es hat sich seither "
                        f"jemand neu an-/abgemeldet)")
    if erg["offen"]:
        probleme.append(f"{len(erg['offen'])} Zeilen ohne sicheren Namenstreffer")

    return {"zuordnung": zuordnung, "probleme": probleme, "offen": erg["offen"],
            "gruppen": roh["gruppen"], "gesamt": gesamt}


def lauf(g: Geraet, schreiben: bool, erzwingen: bool) -> int:
    aid = tool.allianz_id(g.cfg["alliance_tag"])
    _log(f"Allianz {g.cfg['alliance_tag']} = {aid}")
    g.starten(log=_log)

    erg = _scan_offen(g, aid)
    zuordnung = erg["zuordnung"]
    probleme = erg["probleme"]

    vorher = tool.planungsstand(aid).get("csTeamAssign") or {}
    nachher = tool.zusammenfuehren(vorher, zuordnung)
    diff = tool.unterschied(vorher, nachher)

    bericht = {
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "allianz": g.cfg["alliance_tag"],
        "gefunden": len(zuordnung),
        "laut_spiel_gesamt": erg["gesamt"],
        "gruppen": erg["gruppen"],
        "zuordnung": zuordnung,
        "offen": [{"name_ocr": x.get("name_ocr"), "kraft": x.get("kraft"), "grund": x.get("grund")}
                  for x in erg["offen"]],
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
    z = [f"── Schluchtsturm {b['allianz']} ──",
         f"{b['gefunden']} Bewerber zugeordnet "
         f"(Spiel fuehrt {b['laut_spiel_gesamt'] if b['laut_spiel_gesamt'] is not None else '?'} "
         f"als eingeteilt/gesetzt+Ersatz)"]
    for wert in ("A", "B"):
        namen = sorted(n for n, w in b["zuordnung"].items() if w == wert)
        z.append(f"{wert:3s} ({len(namen):2d}): {', '.join(namen) if namen else '—'}")
    d = b["diff"]
    z.append(f"Gegenueber dem Tool: {len(d['neu'])} neu, "
             f"{len(d['geaendert'])} geaendert, {d['unveraendert']} unveraendert")
    if b["offen"]:
        z.append("Ohne sicheren Treffer:")
        z += [f"  {o['name_ocr']!r} ({o['kraft']}M) → {o['grund']}" for o in b["offen"]]
    if b["probleme"]:
        z.append("PROBLEME: " + " · ".join(b["probleme"]))
    return z


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--schreiben", action="store_true",
                   help="Ergebnis ins Tool uebernehmen (sonst nur Bericht).")
    p.add_argument("--erzwingen", action="store_true",
                   help="Auch schreiben, wenn die Gegenprobe nicht aufgeht.")
    p.add_argument("--pruefen", action="store_true",
                   help="Nur zeigen, was im aktuellen Bild erkannt wird.")
    a = p.parse_args(argv)

    g = Geraet(json.loads((Path(__file__).parent / "config.json").read_text()))
    try:
        if a.pruefen:
            return pruefen(g)
        return lauf(g, a.schreiben, a.erzwingen)
    except (GeraetFehler, NavigationFehler, roster.ws_roster.ScanFehler, roster.MusterAbweichung) as e:
        _log(f"ABBRUCH: {e}")
        _log("Das Geraet bleibt unangetastet im aktuellen Zustand — erst nachsehen, dann neu starten.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
