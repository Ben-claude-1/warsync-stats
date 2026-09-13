"""Eine einzelne Rang-Gruppe überwacht auslesen.

Aufruf:  .venv/bin/python -u -m scripts.cs_service.scan_rang <nr> [team]
         nr: 0=R5, 1=R4, 2=R3, 3=R2, 4=R1

Der Ablauf ist bewusst je Rang aufrufbar und **nicht** als Kette über alle Ränge:
der Lauf ist noch nicht stabil genug, um unbeaufsichtigt zu laufen, und ein Abbruch
mitten in einer Kette hat früher den ganzen Zwischenstand gekostet.

Vier Dinge, die nicht wegfallen dürfen:

- **`liste.rang_oeffnen` erzwingt den geschlossenen Zustand.** Es klappt erst alles
  zu und öffnet dann genau einen Rang. Wer stattdessen selbst tippt, kann eine
  zweite Gruppe offen lassen — dann liest der Scan fremde Mitglieder mit.
- **Nach dem Öffnen wird an den Gruppenanfang gefahren.** Die Liste stellt die
  zuletzt benutzte Scrollposition wieder her; am 06.09.2026 fehlte deshalb
  lIBlackJackll (173,7M), der stärkste Spieler in R4 — das erste Bild fing schon
  beim zweiten Mitglied an.
- **Die Zähler werden an der *aktuellen* Balkenposition gelesen**, nicht an der von
  vor dem Öffnen. Klebt der Balken oben, liegt die alte Position im Leeren und alle
  Zähler kommen als `None` zurück — dann fällt genau die Gegenprobe aus.
- **Entdoppelt wird über Kraft *und* Namensähnlichkeit.** Dieselbe Karte liefert in
  zwei Bildern verschiedenen OCR-Salat ('Plag3' und 'PIdy> |') — über den Namen
  allein entdoppelt zählt sie doppelt. Die Kraft allein reicht aber auch nicht:
  in R3 teilen sich mehrere Spielerpaare denselben Wert (117,9M, 115,5M, 107,0M),
  und über die Kraft allein entdoppelt verschwanden sie ineinander — 78 statt 81.
  Gleiche Kraft plus unähnlicher Name heißt deshalb: zwei verschiedene Spieler.
- **Eine Gruppe mit 0 Mitgliedern wird nicht geöffnet.** R1 lässt sich nicht
  aufklappen, weil nichts darin steht — das ist kein Fehlschlag.
"""
from __future__ import annotations

import datetime
import difflib
import json
import pathlib
import re
import sys

from scripts.cs_service import liste, roster
from scripts.ws_service import roster as ws_roster
from scripts.ws_service.device import Geraet

NAMEN = {0: "R5", 1: "R4", 2: "R3", 3: "R2", 4: "R1"}
_RUHE_MAX = 3          # so viele Schritte ohne neue Karte gelten als Listenende
_SCHRITTE_MAX = 140
_ANFANG_MAX = 10       # Rueckwaertsschritte, um an den Gruppenanfang zu kommen


def _stand(team: str) -> pathlib.Path:
    p = pathlib.Path.home() / ".local/state/warsync/cs_service"
    p.mkdir(parents=True, exist_ok=True)
    return p / f"scan_team{team}.json"


# Zeilen der Karte, die kein Name sind. Ohne diese Sperre gewann die Kraftzeile
# den Guetevergleich fuer Plag3: aus 'Plag3' wurde 'Gesamtkampfkraft der Helden:
# 129,9M' — sie ist laenger und besteht aus lauter saubern Buchstaben.
_KEIN_NAME = re.compile(r"ampfkraft|gesamt|helden|oberbefehl", re.I)


def _kern(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _aehnlich(a: str, b: str) -> bool:
    """Zwei OCR-Namen derselben Karte — oder zwei verschiedene Spieler?

    Die Kraft allein reicht als Schluessel **nicht**: am 06.09.2026 trugen in R3
    mehrere Spielerpaare denselben Wert (117,9M, 115,5M, 107,0M). Ueber die Kraft
    entdoppelt hat der Lauf sie zusammengeworfen und meldete 78 statt 81 Karten —
    ein Ergebnis, das aufgeht und trotzdem Spieler verliert.
    """
    ka, kb = _kern(a), _kern(b)
    if not ka or not kb:
        return True                      # ohne lesbaren Namen nicht trennbar
    if ka in kb or kb in ka:
        return True
    return difflib.SequenceMatcher(None, ka, kb).ratio() >= 0.55


def _namensguete(name: str) -> int:
    """Wie brauchbar sieht ein OCR-Name aus — Buchstaben zaehlen, Salat abziehen."""
    if _KEIN_NAME.search(name):
        return -1000
    gut = len(re.findall(r"[A-Za-z0-9]", name))
    schlecht = len(re.findall(r"[^A-Za-z0-9 _.\-]", name))
    return gut - 2 * schlecht


def _offener_balken(g: Geraet, bild):
    """Der Balken der gerade offenen Gruppe im aktuellen Bild.

    Ohne sichtbare Luecke haengt der Inhalt **unter** dem letzten Balken — der
    letzte ist dann der offene, nicht der erste. Mit `balken[0]` als Rueckfall
    lieferte die Funktion bei geoeffnetem R4 den R5-Balken darueber: die Zaehler
    kamen als „1 Mitglied" statt „10" zurueck, und der Lauf hielt sich faelschlich
    fuer mitten in der Gruppe stehend.
    """
    balken = ws_roster.gruppenbalken(g, bild)
    if not balken:
        return None
    for band, luecke in zip(balken, liste._luecken(balken)):
        if luecke > liste._LUECKE_MAX:
            return band
    return balken[0] if len(balken) == 1 else balken[-1]


def _hat_sich_bewegt(vorher, nachher, cfg) -> bool:
    x0, y0, x1, y1 = cfg["list_view"]
    a, b = vorher[y0:y1, x0:x1], nachher[y0:y1, x0:x1]
    return float((abs(a.astype("int16") - b.astype("int16")) > 12).mean()) > 0.02


def _weiter_gesichert(g: Geraet, bild, cfg, log=print) -> bool:
    """Ein Scroll-Schritt, der nachweislich etwas bewegt hat.

    `roster.weiter` sucht zwar einen Ansatzpunkt frei von Rang-Leisten, prueft
    aber nicht, ob die Liste darauf reagiert hat — und eskaliert die Variante
    nicht. Ohne diese Schleife blieb R3 nach fuenf Karten stehen und der Lauf
    hielt das fuer das Listenende.
    """
    for variante in range(5):
        roster.weiter(g, bild, variante=variante, log=log)
        nachher = g.bild()
        if _hat_sich_bewegt(bild, nachher, cfg):
            return True
        log(f"    keine Bewegung — neuer Ansatzpunkt (Variante {variante + 1})")
        bild = nachher
    return False


def _an_gruppenanfang(g: Geraet, log=print) -> None:
    """Zurueck, bis über dem ersten Mitglied nichts mehr kommt.

    Erkannt am klebenden Balken: sitzt er am oberen Rand des Listenfensters,
    steht darueber noch Inhalt. Bricht die Gruppe dabei zu (das passiert am
    Listenrand), wird sie wieder geoeffnet und der Versuch beendet.
    """
    oben = g.cfg["list_view"][1]
    for i in range(_ANFANG_MAX):
        bild = g.bild()
        band = _offener_balken(g, bild)
        if band is None or band[0] > oben + 60:
            if i:
                log(f"  am Gruppenanfang (nach {i} Schritten zurueck).")
            return
        g.liste_weiter(rueckwaerts=True)
    log("  Gruppenanfang nicht sicher erreicht — lese ab hier.")


def _zusammen(nach_kraft: dict, ohne_kraft: list) -> list:
    """Alle gefundenen Karten, staerkste zuerst; Karten ohne lesbare Kraft hinten."""
    alle = [z for gleiche in nach_kraft.values() for z in gleiche]
    return sorted(alle, key=lambda z: -z["kraft"]) + ohne_kraft


def scan(nummer: int, team: str = "A", log=print) -> list:
    cfg = json.loads(pathlib.Path("scripts/cs_service/config.json").read_text())
    g = Geraet(cfg)
    rang = NAMEN[nummer]
    pfad = _stand(team)

    log(f"== {rang} ==")
    liste.alle_schliessen(g, log=log)
    balken = ws_roster.gruppenbalken(g, g.bild())
    if nummer < len(balken):
        vorab = roster.gruppen_zaehler_cs(g, g.bild(), balken[nummer][0])
        if vorab.get("mitglieder") == 0:
            log("  0 Mitglieder — nichts zu lesen.")
            _sichern(pfad, rang, [], vorab, fertig=True)
            return []
    try:
        liste.rang_oeffnen(g, nummer, log=log)
    except liste.RangZustandFehler:
        # Der Vorab-Zaehler hat die 0 verpasst (OCR-Aussetzer) — eine 0er-Gruppe
        # laesst sich nicht aufklappen, weil nichts darin steht. Erst hier wird
        # das endgueltig geklaert, sonst crasht ein sonst leerer Rang den Lauf.
        balken2 = ws_roster.gruppenbalken(g, g.bild())
        nachpruefung = (roster.gruppen_zaehler_cs(g, g.bild(), balken2[nummer][0])
                        if nummer < len(balken2) else {})
        # `mitglieder` kommt bei einer 0er-Gruppe manchmal als None statt 0
        # zurueck (die Kopfzeile zeigt dann keine lesbare Zahl an) — die Gruppe
        # hat sich trotzdem nachweislich nicht geoeffnet, das genuegt als Beleg.
        if nachpruefung.get("mitglieder") in (0, None):
            log(f"  0 Mitglieder (laesst sich nicht oeffnen, Zaehler={nachpruefung}) "
                f"— nichts zu lesen.")
            _sichern(pfad, rang, [], nachpruefung, fertig=True)
            return []
        raise
    _an_gruppenanfang(g, log=log)

    bild = g.bild()
    band = _offener_balken(g, bild)
    zaehler = roster.gruppen_zaehler_cs(g, bild, band[0]) if band else {}
    soll = zaehler.get("mitglieder")
    log(f"  Balken sagt: {soll} Mitglieder, {zaehler.get('gemeldet')} gemeldet, "
        f"{zaehler.get('gesetzt')} gesetzt")

    nach_kraft: dict = {}
    ohne_kraft: list = []
    ruhe = 0
    for schritt in range(1, _SCHRITTE_MAX + 1):
        vorher = len(_zusammen(nach_kraft, ohne_kraft))
        bild = g.bild()
        rand = roster._kartenrand(g)
        for ay, reg in roster._alle_karten_anker(g, bild):
            if ay + rand >= cfg["list_view"][3]:
                continue                      # angeschnitten, kommt wieder
            z = roster.zeile_lesen_cs(g, bild, ay, registriert=reg)
            if not z["name_ocr"] and z["kraft"] is None:
                continue
            if z["kraft"] is None:
                ohne_kraft.append(z)
                log(f"    [?  ] ohne Kraft: {z['name_ocr']!r}")
                continue
            gleiche = nach_kraft.setdefault(z["kraft"], [])
            treffer = next((a for a in gleiche
                            if _aehnlich(a["name_ocr"], z["name_ocr"])), None)
            if treffer is None and _namensguete(z["name_ocr"]) <= 0:
                # Reine Muellzeile (z.B. 'Gesamtkampfkraft der Helden: 129,9M',
                # zufaellig dieselbe Kraft wie eine echte Karte) darf **keine**
                # neue Karte eroeffnen — sonst verdraengt sie am Rangende einen
                # echten Spieler, weil `soll` schon "erreicht" scheint. Am
                # 06.09.2026 fiel dadurch ARCHAENGEL aus R4 heraus, obwohl der
                # Zaehler "10/10 ✓" meldete.
                if gleiche:
                    gleiche[0]["registriert"] = gleiche[0]["registriert"] or z["registriert"]
                    gleiche[0]["wunsch"] = gleiche[0]["wunsch"] or z["wunsch"]
                    for feld in ("gesetzt", "ersatz"):
                        if gleiche[0].get(feld) is None and z.get(feld) is not None:
                            gleiche[0][feld] = z[feld]
                    log(f"    [Muell verworfen, an bestehende Karte gehaengt] "
                        f"{z['kraft']}M {z['name_ocr']!r}")
                else:
                    log(f"    [Muell verworfen, keine Karte an dieser Kraft] "
                        f"{z['kraft']}M {z['name_ocr']!r}")
                continue
            if treffer is None:
                gleiche.append(z)
                zusatz = "  (zweiter Spieler mit dieser Kraft)" if len(gleiche) > 1 else ""
                log(f"    [{'reg' if reg else '  -'}] {z['kraft']}M "
                    f"Wunsch={z['wunsch']} Gesetzt={z['gesetzt']} Ersatz={z['ersatz']} "
                    f"{z['name_ocr']!r}{zusatz}")
            else:
                if _namensguete(z["name_ocr"]) > _namensguete(treffer["name_ocr"]):
                    log(f"    [gleiche Karte {z['kraft']}M] Name verbessert: "
                        f"{treffer['name_ocr']!r} -> {z['name_ocr']!r}")
                    treffer["name_ocr"] = z["name_ocr"]
                treffer["registriert"] = treffer["registriert"] or z["registriert"]
                treffer["wunsch"] = treffer["wunsch"] or z["wunsch"]
                # Gesetzt/Ersatz unabhaengig von der Namensguete nachtragen:
                # ein Feld, das beim ersten Lesen durch den Knopfstreifen
                # angeschnitten war (None), soll ein spaeterer, vollstaendiger
                # Blick auf dieselbe Karte nachliefern koennen (06.09.2026:
                # ZephyrusXI kam beim Oeffnen der Gruppe mit einem
                # abgeschnittenen Feld herein, gesetzt=A stand erst im
                # naechsten Bild).
                for feld in ("gesetzt", "ersatz"):
                    if treffer.get(feld) is None and z.get(feld) is not None:
                        log(f"    [gleiche Karte {z['kraft']}M] {feld} nachgetragen: "
                            f"{z[feld]!r}")
                        treffer[feld] = z[feld]

        zeilen = _zusammen(nach_kraft, ohne_kraft)
        _sichern(pfad, rang, zeilen, zaehler, fertig=False)
        neu = len(zeilen) - vorher
        if soll is not None and len(zeilen) >= soll:
            log(f"  {len(zeilen)}/{soll} — vollzaehlig nach {schritt} Schritten.")
            break
        ruhe = ruhe + 1 if neu == 0 else 0
        if ruhe >= _RUHE_MAX:
            log(f"  {_RUHE_MAX} Schritte ohne neue Karte — Ende der Gruppe.")
            break
        if not _weiter_gesichert(g, bild, cfg, log=log):
            log("  Liste bewegt sich nicht mehr — hier ist Schluss.")
            break
    else:
        log(f"  Schrittgrenze {_SCHRITTE_MAX} erreicht.")

    zeilen = _zusammen(nach_kraft, ohne_kraft)
    fertig = soll is not None and len(zeilen) == soll
    _sichern(pfad, rang, zeilen, zaehler, fertig=fertig)
    log(f"  Ergebnis: {len(zeilen)} Karten" + ("" if soll is None else f" von {soll}")
        + ("  ✓" if fertig else "  — UNVOLLSTAENDIG"))
    if zaehler.get("gemeldet") is not None:
        ist = sum(1 for z in zeilen if z["wunsch"])
        log(f"  Gegenprobe Wunsch fuer diese Truppe: {ist} "
            f"(Balken sagt {zaehler['gemeldet']})")

    liste.alle_schliessen(g, log=log)
    return zeilen


def _sichern(pfad: pathlib.Path, rang: str, zeilen: list, zaehler: dict,
             fertig: bool) -> None:
    daten = json.loads(pfad.read_text()) if pfad.exists() else {}
    daten.setdefault("raenge", {})[rang] = {
        "fertig": fertig,
        "soll": zaehler.get("mitglieder"),
        "gemeldet_laut_balken": zaehler.get("gemeldet"),
        "zaehler": zaehler,
        "mitglieder": [{"name": z["name_ocr"], "kraft_m": z["kraft"],
                        "registriert": z["registriert"], "wunsch": z["wunsch"],
                        "gesetzt": z.get("gesetzt"), "ersatz": z.get("ersatz")}
                       for z in zeilen],
    }
    daten["stand"] = datetime.datetime.now().isoformat(timespec="seconds")
    pfad.write_text(json.dumps(daten, ensure_ascii=False, indent=2))


def scan_alle(team: str = "A", log=print) -> dict:
    """Alle fuenf Raenge in einem Rutsch, in einem einzigen Prozess.

    `Geraet()` haelt die Sperre prozessweit (siehe device._sperr_fd) — die
    fuenf `scan()`-Aufrufe teilen sie sich also, ohne dass ein zweiter Prozess
    dazwischenkommen kann. Das ist der produktive Weg fuer run.py: dieselbe,
    live geprueft vollstaendige Lese-Logik (Muell-Filter, Bewegungs-Pruefung,
    Gesetzt/Ersatz-Nachtrag), statt der aelteren, einfacheren Entdopplung in
    `roster.durchlauf_je_rang`.
    """
    alle_zeilen: list[dict] = []
    for nummer in range(5):
        alle_zeilen += scan(nummer, team, log=log)
    stand = json.loads(_stand(team).read_text())
    gruppen = {rang: info.get("zaehler", {}) for rang, info in stand.get("raenge", {}).items()}
    return {"zeilen": alle_zeilen, "gruppen": gruppen}


if __name__ == "__main__":
    scan(int(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "A")
