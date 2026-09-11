"""Wuestensturm-Kampfergebnis aus dem Postfach lesen — Spieler und Punkte.

Der Weg (von Ben am 11.09.2026 vorgefuehrt, mit `scripts/touch_aufnahme.py`
mitgeschnitten): Basis → Mail → Ordner „Event" → „[Wuestensturm]-Kampfergebnis!"
→ die Rangliste unter „Individuelle Punkte" herunterscrollen.

```
.venv/bin/python -m scripts.ws_service.ergebnis            # neuestes Ergebnis
.venv/bin/python -m scripts.ws_service.ergebnis --nr 2     # das zweitneueste
.venv/bin/python -m scripts.ws_service.ergebnis --pruefen  # nur das aktuelle Bild auswerten
```

Bericht und Belegbilder: `~/.local/state/warsync/ws_ergebnis/<zeit>/`.

**Gelesen wird mit der Texterkennung von macOS, mit Lage je Zeile**
(`vision_ocr.swift --boxen`). Eine Zeile der Rangliste besteht aus drei Texten
— Platz, `[XP33]Name`, darunter die Punkte —, und erst die Lage sagt, was
zusammengehoert. Tesseract liest die Namen deutlich schlechter (siehe
Kartenarchiv in der CLAUDE.md).

**Der Platz kommt aus der Reihenfolge auf dem Bildschirm, nicht aus der
Ziffer.** Die Platzziffern stehen in einer verzierten Schrift; am ersten Bild
las Vision aus 11 eine 17 und liess 9 und 13 ganz aus. Gelesene Ziffern dienen
nur als Gegenprobe.

**Und nicht aus der Punktzahl.** Nach Punkten zu sortieren liegt nahe, weil die
Liste danach sortiert ist — aber dann entscheidet ausgerechnet die Zahl, die
falsch gelesen sein kann, ueber den Platz. Im ersten Test fehlte Republica58
eine verdeckte Ziffer (285.904 statt 3.285.904), und die Zeile rutschte von
Platz 2 auf Platz 24, ohne dass es auffiel. Die Bilder werden deshalb ueber
gemeinsame Zeilen aneinandergelegt (`_einfuegen`), und die Punktfolge ist die
Gegenprobe statt der Sortierschluessel.

**Drei Gegenproben, und der Bericht nennt jede Abweichung:**
- die Punkte muessen von oben nach unten fallen — ein Lesefehler in einer
  Ziffer faellt dort fast immer auf;
- wo eine Platzziffer gelesen wurde, muss sie zur Position passen;
- jedes Bild muss mindestens eine Zeile mit dem vorigen teilen. Sonst wurde
  weiter gescrollt, als das Fenster hoch ist, und dazwischen fehlt etwas.

Eine Zeile gilt erst als gelesen, wenn Name **und** Punkte im selben Bild stehen.
Am unteren Rand angeschnittene Zeilen kommen im naechsten Bild vollstaendig.
Wiedererkannt wird eine Zeile an ihrer Punktzahl — sie ist je Spieler praktisch
eindeutig und liest sich sicherer als der Name.

Geschrieben wird nichts ins Tool — der Bericht ist ein Vorschlag zum Gegenlesen.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

from scripts.karten_archiv.banner import _VISION_BIN, _VISION_QUELLE, entzwillingen

from . import match, tool
from . import vision as v
from .device import CONFIG, Geraet, GeraetFehler
from .navigate import NavigationFehler, auf_hauptkarte, zur_hauptkarte

STAND = Path.home() / ".local/state/warsync/ws_ergebnis"

# ── Lage auf dem 2560×2560-Bildschirm (aus der Aufnahme vom 11.09.2026) ──────
# Das Mail-Symbol steht rechts in der Leiste Allianz · Mail · Inventar. Gesucht
# wird zuerst die Beschriftung darunter; die Koordinate ist nur der Rueckfall.
MAIL_SUCHE = (2250, 1880, 2560, 2200)
MAIL_SYMBOL = (2386, 2000)
ORDNER_BOX = (250, 250, 1800, 2150)        # Kampfbericht, Allianz, Event, …
POST_BOX = (600, 450, 1960, 2300)           # Mail-Liste eines Ordners
TITEL_BOX = (700, 100, 1900, 220)           # Ueberschrift der geoeffneten Mail
LISTE_BOX = (600, 540, 1960, 2250)          # sichtbarer Teil der Mail samt Datumszeile
KOPF_BOX = (600, 1120, 1960, 1560)          # die beiden Allianzen mit Gesamtpunkten

NAME_X = (1060, 1220)      # linke Kante von Name und Punkten
PLATZ_X = (620, 830)       # linke Kante der Platzziffer
PUNKTE_DY = (35, 115)      # Punkte stehen so weit unter der Namenszeile

STILLSTAND = 3             # so viele unveraenderte Bilder = Listenende
MAX_SCHRITTE = 60

_DATUM = re.compile(r"(20\d\d)-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2}):(\d{2})")
# Das Kuerzel vorn. Vision liest die Klammern gern als L/J (`LXP33Jsenasinasona`)
# und verliert auch mal ein Zeichen darin (`[X33]`) — verglichen wird deshalb
# aehnlich statt gleich. In dieser Liste steht nur die eigene Allianz, das
# Kuerzel ist also bekannt.
_TAG = CONFIG["alliance_tag"]
_TAG_KLAMMER = re.compile(r"^[\[\(\{L|I]?\s*([A-Z0-9]{2,5})\s*[\]\)\}J|/]\s*")
_TAG_VORN = re.compile(r"^.{0,2}?" + re.escape(_TAG) + r"\s*[\]\)\}JjIl1|/]?\s*")


def _log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ── Texterkennung mit Lage ────────────────────────────────────────────────
_dienst: subprocess.Popen | None = None


def _vision_dienst() -> subprocess.Popen:
    """Der Vision-Dienst im Modus `--boxen` — gebaut wie im Kartenarchiv."""
    global _dienst
    if _dienst is not None:
        return _dienst
    if (not _VISION_BIN.exists()
            or _VISION_BIN.stat().st_mtime < _VISION_QUELLE.stat().st_mtime):
        _VISION_BIN.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["swiftc", "-O", "-o", str(_VISION_BIN), str(_VISION_QUELLE)],
                       check=True, capture_output=True, timeout=300)
    _dienst = subprocess.Popen([str(_VISION_BIN), "--dienst", "--boxen"],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               text=True, bufsize=1)
    return _dienst


def zeilen_lesen(bild: np.ndarray, box: tuple[int, int, int, int]) -> list[dict]:
    """Alle Textzeilen im Ausschnitt, Lage in Vollbild-Koordinaten."""
    x0, y0, x1, y1 = box
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        pfad = f.name
    try:
        Image.fromarray(bild[y0:y1, x0:x1]).save(pfad, "PNG")
        d = _vision_dienst()
        d.stdin.write(pfad + "\n")
        d.stdin.flush()
        antwort = d.stdout.readline()
    finally:
        Path(pfad).unlink(missing_ok=True)
    teile = antwort.rstrip("\n").split("\t", 1)
    roh = json.loads(teile[1]) if len(teile) == 2 else []
    return [{"t": r["t"].strip(), "c": r["c"], "x": r["x"] + x0, "y": r["y"] + y0,
             "w": r["w"], "h": r["h"]} for r in roh if r["t"].strip()]


def _zahl(t: str) -> int | None:
    rein = re.sub(r"[\s.,'’]", "", t)
    return int(rein) if rein.isdigit() else None


def _name(t: str) -> str:
    """`[XP33]Name` → `Name`."""
    t = entzwillingen(t.strip())
    m = _TAG_KLAMMER.match(t)
    if m and difflib.SequenceMatcher(None, m[1], _TAG).ratio() >= 0.75:
        return t[m.end():].strip() or t
    return _TAG_VORN.sub("", t, count=1).strip() or t


# ── Die Rangliste in einem Bild ───────────────────────────────────────────
def zeilen_im_bild(bild: np.ndarray) -> tuple[list[dict], list[dict]]:
    """(Ranglisten-Zeilen, alle gelesenen Texte) eines Bildes, von oben nach unten."""
    texte = zeilen_lesen(bild, LISTE_BOX)
    namen = [t for t in texte
             if NAME_X[0] <= t["x"] <= NAME_X[1] and _zahl(t["t"]) is None
             and not _DATUM.search(t["t"])]
    zahlen = [t for t in texte
              if NAME_X[0] <= t["x"] <= NAME_X[1] and _zahl(t["t"]) is not None]
    plaetze = [t for t in texte
               if PLATZ_X[0] <= t["x"] <= PLATZ_X[1] and _zahl(t["t"]) is not None]

    zeilen = []
    for n in namen:
        unter = [z for z in zahlen
                 if PUNKTE_DY[0] <= z["y"] - n["y"] <= PUNKTE_DY[1]]
        if not unter:
            continue            # am Rand angeschnitten — kommt im naechsten Bild
        p = min(unter, key=lambda z: z["y"])
        oben, unten = n["y"] - 25, p["y"] + p["h"] + 25
        platz = next((_zahl(q["t"]) for q in plaetze
                      if oben <= q["y"] + q["h"] / 2 <= unten), None)
        zeilen.append({"name_roh": n["t"], "name_ocr": _name(n["t"]),
                       "punkte": _zahl(p["t"]), "platz_ocr": platz,
                       "sicher": round(min(n["c"], p["c"]), 2), "y": round(n["y"])})
    return sorted(zeilen, key=lambda z: z["y"]), texte


def kopf_lesen(texte: list[dict]) -> dict:
    """Server, Allianz und Gesamtpunkte beider Seiten — soweit lesbar."""
    seiten = {"links": [], "rechts": []}
    mitte = (KOPF_BOX[0] + KOPF_BOX[2]) / 2
    for t in texte:
        if KOPF_BOX[1] <= t["y"] <= KOPF_BOX[3] and KOPF_BOX[0] <= t["x"] <= KOPF_BOX[2]:
            seiten["links" if t["x"] + t["w"] / 2 < mitte else "rechts"].append(t)
    kopf = {}
    for seite, ts in seiten.items():
        ts.sort(key=lambda t: t["y"])
        server = next((t["t"] for t in ts if re.fullmatch(r"#\s*\d{3,5}", t["t"])), None)
        punkte = next((_zahl(t["t"]) for t in ts if _zahl(t["t"]) is not None), None)
        name = next((t["t"] for t in ts if t["t"] != server and _zahl(t["t"]) is None),
                    None)
        kopf[seite] = {"server": server, "allianz": name, "punkte": punkte,
                       "roh": [t["t"] for t in ts]}
    return kopf


# ── Navigation ───────────────────────────────────────────────────────────
def _tippe_text(g: Geraet, bild, box, *woerter: str, pause: float = 2.0) -> dict | None:
    """Die erste Textzeile antippen, die alle `woerter` enthaelt."""
    for t in zeilen_lesen(bild, box):
        if all(v._norm(w) in v._norm(t["t"]) for w in woerter):
            g.tippen(t["x"] + t["w"] / 2, t["y"] + t["h"] / 2, pause=pause)
            return t
    return None


def mail_offen(bild) -> bool:
    titel = " ".join(t["t"] for t in zeilen_lesen(bild, TITEL_BOX))
    return "kampfergebnis" in v._norm(titel) and "sturm" in v._norm(titel)


def zum_ergebnis(g: Geraet, nr: int = 1, log=_log) -> None:
    """Basis → Mail → Event → n-tes Wuestensturm-Kampfergebnis."""
    zur_hauptkarte(g, log=log)

    log("Mail oeffnen ...")
    bild = g.bild()
    if _tippe_text(g, bild, MAIL_SUCHE, "mail") is None:
        g.tippen(*MAIL_SYMBOL, pause=2.0)

    for versuch in range(4):
        bild = g.bild()
        if _tippe_text(g, bild, ORDNER_BOX, "event"):
            log("  Ordner 'Event' geoeffnet.")
            break
        if auf_hauptkarte(g, bild):
            raise NavigationFehler("Mail hat sich nicht geoeffnet.")
        # Das Postfach oeffnet sich gelegentlich im zuletzt benutzten Ordner.
        log(f"  Ordneruebersicht nicht sichtbar (Versuch {versuch + 1}) — zurueck ...")
        g.zurueck()
    else:
        raise NavigationFehler("Ordner 'Event' im Postfach nicht gefunden.")

    bild = g.bild()
    treffer = [t for t in zeilen_lesen(bild, POST_BOX)
               if "kampfergebnis" in v._norm(t["t"]) and "wusten" in v._norm(t["t"])]
    treffer.sort(key=lambda t: t["y"])
    if len(treffer) < nr:
        raise NavigationFehler(
            f"Nur {len(treffer)} Wuestensturm-Kampfergebnis(se) im Ordner 'Event' "
            f"sichtbar, gewuenscht war Nr. {nr}.")
    t = treffer[nr - 1]
    log(f"Oeffne '{t['t']}' (Nr. {nr}) ...")
    g.tippen(t["x"] + t["w"] / 2, t["y"] + t["h"] / 2, pause=3.0)
    if not mail_offen(g.bild()):
        raise NavigationFehler("Die Mail mit dem Kampfergebnis hat sich nicht geoeffnet.")


# ── Lauf ─────────────────────────────────────────────────────────────────
def _ausschnitt(bild) -> np.ndarray:
    x0, y0, x1, y1 = LISTE_BOX
    return bild[y0:y1, x0:x1].astype(np.int16)


def liste_lesen(g: Geraet, ordner: Path, log=_log) -> dict:
    gelesen: dict[int, list[dict]] = {}     # Punkte → alle Lesungen dieser Zeile
    folge: list[int] = []                   # Punkte in Bildschirm-Reihenfolge
    luecken: list[int] = []                 # Bilder ohne gemeinsame Zeile mit dem vorigen
    kopf, datum = None, None
    vorher, still = None, 0
    for schritt in range(MAX_SCHRITTE):
        bild = g.bild()
        Image.fromarray(bild[LISTE_BOX[1]:LISTE_BOX[3], LISTE_BOX[0]:LISTE_BOX[2]]) \
            .save(ordner / f"bild_{schritt:02d}.jpg", quality=85)
        zeilen, texte = zeilen_im_bild(bild)
        if kopf is None:
            kopf = kopf_lesen(texte)
        for t in texte:
            m = _DATUM.search(t["t"])
            if m and datum is None:
                datum = "{}-{:02d}-{:02d} {:02d}:{}:{}".format(
                    m[1], int(m[2]), int(m[3]), int(m[4]), m[5], m[6])
        neu = sum(1 for z in zeilen if z["punkte"] not in gelesen)
        if zeilen and folge and neu == len(zeilen):
            luecken.append(schritt)
            log(f"  WARNUNG: Bild {schritt} teilt keine Zeile mit dem vorigen.")
        _einfuegen(folge, [z["punkte"] for z in zeilen])
        for z in zeilen:
            gelesen.setdefault(z["punkte"], []).append({**z, "bild": schritt})
        log(f"  Bild {schritt:2d}: {len(zeilen)} Zeilen, {neu} neu, "
            f"zusammen {len(gelesen)}")

        jetzt = _ausschnitt(bild)
        if vorher is not None and np.abs(jetzt - vorher).mean() < 1.5:
            still += 1
            if still >= STILLSTAND:
                log("  Listenende erreicht.")
                break
        else:
            still = 0
        vorher = jetzt
        g.liste_weiter(variante=still)
    else:
        log(f"  WARNUNG: nach {MAX_SCHRITTE} Schritten noch kein Listenende.")

    return {"kopf": kopf, "datum": datum, "gelesen": gelesen, "folge": folge,
            "luecken": luecken}


def _einfuegen(folge: list[int], neu: list[int]) -> None:
    """Die Zeilen eines Bildes in die Gesamtfolge legen — ausgerichtet an bekannten.

    Neue Zeilen hinter einer bekannten kommen direkt dahinter, neue Zeilen vor
    der ersten bekannten direkt davor. Teilt das Bild gar keine Zeile mit dem
    Bisherigen, wird angehaengt — `liste_lesen` meldet das als Luecke.
    """
    bekannt = [k for k in neu if k in folge]
    if not bekannt:
        folge.extend(k for k in neu if k not in folge)
        return
    erste = neu.index(bekannt[0])
    pos = folge.index(bekannt[0])
    for k in reversed(neu[:erste]):
        if k not in folge:
            folge.insert(pos, k)
    pos = folge.index(bekannt[0])
    for k in neu[erste:]:
        if k in folge:
            pos = folge.index(k)
        else:
            pos += 1
            folge.insert(pos, k)


def auswerten(gelesen: dict[int, list[dict]], folge: list[int],
              luecken: list[int] = ()) -> tuple[list[dict], list[str]]:
    """Lesungen → Rangliste, plus alles, was bei der Gegenprobe auffiel."""
    liste, hinweise = [], []
    for b in luecken:
        hinweise.append(f"Bild {b} schliesst nicht an das vorige an — dazwischen "
                        f"fehlen vermutlich Zeilen")
    for platz, punkte in enumerate(folge, start=1):
        lesungen = gelesen[punkte]
        # Der Name, der am haeufigsten gelesen wurde; bei Gleichstand der sicherste.
        zaehler: dict[str, list] = {}
        for l in lesungen:
            zaehler.setdefault(l["name_ocr"], []).append(l["sicher"])
        name = max(zaehler, key=lambda n: (len(zaehler[n]), max(zaehler[n])))
        ziffern = {l["platz_ocr"] for l in lesungen if l["platz_ocr"] is not None}
        roh = next(l["name_roh"] for l in lesungen if l["name_ocr"] == name)
        z = {"platz": platz, "name_ocr": name, "name_roh": roh, "punkte": punkte,
             "lesungen": len(lesungen),
             "name_varianten": sorted(zaehler) if len(zaehler) > 1 else None,
             "platz_ocr": sorted(ziffern) or None}
        if ziffern and platz not in ziffern:
            hinweise.append(f"Platz {platz} ({name}): als {sorted(ziffern)} gelesen")
        if len(lesungen) == 1:
            hinweise.append(f"Platz {platz} ({name}, {punkte}): nur in einem Bild gelesen "
                            f"— Punktzahl pruefen")
        liste.append(z)
    for a, b in zip(liste, liste[1:]):
        if b["punkte"] > a["punkte"]:
            hinweise.append(f"Punkte steigen von Platz {a['platz']} ({a['name_ocr']}, "
                            f"{a['punkte']}) zu Platz {b['platz']} ({b['name_ocr']}, "
                            f"{b['punkte']}) — eine der beiden Zahlen ist falsch gelesen")
    return liste, hinweise


def bericht_drucken(b: dict) -> None:
    k = b.get("kopf") or {}
    l, r = k.get("links") or {}, k.get("rechts") or {}
    print()
    print(f"Wuestensturm-Kampfergebnis vom {b.get('datum') or '?'}")
    if l.get("punkte") or r.get("punkte"):
        print(f"  {l.get('server') or ''} {l.get('allianz') or '?'}  {l.get('punkte') or '?'}"
              f"  :  {r.get('punkte') or '?'}  {r.get('allianz') or '?'} {r.get('server') or ''}")
    print()
    print(f"  {'Platz':>5}  {'Name (gelesen)':<24} {'Punkte':>10}  {'Tool':<20}")
    for z in b["liste"]:
        tool_name = z.get("spieler") or "— offen —"
        print(f"  {z['platz']:>5}  {z['name_ocr'][:24]:<24} {z['punkte']:>10,}  "
              f"{tool_name:<20}".replace(",", "."))
    print(f"\n  {len(b['liste'])} Spieler, zusammen "
          f"{sum(z['punkte'] for z in b['liste']):,} Punkte".replace(",", "."))
    if b["hinweise"]:
        print("\nGegenprobe:")
        for h in b["hinweise"]:
            print(f"  - {h}")
    print(f"\nBericht: {b['ordner']}/bericht.json")


def kader_abgleich(liste: list[dict], log=_log) -> list[str]:
    """Gelesene Namen den Spielern im Tool zuordnen — nur fuer den Bericht."""
    try:
        aid = tool.allianz_id(CONFIG["alliance_tag"])
        kader = tool.kader(aid)
    except Exception as e:  # noqa: BLE001 — ohne Tool bleibt der Bericht trotzdem stehen
        log(f"  Kader nicht erreichbar ({e}) — Bericht ohne Zuordnung.")
        return [f"Kader nicht erreichbar: {e}"]
    # `wert` traegt die Punkte: landen zwei verschiedene Zeilen beim selben
    # Spieler, meldet `zuordnen` das als Konflikt statt eine still zu verwerfen.
    zeilen = [{**z, "wert": z["punkte"]} for z in liste]
    erg = match.zuordnen(zeilen, kader)
    hinweise = []
    for name, t in erg["treffer"].items():
        for z in liste:
            if z["platz"] == t["platz"]:
                z["spieler"] = name
    for o in erg["offen"]:
        hinweise.append(f"Platz {o['platz']} ({o['name_ocr']}): kein Kadername — {o['grund']}")
    for k in erg["konflikte"]:
        plaetze = ", ".join(str(z["platz"]) for z in k["zeilen"])
        hinweise.append(f"{k['spieler']}: mehreren Zeilen zugeordnet (Platz {plaetze})")
    return hinweise


def lauf(g: Geraet, nr: int, zurueck: bool = True) -> int:
    ordner = STAND / f"{datetime.now():%Y%m%d_%H%M%S}"
    ordner.mkdir(parents=True, exist_ok=True)
    _log(f"Belege: {ordner}")

    g.starten(log=_log)
    zum_ergebnis(g, nr=nr)
    _log("Lese die Rangliste ...")
    roh = liste_lesen(g, ordner)
    liste, hinweise = auswerten(roh["gelesen"], roh["folge"], roh["luecken"])
    hinweise += kader_abgleich(liste)

    b = {"gelesen_um": datetime.now().isoformat(timespec="seconds"), "nr": nr,
         "datum": roh["datum"], "kopf": roh["kopf"], "liste": liste,
         "hinweise": hinweise, "ordner": str(ordner)}
    (ordner / "bericht.json").write_text(json.dumps(b, ensure_ascii=False, indent=2))
    bericht_drucken(b)

    if zurueck:
        _log("Zurueck zur Basis ...")
        zur_hauptkarte(g, log=_log)
    return 0 if liste else 2


def pruefen(g: Geraet) -> int:
    """Nur das aktuelle Bild: was als Zeile erkannt wird und was nicht."""
    bild = g.bild()
    zeilen, texte = zeilen_im_bild(bild)
    print("Alle Texte im Listenbereich:")
    for t in sorted(texte, key=lambda t: t["y"]):
        print(f"  x={t['x']:5.0f} y={t['y']:5.0f} c={t['c']:.2f}  {t['t']}")
    print("\nAls Ranglisten-Zeile erkannt:")
    for z in zeilen:
        print(f"  Platz {z['platz_ocr'] or '?':>3}  {z['name_ocr']:<24} {z['punkte']}")
    print("\nKopf:", json.dumps(kopf_lesen(texte), ensure_ascii=False))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--nr", type=int, default=1,
                   help="Welches Kampfergebnis im Ordner 'Event' (1 = neuestes).")
    p.add_argument("--pruefen", action="store_true",
                   help="Nur das aktuelle Bild auswerten, nichts antippen.")
    p.add_argument("--hierbleiben", action="store_true",
                   help="Nach dem Lesen nicht zur Basis zurueckkehren.")
    a = p.parse_args(argv)

    g = Geraet()
    try:
        if a.pruefen:
            return pruefen(g)
        return lauf(g, a.nr, zurueck=not a.hierbleiben)
    except (GeraetFehler, NavigationFehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
