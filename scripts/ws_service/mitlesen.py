"""Die Teilnehmerliste aus mitgeschriebenen Bildern lesen.

Gegenstueck zu `mitschreiben.py`: dort wird gesammelt, waehrend ein Mensch
scrollt, hier wird gelesen. Der Schnitt liegt bewusst dazwischen — das Sammeln
muss Schritt halten, das Lesen kostet je Zeile eine Texterkennung. Zusammen in
einer Schleife liefe das Lesen dem Scrollen hinterher und verloere Zeilen.

Gelesen wird mit **denselben** Funktionen wie im Dienst (`roster.zeitkoepfe`,
`roster.zeile_lesen`, `roster.gruppen_zaehler`) — nur ohne Geraet. Was hier
anders herauskommt als beim Dienst, liegt dann am Material und nicht an einer
zweiten, langsam auseinanderlaufenden Lesart.

Die Gegenproben bleiben dieselben und gelten genauso: Rang-Zaehler gegen
Gefundenes, ihre Summe gegen die Zahl ueber der Liste. Eine halb gelesene
Liste ist auch von Hand gescrollt schlimmer als gar keine.
"""
from __future__ import annotations

import json
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

from . import match, roster, tool
from .device import CONFIG


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class _Ohne:
    """Nur die Konfiguration, kein Geraet.

    Die Lesefunktionen in `roster` nehmen ein `Geraet`, benutzen davon aber
    ausschliesslich `cfg`. Ein echtes `Geraet` zu bauen hiesse, die
    BlueStacks-Sperre zu holen — fuer eine Auswertung aus Dateien waere das
    eine Behauptung ueber das Geraet, die hier niemand braucht.
    """

    def __init__(self, cfg: dict):
        self.cfg = cfg


def bilder_lesen(ordner: Path, log=_log) -> dict:
    """Wie `roster.durchlauf`, aber ueber abgelegte Bilder statt ueber das Geraet."""
    g = _Ohne(CONFIG)
    _, _, _, view_unten = g.cfg["list_view"]

    pfade = sorted(ordner.glob("bild_*.png"))
    if not pfade:
        raise FileNotFoundError(f"Keine Bilder in {ordner}")

    zeilen: list[dict] = []
    gesehen: dict[str, dict] = {}
    gesehen_nach_gesetzt: dict[int, str] = {}
    zaehler_lesungen: list[tuple] = []

    for i, pfad in enumerate(pfade):
        bild = np.array(Image.open(pfad).convert("RGB"))

        z = roster.dialog_zaehler(g, bild)
        if z:
            zaehler_lesungen.append(tuple(sorted(z.items())))

        for y0, y1, farbe in roster.zeitkoepfe(g, bild):
            if y1 + 210 >= view_unten:
                continue                     # Zeile angeschnitten — naechstes Bild
            r = roster.zeile_lesen(g, bild, y1)
            if r["kraft"] is None:
                continue                     # ohne Kraftwert keine brauchbare Zeile
            r["farbe"] = farbe
            r["zeit"] = roster.kopfzeit(g, bild, y0, y1)
            r["bild"] = pfad.name
            r["y"] = y1
            zeilen.append(r)

        for y0, y1 in roster.gruppenbalken(g, bild):
            if y1 + 45 >= view_unten:
                continue
            zg = roster.gruppen_zaehler(g, bild, y0)
            schluessel = roster._balken_schluessel(g, bild, y0, zg)
            ges = zg.get("gesetzt")
            bekannt = schluessel if schluessel in gesehen else (
                gesehen_nach_gesetzt.get(ges) if ges else None)
            if bekannt is not None:
                # Fehlende Felder nachtragen, unplausible verwerfen — dieselbe
                # Regel wie im Dienst: ein fehlender Nachtrag heisst „keine
                # Gegenprobe", ein falscher heisst „falsche Gegenprobe".
                grenze = {"gesetzt": 40, "ersatz": 30, "kommandant": 10}
                alt = gesehen[bekannt]
                for feld, wert in zg.items():
                    if alt.get(feld) is not None or wert is None:
                        continue
                    if wert > grenze.get(feld, 40):
                        continue
                    alt[feld] = wert
                continue
            gesehen[schluessel] = zg
            if ges:
                gesehen_nach_gesetzt[ges] = schluessel
            log(f"  Gruppe {roster.rang(bild, y0, y1) or '??'} {schluessel}: {zg}")

        if (i + 1) % 25 == 0 or i + 1 == len(pfade):
            log(f"  {i + 1}/{len(pfade)} Bilder · {len(zeilen)} Rohzeilen")

    summe = {}
    for rolle in ("gesetzt", "ersatz"):
        werte = [z.get(rolle) for z in gesehen.values()]
        summe[rolle] = None if any(w is None for w in werte) else sum(werte)

    zaehler = dict(Counter(zaehler_lesungen).most_common(1)[0][0]) if zaehler_lesungen else {}
    return {"zeilen": zeilen, "zaehler": zaehler, "gruppen": gesehen,
            "gruppen_summe": summe}


def auswerten(ordner: Path, team: str | None = None, schreiben: bool = False,
              erzwingen: bool = False, nur_rechnen: bool = False) -> int:
    ordner = ordner.expanduser().resolve()
    meta = {}
    if (ordner / "meta.json").exists():
        meta = json.loads((ordner / "meta.json").read_text())
    _log(f"Auswertung von {ordner}")
    if meta:
        _log(f"Mitschnitt {meta.get('start')} – {meta.get('ende')} · "
             f"{meta.get('bilder')} Bilder · {meta.get('gescrollt_px')} px gescrollt")

    # Das Lesen der Bilder kostet Minuten, das Rechnen darauf Sekunden. Beides
    # zu trennen heisst: eine Aenderung am Abgleich (Alias, Schwelle) laesst
    # sich sofort messen, statt jedes Mal 220 Bilder neu durch die
    # Texterkennung zu schicken.
    roh_datei = ordner / "roh.json"
    if nur_rechnen:
        roh = json.loads(roh_datei.read_text())
        _log(f"Aus {roh_datei.name} gerechnet — Bilder nicht neu gelesen.")
    else:
        roh = bilder_lesen(ordner)
        roh_datei.write_text(json.dumps(roh, ensure_ascii=False, indent=1))
        (ordner / "zeilen.json").write_text(
            json.dumps(roh["zeilen"], ensure_ascii=False, indent=1))

    aid = tool.allianz_id(CONFIG["alliance_tag"])
    stand = tool.planungsstand(aid)
    ws_time = stand.get("wsTime") or {"A": "13:00", "B": "22:00"}
    # Welches Blatt offen war, entscheidet ueber die Bedeutung der Balkenfarbe
    # (siehe roster.farb_teams) und muss deshalb **vor** ihr feststehen. Mit
    # --team ist es eine Angabe, ohne eine Messung.
    blatt = (team or "").upper() or None
    farb_team, farb_meldung = roster.farb_teams(roh["zeilen"], ws_time, blatt)
    zeilen = roster.zu_werten(roh["zeilen"], ws_time, farb_team)
    _log(f"{len(zeilen)} Zeilen mit Anmeldung (Zeiten laut Tool: {ws_time}).")
    _log(f"Balkenfarben{' laut Blatt ' + blatt if blatt else ' gemessen'}: "
         f"{farb_team or '— keine Zuordnung'}"
         + (f" · {farb_meldung}" if farb_meldung else ""))

    kader = tool.kader(aid)
    erg = match.zuordnen(zeilen, kader)
    zuordnung = {name: t["wert"] for name, t in erg["treffer"].items() if t["wert"]}
    verteilung = Counter(zuordnung.values())
    _log(f"Zugeordnet: {dict(sorted(verteilung.items()))}")

    # ── Gegenprobe ────────────────────────────────────────────────────────
    summe = roh["gruppen_summe"]
    probleme = []
    if not blatt:
        # Welches Blatt offen war, sagt hier keine Kopfzeile — der Mitschnitt
        # beginnt in der Liste. Der gruene Balken sagt es trotzdem: gruen ist
        # die Zeit des offenen Blatts (siehe roster.farb_teams). Vorher stand
        # hier die Mehrheit der Farben, und die zeigte in **beiden**
        # Mitschnitten vom 16.09.2026 auf das falsche Blatt — die Farbe des
        # anderen Teams ist schlicht haeufiger, weil dessen Zeilen ebenso in
        # der Liste stehen.
        blatt = farb_team.get("gruen")
        if blatt:
            _log(f"Blatt aus dem gruenen Balken geschlossen: {blatt}")
        else:
            probleme.append("Welches Blatt offen war, ist nicht zu erkennen — "
                            "mit --team A/B angeben")
            blatt = "A"

    # Jeder Zaehler wird fuer sich geprueft. Vorher fiel die **ganze**
    # Gegenprobe aus, sobald einer der beiden unlesbar war — und genau das ist
    # am 17.09.2026 passiert: der Ersatz-Zaehler einer Rang-Gruppe blieb offen,
    # und damit verschwand auch der Vergleich der gesetzten, der dagestanden
    # haette („gefunden 19, Spiel sagt 20" — `lIBlackJackll`, dessen Zeile in
    # keinem Bild ganz zu sehen war). Ein fehlender Zaehler ist ein fehlender
    # Zaehler, kein Grund, den vorhandenen wegzuwerfen.
    gesamt = roh["zaehler"] or meta.get("zaehler") or {}
    probleme += roster.zaehler_pruefen(summe, verteilung, blatt, gesamt)
    if gesamt and summe.get("gesetzt") is not None \
            and gesamt.get("gesetzt") != summe["gesetzt"]:
        probleme.append(f"Rang-Summe {summe['gesetzt']} passt nicht zur Gesamtzahl "
                        f"{gesamt.get('gesetzt')} ueber der Liste")
    if erg["offen"]:
        probleme.append(f"{len(erg['offen'])} Zeilen ohne sicheren Namenstreffer")
    if erg["konflikte"]:
        probleme.append(f"{len(erg['konflikte'])} Spieler mit widerspruechlichen Zeilen")
    streit = roster.zeit_farbe_streit(zeilen)
    if streit:
        probleme.append(streit)
    if farb_meldung:
        probleme.append(farb_meldung)

    vorher = stand.get("teamAssign") or {}
    nachher = tool.zusammenfuehren(vorher, zuordnung)
    diff = tool.unterschied(vorher, nachher)

    bericht = {
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "quelle": str(ordner), "von_hand_gescrollt": True,
        "allianz": CONFIG["alliance_tag"], "team_blatt": blatt,
        "gruppen": roh["gruppen"], "gruppen_summe": summe,
        "zaehler_gesamt": gesamt,
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
        "diff": {"neu": diff["neu"],
                 "geaendert": {k: {"vorher": a, "nachher": b}
                               for k, (a, b) in diff["geaendert"].items()},
                 "unveraendert": diff["unveraendert"]},
        "geschrieben": False,
    }
    ziel = ordner / "bericht.json"

    print()
    print(f"── Wuestensturm {CONFIG['alliance_tag']} · Blatt {blatt} "
          f"· von Hand gescrollt ──")
    for wert in ("A", "AE", "B", "BE", "C"):
        namen = sorted(n for n, w in zuordnung.items() if w == wert)
        print(f"{wert:3s} ({len(namen):2d}): {', '.join(namen) if namen else '—'}")
    for zeile in match.beide_zeiten_text(bericht["beide_zeiten"]):
        print(zeile)
    print(f"Gegenueber dem Tool: {len(diff['neu'])} neu, "
          f"{len(diff['geaendert'])} geaendert, {diff['unveraendert']} unveraendert")
    if diff["geaendert"]:
        for k, (a, b) in diff["geaendert"].items():
            print(f"  {k}: {a} → {b}")
    if erg["offen"]:
        print("Ohne sicheren Treffer:")
        for o in erg["offen"]:
            print(f"  {o.get('name_ocr')!r} ({o.get('kraft')}M) → {o.get('grund')}")
    if erg["konflikte"]:
        print("Widersprueche: " + ", ".join(
            f"{k['spieler']} {k['werte']}" for k in erg["konflikte"]))
    print("PROBLEME: " + (" · ".join(probleme) if probleme else "keine"))

    if schreiben and probleme and not erzwingen:
        _log("NICHT geschrieben — die Gegenprobe geht nicht auf (siehe oben).")
        _log("Wenn das bewusst so sein soll: nochmal mit --erzwingen.")
    elif schreiben:
        sicherung = tool.sicherung_schreiben(aid, ordner)
        _log(f"Sicherung des bisherigen Stands: {sicherung}")
        tool.schreibe_teamassign(aid, nachher)
        bericht["geschrieben"] = True
        bericht["sicherung"] = str(sicherung)
        _log(f"Geschrieben: {len(diff['neu'])} neu, {len(diff['geaendert'])} geaendert.")
        _log("Im Browser einmal neu laden — ein offener Tab kennt den neuen Stand nicht.")

    ziel.write_text(json.dumps(bericht, ensure_ascii=False, indent=1))
    print(f"Bericht: {ziel}")
    return 0 if not probleme else 2
