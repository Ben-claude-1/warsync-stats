"""Die Teilnehmerliste auslesen.

Was eine Zeile bedeutet — die ganze Logik des Dienstes in vier Saetzen:

* **Zeitkopfzeile = fuer welche Uhrzeit angemeldet.** Wer sich angemeldet hat,
  bekommt ueber seiner Zeile einen Balken „Lokale Zeit: … 13:00 ~ 13:30". Die
  Uhrzeit sagt, fuer welches Team (nachgeschlagen in `wsTime` des Tools, nicht
  fest verdrahtet — die Zeiten sind je Team umstellbar). Die **Farbe** des
  Balkens meint nicht das Team, sondern das gerade offene Blatt; was sie
  bedeutet, misst `farb_teams` aus den Uhrzeiten des Laufs selbst.
* **Das Abzeichen im Einteilungsfeld schlaegt den Balken** — es sagt, in
  welchem Team jemand *ist*, der Balken nur, fuer wann er *koennte*.
* **Badge links = gesetzt, Badge rechts = Ersatz.** Die beiden Spalten stehen
  genau unter den Zaehlern der Kopfzeile (👤x und 👤↺).
* **Kopfzeile ohne Badge = C.** Angemeldet, aber keiner der 30 Plaetze.
* **Keine Kopfzeile = gar nicht angemeldet.** Diese Zeilen werden bewusst
  uebergangen: sie sind keine Aussage, und im Tool darf dafuer nichts stehen.

Die Rang-Gruppen (R5…R1) sind zugeklappt oder aufgeklappt. Der Dienst klappt
jede genau einmal auf — erkannt am OCR-Text des Balkens, der sich beim Scrollen
nicht aendert. Ohne dieses Gedaechtnis wuerde derselbe Balken in mehreren
Bildern erneut angetippt und damit wieder zugeklappt.
"""
from __future__ import annotations

import collections
import functools
import re
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from scripts.karten_archiv.banner import _vision
from . import vision as v
from .device import Geraet

VORLAGEN = Path(__file__).resolve().parent / "vorlagen"


class ScanFehler(RuntimeError):
    pass


ZAEHLER = re.compile(r"(\d+)\s*/\s*(\d+)")

# Ab wie vielen Pixeln eine gemessene Verschiebung als echter Scroll-Schritt
# gilt. Begruendung an der Auswertungsstelle in `durchlauf`.
MIN_VERSATZ_PX = 180

# Wie weit der Gegenruck bei einer stehenden Liste zurueckgeht, und wie lange
# er dafuer braucht. Siehe `Geraet.liste_zurueck`: das Tempo entscheidet, nicht
# die Strecke — rund 120 px/s, nachgemessen an Bens Hand.
RUECK_PX = 70
RUECK_MS = 600

# Wie weit die Serverzeit hinter der europaeischen liegt — dieselbe Zahl wie
# SERVER_DIFF_H in src/core/helpers.js. Siehe `eu_zu_server`.
SERVER_DIFF_H = -4


# ── Bausteine eines Bildes ────────────────────────────────────────────────
def gruppenbalken(g: Geraet, bild) -> list[tuple[int, int]]:
    x0, y0, x1, y1 = g.cfg["list_view"]
    s = g.cfg["schwellen"]
    roh = v.baender(bild, y0, y1, 700, 1500, v.ist_gruppenbalken, s["gruppe_min_hoehe"])
    return [(a, b) for a, b in roh if b - a <= s["gruppe_max_hoehe"]]


def zeitkoepfe(g: Geraet, bild) -> list[tuple[int, int, str]]:
    """Alle Zeitkopfzeilen im Bild, mit 'A-Farbe'/'B-Farbe' als Rohkennung."""
    x0, y0, x1, y1 = g.cfg["list_view"]
    s = g.cfg["schwellen"]
    out = []
    for pruefer, kennung in ((v.ist_gruen, "gruen"), (v.ist_orange, "orange")):
        for a, b in v.baender(bild, y0, y1, 700, 1500, pruefer, s["kopf_min_hoehe"]):
            out.append((a, b, kennung))
    return sorted(out)


# Rechts neben dem Ersatz-Feld ist die Zeilenkarte leer — dort steht weder ein
# Abzeichen noch das Verbotszeichen. Gemessen am 17.09.2026 ueber Blatt A und B.
ZEILENRAND_X = (1780, 1850)

# Der Trennstreifen zwischen zwei Karten ist 28 px hoch (1480…1508, 1800…1828
# ueber demselben Bild). Die Grenzen lassen Luft nach oben und unten, schliessen
# aber die grossen beigen Flaechen ueber und unter der Liste aus.
TRENNER_MIN_HOEHE = 12
TRENNER_MAX_HOEHE = 70


def _ist_trenner(r, g, b):
    """Der beige Streifen zwischen zwei Zeilenkarten.

    Rot ueber Blau — dieselbe Unterscheidung wie bei `ist_gruppenbalken`, nur
    andersherum: die Rang-Balken sind fliederfarben (Blau ueber Rot), die
    Kartenzwischenraeume warm. Nach oben abgegrenzt wird gegen das Weiss der
    Karte selbst (Mittel 251), nach unten gegen Schrift und Bilder.
    """
    m = (r + g + b) / 3
    return (r > b + 4) & (m > 180) & (m < 240)


def zeilenkoepfe(g: Geraet, bild) -> list[tuple[int, int, None]]:
    """Zeilenanfaenge ohne Zeit-Balken — fuer die Liste nach dem Anmeldeschluss.

    **Nach Donnerstag 04:00 zeichnet Last War die farbigen Zeit-Balken nicht
    mehr.** Sie sind die Anmeldung, und die ist dann vorbei; die Abzeichen
    (`A`/`B` im Feld „gesetzt" bzw. „Ersatz") stehen weiter da. `zeitkoepfe`
    findet in diesem Zustand null Zeilen, und der ganze Lauf kommt leer heraus
    — am 17.09.2026 zweimal hintereinander, einmal davon nach einem
    App-Neustart, der den Renderfehler vom 09.09.2026 ausgeschlossen hat.

    Der Anker ist deshalb ein anderer: der **Trennstreifen zwischen zwei
    Zeilenkarten**, gemessen in der leeren rechten Spalte der Karte. Sein Ende
    liegt an derselben Stelle, an der sonst der Balken endet — `zeile_lesen`
    bleibt damit unveraendert.

    **Was fehlt, fehlt wirklich.** Ohne Balken gibt es keine Farbe und keine
    Uhrzeit, also auch kein `AC`/`BC`: wer sich gemeldet hat und aussortiert
    wurde, ist von jemandem, der sich nie gemeldet hat, nicht zu
    unterscheiden. Diese Funktion liefert deshalb `None` als Kennung statt
    einer geratenen Farbe — die Auskunft ist weg, nicht verschoben. Wer sie
    braucht, muss **vor** dem Anmeldeschluss scannen.
    """
    _, y0, _, y1 = g.cfg["list_view"]
    x0, x1 = ZEILENRAND_X
    out = []
    for a, b in v.baender(bild, y0, y1, x0, x1, _ist_trenner, TRENNER_MIN_HOEHE):
        if b - a <= TRENNER_MAX_HOEHE:
            out.append((a, b, None))
    return sorted(out)


def _name_vision(bild, box) -> str:
    """Den Namen mit der Texterkennung von macOS lesen — `''`, wenn das nicht geht.

    Der Import steht absichtlich **in** der Funktion: `ergebnis` zieht `match`
    nach, und `match` importiert dieses Modul. Auf Modulebene waere das ein
    Ringschluss.
    """
    try:
        from .ergebnis import SPRACHEN_NAMEN, zeilen_lesen
        texte = zeilen_lesen(bild, box, SPRACHEN_NAMEN)
    except Exception:
        return ""
    return texte[0]["t"].strip() if texte else ""


@functools.lru_cache(maxsize=1)
def _team_vorlagen() -> dict:
    return {b: cv2.cvtColor(np.array(Image.open(VORLAGEN / f"team_{b.lower()}.png")
                                     .convert("RGB")), cv2.COLOR_RGB2GRAY)
            for b in ("A", "B")}


# Ab welchem Abstand der beiden Vorlagen die Lesung gilt. Gemessen am
# 16.09.2026 ueber 134 Abzeichen: der richtige Buchstabe kommt auf 0,96–1,00,
# der falsche auf 0,59–0,68. Dazwischen liegt nichts.
TEAM_MIN_ABSTAND = 0.15


def team_abzeichen(bild, y_kopf_ende: int, x: int) -> str | None:
    """'A' oder 'B' aus dem Abzeichen im Einteilungsfeld — oder None.

    **Das ist die einzige Stelle, an der das Spiel das Team selbst nennt.**
    Bisher kam es aus der Farbe des Balkens ueber der Zeile, und die ist beim
    Scrollen nicht verlaesslich: am 16.09.2026 stand dieselbe Zeile
    (`ZephyrusXI`, 150,8M) in bild_009 unter einem gruenen Balken „09:00 ~
    09:30" und in bild_010 unter einem orangen „18:00 ~ 18:30" — das Abzeichen
    war beide Male ein `A`. Die Liste zeichnet ihre Zeilen beim Scrollen neu,
    und ein Bild trifft sie gelegentlich zwischen Balken und Zeile. Ueber fuenf
    Spieler (ZephyrusXI, Mammon90, NuSReT, Mika Pika, Little Kong) fuehrte das
    zu widerspruechlichen Werten, die die Gegenprobe scheitern liessen.

    Gelesen wird als **Bild, nicht als Text**: Tesseract und die Texterkennung
    von macOS liefern bei diesem verzierten Einzelbuchstaben meist gar nichts
    (`A` in 4 von 10 Faellen, `B` nie). Der Vorlagenabgleich trennt beide
    dagegen sauber — dieselbe Haltung wie sonst im Dienst: Text wird gelesen,
    Zustand wird gemessen.

    Gesucht wird in einem etwas groesseren Fenster, damit die paar Pixel
    Hoehenunterschied je nach Namenslaenge nichts ausmachen.

    **Es muss beide Anker aushalten.** Haengt ein Zeit-Balken ueber der Zeile,
    sitzt das Abzeichen bei `dy` 60 (gemessen ueber sechs Bilder aus `lauf10`,
    Trefferwert 0,98–1,00); nach dem Anmeldeschluss gibt es keinen Balken mehr
    und `zeilenkoepfe` ankert am Trennstreifen zwischen den Karten — dann sind
    es 93. Mit dem alten Fenster (+45…+185) fiel dort der untere Rand der
    110 px hohen Vorlage heraus, und der Abgleich brach von 0,99 auf 0,35 ein:
    beide Buchstaben gleich schlecht, also `None`. Die Zeile stand dann ohne
    Team da, obwohl das Abzeichen im Bild sauber zu sehen war. Nach unten ist
    genug Luft — die naechste Zeile beginnt erst 320 px weiter.
    """
    fenster = bild[y_kopf_ende + 45:y_kopf_ende + 215, x - 75:x + 75]
    if fenster.size == 0:
        return None
    grau = cv2.cvtColor(fenster, cv2.COLOR_RGB2GRAY)
    werte = {}
    for buchstabe, vorlage in _team_vorlagen().items():
        if grau.shape[0] < vorlage.shape[0] or grau.shape[1] < vorlage.shape[1]:
            return None
        werte[buchstabe] = float(cv2.matchTemplate(
            grau, vorlage, cv2.TM_CCOEFF_NORMED).max())
    beste, zweite = sorted(werte.items(), key=lambda kv: -kv[1])
    return beste[0] if beste[1] - zweite[1] >= TEAM_MIN_ABSTAND else None


def zeile_lesen(g: Geraet, bild, y_kopf_ende: int) -> dict:
    """Name, Kraft, Uhrzeit und Badge-Zustand einer Zeile.

    **Den Namen liest Vision, die Kraft weiter Tesseract.** Am 16.09.2026 ueber
    die 93 Zeilen eines gespeicherten Laufs gemessen (`--bilder`), verglichen
    wurde gegen die 99 aktiven Kadernamen:

    | Erkennung | exakt im Kader |
    |---|---|
    | Tesseract | 73 |
    | macOS Vision, Japanisch zuerst | **79** |

    Der Gewinn steckt genau dort, wo die Doku ihn vorhersagt: `V ベジータ王子`
    kam als `VND-SIEF` und `VAD-9EF` an und war in keinem Lauf zuzuordnen, aus
    `Martoxen` wurde `I EL u _ VE`. Dazu die Ziffernverwechslungen, an denen
    Tesseract regelmaessig scheitert (`Dede33190`, `SyDdu33`, `CarmenO03804`).
    Umgekehrt verliert Vision gelegentlich ein Zeichen (`Efraim Maftia`) — das
    faengt der unscharfe Abgleich in `match.py` ab, ein unlesbarer Name nicht.

    Die Kraftzahl bleibt bei Tesseract: sie ist der Tiebreak des Abgleichs, und
    fuer reine Ziffern ist sie dort gut aufgehoben. Faellt Vision aus (kein
    macOS, kein Swift), steht wieder die Tesseract-Lesung da — der Lauf wird
    schlechter, aber er bricht nicht.
    """
    nx0, nx1 = g.cfg["name_box_x"]
    box = (nx0, y_kopf_ende + 8, nx1, y_kopf_ende + 205)
    text = v.ocr(bild, box, psm=6)
    zeilen = [z.strip() for z in text.splitlines() if z.strip()]
    name = _name_vision(bild, box) or (zeilen[0] if zeilen else "")
    schwelle = g.cfg["schwellen"]["badge_blau_minus_rot"]
    badges = {}
    for rolle, x in g.cfg["badge_x"].items():
        badges[rolle] = v.blau_signal(bild, x, y_kopf_ende + 40, y_kopf_ende + 230)
    if badges["gesetzt"] > schwelle:
        platz = "gesetzt"
    elif badges["ersatz"] > schwelle:
        platz = "ersatz"
    else:
        platz = "ohne"
    # Im belegten Feld steht der Buchstabe des Teams. Wer keinen Platz hat, hat
    # auch kein Abzeichen — fuer ihn bleibt es beim Balken ueber der Zeile.
    team = (team_abzeichen(bild, y_kopf_ende, g.cfg["badge_x"][platz])
            if platz != "ohne" else None)
    return {"name_ocr": name, "kraft": v.kraft(text), "platz": platz,
            "team_abzeichen": team,
            "badge_signal": {k: round(x, 1) for k, x in badges.items()}}


def kopfzeit(g: Geraet, bild, y0: int, y1: int) -> str | None:
    return v.uhrzeit(v.ocr(bild, (700, y0 - 4, 1900, y1 + 4), psm=7))


def gruppen_zaehler(g: Geraet, bild, y0: int) -> dict:
    """Die drei Zahlen einer Rang-Kopfzeile: Kommandant, gesetzt, Ersatz.

    **Sie sind die Gegenprobe des Scans.** Je Rang gezaehlt, damit ein Fehler
    auch zeigt, *wo* er sitzt — die Summe allein sagt nur, dass etwas fehlt.
    Ihre Summe muss zur Zahl ueber der Liste passen; tut sie es nicht, ist beim
    Durchscrollen etwas verlorengegangen.
    """
    dy0, dy1 = g.cfg["group_counter_dy"]
    return {rolle: v.zahl(bild, (x0, y0 + dy0, x1, y0 + dy1))
            for rolle, (x0, x1) in g.cfg["group_counter_x"].items()}


def dialog_zaehler(g: Geraet, bild) -> dict:
    """Die Zahlen ueber der Liste: eingeteilt / Plaetze, fuer beide Rollen.

    Dieselbe Groesse wie die Rang-Zaehler, nur als Gesamtsumme — und damit die
    zweite Gegenprobe.

    Dass sie sich waehrend eines Nachmittags aendern, heisst **nicht**, dass der
    Scan falsch lag: in der Anmeldephase duerfen R4 und R5 die Zuordnung jederzeit
    umstellen. Der Dienst liest einen Zustand, keine Wahrheit auf Dauer.
    """
    text = v.ocr(bild, tuple(g.cfg["dialog_header"]), psm=6)
    paare = ZAEHLER.findall(text)
    if len(paare) < 2:
        return {}
    gesetzt, ersatz = paare[-2], paare[-1]
    return {"gesetzt": int(gesetzt[0]), "gesetzt_max": int(gesetzt[1]),
            "ersatz": int(ersatz[0]), "ersatz_max": int(ersatz[1])}


# ── Der Durchlauf ─────────────────────────────────────────────────────────
# Das Rang-Abzeichen sitzt ganz links im Balken.
RANG_X = (670, 800)
_RANG_RE = re.compile(r"R\s*([1-5])")
# Die unterste Rang-Gruppe. Was danach kommt, gibt es nicht.
LETZTER_RANG = "R1"


def rang(bild, y0: int, y1: int) -> str | None:
    """Welcher Rang steht auf dem Balken — `'R5'` … `'R1'`, sonst `None`.

    **Wozu, wenn der Schluessel schon aus den Zaehlern kommt.** Der Schluessel
    unterscheidet Gruppen voneinander, sagt aber nicht, welche die *letzte*
    ist. Genau das fehlte der Abbruchbedingung: „Liste haengt" und „Liste ist zu
    Ende" sehen vorwaerts beide gleich aus — ein stehendes Bild —, und deshalb
    musste das Listenende ueber zehn Stillstaende erraten werden. Der Rang sagt
    es direkt: unter R1 kommt nichts mehr.

    **Gelesen wird mit der Texterkennung von macOS, nicht mit Tesseract.** Am
    16.09.2026 an einem Bild mit R2- und R1-Balken gemessen: Vision liefert
    `'R2'` und `'R1'`, in jedem der drei probierten Zuschnitte und in beiden
    Groessen. Tesseract liest dasselbe Abzeichen als `'LER'`, `'(EEK'`, `'2%'`
    oder `'R1|ı'` — weisse Schrift auf goldenem Schild ist genau der Fall, an
    dem es scheitert.

    `None` heisst „nicht gelesen" und nicht „kein Rang": ohne macOS oder Swift
    gibt es Vision nicht, und dann bleibt es beim alten Abbruch ueber die
    Stillstaende. Der Lauf wird langsamer, aber er bricht nicht.
    """
    try:
        text = _vision(Image.fromarray(bild[y0:y1, RANG_X[0]:RANG_X[1]]))
    except Exception:
        return None
    if not text:
        return None
    treffer = _RANG_RE.search(text)
    return f"R{treffer.group(1)}" if treffer else None


def _balken_schluessel(g: Geraet, bild, y0: int, zaehler: dict) -> str:
    """Wiedererkennungsmerkmal einer Rang-Gruppe ueber Bilder hinweg.

    Aus den **Zahlen** gebaut, nicht aus dem Fliesstext des Balkens: der wandert
    beim Scrollen um ein paar Pixel, und die OCR liefert dann leicht anderen
    Buchstabensalat („Bu a0 Bo 42 30"). Ein wechselnder Schluessel liesse
    dieselbe Gruppe als neu erscheinen — und ein zweiter Tipp klappt sie wieder zu.

    **Nur die beiden Einteilungs-Zahlen tragen den Schluessel.** Die
    Mitgliederzahl stand hier frueher mit drin und hat am 02.09.2026 dieselbe
    R3-Gruppe dreimal gezaehlt: ihr Bruch wurde mal als „80", mal als „380"
    gelesen (die Ziffer des Zaehlers blutet in den Nenner), der Kommandanten-
    Zaehler mal als 0, mal gar nicht. Aus 17 gesetzten wurden so 54 — und die
    Gegenprobe schlug fehl, obwohl der Scan stimmte.

    Ausnahme: eine Gruppe **ohne** Einteilung (0/0) traegt die Mitgliederzahl
    weiter mit. Zwei leere Rang-Gruppen waeren sonst nicht zu unterscheiden und
    die zweite wuerde nie aufgeklappt — dort sitzen die 'C'-Spieler, die sich
    angemeldet haben, ohne einen Platz zu bekommen. Fuer die Summe ist es
    gleichgueltig, ob 0 einmal oder zweimal gezaehlt wird.
    """
    ges, ers = zaehler.get("gesetzt"), zaehler.get("ersatz")
    if ges is not None and ers is not None and (ges or ers):
        return f"{ges}|{ers}"
    dy0, dy1 = g.cfg["group_counter_dy"]
    x0, x1 = g.cfg["group_members_x"]
    mitglieder = v.bruch(bild, (x0, y0 + dy0 - 10, x1, y0 + dy1))
    teile = [zaehler.get("kommandant"), ges, ers, mitglieder]
    return "|".join("?" if t is None else str(t) for t in teile)


# Ab wie vielen Buchstaben/Ziffern unter einem Balken dort Listeninhalt steht.
# Gemessen am 09.09.2026 an beiden Zustaenden desselben Dialogs: offen 17 und
# 28 Zeichen, zugeklappt 0 und 1. Dazwischen liegt nichts, die Grenze ist
# unkritisch.
INHALT_MIN_ZEICHEN = 4


def _inhalt_darunter(g: Geraet, bild, y_ab: int) -> bool:
    """Steht unter `y_ab` noch Listeninhalt — oder ist dort nichts mehr?

    Gemessen wird **Text**, nicht der Kraftwert. Der lag naeher, taugt aber
    nicht: der Rang-Balken klebt beim Scrollen oben fest, und unter ihm steht
    dann eine angeschnittene Zeile, deren Kraftzeile aus dem Fenster gefallen
    ist. Genau daran hat die erste Fassung dieser Funktion am 09.09.2026 eine
    offene R3 als zugeklappt gemeldet. Irgendein Text steht unter einer offenen
    Gruppe immer — ein Name, ein Rangtitel, eine Serverzeit.
    """
    nx0, nx1 = g.cfg["name_box_x"]
    _, _, _, view_unten = g.cfg["list_view"]
    text = v.ocr(bild, (nx0, y_ab + 8, nx1, min(y_ab + 205, view_unten)), psm=6)
    return sum(c.isalnum() for c in text) >= INHALT_MIN_ZEICHEN


def _zugeklappt(g: Geraet, bild, y1: int, balken: list[tuple[int, int]],
                idx: int) -> bool | None:
    """Ist die Rang-Gruppe zugeklappt? Gemessen, nicht geraten.

    Folgt dicht darunter der naechste Rang-Balken, ist sie zu — das ist der
    einfache Fall. Beim **untersten** Balken im Bild steht dort kein Balken,
    weil Mitglieder keine sind; frueher lieferte diese Funktion darum `None`
    („nicht entscheidbar") und der Aufrufer tippte am Listenende blind darauf.
    War die Gruppe in Wahrheit offen, klappte genau dieser Griff sie **zu**:
    am 09.09.2026 verschwand so R4 mitsamt ihren Zeilen aus dem Lauf, und der
    Scan zog zu R3 weiter, als waere nichts gewesen.

    Der Unterschied ist aber sichtbar, man muss nur hinsehen: unter einer
    offenen Gruppe steht eine Spielerzeile, unter einer zugeklappten nicht.

    `None` bleibt fuer den einen Fall, in dem sich nichts messen laesst — der
    Balken sitzt so tief, dass unter ihm kein ganzer Zeilenstreifen mehr ins
    Bild passt. Dann wird **nicht** getippt, sondern gewartet: nach dem
    naechsten Schritt steht er weiter oben und die Frage beantwortet sich.
    """
    if idx + 1 < len(balken):
        return balken[idx + 1][0] - y1 < 45
    _, _, _, view_unten = g.cfg["list_view"]
    if view_unten - y1 < 150:
        return None
    return not _inhalt_darunter(g, bild, y1)


def alle_gruppen_einklappen(g: Geraet, log=print, max_tipps: int = 12) -> None:
    """Waechter: vor dem Scan ist jede Rang-Gruppe zugeklappt.

    Der erste Schritt nach dem Betreten der Liste, nicht der zweite. Beim
    Sprung aus „Teilnehmer auswaehlen" kann bereits ein Rang offen stehen —
    dann liest der Scan Mitglieder der falschen Gruppe mit, und die Zaehler je
    Rang gehen scheinbar auf. Das Ergebnis sieht plausibel aus und ist falsch;
    genau daran sind ueber Wochen Laeufe gescheitert.

    Der Waechter ist deshalb Code und nicht Vorsatz: er klappt ein, bis nichts
    Offenes mehr zu sehen ist, und bricht ab, wenn ihm das nicht gelingt. Ein
    Lauf auf ungeklaertem Zustand ist schlimmer als kein Lauf.

    Gescrollt werden muss dabei kaum: sind alle Gruppen zu, ist die Liste nur
    noch eine Handvoll Balken hoch und passt auf einen Schirm. Jede
    eingeklappte Gruppe holt die darunter liegenden mit ins Bild.
    """
    zum_listenanfang(g, log=log)
    eingeklappt = 0
    for _ in range(max_tipps + 1):
        bild = g.bild()
        balken = gruppenbalken(g, bild)
        _, _, _, view_unten = g.cfg["list_view"]
        offen = None
        for i, (y0, y1) in enumerate(balken):
            if y1 + 45 >= view_unten:
                continue
            if _zugeklappt(g, bild, y1, balken, i) is False:
                offen = (y0, y1)
                break
        if offen is None:
            log(f"  Waechter: alle Rang-Gruppen zugeklappt "
                f"({eingeklappt} eingeklappt).")
            return
        eingeklappt += 1
        log("  Waechter: Rang-Gruppe steht offen — einklappen ...")
        g.tippen(g.cfg["group_arrow_x"], (offen[0] + offen[1]) // 2, pause=1.6)
        zum_listenanfang(g, log=log)
    raise ScanFehler("Die Rang-Gruppen lassen sich nicht alle einklappen — "
                     "abgebrochen, statt auf ungeklaertem Zustand zu scannen.")


def zum_listenanfang(g: Geraet, log=print, max_schritte: int = 25) -> None:
    letzte = None
    for _ in range(max_schritte):
        bild = g.bild()
        sig = _signatur(g, bild)
        if letzte is not None and _steht(sig, letzte):
            return
        letzte = sig
        g.liste_weiter(rueckwaerts=True)
    log("  (Listenanfang nicht sicher erreicht — weiter mit dem, was da ist.)")


def _signatur(g: Geraet, bild) -> np.ndarray:
    x0, y0, x1, y1 = g.cfg["list_view"]
    return bild[y0:y1:7, x0:x1:7].astype(np.int16)


def _versatz(g: Geraet, vorher, nachher) -> int | None:
    """Um wie viele Pixel ist der Listeninhalt nach oben gerutscht?

    Ein Ja/Nein („bewegt sich") sagt nicht, ob ein Schritt zu kurz oder gar
    nicht angekommen ist. Die Zahl steht deshalb im Protokoll: ein wirkungsloser
    Schritt faellt damit sofort auf, statt erst am mageren Endergebnis.

    None heisst „nicht messbar" — die Wiedererkennung war zu unsicher, meist
    weil sich sehr viel geaendert hat.
    """
    if vorher is None or nachher is None:
        return None
    x0, y0, x1, y1 = g.cfg["list_view"]
    a = cv2.cvtColor(vorher, cv2.COLOR_RGB2GRAY)[y0:y1, x0:x1]
    b = cv2.cvtColor(nachher, cv2.COLOR_RGB2GRAY)[y0:y1, x0:x1]
    h = a.shape[0]
    muster = a[h - 260:h - 60, :]
    suchraum = b[max(0, h - 260 - 900):h - 60, :]
    if suchraum.shape[0] < muster.shape[0]:
        return None
    treffer = cv2.matchTemplate(suchraum, muster, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(treffer)
    if guete < 0.55:
        return None
    return -((max(0, h - 260 - 900) + ort[1]) - (h - 260))


def _steht(a: np.ndarray, b: np.ndarray, toleranz: float = 0.02) -> bool:
    """Zwei Bilder derselben Scrollstellung — mit Nachsicht verglichen.

    Nicht auf Gleichheit pruefen: im Dialog schimmern die Kopfzeilen leicht, und
    ein Byte-Vergleich findet deshalb **nie** zwei gleiche Bilder. Der Dienst
    hielte den Listenanfang nie fuer erreicht und wischte stur bis zum
    Schleifenende weiter — von aussen sieht das aus, als haenge er.
    """
    if a is None or b is None or a.shape != b.shape:
        return False
    return float((np.abs(a - b).max(axis=2) > 20).mean()) < toleranz


def durchlauf(g: Geraet, log=print, max_bilder: int = 120,
              max_aufklapp: int = 10, leser=zeile_lesen,
              bilder_ordner=None) -> dict:
    """Einmal von oben nach unten. Gibt Rohzeilen und die Zaehler zurueck.

    `leser` liest eine einzelne Zeile (Signatur wie `zeile_lesen`) und ist
    austauschbar: Scrollen, Rang-Gruppen und Gegenprobe sind fuer Wuestensturm
    und Schluchtsturm identisch, nur *was* an einer Zeile abzulesen ist,
    unterscheidet sich (Badge-Rolle hier, Team-Wunsch beim Schluchtsturm-Dienst).

    `bilder_ordner` legt jedes Bild des Laufs als PNG ab. Der Scan dauert zehn
    Minuten und faellt jedes Mal anders aus — ohne Belegbilder laesst sich eine
    Aenderung an der Namenserkennung nur behaupten, nicht messen. Mit ihnen
    laeuft dieselbe Aenderung beliebig oft ueber dasselbe Material, wie schon
    beim Kartenarchiv und bei den Kampfergebnissen.
    """
    alle_gruppen_einklappen(g, log=log)
    bild = g.bild()
    zaehler = dialog_zaehler(g, bild)
    if zaehler:
        log(f"  Eingeteilt laut Spiel: {zaehler['gesetzt']}/{zaehler['gesetzt_max']} "
            f"gesetzt, {zaehler['ersatz']}/{zaehler['ersatz_max']} Ersatz")

    gesehen_balken: dict[str, dict] = {}
    # Zweitschluessel: gesetzt-Zahl → Schluessel der Gruppe, die sie trug.
    # Faellt in einem Bild der Ersatz-Zaehler aus (die OCR liefert dann None),
    # entsteht ein anderer Schluessel fuer dieselbe Gruppe — und sie zaehlt ein
    # zweites Mal. Am 02.09.2026 wurden aus 15 gesetzten so 35. Ueber die
    # gesetzt-Zahl findet sie sich trotzdem wieder; der bessere der beiden
    # Lesevorgaenge gewinnt.
    gesehen_nach_gesetzt: dict[int, str] = {}
    zeilen: list[dict] = []
    letzte_sig = None
    letztes_bild = None
    strecken: list[int] = []
    # (wievielter Stillstand, gemessener Ruck zurueck) — Rohmaterial fuer die
    # Frage, ob sich „haengt" und „am Ende" rueckwaerts trennen lassen.
    rueck_messungen: list[tuple[int, int | None]] = []
    gleich_hintereinander = 0
    aufklapp_tipps = 0
    # In wie vielen Stillstands-Bildern hintereinander stand R1 im Fenster.
    # Siehe die Auswertung weiter unten — eine einzelne Lesung reicht nicht.
    r1_bestaetigt = 0

    for schritt in range(max_bilder):
        bild = g.bild()
        if bilder_ordner is not None:
            Image.fromarray(bild).save(f"{bilder_ordner}/bild_{schritt:03d}.png")
        balken = gruppenbalken(g, bild)
        _, _, _, view_unten = g.cfg["list_view"]

        # 0) Zuerst lesen, was in diesem Bild steht — vor jeder Aktion.
        #
        # Das Aufklappen einer Rang-Gruppe brach die Runde frueher mit
        # `continue` ab, und die Zeilen dieses Bildes wurden nie gelesen. Danach
        # springt die Liste (sie wird ja laenger), sodass genau diese Zeilen in
        # keinem weiteren Bild mehr im lesbaren Streifen landen mussten: am
        # 09.09.2026 fielen so 13 Zeilen komplett durch — darunter `sapphy`,
        # `Saladin 85` und `Skirata33`, die nur ein einziges Mal und dort
        # angeschnitten am unteren Rand zu sehen waren. Im Ergebnis fehlten 6
        # von 20 gesetzten Spielern in Team A, ohne dass eine der beiden
        # Gegenproben anschlug: die zaehlen Rang-Kopfzeilen, nicht Zeilen.
        #
        # Zeilen doppelt zu lesen kostet nichts — `match.zuordnen` fasst sie
        # ueber den Namen zusammen. Eine ungelesene Zeile ist dagegen weg.
        for y0, y1, farbe in zeitkoepfe(g, bild):
            if y1 + 210 >= view_unten:
                continue                      # Zeile angeschnitten — naechstes Bild
            z = leser(g, bild, y1)
            z["farbe"] = farbe
            z["zeit"] = kopfzeit(g, bild, y0, y1)
            if z["kraft"] is None:
                continue                      # ohne Kraftwert keine brauchbare Zeile
            zeilen.append(z)

        # 1) Eine noch nicht behandelte, zugeklappte Gruppe aufklappen.
        aktion = False
        for i, (y0, y1) in enumerate(balken):
            if y1 + 45 >= view_unten:
                continue                      # zu nah am Rand, spaeter nochmal
            zaehler_gruppe = gruppen_zaehler(g, bild, y0)
            schluessel = _balken_schluessel(g, bild, y0, zaehler_gruppe)
            ges = zaehler_gruppe.get("gesetzt")
            # Schon bekannt? Entweder unter demselben Schluessel oder — wenn ein
            # Zaehler in einem der beiden Bilder ausfiel — ueber die gesetzt-Zahl.
            bekannt = schluessel if schluessel in gesehen_balken else (
                gesehen_nach_gesetzt.get(ges) if ges else None)
            if bekannt is not None:
                # Dieselbe Gruppe, nur anders gelesen. Jedes Feld, das bisher
                # None war, wird nachgetragen: die Kopfzeile klebt beim Scrollen
                # oben fest und ist weiter unten oft besser lesbar als beim
                # ersten Blick. Ohne das Nachtragen bleibt die Summe None und
                # die Gegenprobe faellt ganz aus, obwohl die Zahl laengst
                # dastand.
                # Ein Nachtrag ohne Gegenprobe kann danebengehen: am 02.09.2026
                # las die OCR den Ersatz-Zaehler derselben Gruppe beim zweiten
                # Blick als 288 statt 8 — die Ziffern eines benachbarten Felds
                # bluten hinein. Unplausible Werte werden deshalb verworfen
                # statt uebernommen; ein fehlender Nachtrag heisst nur „keine
                # Gegenprobe", ein falscher heisst „falsche Gegenprobe".
                grenze = {"gesetzt": 40, "ersatz": 30, "kommandant": 10}
                alt = gesehen_balken[bekannt]
                for feld, wert in zaehler_gruppe.items():
                    if alt.get(feld) is not None or wert is None:
                        continue
                    if wert > grenze.get(feld, 40):
                        log(f"  Gruppe {bekannt}: {feld}={wert} verworfen (unplausibel)")
                        continue
                    alt[feld] = wert
                    log(f"  Gruppe {bekannt}: {feld} nachgetragen = {wert}")
                continue
            zu = _zugeklappt(g, bild, y1, balken, i)
            if zu is None:
                # Nicht messbar, weil der Balken zu tief sitzt — also nichts
                # tun. Weder tippen noch als gesehen ablegen: nach dem
                # naechsten Schritt steht er weiter oben und laesst sich
                # beantworten. Hier stand frueher ein Vermerk, der am
                # Listenende zum blinden Tipp fuehrte; der hat offene Gruppen
                # zugeklappt (siehe `_zugeklappt`).
                continue
            gesehen_balken[schluessel] = zaehler_gruppe
            if ges:
                gesehen_nach_gesetzt[ges] = schluessel
            log(f"  Gruppe {rang(bild, y0, y1) or '??'} {schluessel}: "
                f"{zaehler_gruppe}")
            if zu:
                # Eine leere Gruppe sieht auch aufgeklappt zugeklappt aus — sie
                # hat ja nichts zu zeigen. Ohne Obergrenze klappte der Dienst sie
                # in jedem Bild erneut auf und käme nie zum Scrollen.
                if aufklapp_tipps >= max_aufklapp:
                    log("  (Obergrenze fuers Aufklappen erreicht — weiter.)")
                    continue
                aufklapp_tipps += 1
                log(f"  Gruppe {schluessel} aufklappen ...")
                g.tippen(g.cfg["group_arrow_x"], (y0 + y1) // 2, pause=1.6)
                aktion = True
                break
        if aktion:
            continue

        # 2) Weiter — und merken, ob sich ueberhaupt noch etwas bewegt.
        #
        # Ein stehendes Bild heisst **nicht** ohne Weiteres „Listenende": die
        # Liste nimmt regelmaessig einen Wisch nicht an. Wer das verwechselt,
        # bricht mitten im Kader ab und haelt eine halbe Liste fuer die ganze —
        # genau das ist am 02.09.2026 passiert (31 statt 76 Zeilen).
        #
        # Drei Versuche waren dafuer zu wenig, sechs auch noch: an dem Tag
        # blieb die Liste zweimal ganze fuenf Versuche lang stehen — bei jeder
        # Geste, jeder Spalte, sogar beim Wechsel auf den Wisch (device.py,
        # `rad_schritt`). Das ist kein Gesten-Problem, sondern eine kurze
        # echte Pause des Spiels selbst beim Nachladen unbekannten
        # Listenterrains. Ein zusaetzlicher Anlauf kostet Sekunden, ein zu
        # frueher Abbruch den ganzen Lauf — deshalb zehn, mit waechsenden
        # Pausen ab dem dritten Versuch.
        # Die grobe Signatur (_steht) hakt an genau der Stelle: am echten
        # Listenende blinkt der rote Online-Punkt neben den Profilbildern
        # weiter, obwohl nichts mehr scrollt. Alle paar Bilder faellt dieses
        # Blinken durch die 2-%-Toleranz und _steht meldet faelschlich
        # „bewegt" — der Zaehler faengt endlos wieder bei 0 an und die
        # Rang-Gruppe R2 (nur 8 Mitglieder, am 02.09.2026 beobachtet) wird nie
        # zu Ende gescannt. Die gemessene Pixel-Verschiebung (_versatz) ist die
        # praezisere Auskunft und entscheidet deshalb zuerst; die grobe
        # Signatur bleibt nur der Rueckfall, wenn sich kein Muster wiederfinden
        # laesst (z.B. weil eine Gruppe gerade auf-/zugeklappt wurde).
        sig = _signatur(g, bild)
        steht = _steht(sig, letzte_sig)
        px = _versatz(g, letztes_bild, bild)
        letzte_sig = sig
        letztes_bild = bild
        # Bewusst NICHT auf `steht` zurueckfallen, wenn `px` mal nicht messbar
        # ist (kurz nach dem Aufklappen einer Gruppe zum Beispiel — dieser Fall
        # nimmt aber ohnehin den `aktion`-Zweig oben und kommt hier gar nicht
        # an). Ein Rueckfall auf `steht` fuehrte am 02.09.2026 in eine
        # Endlosschleife: am echten Listenende (nur 8 Mitglieder in R2) matchte
        # das Schablonenbild manchmal zu unsicher fuer `px`, und `steht` riss
        # es dann durch das Blinken des Online-Punkts staendig wieder auf
        # „bewegt" — der Zaehler kam nie ueber 4 hinaus.
        # Und eine gemessene Verschiebung ist noch kein Fortschritt: sie muss
        # gross genug sein, um von einer Geste zu stammen.
        #
        # `_versatz` sucht das Muster nur oberhalb seiner alten Lage — eine
        # Bewegung zurueck nach unten kann es also gar nicht finden. Steht die
        # Liste am Ende, greift der Schablonenabgleich stattdessen auf die
        # naechste gleich aufgebaute Zeilenkarte weiter oben und meldet einen
        # Versatz, den es nicht gibt. Am 09.09.2026 hat das den Lauf gekostet:
        # nach jedem dritten „bewegt sich nicht" kam ein Schein-Δ von rund
        # 145 px, setzte den Zaehler auf 0, und die zehn stehenden Bilder kamen
        # nie zustande — nach 120 Bildern brach der Scan ohne Ergebnis ab,
        # obwohl die Liste laengst vollstaendig gelesen war.
        #
        # Die beiden Verteilungen liegen weit auseinander und lassen sich
        # trennen (gemessen an demselben Lauf): Scheinversatz 123…161 px,
        # echte Wische 193…590 px, im Lauf davor 206…567 px. Die Grenze liegt
        # deshalb bei 180 px. Zu klein Gemessenes zaehlt wie Stillstand — es
        # verhindert den Abbruch nicht mehr, kostet aber auch nichts: die zehn
        # Anlaeufe fuer eine haengende Liste bleiben unangetastet.
        bewegt = px is not None and px >= MIN_VERSATZ_PX
        if bewegt:
            strecken.append(px)
            log(f"  Bild veraendert (Δ={px}px) — weiter.")
            gleich_hintereinander = 0
            g.liste_weiter()
            continue
        if px:
            log(f"  Δ={px}px zu klein fuer eine Geste — zaehlt als Stillstand.")
        gleich_hintereinander += 1
        # Zehn Anlaeufe sind der Preis dafuer, dass ein stehendes Bild allein
        # nicht verraet, ob die Liste haengt oder zu Ende ist — und ein zu
        # frueher Abbruch kostet den ganzen Lauf (02.09.2026: 31 statt 76
        # Zeilen). Sobald aber die unterste Rang-Gruppe im Fenster steht, ist
        # die Antwort inhaltlich klar: unter R1 kommt nichts mehr.
        #
        # **„R1 ist zu sehen" allein waere hier ein schwerer Fehler.** Zu
        # Beginn sind alle Rang-Balken zugeklappt und passen gemeinsam ins
        # Fenster — R1 steht also schon in der ersten Sekunde da, lange bevor
        # irgendetwas gelesen ist. Am 16.09.2026 wurde die R1-Gruppe um
        # 01:05:23 registriert, elf Sekunden nach dem Start. Eine Abkuerzung
        # daran haette bei einem fruehen Haenger nach zwei Stillstaenden
        # abgebrochen und die halbe Liste fuer die ganze gehalten — genau der
        # Fehler vom 02.09.2026, gegen den die zehn Anlaeufe da sind.
        #
        # Zwei Bedingungen muessen deshalb zusammenkommen:
        #
        # * **Die Rang-Zaehler sind beisammen.** Was die Kopfzeile als
        #   eingeteilt fuehrt, ist auf Gruppen verteilt wiedergefunden — es
        #   fehlt also keine Gruppe mehr, die noch etwas beizutragen haette.
        # * **R1 steht in zwei aufeinanderfolgenden Bildern im Fenster.** Eine
        #   einzelne Lesung traegt nicht: dieselbe Erkennung hat an diesem Tag
        #   eine Gruppe als `R5` gelesen, die keine war (`Gruppe R5 0|0|0|7`).
        #   Ein Ausrutscher setzt den Zaehler zurueck.
        ges_summe = sum(z.get("gesetzt") or 0 for z in gesehen_balken.values())
        ers_summe = sum(z.get("ersatz") or 0 for z in gesehen_balken.values())
        summe_komplett = bool(zaehler) and ges_summe == zaehler.get("gesetzt") \
            and ers_summe == zaehler.get("ersatz")
        r1_bestaetigt = (r1_bestaetigt + 1
                         if any(rang(bild, y0, y1) == LETZTER_RANG
                                for y0, y1 in balken) else 0)
        am_ende = summe_komplett and r1_bestaetigt >= 2
        schwelle = 2 if am_ende else 10
        if gleich_hintereinander >= schwelle:
            grund = (f"{LETZTER_RANG} zweimal gelesen, Rang-Summe vollstaendig"
                     if am_ende else f"{schwelle} stehende Bilder")
            log(f"  Listenende nach {schritt + 1} Bildern, {len(zeilen)} Zeilen "
                f"gelesen ({grund}).")
            break
        log(f"  Liste bewegt sich nicht ({gleich_hintereinander}, "
            f"gemessen {px if px is not None else '?'} px) — Ruck zurueck ...")
        # Gegenruck, dann erst der naechste Versuch vorwaerts. Von Hand belegt
        # am 16.09.2026 (siehe `Geraet.liste_zurueck`): 79 statt 29 Zeilen, und
        # die Rang-Summe ging zum ersten Mal auf.
        #
        # Die Messung darunter ist die Auskunft, die bisher fehlte: sie trennt
        # **haengend** von **am Ende**. Beides sieht vorwaerts gleich aus — ein
        # stehendes Bild —, und genau deshalb braucht das Listenende zehn
        # Anlaeufe, bevor es gilt. Rueckwaerts sind es zwei verschiedene Dinge:
        # am Ende ist Platz nach hinten, bei einer haengenden Liste nicht.
        # Solange das nicht ueber mehrere Laeufe gemessen ist, wird daraus
        # nichts geschlossen — die zehn Anlaeufe bleiben unangetastet.
        # Erst tippen, dann ziehen — in dieser Reihenfolge, siehe
        # `Geraet.liste_antippen`. Der Tipp allein ist der Teil, den der Dienst
        # bisher nie gemacht hat.
        g.liste_antippen()
        g.liste_zurueck(weite_px=RUECK_PX, dauer_ms=RUECK_MS)
        # Argumente getauscht: `_versatz` sucht das Muster nur oberhalb seiner
        # alten Lage, findet eine Bewegung nach unten also nur andersherum.
        rueck = _versatz(g, g.bild(), bild)
        rueck_messungen.append((gleich_hintereinander, rueck))
        log(f"  Ruck zurueck: {rueck if rueck is not None else '?'} px.")
        g.liste_weiter(variante=gleich_hintereinander)
    else:
        raise ScanFehler(f"Nach {max_bilder} Bildern kein Listenende — abgebrochen.")

    if strecken:
        s = sorted(strecken)
        log(f"  Scrollen: {len(strecken)} Schritte, Median {s[len(s) // 2]} px, "
            f"groesster {s[-1]} px, gesamt {sum(strecken)} px.")
    if rueck_messungen:
        # Der letzte ununterbrochene Anlauf gehoert zum Listenende, alles davor
        # zu einem Haenger mitten im Kader. Getrennt wird am Zaehler, nicht an
        # einer festen Zahl: beim Abbruch faellt der letzte Gegenruck aus (die
        # Schleife bricht davor ab), der Endlauf ist also einen kuerzer als die
        # Schwelle. Nebeneinander gestellt zeigt sich, ob der Ruck zurueck die
        # beiden Faelle unterscheidet.
        def _zahl(m):
            return ", ".join(f"{n}:{p if p is not None else '?'}" for n, p in m)
        schnitt = max((i for i, (n, _) in enumerate(rueck_messungen) if n == 1),
                      default=0)
        haenger, ende = rueck_messungen[:schnitt], rueck_messungen[schnitt:]
        if haenger:
            log(f"  Ruck zurueck bei Haengern: {_zahl(haenger)}")
        log(f"  Ruck zurueck am Listenende:  {_zahl(ende)}")

    # Summe der Rang-Zaehler = wie viele das Spiel als eingeteilt fuehrt.
    # Fehlt eine Zahl (OCR daneben), bleibt die Summe None — dann gibt es keine
    # Gegenprobe, und das soll auffallen statt stillschweigend durchzugehen.
    summe = {}
    for rolle in ("gesetzt", "ersatz"):
        werte = [z.get(rolle) for z in gesehen_balken.values()]
        summe[rolle] = None if any(w is None for w in werte) else sum(werte)

    return {"zeilen": zeilen, "zaehler": zaehler,
            "gruppen": {k: v for k, v in gesehen_balken.items()},
            "gruppen_summe": summe}


# ── Aus Rohzeilen werden Zuordnungen ──────────────────────────────────────
def eu_zu_server(t: str) -> str:
    """'13:00' → '09:00'. Dieselbe Rechnung wie `serverZeit` in helpers.js.

    Das Spiel sagt jede Zeit in **Serverzeit** an — im Balken einer Zeile steht
    „Serverzeit: 2026-9-11  09:00 ~ 09:30", auf dem Blatt „Kampfzeit 09:00". Das
    Tool fuehrt daneben die europaeische Zeit (`wsTime` = A 13:00, B 22:00).
    Ohne die Umrechnung trifft der Vergleich nie: die Zeit galt als „nicht
    lesbar", die Gegenprobe fiel deshalb ganz aus und der Dienst schrieb
    grundsaetzlich nicht — obwohl die Zeit sauber dastand.
    """
    h, _, m = t.partition(":")
    return f"{(int(h) + SERVER_DIFF_H) % 24:02d}:{m or '00'}"


def team_aus_zeit(zeit: str | None, ws_time: dict) -> str | None:
    """'13:00' oder '09:00' → 'A'. Die Zuordnung kommt aus dem Tool, nicht aus dem Code.

    Welche Uhrzeit welches Team spielt, ist je Team einstellbar (WS_ZEITEN) und
    wechselt. Verglichen wird gegen beide Schreibweisen derselben Zeit, weil im
    Bild mal die Serverzeit und mal die lokale Zeit steht (siehe `eu_zu_server`
    und `vision.uhrzeit`).
    """
    for team, t in (ws_time or {}).items():
        if zeit and (t == zeit or eu_zu_server(t) == zeit):
            return team.upper()
    return None


FARBEN = ("gruen", "orange")


def _farb_stimmen(zeilen: list[dict], ws_time: dict) -> dict:
    """Je Farbe: welches Team die gelesenen Uhrzeiten darunter nennen."""
    stimmen = {f: collections.Counter() for f in FARBEN}
    for z in zeilen:
        t = team_aus_zeit(z.get("zeit"), ws_time)
        if t and z.get("farbe") in stimmen:
            stimmen[z["farbe"]][t] += 1
    return stimmen


def farb_teams(zeilen: list[dict], ws_time: dict,
               blatt: str | None = None) -> tuple[dict, str | None]:
    """Welches Team welche Balkenfarbe meint — **das haengt am gescannten Blatt.**

    Hier stand bis zum 17.09.2026 fest `{"gruen": "A", "orange": "B"}`, und das
    ist widerlegt. Die Farbe gehoert gar nicht dem Team, sondern dem Blatt, das
    gerade offen ist: **gruen sind die, die sich fuer die Zeit dieses Blatts
    gemeldet haben**, orange die anderen (Ben, 17.09.2026). Ueber zwei
    Mitschnitte desselben Tages nachgemessen:

    | Mitschnitt | offenes Blatt | gruene Balken | orange Balken |
    |---|---|---|---|
    | 12:45 Uhr | A | 09:00 (16×) = A | 18:00/18:30 (21×) = B |
    | 23:37 Uhr | B | 18:00/18:30 (23×) = B | 09:00 (2×) = A |

    Die feste Zuordnung haette im zweiten Lauf **jede** Zeile ohne Abzeichen
    ins falsche Team gelegt — und nur die, denn das Abzeichen schlaegt den
    Balken (siehe `zu_werten`). Getroffen haette es also ausgerechnet die
    Ausgeschlossenen, bei denen `AC`/`BC` die ganze Auskunft ist.

    `blatt` ist die Quelle: welches Blatt offen war, weiss der Aufrufer sicher
    (der Dienst hat dorthin navigiert, der Mitschnitt bekommt `--team`). Die
    gelesenen Uhrzeiten sind die **Gegenprobe** — widersprechen sie in der
    Mehrheit, stimmt etwas Grundsaetzliches nicht (falsches Blatt bedient,
    `wsTime` veraltet), und das wird gemeldet statt verschluckt.

    Ohne `blatt` wird aus denselben Uhrzeiten geschlossen: je Farbe gewinnt die
    Mehrheit. Die Uhrzeit ist die unzuverlaessigere Einzelmessung (`18:00` wird
    als `13:00` gelesen), ueber viele Zeilen gemittelt aber belastbar — vier
    Fehllesungen gegen dreiundzwanzig richtige drehen keine Mehrheit.

    Zurueck kommt die Zuordnung und, wo sie nicht traegt, eine Meldung. Ohne
    Zuordnung bleibt eine Zeile ohne Abzeichen lieber unbestimmt, als geraten
    zu werden.
    """
    stimmen = _farb_stimmen(zeilen, ws_time)
    teams = {t.upper() for t in (ws_time or {})} or {"A", "B"}
    blatt = (blatt or "").upper() or None

    if blatt and len(teams) == 2 and blatt in teams:
        zuordnung = {FARBEN[0]: blatt, FARBEN[1]: next(iter(teams - {blatt}))}
        dafuer = sum(stimmen[f][zuordnung[f]] for f in FARBEN)
        dagegen = sum(v for f in FARBEN for t, v in stimmen[f].items()
                      if t != zuordnung[f])
        if dafuer + dagegen >= 4 and dagegen > dafuer:
            return zuordnung, (
                f"Die gelesenen Uhrzeiten widersprechen dem Blatt {blatt}: "
                f"{dagegen} von {dafuer + dagegen} Balken nennen die andere "
                f"Zeit. War wirklich Blatt {blatt} offen, und stimmt wsTime "
                f"({ws_time}) noch?")
        return zuordnung, None

    zuordnung, belege = {}, {}
    for f in FARBEN:
        if stimmen[f]:
            (team, n), = stimmen[f].most_common(1)
            zuordnung[f], belege[f] = team, (n, sum(stimmen[f].values()))

    # Eine Farbe reicht: die andere ist das, was uebrig bleibt. Genau so kam im
    # Mitschnitt vom 23:37 Uhr die orange Zuordnung zustande — nur zwei Zeilen
    # trugen dort ueberhaupt eine lesbare Uhrzeit.
    for f, andere in ((FARBEN[0], FARBEN[1]), (FARBEN[1], FARBEN[0])):
        if f in zuordnung and andere not in zuordnung and len(teams) == 2:
            zuordnung[andere] = next(iter(teams - {zuordnung[f]}))

    if not zuordnung:
        return {}, ("Keine Uhrzeit lesbar und kein Blatt angegeben — welche "
                    "Balkenfarbe welches Team meint, ist damit unbekannt. "
                    "Zeilen ohne Abzeichen bleiben ohne Team.")
    if len(set(zuordnung.values())) < len(zuordnung):
        return {}, (f"Gruen und orange zeigen auf dasselbe Team "
                    f"({zuordnung}) — Balkenfarben nicht verwertbar.")
    schwach = [f"{f}: {belege[f][0]} von {belege[f][1]}" for f in belege
               if belege[f][0] * 2 <= belege[f][1] * 1.2]
    return zuordnung, (f"Balkenfarbe nur knapp entschieden ({', '.join(schwach)})"
                       if schwach else None)


def zeit_zu_team(zeit: str | None, farbe: str, ws_time: dict,
                 farb_team: dict | None = None) -> str | None:
    """Welches Team der Balken ueber einer Zeile meint — **die Farbe entscheidet.**

    Welche Farbe welches Team meint, kommt aus `farb_teams` und damit aus dem
    Mitschnitt selbst. Die gelesene Uhrzeit dieser einen Zeile springt nur ein,
    wo gar keine Farbe erkannt wurde; widerspricht sie der Farbe, gilt die
    Farbe.

    Das war bis zum 16.09.2026 umgekehrt, und es kostete Zuordnungen: ueber die
    242 Zeilen des Mitschnitts wurden nur 26 Uhrzeiten ueberhaupt gelesen — und
    **4 davon falsch**. Jede der vier drehte das Team, denn die Erkennung macht
    aus `18:00` ein `13:00`, und genau das ist die lokale Zeit des *anderen*
    Teams (`Little Kong` und `NuSReT`, beide mit belegtem
    `Serverzeit: … 18:00 ~ 18:30` im Bild). Gemessen in
    `pruefe_balken_zeit.py`.

    Die Uhrzeit bleibt trotzdem stehen — nur eine Stufe hoeher: ueber **alle**
    Zeilen gemittelt sagt sie ueberhaupt erst, was die Farbe bedeutet.
    """
    aus_farbe = (farb_team or {}).get(farbe)
    return aus_farbe or team_aus_zeit(zeit, ws_time)


def zaehler_pruefen(summe: dict, verteilung, blatt: str) -> list[str]:
    """Gefundene Spieler gegen die Zaehler der Rang-Kopfzeilen — je Zaehler einzeln.

    Beide Zaehler des offenen Blatts werden **unabhaengig** geprueft. Vorher
    hing das an einem gemeinsamen `if`: war einer unlesbar, fiel die ganze
    Gegenprobe aus. Am 17.09.2026 blieb der Ersatz-Zaehler einer Rang-Gruppe
    offen, und mit ihm verschwand der Vergleich der **gesetzten** — der
    dagestanden haette, denn dort fehlte tatsaechlich einer (`lIBlackJackll`,
    dessen Zeile in `bild_004` unter der Lesegrenze lag und in `bild_005`
    schon ueber dem oberen Rand). Der Lauf sah dadurch sauberer aus, als er
    war.

    Ein fehlender Zaehler wird weiterhin gemeldet — als das, was er ist: eine
    Gegenprobe, die hier nicht stattgefunden hat.
    """
    aus = []
    for feld, wert, was in (("gesetzt", blatt, "gesetzt"),
                            ("ersatz", blatt + "E", "Ersatz")):
        soll = summe.get(feld)
        if soll is None:
            aus.append(f"Rang-Zaehler '{feld}' nicht vollstaendig lesbar — "
                       f"{was} {blatt} ungeprueft")
            continue
        ist = verteilung.get(wert, 0)
        if ist != soll:
            aus.append(f"{was} {blatt}: gefunden {ist}, Spiel sagt {soll}")
    return aus


OHNE_PLATZ = ("AC", "BC", "ABC")


def ohne_platz_vereinen(werte) -> str | None:
    """Mehrere „ohne Platz"-Werte desselben Spielers zu einem zusammenziehen.

    Wer sich fuer **beide** Uhrzeiten meldet, steht zweimal in der Liste — je
    einmal unter dem 13:00- und dem 22:00-Balken. Das sind zwei Zeilen, aber
    kein Widerspruch: der Spieler sagt „ich koennte zu beiden Zeiten", und
    genau das ist beim Nachruecken die nuetzlichste Auskunft.

    Gibt None zurueck, sobald etwas anderes als 'AC'/'BC'/'ABC' dabei ist —
    dann steht derselbe Mensch einmal mit und einmal ohne Platz da, und das
    *ist* ein Widerspruch, den niemand stillschweigend aufloesen darf.
    """
    werte = list(werte)
    if not werte or any(w not in OHNE_PLATZ for w in werte):
        return None
    teams = {t for w in werte for t in (("A", "B") if w == "ABC" else (w[0],))}
    return "ABC" if len(teams) == 2 else next(iter(teams)) + "C"


def zeit_farbe_streit(zeilen: list[dict]) -> str | None:
    """Meldung, wenn einzelne Uhrzeiten der gemessenen Farbzuordnung widersprechen.

    Seit die Zuordnung aus den Uhrzeiten selbst gemessen wird (`farb_teams`),
    kann sie ihnen nicht mehr *durchgehend* widersprechen — was uebrig bleibt,
    sind die einzelnen Fehllesungen, die die Mehrheit ueberstimmt hat. Die
    bleiben meldenswert: sie sagen, wie knapp die Mehrheit war.

    Die frueher hier gemeldete Lage („widerspricht durchgehend, stimmt wsTime
    noch?") ist am 17.09.2026 eingetreten und war **kein** verstelltes
    `wsTime`, sondern die falsche Annahme gruen=A (siehe `farb_teams`). Genau
    dafuer war die Zeile da: sie hat die Annahme gemeldet, statt still das
    falsche Team zu vergeben.
    """
    mit_zeit = [z for z in zeilen if z.get("zeit_team")]
    streit = [z for z in mit_zeit if z.get("zeit_streit")]
    if len(mit_zeit) >= 4 and len(streit) > len(mit_zeit) / 3:
        return (f"{len(streit)} von {len(mit_zeit)} gelesenen Uhrzeiten "
                f"widersprechen der gemessenen Balkenfarbe — Uhrzeit-Erkennung "
                f"pruefen")
    return None


def zaehler_pruefen(summe: dict, verteilung, blatt: str,
                    gesamt: dict | None = None) -> list[str]:
    """Das Gefundene gegen die Zaehler des Spiels halten — **jeden fuer sich.**

    Vorher hing beides an einer Bedingung: war *einer* der beiden Zaehler
    unlesbar, fiel die ganze Gegenprobe aus. Am 17.09.2026 blieb der
    Ersatz-Zaehler einer Rang-Gruppe offen, und damit verschwand auch der
    Vergleich der Gesetzten — der dagestanden haette: gefunden 19, Spiel sagt
    20 (`lIBlackJackll`, dessen Zeile in keinem der 170 Bilder stand). Ein
    fehlender Zaehler ist ein fehlender Zaehler und kein Grund, den vorhandenen
    wegzuwerfen.

    **Dasselbe sagt das Spiel zweimal**, und die beiden Stellen taugen
    Verschiedenes: die Rang-Zaehler sagen auch, *in welcher Gruppe* etwas fehlt,
    die Zahl ueber der Liste nur, *dass* etwas fehlt — dafuer steht sie an einer
    Stelle statt an fuenf und ist entsprechend zuverlaessiger zu lesen. Ist die
    Aufschluesselung unvollstaendig, springt sie deshalb ein. Die schwaechere
    Auskunft ist immer noch die ganze Gegenprobe; sie wegzulassen hiesse, aus
    „ich weiss nicht, wo" ein „ich pruefe gar nicht" zu machen.

    Woher der Sollwert kam, steht in der Meldung: eine Abweichung ohne
    Aufschluesselung will man anders nachsehen als eine mit.
    """
    probleme = []
    for rolle, wert in (("gesetzt", blatt), ("ersatz", blatt + "E")):
        soll, quelle = (summe or {}).get(rolle), "Rang-Summe"
        if soll is None:
            soll, quelle = (gesamt or {}).get(rolle), "Zahl ueber der Liste"
        ist = verteilung.get(wert, 0)
        if soll is None:
            probleme.append(f"{rolle} {blatt}: Zaehler des Spiels nicht lesbar "
                            f"— keine Gegenprobe")
        elif ist != soll:
            probleme.append(f"{rolle} {blatt}: gefunden {ist}, Spiel sagt {soll} "
                            f"({quelle})")
    return probleme


def bestand_pruefen(nachher: dict, blatt: str, summe: dict | None,
                    gesamt: dict | None, gescannt: dict | None) -> list[str]:
    """Den **zusammengefuehrten** Stand gegen die Zaehler des Spiels halten.

    `zaehler_pruefen` misst den Fund: hat dieser Lauf so viele gesetzte
    gesehen, wie das Spiel nennt? Das sagt nichts darueber, was hinterher im
    Werkzeug steht — denn zusammengefuehrt wird, und die Zusammenfuehrung
    loescht nie (`tool.zusammenfuehren`). Das ist auch richtig so: wer sich
    nicht angemeldet hat, taucht im Scan gar nicht auf, und ein geratenes
    `null` waere eine Aussage, die niemand getroffen hat.

    Die Kehrseite ist der Fall, um den es hier geht. Wer aussortiert wurde,
    verliert im Spiel sein Abzeichen, behaelt aber seinen Balken — der Scan
    liest ihn dann als `AC`/`BC`, und genau daran ist hinterher zu sehen,
    **dass er sich gemeldet hatte**. Sieht der Lauf seine Zeile aber nicht,
    bleibt im Werkzeug still sein alter Wert `A` stehen. Der Stand sieht
    danach vollstaendig aus und ist es nicht — aus 20 gesetzten werden 21,
    und das faellt nur auf, wenn man die Zaehler gegen das **Ergebnis**
    haelt statt gegen den Fund.

    **Gemeldet, nicht korrigiert.** Ueber einen Spieler, dessen Zeile dieser
    Lauf nicht gesehen hat, weiss er nichts; ihn auf `AC` zu setzen waere
    dieselbe Erfindung wie ein geratenes Team. Wessen Wert nicht aus diesem
    Lauf stammt, steht deshalb namentlich in der Meldung — das ist die
    Liste, die man im Spiel nachsieht.
    """
    probleme = []
    for rolle, wert in (("gesetzt", blatt), ("ersatz", blatt + "E")):
        soll = (summe or {}).get(rolle)
        if soll is None:
            soll = (gesamt or {}).get(rolle)
        if soll is None:
            continue  # fehlender Zaehler — meldet bereits zaehler_pruefen
        stehen = sorted(n for n, w in (nachher or {}).items() if w == wert)
        if len(stehen) == soll:
            continue
        meldung = (f"Stand nach dem Zusammenfuehren: {len(stehen)} auf "
                   f"'{wert}', das Spiel sagt {soll}")
        unbestaetigt = [n for n in stehen if (gescannt or {}).get(n) != wert]
        if unbestaetigt:
            meldung += (" — aus diesem Lauf nicht bestaetigt: "
                        + ", ".join(unbestaetigt))
        probleme.append(meldung)
    return probleme


def zu_werten(zeilen: list[dict], ws_time: dict,
              farb_team: dict | None = None) -> list[dict]:
    """Rohzeile → REG_WERTE ('A', 'AE', 'B', 'BE', 'AC', 'BC').

    **Das Abzeichen schlaegt den Balken.** Steht im Einteilungsfeld ein `A`
    oder `B`, ist das die Auskunft des Spiels selbst und gilt; der Balken ueber
    der Zeile ist nur der Rueckfall fuer die, die keinen Platz haben (siehe
    `team_abzeichen`).

    Was die Balkenfarbe bedeutet, wird aus demselben Satz Zeilen gemessen
    (`farb_teams`) — ein Aufrufer kann die Zuordnung mitgeben, wenn er sie
    schon hat. Sie **vor** der Schleife einmal zu bestimmen ist der Punkt: sie
    ist eine Aussage ueber den ganzen Mitschnitt, nicht ueber eine Zeile.
    """
    if farb_team is None:
        farb_team, _ = farb_teams(zeilen, ws_time)
    out = []
    for z in zeilen:
        # Der Balken wird **immer** ausgewertet, nicht nur als Rueckfall. Er
        # sagt etwas anderes als das Abzeichen: fuer welche Uhrzeit sich jemand
        # gemeldet hat, nicht in welches Team er eingeteilt ist. Wer beide
        # Zeiten angibt, dessen Balken wechselt staendig zwischen ihnen hin und
        # her — ueber mehrere Bilder gesehen stehen dann beide da, und genau das
        # ist die Auskunft „waere in beiden Teams einsetzbar" (siehe
        # `beide_zeiten` in match.py). Vorher fiel sie weg, sobald ein Abzeichen
        # da war — also bei jedem, der einen Platz hat.
        z["balken_team"] = zeit_zu_team(z.get("zeit"), z["farbe"], ws_time,
                                        farb_team)
        z["zeit_team"] = team_aus_zeit(z.get("zeit"), ws_time)
        z["zeit_streit"] = bool(z["zeit_team"] and z["balken_team"]
                                and z["zeit_team"] != z["balken_team"])
        team = z.get("team_abzeichen") or z["balken_team"]
        if not team:
            z["wert"] = None
            z["warnung"] = "Team nicht bestimmbar"
        elif z["platz"] == "gesetzt":
            z["wert"] = team
        elif z["platz"] == "ersatz":
            z["wert"] = team + "E"
        else:
            # Ohne Platz — aber nicht ohne Uhrzeit. Hier stand bis zum
            # 10.09.2026 ein blankes 'C', und damit war die Angabe weg, fuer
            # welche der beiden Zeiten sich der Spieler gemeldet hatte. Der
            # Balken sagt sie, gelesen wurde sie ohnehin schon; sie hat nur
            # niemand aufgehoben.
            z["wert"] = team + "C"
        out.append(z)
    return out
