"""Den Weg zur VS-Tagesliste gehen — und jeden Schritt belegen.

Basis → Allianzduell → „Rang" → Reiter „Tagesrang" → Haken „Deine Allianz" →
Tagesreiter. Der Weg stammt aus dem Touch-Mitschnitt vom 17.09.2026
(`aufnahme/20260917_144654_vs_tagesliste`).

**Jeder Schritt wird nachgeprueft, keiner wird geglaubt.** Feste Koordinaten
treffen frueher oder spaeter das Falsche — das Symbol am rechten Rand der Basis
haengt an den gerade laufenden Events, und welcher Tagesreiter gewaehlt ist,
sieht man nur am Bild. Stimmt der Zustand nach einem Tipp nicht, wird
abgebrochen statt weitergetippt.

Zwei Zustaende werden ueber Farbe gelesen, nicht ueber Text:

- **Der Haken „Deine Allianz"** — gesetzt ist er ein gruener Haken im dunklen
  Kasten (Gruenanteil 0,19), ungesetzt ist der Kasten leer (0,00). Dazwischen
  liegt nichts.
- **Der gewaehlte Tagesreiter** ist weiss, die uebrigen sind beige. Gemessen
  ueber den Anteil nahezu weisser Pixel: 0,83–0,88 gegen hoechstens 0,08, auch
  auf dem Bild mit dem Aufleuchten nach dem Tippen.
"""
from __future__ import annotations

import difflib
import time

import numpy as np

from scripts.ws_service import vision as v
from scripts.ws_service.device import Geraet


class NavigationFehler(RuntimeError):
    pass


TITEL_BOX = (40, 30, 760, 140)          # „Allianzduell" / „Rang" oben links
TAGESRANG_BOX = (60, 200, 480, 310)     # der Reiter „Tagesrang"
HAKEN_BOX = (2395, 2335, 2475, 2412)    # der Kasten neben „Deine Allianz"
TAG_Y = (350, 430)                      # Hoehe des Tagesreiter-Streifens
TAG_HALB = 70                           # halbe Breite des gemessenen Fensters

HAKEN_GRUEN = 0.05                      # darueber gilt der Haken als gesetzt
TAG_WEISS = 0.40                        # darueber gilt ein Reiter als gewaehlt
TAGE = ("Mo", "Di", "Mi", "Do", "Fr", "Sa")


def _titel(g: Geraet, bild=None) -> str:
    bild = g.bild() if bild is None else bild
    return v._norm(v.ocr(bild, TITEL_BOX, psm=7))


# Der Titel wird **aehnlich** verglichen, nicht gleich. Tesseract las
# „Allianzduell" am 17.09.2026 als `allianzdull` — der Weg stimmte, der Abbruch
# war der Vergleich. Ein fehlender Buchstabe in einem langen Wort darf einen
# Lauf nicht kosten; ein ganz anderer Bildschirm faellt trotzdem durch.
#
# 0,75 und nicht hoeher, weil „Rang" nur vier Buchstaben hat: ein falscher
# Buchstabe darin ergibt genau 0,75. Die Gegenrichtung bleibt trotzdem klar —
# „Basis" kommt gegen „Rang" auf 0,22, „Belohnung" auf 0,46.
TITEL_MIN = 0.75


def _titel_ist(titel: str, erwartet: str) -> bool:
    if erwartet in titel:
        return True
    return any(difflib.SequenceMatcher(None, w, erwartet).ratio() >= TITEL_MIN
               for w in titel.split())


def warte_auf_titel(g: Geraet, erwartet: str, versuche: int = 5,
                    pause: float = 1.2) -> str:
    """Auf einen Bildschirm warten, statt ihn einmal zu erfragen.

    Der Bildschirm wechselt mit einer Animation. Ein einzelner Blick direkt
    danach traf am 17.09.2026 mitten hinein: der Titel kam als **leerer** Text
    zurueck, und der Lauf brach ab, obwohl er richtig stand. Eine leere Lesung
    ist kein „falscher Bildschirm", sondern „noch keine Auskunft".
    """
    titel = ""
    for _ in range(versuche):
        titel = _titel(g)
        if _titel_ist(titel, erwartet):
            return titel
        time.sleep(pause)
    return titel


def haken_gesetzt(bild: np.ndarray) -> bool:
    x0, y0, x1, y1 = HAKEN_BOX
    a = bild[y0:y1, x0:x1].reshape(-1, 3).astype(int)
    gruen = ((a[:, 1] > 110) & (a[:, 1] - a[:, 0] > 40) & (a[:, 1] - a[:, 2] > 40)).mean()
    return bool(gruen > HAKEN_GRUEN)


def _weissanteil(bild: np.ndarray, x: int) -> float:
    a = bild[TAG_Y[0]:TAG_Y[1], x - TAG_HALB:x + TAG_HALB].reshape(-1, 3)
    return float((a.min(1) > 230).mean())


def gewaehlter_tag(bild: np.ndarray, cfg: dict) -> str | None:
    """Welcher Wochentag ist gerade gewaehlt? None = keiner erkennbar."""
    werte = {t: _weissanteil(bild, x) for t, x in cfg["tag_reiter_x"].items()}
    bester = max(werte, key=werte.get)
    return bester if werte[bester] > TAG_WEISS else None


def auf_tagesrang(bild: np.ndarray) -> bool:
    """Der aktive Reiter „Tagesrang" ist orange, der inaktive dunkelgrau."""
    x0, y0, x1, y1 = TAGESRANG_BOX
    a = bild[y0:y1, x0:x1].reshape(-1, 3).astype(int)
    orange = ((a[:, 0] > 180) & (a[:, 0] - a[:, 2] > 60) & (a[:, 1] > 80)).mean()
    return bool(orange > 0.15)


def zum_rang(g: Geraet, log=print) -> None:
    """Von der Basis bis zur Rangliste, mit gesetztem Allianz-Filter."""
    from scripts.ws_service.navigate import zur_hauptkarte

    bild = g.bild()
    if _titel_ist(_titel(g, bild), "rang"):
        log("  Rangliste ist schon offen.")
    else:
        if not _titel_ist(_titel(g, bild), "allianzduell"):
            zur_hauptkarte(g, log=log)
            log("  Allianzduell oeffnen ...")
            g.tippen(*g.cfg["events_icon"], pause=2.0)
            titel = warte_auf_titel(g, "allianzduell")
            if not _titel_ist(titel, "allianzduell"):
                raise NavigationFehler(
                    f"Nach dem Tipp auf {g.cfg['events_icon']} steht oben "
                    f"'{titel.strip()}' statt 'Allianzduell'. Das Symbol am rechten "
                    f"Rand haengt an den laufenden Events und sitzt offenbar "
                    f"woanders — bitte einmal von Hand nachsehen.")
        log("  'Rang' oeffnen ...")
        g.tippen(*g.cfg["rang_knopf"], pause=2.0)
        titel = warte_auf_titel(g, "rang")
        if not _titel_ist(titel, "rang"):
            raise NavigationFehler(
                f"Nach dem Tipp auf 'Rang' steht oben '{titel.strip()}'.")

    bild = g.bild()
    if not auf_tagesrang(bild):
        raise NavigationFehler(
            "Der Reiter 'Tagesrang' ist nicht aktiv. Beim Oeffnen ist er es "
            "immer — steht hier 'Wochen-Rang', hat jemand umgeschaltet.")

    filter_setzen(g, bild, log=log)


def filter_setzen(g: Geraet, bild=None, log=print) -> None:
    """Sicherstellen, dass nur die eigene Allianz in der Liste steht.

    **Der Haken ist nicht dauerhaft.** Eine frisch geoeffnete Rangliste steht
    auf dem heutigen Tag und *ohne* Filter — am 17.09.2026 nachgesehen, nachdem
    ein abgebrochener Lauf die Liste neu geoeffnet hatte. Ungefiltert stehen die
    Gegner mit in der Liste (auf #9016 rund 200 Zeilen), und der Lauf schriebe
    fremde Spieler in den eigenen Kader. Geprueft wird deshalb nicht einmal am
    Anfang, sondern nach jedem Tageswechsel.
    """
    bild = g.bild() if bild is None else bild
    if haken_gesetzt(bild):
        return
    log("  Haken 'Deine Allianz' setzen ...")
    g.tippen(*g.cfg["deine_allianz"], pause=2.0)
    if not haken_gesetzt(g.bild()):
        raise NavigationFehler(
            "Der Haken 'Deine Allianz' laesst sich nicht setzen. Ohne ihn "
            "stehen die Gegner mit in der Liste — es wird nichts gelesen.")


def tag_waehlen(g: Geraet, tag: str, log=print) -> None:
    """Einen Wochentag anwaehlen und die Wahl am Bild nachpruefen."""
    if tag not in g.cfg["tag_reiter_x"]:
        raise NavigationFehler(f"'{tag}' ist kein Tagesreiter ({', '.join(TAGE)}).")
    if gewaehlter_tag(g.bild(), g.cfg) == tag:
        return
    g.tippen(g.cfg["tag_reiter_x"][tag], g.cfg["tag_reiter_y"], pause=2.5)
    time.sleep(1.0)
    ist = gewaehlter_tag(g.bild(), g.cfg)
    if ist != tag:
        raise NavigationFehler(
            f"Wollte '{tag}' waehlen, gewaehlt ist aber "
            f"'{ist or 'keiner erkennbar'}'.")
