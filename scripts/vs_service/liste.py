"""Eine Zeile der VS-Tagesliste lesen: Rang, Name, Punkte.

Die Liste steht unter Allianzduell → „Rang" → „Tagesrang", gefiltert auf
„Deine Allianz". Eine Zeile ist eine Karte mit drei Spalten: links die
Rangziffer, in der Mitte zweizeilig Name und `[XP33] Expedition33`, rechts die
Punkte.

**Der Rang ist der Schluessel, nicht der Name.** Anders als in der
Wuestensturm-Teilnehmerliste sind die Zeilen hier durchnummeriert. Das loest
zwei Probleme auf einmal, an denen der andere Dienst lange haengt: dieselbe
Zeile in zwei Bildern ist an derselben Nummer wiederzuerkennen (statt an einer
schwankenden Lesung ihres Namens), und eine Luecke in 1…N heisst „Zeile
verloren" — eine Gegenprobe, die kein Zaehler im Spiel liefern muss.

**Die eigene Zeile haengt gruen unten fest** und gehoert nicht zum Lauf: sie
steht in *jedem* Bild und wuerde den Spieler sonst hundertfach zaehlen. Sie
wird getrennt gelesen (`eigene_zeile`) und dient als Gegenprobe gegen die
Fundstelle desselben Spielers in der Liste.

Aufruf zum Ansehen eines einzelnen Bildes:

    .venv/bin/python -m scripts.vs_service.liste --pruefen <bild.png>
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import unicodedata

import cv2
import numpy as np

from scripts.karten_archiv.banner import entzwillingen
from scripts.ws_service.ergebnis import SPRACHEN_NAMEN, zeilen_lesen

CFG = json.loads((pathlib.Path(__file__).with_name("config.json")).read_text())

# ── Lage auf dem 2560×2560-Bildschirm ────────────────────────────────────
# Gemessen am Bild `pruefe_20260917_145256/bild_025.png`: die linken Kanten
# liegen bei Rang 703–710, Name 1033–1041, Punkte 1693–1726. Die Fenster sind
# bewusst weiter als die Messwerte — ein laengerer Name oder eine dreistellige
# Rangziffer wandert ein Stueck nach aussen.
# **Der Ausschnitt beginnt unter der Spaltenueberschrift.** „Rang · Kommandant ·
# Punkte" steht fest bei y 505…545 und scrollt nicht mit; „Kommandant" liegt
# dabei mitten in der Namensspalte. Mit y0=480 wurde die Ueberschrift als Zeile
# gelesen und bekam die Punktzahl der ersten Zeile darunter angehaengt — eine
# Phantomzeile, die jeden Rang darunter um eins verschob.
LISTE_BOX = (560, 560, 1960, 1880)     # der scrollbare Teil, ohne die eigene Zeile
EIGENE_BOX = (560, 1880, 1960, 2120)   # die festgepinnte gruene Zeile

# **Gemessen wird enger als gelesen.** Die Vorlagensuche braucht einen
# Ausschnitt, in dem sich *alles* mitbewegt. Die gruene eigene Zeile steht fest
# — reicht das Fenster bis in sie hinein, besteht die Vorlage zur Haelfte aus
# unbeweglichem Bild, die Guete faellt unter die Schwelle und der Schritt gilt
# als Stillstand. Am 17.09.2026 hat genau das den ersten Lauf ruiniert.
MESS_BOX = (600, 600, 1900, 1840)
PLATZ_X = (640, 850)
NAME_X = (980, 1640)
PUNKTE_X = (1620, 1960)

# Abstaende innerhalb einer Zeile, von der Oberkante des Namens aus gemessen
# (Rang +32, Punkte +42, Kuerzel +77). Die Fenster tragen reichlich Reserve;
# entscheidend ist nur, dass sie kleiner sind als der Zeilenabstand von 253 px,
# sonst greift eine Zeile in ihre Nachbarin.
PUNKTE_DY = (-40, 110)
PLATZ_DY = (-40, 110)
ZEILEN_HOEHE = 253

_TAG_ZEILE = re.compile(r"^.{0,2}?[\[\(\{]\s*[A-Z0-9]{2,5}\s*[\]\)\}\u3011J|/]")
# Das eigene Kuerzel steht in **jeder** Zeile der zweiten Reihe. Es als Namen zu
# lesen erzeugt eine Zeile, die es nicht gibt — am 17.09.2026 kam die Zeile als
# `3[XP33] Expedition33` an, mit einer Ziffer vor der Klammer, und fiel damit
# durch das Klammermuster. Der Kuerzeltext selbst ist das verlaesslichere
# Merkmal: er ist bekannt und steht in keinem Spielernamen.
_TAG_TEXT = re.sub(r"[^a-z0-9]", "", CFG.get("alliance_tag", "").lower())


def _ist_tag_zeile(t: str) -> bool:
    if _TAG_ZEILE.match(t):
        return True
    return bool(_TAG_TEXT) and _TAG_TEXT in re.sub(r"[^a-z0-9]", "", t.lower())

# Fuer die Versatzmessung: so hoch ist die gesuchte Vorlage, so viel Abstand
# haelt sie zu den Raendern.
MUSTER_HOCH = 200
X_RAND = 60
# Weniger Bewegung gilt als Stillstand — darunter waere der Schritt ohnehin
# wertlos, weil dieselben Zeilen noch einmal gelesen wuerden.
STILL_PX = 30


def versatz(vorher: np.ndarray, nachher: np.ndarray,
            rueckwaerts: bool = False) -> tuple[int | None, float]:
    """Um wie viele Pixel ist die Liste gewandert? (px, Guete); None = unbekannt.

    Ein Streifen des vorigen Bildes wird im neuen gesucht. Dieselbe
    Vorlagensuche wie in `ws_service.messe_rad` — sie beantwortet die einzige
    Frage, die beim Scrollen zaehlt: hat die Liste die Geste angenommen?

    **Die Richtung entscheidet, welcher Streifen taugt**, und das war am
    17.09.2026 ein echter Fehler: beim Scrollen nach unten wandert der Inhalt
    nach oben, der *untere* Streifen bleibt also sichtbar. Beim Zurueckscrollen
    ist es umgekehrt — dort rutscht genau dieser Streifen aus dem Bild, die
    Suche findet ihn nicht mehr und meldet `None`. `nach_oben` las das als
    „bewegt sich nicht mehr, also bin ich oben" und brach nach dem ersten
    Schritt ab. Der Lauf las danach das Ende der vorigen Liste statt den Anfang
    der neuen und hielt es fuer einen vollstaendigen Tag.
    """
    x0, y0, x1, y1 = MESS_BOX
    a = cv2.cvtColor(vorher, cv2.COLOR_RGB2GRAY)
    b = cv2.cvtColor(nachher, cv2.COLOR_RGB2GRAY)
    oben = y0 if rueckwaerts else y1 - MUSTER_HOCH
    muster = a[oben:oben + MUSTER_HOCH, x0:x1]
    suchraum = b[y0:y1, x0:x1]
    treffer = cv2.matchTemplate(suchraum, muster, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(treffer)
    if guete < 0.7:
        return None, guete
    # Positiv heisst immer „in die gefahrene Richtung bewegt".
    px = oben - (y0 + ort[1])
    return (-px if rueckwaerts else px), guete


def zahl(t: str) -> int | None:
    """`13-894.507` → 13894507. Trennzeichen liest Vision als `.`, `-`, `_`, `,`."""
    rein = re.sub(r"[\s.,'’_\-–—]", "", unicodedata.normalize("NFKC", t))
    return int(rein) if rein.isdigit() else None


def name_saeubern(t: str) -> str:
    """Zwillinge zurueckdrehen, Rand aufraeumen — der Rohtext bleibt daneben stehen."""
    return entzwillingen(unicodedata.normalize("NFKC", t).strip())


def _zeilen_aus_texten(texte: list[dict]) -> list[dict]:
    """Aus den erkannten Textstuecken die Zeilen bauen, verankert am Namen."""
    namen = [t for t in texte
             if NAME_X[0] <= t["x"] <= NAME_X[1]
             and not _ist_tag_zeile(t["t"])        # die Kuerzel-Zeile darunter
             and zahl(t["t"]) is None]             # ein rein numerischer Name waere die Ausnahme
    punkte = [t for t in texte
              if PUNKTE_X[0] <= t["x"] <= PUNKTE_X[1] and zahl(t["t"]) is not None]
    plaetze = [t for t in texte
               if PLATZ_X[0] <= t["x"] <= PLATZ_X[1] and zahl(t["t"]) is not None]

    zeilen = []
    for n in namen:
        # Gesperrt geschriebene Namen liefert Vision als Einzelstuecke
        # nebeneinander; rechts vom Namen steht in dieser Spalte sonst nichts.
        rest = sorted((t for t in texte
                       if NAME_X[0] <= t["x"] <= NAME_X[1]
                       and t["x"] >= n["x"] + n["w"] - 5
                       and abs(t["y"] - n["y"]) < n["h"] / 2), key=lambda t: t["x"])
        roh = " ".join([n["t"]] + [t["t"] for t in rest])
        guete = min([n["c"]] + [t["c"] for t in rest])

        p = next((q for q in punkte if PUNKTE_DY[0] <= q["y"] - n["y"] <= PUNKTE_DY[1]), None)
        r = next((q for q in plaetze if PLATZ_DY[0] <= q["y"] - n["y"] <= PLATZ_DY[1]), None)
        zeilen.append({
            "platz": zahl(r["t"]) if r else None,
            "name_roh": roh,
            "name": name_saeubern(roh),
            "punkte": zahl(p["t"]) if p else None,
            "sicher": round(min(guete, p["c"] if p else guete), 2),
            "y": round(n["y"]),
        })
    return sorted(zeilen, key=lambda z: z["y"])


def zeilen_im_bild(bild: np.ndarray) -> list[dict]:
    """Alle vollstaendig sichtbaren Zeilen des scrollbaren Teils, von oben nach unten.

    Am oberen und unteren Rand angeschnittene Zeilen liefern keinen Punktwert
    und fallen hier heraus — sie stehen im Nachbarbild vollstaendig da. Bei
    rund 253 px Zeilenhoehe und 452 px je Rastung sieht der Lauf jede Zeile
    mehrfach; eine hier verworfene ist damit nicht verloren.
    """
    zeilen = _zeilen_aus_texten(zeilen_lesen(bild, LISTE_BOX, SPRACHEN_NAMEN))
    return [z for z in zeilen if z["punkte"] is not None]


def eigene_zeile(bild: np.ndarray) -> dict | None:
    """Die festgepinnte gruene Zeile am unteren Rand — der eigene Stand."""
    zeilen = _zeilen_aus_texten(zeilen_lesen(bild, EIGENE_BOX, SPRACHEN_NAMEN))
    treffer = [z for z in zeilen if z["punkte"] is not None]
    return treffer[0] if treffer else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pruefen", required=True, help="Pfad zu einem Bildschirmfoto")
    args = ap.parse_args()

    bild = cv2.cvtColor(cv2.imread(args.pruefen), cv2.COLOR_BGR2RGB)
    zeilen = zeilen_im_bild(bild)
    print(f"{len(zeilen)} Zeilen:")
    for z in zeilen:
        pkt = f"{z['punkte']:,}".replace(",", ".")
        print(f"  {str(z['platz']):>4}. {z['name']:<28} {pkt:>14}"
              f"   (sicher {z['sicher']:.2f}, y={z['y']})")
    eigen = eigene_zeile(bild)
    print(f"\nEigene Zeile: {eigen['platz']}. {eigen['name']} "
          f"{eigen['punkte']:,}".replace(",", ".") if eigen else "\nEigene Zeile: nicht gelesen")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
