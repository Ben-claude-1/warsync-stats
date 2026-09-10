"""Namensbanner finden und lesen — und daraus die Weltkoordinate rechnen.

**Gesucht wird geometrisch, nicht per OCR.** Die frueheren Ketten benutzten
Tesseract als *Finder*: erst wenn ein Wort gelesen war, gab es eine Bannerstelle —
und erst dann lief die gute Einzelbild-Aufbereitung. Wo die OCR das Banner nicht
lesen konnte, wurde es also gar nicht erst gefunden. Das ist zirkulaer und kostete
die Haelfte der Treffer: am selben Bild fand der OCR-Finder 3 von 9 Bannern, der
geometrische 7.

**Gesucht wird bewertet, nicht geschwellt.** Bis zum 07.09.2026 stand hier eine
Helligkeitsschwelle (`grau < 105`) mit anschliessendem Zusammenhangszaehlen. Das
traegt nur, solange die Banner freistehen: auf der weiten Zoomstufe ruecken die
Basen zusammen, der dunkle Balken beruehrt dunkle Bauwerke, und beide werden zu
*einer* Zusammenhangskomponente — die faellt dann durch jede Groessenpruefung.
Am Eichbild fand die Schwellenkette so **6 von 21** Bannern, und keine andere
Schwelle half: das Problem ist die Beruehrung, nicht der Wert. `bewertung()`
vergibt stattdessen fuer jede Bildstelle eine Punktzahl und nimmt danach die
oertlichen Hochpunkte — was sich beruehrt, bleibt getrennt. Von denselben 21
Bannern findet sie 20 (`pruefe_banner.py`); ueber das Archiv `drift` gerechnet
sind es 206 statt 44 Funde und 30 statt 16 zugeordnete Kaderspieler.

Die Punktzahl ist das Produkt zweier Merkmale, die einzeln *nicht* reichen:

- **Kantenpaar** — zwei lange waagerechte Kanten im Abstand `banner_hoehe`, die
  obere mit dunkel darunter, die untere mit hell darunter. Das gilt fuer jeden
  Rahmen: die Rahmenfarbe ist Zierrat und wechselt (silbern, violett, golden),
  die Kante bleibt.
- **Schriftenergie** — helle duenne Striche (Weiss-Hut) dicht gedraengt in einem
  flachen Band. Das trennt das Banner von jedem sonstigen dunklen Balken.

Einzeln liegen beide unter dem 99. Perzentil des Bildes, ihr Produkt darueber.

**Die Koordinate kommt aus dem Abstand zur Bildmitte:**

    welt_x = kamera_x + (balken_x - 1280) / skala_x
    welt_y = kamera_y - (balken_y - versatz - 1280) / skala_y

X und Y haben **verschiedene** Massstaebe (die Karte ist perspektivisch gekippt),
Y waechst **nach oben**, und das Banner haengt `versatz` px unterhalb der Basis.
Wer eines der drei uebersieht, liegt um Einheiten daneben — daran sind die alten
Skripte mit ihrem einen px/Einheit-Faktor gescheitert.
"""
from __future__ import annotations

import io
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from scripts.karten_archiv import ymodell

MITTE = 1280


def _im_hud(cx: float, cy: float, karte: list[int]) -> bool:
    x0, y0, x1, y1 = karte
    return not (x0 <= cx <= x1 and y0 <= cy <= y1)


SCHWELLE = 12.0          # Punktzahl, ab der ein Fund fuer sich allein zaehlt
SCHWELLE_SCHWACH = 9.0   # darunter gesucht, aber nur mit Beleg geschrieben
#
# **Zwei Schwellen statt einer.** 12,0 stammt aus der Zeit, als hinter dem Finder
# noch nichts stand, was einen Fehlfund wieder aussortiert. Sie kostet echte
# Basen: `Skirata33` (478/560) kam auf 9,7 Punkte und `HY07` (460/563) auf 10,5 —
# beide fehlten deshalb ganz auf der Karte, obwohl sie im Bild gut zu sehen sind.
#
# Tiefer zu suchen holt sie zurueck (an der Wahrheit von `pruefe_banner`: 21 von
# 21 statt 20, bei 3 statt 1 Fehlfund), bringt aber die Beschriftungen der
# Kartenobjekte mit — `Nord-Kanone`, `Lv. 70 Grosser Sandwurm`, `Vorbereitung`,
# eine laufende Uhr `05:07`. Deshalb muss ein **schwacher** Fund etwas
# mitbringen, das nur eine Basis hat: eine gelesene Stufe oder ein
# Allianz-Kuerzel (`basen_bauen`). Ueber `karte_kern` gemessen kamen so 24 echte
# Basen dazu und 11 der 13 Beschriftungen fielen wieder heraus.


def bewertung(grau: np.ndarray, bb: float, bh: float) -> tuple[np.ndarray, np.ndarray]:
    """Punktzahl je Bildstelle und das weiss-geoeffnete Graubild fuer `_kasten`.

    Alle Fenstermasse haengen an `banner_hoehe` / `banner_breite` und damit an der
    Zoomstufe — nichts hier ist auf eine Stufe geeicht. `breit` ist bewusst nur
    knapp die halbe Bannerbreite: der Name ist mal kurz und mal lang, und ein
    Fenster ueber die volle Breite verlangte das Muster dort, wo beim kurzen
    Namen schon Wiese ist.
    """
    g = grau.astype(np.float32)
    breit = max(5, int(bb * 0.45)) | 1
    d = max(1, int(round(bh * 0.5)))

    # 1. Kantenpaar: oben wird es dunkler, `bh` tiefer wieder heller.
    dy = cv2.Sobel(cv2.GaussianBlur(g, (0, 0), max(0.8, bh / 32)), cv2.CV_32F, 0, 1, ksize=3)
    ab = cv2.boxFilter(np.maximum(-dy, 0), -1, (breit, 3))
    auf = cv2.boxFilter(np.maximum(dy, 0), -1, (breit, 3))
    kante = np.minimum(np.roll(ab, +d, axis=0), np.roll(auf, -d, axis=0))

    # 2. Schriftenergie: helle Striche, duenner als der Kern (Weiss-Hut).
    #    Der Kern muss mit der Zoomstufe wachsen. Er stand zuerst fest auf 5x5 —
    #    das passt zur weiten Stufe, aber auf der Sprung-Stufe sind die
    #    Buchstabenstriche selbst fuenf Pixel dick, das Oeffnen laesst sie stehen
    #    und der Hut wird flach. Genau daran fielen dort fuenf von zwoelf Bannern
    #    unter die Schwelle, waehrend dieselbe Schwelle eine Stufe weiter draussen
    #    alle 21 fand.
    kb = max(3, int(round(bh * 0.14))) | 1
    kern = cv2.getStructuringElement(cv2.MORPH_RECT, (kb, kb))
    hut = np.maximum(g - cv2.morphologyEx(g, cv2.MORPH_OPEN, kern).astype(np.float32), 0)
    schrift = cv2.boxFilter(hut, -1, (breit, max(3, int(bh * 0.5)) | 1))

    return kante * schrift / 50.0, cv2.morphologyEx(g, cv2.MORPH_OPEN, kern)


def _kasten(offen: np.ndarray, cx: int, cy: int, bb: float, bh: float
            ) -> tuple[float, float, int, int]:
    """Den Balken um eine Fundstelle herum genau ausmessen.

    Zwei Stufen, und die Reihenfolge ist der Punkt: **wo** ein Banner ist,
    entscheidet die Punktzahl ueber das ganze Bild; **wie gross** es ist, wird
    danach in einem Fenster gemessen, das schon auf ihm sitzt. Im kleinen
    Fenster traegt die einfache Schwelle wieder, an der die alte Kette im
    Vollbild scheiterte — dort steht nur noch dieses eine Banner zur Auswahl.

    Die Feinlage der Zeile muss vor der Breite stehen. Der Hochpunkt der
    Punktzahl liegt ein paar Pixel neben der Balkenmitte (er folgt der Schrift,
    nicht dem Rahmen), und jede Breitenmessung haengt an genau dieser Zeile:
    zwei Pixel daneben, und sie misst den Schatten unter dem Balken statt des
    Balkens. Genau daran lagen die Mitten am 07.09.2026 bis zu 97 px daneben.

    **Gesucht wird eng, nicht frei.** Ein erster Anlauf liess Hoehe und Lage im
    ganzen Fenster laufen und rastete bei einem Drittel der Banner auf dem
    Schatten unter der Basis oder auf dem Stufenschild ein — beides dunkle
    Baender in Reichweite. Die Hoehe ist aber gar nicht frei: das Spiel zeichnet
    den Balken je Zoomstufe in fester Groesse, und `banner_hoehe` ist genau die.
    Gesucht wird deshalb nur noch die Verschiebung, und die nur um eine halbe
    Balkenhoehe.

    **Die Messung verwirft nie.** Ob eine Stelle ein Banner ist, hat die
    Punktzahl entschieden; findet die Feinmessung keinen sauberen Rand, bleibt
    es beim Nennmass. Ein Verwerfen an dieser Stelle waere eine zweite,
    schlechter begruendete Entscheidung — der erste Anlauf hat damit neun der
    21 Banner wieder verloren.

    `offen` ist das weiss-geoeffnete Graubild — ohne die helle Schrift, die
    sonst das Innere aufhellt und den Balken kuerzer erscheinen laesst als er ist.
    """
    h, w = offen.shape
    hoehe = max(3, int(round(bh)))
    rx, ry = int(bb * 0.85), int(bh)
    x0, x1 = max(0, cx - rx), min(w, cx + rx)
    y0, y1 = max(0, cy - ry), min(h, cy + ry)
    fen = offen[y0:y1, x0:x1].astype(np.float32)
    p = cx - x0
    nenn = (float(cx), float(cy), int(bb), hoehe)
    if fen.shape[0] < hoehe + 12 or fen.shape[1] < bb * 0.4 or not 0 <= p < fen.shape[1]:
        return nenn

    # Zeile: schmaler Streifen um die Fundstelle, dort steht der Balken sicher.
    sx0 = max(0, p - int(bb * 0.15))
    profil = fen[:, sx0:min(fen.shape[1], p + int(bb * 0.15))].mean(axis=1)
    saum = max(2, int(bh * 0.15))
    mitte = cy - y0
    bester, oben = -1e9, mitte - hoehe // 2
    for kopf in range(max(saum, mitte - hoehe), min(len(profil) - hoehe - saum, mitte + 1)):
        innen = profil[kopf:kopf + hoehe].mean()
        aussen = min(profil[kopf - saum:kopf].mean(), profil[kopf + hoehe:kopf + hoehe + saum].mean())
        if aussen - innen > bester:
            bester, oben = aussen - innen, kopf
    my = y0 + oben + hoehe / 2.0

    # Breite: je Spalte die obere Balkenhaelfte gegen den Streifen darueber.
    #
    # **Nur oben, und das ist der ganze Trick.** Das Stufenschild ("32") sitzt
    # mittig unter dem Namen und ragt in die untere Balkenkante hinein: es ist
    # hell, zieht dort das Innere hoch und den Streifen darunter mit. Wer beide
    # Seiten heranzieht, misst genau in der Balkenmitte einen negativen
    # Kontrast — der Lauf endet sofort, und die Breite faellt auf das Nennmass
    # zurueck. So kam am 07.09.2026 fuer 19 von 21 Bannern gar keine Messung
    # zustande. Oben ist nichts im Weg.
    ob = max(2, int(hoehe * 0.55))
    kontrast = fen[oben - saum:oben].mean(axis=0) - fen[oben:oben + ob].mean(axis=0)
    grenze = max(4.0, bester * 0.50)
    luecke = max(3, int(bb * 0.05))
    raender = []
    for richtung in (-1, +1):
        x, leer = p, 0
        while 0 <= x + richtung < len(kontrast) and leer <= luecke:
            x += richtung
            leer = 0 if kontrast[x] > grenze else leer + 1
        raender.append(x - richtung * leer)
    links, rechts = raender
    if rechts - links < bb * 0.25:
        return float(cx), my, int(bb), hoehe
    return x0 + (links + rechts) / 2.0, my, int(rechts - links), hoehe


def finde(bild_rgb: np.ndarray, cfg: dict, mit_punkt: bool = False) -> list[tuple]:
    """Mittelpunkte und Maße aller Bannerbalken im HUD-freien Bereich.

    Der HUD-Rand wird mit einer Bannerhoehe Sicherheitsabstand ausgespart, nicht
    nur abgefragt: ein halb verdecktes Banner liefert eine Punktzahl, die am
    Rand des Suchbereichs zwangslaeufig oertlicher Hochpunkt ist. Am Eichbild
    kamen drei der vier Fehlfunde genau von dieser Kante.
    """
    bb, bh = float(cfg["banner_breite"]), float(cfg["banner_hoehe"])
    grau = cv2.cvtColor(bild_rgb, cv2.COLOR_RGB2GRAY)
    punkte, offen = bewertung(grau, bb, bh)

    x0, y0, x1, y1 = cfg["karte"]
    rand = int(bh)
    maske = np.zeros(punkte.shape, np.float32)
    maske[y0 + rand:y1 - rand, x0 + rand:x1 - rand] = 1.0
    punkte = punkte * maske

    fenster = cv2.getStructuringElement(cv2.MORPH_RECT,
                                        (max(3, int(bb * 0.6)) | 1, max(3, int(bh)) | 1))
    hoch = cv2.dilate(punkte, fenster)
    schwelle = float(cfg.get("banner_schwelle", SCHWELLE))
    roh = np.argwhere((punkte >= hoch) & (punkte > schwelle))
    roh = sorted(roh, key=lambda p: -punkte[p[0], p[1]])

    # Doppelfunde zusammenfassen — **nach** der Feinmessung, nicht vorher. Ein
    # Banner kann zwei Hochpunkte tragen (Namensteil und Stufenschild liegen
    # verschieden hoch); erst der ausgemessene Kasten zeigt, dass beide denselben
    # Balken meinen. Ein groesseres Unterdrueckungsfenster stattdessen zu nehmen
    # waere der falsche Hebel: es verschluckt auf der weiten Stufe das
    # Nachbarbanner, und die stehen dort dicht.
    treffer: list[tuple] = []
    for cy, cx in roh:
        mx, my, w, h = _kasten(offen, int(cx), int(cy), bb, bh)
        if any(abs(mx - t[0]) < bb * 0.4 and abs(my - t[1]) < bh * 0.6 for t in treffer):
            continue
        # `mit_punkt` haengt die Punktzahl an. Sie wird gebraucht, um schwache
        # Funde spaeter strenger zu pruefen (siehe `SCHWELLE_SCHWACH`); die
        # Eichskripte fragen sie nicht ab und bekommen weiter Viererpaare.
        treffer.append((mx, my, w, h, float(punkte[cy, cx])) if mit_punkt
                       else (mx, my, w, h))
    return treffer


SAUM = " _-—=*.,;:'\"|()[]{}<>/\\"

# `[XP33]Ben_the_men` — Kuerzel in Klammern, dahinter der Name. **Beide**
# Klammern muessen dastehen, und die oeffnende ganz am Anfang.
#
# Bis zum 08.09.2026 war die oeffnende Klammer wahlfrei und die Ziffer `1` galt
# als schliessende. Das zerlegte jeden klammerlosen Namen mit einer Eins:
# `Conand1990` wurde zur Allianz `ONAND` mit dem Namen `990`, `Sniper1337` zu
# `NIPER`/`337`. Genau diese Namen sind die Mehrheit — 19 von 20 Basen der
# Stichprobe tragen ueberhaupt kein Kuerzel, denn am Kartenrand siedeln die
# Allianzlosen. Der Fehler traf also fast nur die, um die es geht.
#
# Es gibt zwei Faelle, und sie brauchen verschieden strenge Regeln.
#
# **Mit oeffnender Klammer** darf die schliessende ein OCR-Zwilling sein — `1`,
# `l`, `I` oder noch einmal `[`. Das ist gefahrlos, weil vorn ein Zeichen steht,
# mit dem kein Spielername beginnt. Die oeffnende kommt oft doppelt (`[(`), und
# im Kuerzel stehen Leerzeichen (`[KU RL]`) und OCR-Zwillinge von Buchstaben
# (`[C¥KA}` fuer CYKA) — beides ist erlaubt, das Kuerzel wird danach von
# Leerzeichen befreit.
#
# **Ohne oeffnende Klammer** — sie faellt beim Zuschnitt am Bildrand weg
# (`ZOMG]Oli`, `YKA]Vasex`) — muss die schliessende eine *echte* sein. Genau
# hier sass der Fehler bis zum 08.09.2026: damals galt auch die Ziffer `1` als
# schliessende Klammer, und `Conand1990` wurde zur Allianz `ONAND` mit dem Namen
# `990`. Ziffern und Buchstaben sind deshalb ausgeschlossen; ein Name, der in
# den ersten Zeichen ein `]`, `)` oder `}` traegt, ist praktisch nicht zu haben.
_TAG_ZEICHEN = r"[A-Za-z0-9¥$€&][A-Za-z0-9¥$€& ]{1,6}"
_TAG_MIT = re.compile(rf"^[\[({{<|]{{1,2}}\s*({_TAG_ZEICHEN})\s*[\])}}>|\[1lI]\s*(.+)$")
_TAG_OHNE = re.compile(rf"^({_TAG_ZEICHEN})\s*[\])}}]\s*(.+)$")


# Kyrillische und griechische Zwillinge lateinischer Zeichen. Die Texterkennung
# von macOS greift regelmaessig danach — aus `[XP33]Mo By` wurde `ХРЗЗMo By`, aus
# `Commander 1c6a31657` wurde `1сба31657`. Am Bildschirm sieht das gleich aus, in
# der Datenbank ist es ein anderer Name: die Suche nach `Commander 1c` findet ihn
# nicht mehr. Ueber die 38 Wahrheiten gemessen bringt die Tabelle einen Namen.
ZWILLINGE = {
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "К": "K", "М": "M", "О": "O",
    "Р": "P", "Т": "T", "Х": "X", "У": "Y", "З": "3", "Ѕ": "S", "б": "6",
    "а": "a", "с": "c", "е": "e", "о": "o", "р": "p", "х": "x", "у": "y", "і": "i",
    "ј": "j", "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M",
    "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X", "Ζ": "Z",
}

# Die vom Spiel selbst vergebenen Namen sind `Commander`/`Kommandant` plus eine
# Hexzahl und die Serverkennung. Genau dort verwechselt jede Erkennung `1` mit
# `l`/`i` und `0` mit `O` — und dort ist die Korrektur begruendet statt geraten,
# weil hinter dem Wort nur Hexziffern stehen koennen. Zwei der fuenf
# verbleibenden Fehler der Stichprobe fallen damit weg.
_ERZEUGT = re.compile(r"^(Commander |Comandante |Commandant |Kommandant)([0-9A-Za-z]{7,12})$")
_HEX_ZWILLING = {"l": "1", "i": "1", "I": "1", "O": "0", "o": "0", "S": "5", "B": "8"}


def entzwillingen(t: str) -> str:
    """Fremde Zeichen zurueck auf ihre lateinischen Zwillinge — wenn der Rest lateinisch ist.

    Die Bedingung ist der Punkt: ein wirklich griechisch geschriebener Name
    (`ΧΑΣΑΠΗΣ`) besteht **nur** aus fremden Zeichen und bleibt deshalb stehen.
    Ersetzt wird nur, wo einzelne Zwillinge in einem lateinischen Wort sitzen.
    """
    if not t:
        return t
    fremd = sum(1 for c in t if c in ZWILLINGE)
    latein = sum(1 for c in t if c.isascii() and c.isalnum())
    return "".join(ZWILLINGE.get(c, c) for c in t) if fremd and latein >= fremd else t


def _erzeugten_namen_glaetten(name: str) -> str:
    m = _ERZEUGT.match(name or "")
    if not m:
        return name
    return m.group(1) + "".join(
        c if c in "0123456789abcdef" else _HEX_ZWILLING.get(c, c) for c in m.group(2))


def zerlegen(t: str) -> tuple[str | None, str]:
    """Rohtext eines Balkens in Allianz-Kuerzel und Namen.

    Ohne Klammer gilt der ganze Text als Name und das Kuerzel bleibt offen:
    lieber keine Allianz als eine falsche — und lieber ein ganzer Name als ein
    halber.
    """
    t = (t or "").strip()
    m = _TAG_MIT.match(t) or _TAG_OHNE.match(t)
    if not m:
        return None, t.strip(SAUM)
    return m.group(1).upper().replace(" ", ""), m.group(2).strip(SAUM)


def _ocr(bild: Image.Image, psm: int, ziffern: bool = False) -> str:
    buf = io.BytesIO()
    bild.save(buf, "PNG")
    cmd = ["tesseract", "stdin", "stdout", "--psm", str(psm)]
    if ziffern:
        cmd += ["-c", "tessedit_char_whitelist=0123456789"]
    p = subprocess.run(cmd, input=buf.getvalue(), capture_output=True, timeout=60)
    return p.stdout.decode("utf8", "replace").strip().replace("\n", " ")


_VISION_QUELLE = Path(__file__).resolve().parent / "vision_ocr.swift"
_VISION_BIN = Path.home() / ".local" / "state" / "warsync" / "vision_ocr"
_vision_dienst: subprocess.Popen | None | bool = None


def _vision_starten():
    """Den Vision-Dienst hochfahren — oder `None`, wo es ihn nicht gibt.

    Gebaut wird beim ersten Gebrauch und nur, wenn die Quelle neuer ist als das
    Werkzeug. Auf einer Maschine ohne Swift oder ohne macOS bleibt es bei
    Tesseract; die Erkennung wird dort schlechter, aber sie laeuft.
    """
    global _vision_dienst
    if _vision_dienst is False:
        return None
    if _vision_dienst is not None:
        return _vision_dienst
    try:
        if (not _VISION_BIN.exists()
                or _VISION_BIN.stat().st_mtime < _VISION_QUELLE.stat().st_mtime):
            _VISION_BIN.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["swiftc", "-O", "-o", str(_VISION_BIN), str(_VISION_QUELLE)],
                           check=True, capture_output=True, timeout=300)
        _vision_dienst = subprocess.Popen(
            [str(_VISION_BIN), "--dienst"], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, text=True, bufsize=1)
    except (OSError, subprocess.SubprocessError):
        _vision_dienst = False
        return None
    return _vision_dienst


def _vision(bild: Image.Image) -> str | None:
    """Ein Bild durch die Texterkennung von macOS — `None`, wenn es sie nicht gibt.

    Der Umweg ueber eine Datei ist der Preis dafuer, dass `VNImageRequestHandler`
    einen Pfad will. Sie wird sofort wieder weggeraeumt; ein fester Name waere
    riskant, weil macOS Bilder nach Pfad zwischenspeichert.
    """
    dienst = _vision_starten()
    if dienst is None:
        return None
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        pfad = f.name
    try:
        bild.save(pfad, "PNG")
        dienst.stdin.write(pfad + "\n")
        dienst.stdin.flush()
        zeile = dienst.stdout.readline()
    except (OSError, ValueError, AttributeError):
        globals()["_vision_dienst"] = False
        return None
    finally:
        Path(pfad).unlink(missing_ok=True)
    teile = zeile.rstrip("\n").split("\t")
    return teile[1].strip() if len(teile) >= 2 else None


def _gross(maske: np.ndarray, rand: int = 20) -> Image.Image:
    """Schwarze Schrift auf Weiss, auf Lesegroesse gebracht."""
    bild = Image.fromarray(((1 - maske) * 255).astype(np.uint8))
    f = max(3, int(round(120 / bild.height)))
    bild = bild.resize((bild.width * f, bild.height * f), Image.LANCZOS)
    return Image.fromarray(np.pad(np.asarray(bild), rand, constant_values=255))


BLASS = 60          # darunter ist ein Pixel farblos; sein Farbton ist Rauschen
TON_TOL = 10        # halbe Breite des Farbfensters um die Spitze, in Grad
BESCHRIFTUNG_S = 240  # ab hier ist die Farbe rein — siehe `_schriftfarbe`


def _tonabstand(h: np.ndarray, ton: int) -> np.ndarray:
    """Abstand auf dem Farbkreis; er ist rund, 178 liegt neben 2."""
    return np.abs(((h.astype(np.int16) - ton + 90) % 180) - 90)


def _schriftmaske(a: np.ndarray, bh: float, farbe=None) -> np.ndarray:
    """Die Schrift eines Namensschilds, ohne Gelaende und ohne Gelaender.

    Der Name steht als **helle Schrift mit dunklem Saum** frei auf der Karte —
    es gibt keinen dunklen Balken darunter, anders als bei den Allianz- und
    Gebaeudeschildern. Gesucht wird deshalb ueber die Helligkeit: Gras liegt bei
    V um 150, Bauwerke tiefer, die Schrift bei V um 234.

    **Ueber die Farbe entscheidet nicht mehr eine feste Grenze.** Hier stand
    zuerst `S < 70`, dann `S < 105` — beide Male, weil eine Namensfarbe nicht
    durchkam, und beide Male wurde die naechste erst durch einen Ausfall
    entdeckt: die hellblauen Namen der eigenen Allianz (S um 96) am 09.09.2026,
    das **gelbgruene** Schild der eigenen Basis am selben Tag. Bei `[XP33]Ben the
    men` kam von der Schrift nichts durch, gelesen wurde `zr`; die Basis fehlte
    danach ganz in der Tabelle. Eine Zahl, die zweimal gebrochen ist, bricht ein
    drittes Mal — welche Farbe die Schrift hat, misst deshalb `_schriftfarbe`
    im Namensband selbst, und `farbe` gibt sie hier vor.

    Ohne `farbe` bleibt die Maske **permissiv** (alles Helle). Das ist der erste
    Durchgang, aus dem das Band ueberhaupt erst gefunden wird.

    Danach fallen lange waagerechte Strukturen heraus. Zaeune, Gelaender und die
    Zierrahmen um geschmueckte Basen sind hell wie die Schrift, aber kein
    Buchstabenstrich ist eine Bannerbreite lang.
    """
    hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV)
    m = hsv[:, :, 2] > 195
    if farbe is not None:
        ton = farbe[0]
        s = hsv[:, :, 1]
        m &= (s < BLASS) if ton is None else (
            (s >= BLASS) & (_tonabstand(hsv[:, :, 0], ton) <= TON_TOL))
    m = m.astype(np.uint8)
    lang = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                            np.ones((1, max(3, int(bh * 1.1))), np.uint8))
    return m & (1 - lang)


def _schriftfarbe(a: np.ndarray, band) -> tuple[int | None, float]:
    """Welche Farbe traegt den Namen — und wie rein ist sie.

    Gemessen wird **im Band**, nicht im ganzen Ausschnitt: dort ist die Schrift
    die groesste helle Gruppe, im Ausschnitt sind es Rahmen und Gelaende. Bei
    `Ben the men` gewinnt ueber den ganzen Ausschnitt der blaue Zierrahmen
    (H 105), im Band der gelbgruene Name (H 38).

    Zurueck kommt der Farbton der groessten Gruppe — oder `None`, wenn die
    farblosen Pixel ueberwiegen (weisse Namen). Dazu der Median ihrer Saettigung:
    daran haengt die Beschriftungs-Probe in `schild_lesen`.
    """
    r0, r1, li, re = band
    hsv = cv2.cvtColor(a[max(0, r0 - 3):r1 + 3, li:re + 1], cv2.COLOR_RGB2HSV)
    hell = hsv[:, :, 2] > 195
    h, s = hsv[:, :, 0][hell], hsv[:, :, 1][hell]
    if not h.size:
        return None, 0.0
    bunt = s >= BLASS
    if not bunt.any():
        return None, 0.0
    # Ringfoermig geglaettetes Histogramm: eine Schriftfarbe streut ueber ein
    # paar Grad, und die Spitze soll nicht zwischen zwei Behaelter fallen.
    hist = np.bincount(h[bunt], minlength=180).astype(float)
    kern = np.ones(2 * TON_TOL + 1)
    glatt = np.convolve(np.r_[hist[-TON_TOL:], hist, hist[:TON_TOL]],
                        kern, "same")[TON_TOL:-TON_TOL]
    ton = int(np.argmax(glatt))
    fenster = bunt & (_tonabstand(h, ton) <= TON_TOL)
    if int((~bunt).sum()) >= int(fenster.sum()):
        return None, 0.0
    return ton, float(np.median(s[fenster]))


def _stuecke(an: np.ndarray, verschmelzen: int) -> list[tuple[int, int]]:
    an = cv2.dilate(an.astype(np.uint8).reshape(1, -1),
                    np.ones((1, verschmelzen), np.uint8)).ravel() > 0
    teile, anfang = [], None
    for j, a in enumerate(an):
        if a and anfang is None:
            anfang = j
        if not a and anfang is not None:
            teile.append((anfang, j - 1))
            anfang = None
    if anfang is not None:
        teile.append((anfang, len(an) - 1))
    return teile


def _namensband(a: np.ndarray, t: np.ndarray, cx_rel: int, bh: float):
    """Zeilenband und Spaltenbereich des Namens — oder None.

    Das Band ist die dichteste Folge von Zeilen im oberen Teil des Ausschnitts.
    Ein Versuch, es stattdessen nach *Schriftstruktur* zu waehlen (viele
    senkrechte Striche nebeneinander), war an der Stichprobe deutlich schlechter
    — 7 statt 11 genau gelesene Namen: er rastet gern eine Zeile daneben ein,
    und dort steht nur die halbe Schrift.
    """
    hoch = max(6, int(bh * 0.42))
    bis = max(1, min(t.shape[0] - hoch, int(bh * 2.0)))
    dichte = np.convolve(t.mean(axis=1), np.ones(hoch), "valid")[:bis]
    if not len(dichte):
        return None
    r0 = int(np.argmax(dichte))
    r1 = r0 + hoch

    spalten = t[r0:r1].mean(axis=0)
    aktiv = (spalten > 0.12) & (spalten < 0.92)
    nah = np.convolve(aktiv.astype(float), np.ones(max(4, int(bh * 0.30))), "same") > 0

    # **Genommen wird der breiteste Schriftblock in Reichweite, nicht der unter
    # der Fundstelle.** Bei den geschmueckten Basen misst `_kasten` die Leiste
    # des Zierrahmens, und deren Mitte liegt neben dem Namen — bei `marjo42`
    # landete sie auf einer Vogelscheuche am linken Rahmenende, und gelesen
    # wurde `r`. Der Name ist dagegen immer der laengste zusammenhaengende Text
    # im Band.
    #
    # Die Reichweite ist der Schutz davor, den Nachbarn zu greifen: im dichten
    # Kerngebiet stehen die Schilder rund 390 px auseinander, drei Bannerhoehen
    # (141 px) bleiben sicher darunter.
    laeufe = _stuecke(nah, 1)
    if not laeufe:
        return None
    reichweite = bh * 3.0
    in_reichweite = [p for p in laeufe
                     if abs((p[0] + p[1]) / 2 - cx_rel) <= reichweite]
    if in_reichweite:
        li, re = max(in_reichweite, key=lambda p: p[1] - p[0])
    else:
        li, re = min(laeufe, key=lambda p: abs((p[0] + p[1]) / 2 - cx_rel))

    # **Die Landesflagge steht hinter dem Namen und gehoert nicht dazu.** Ohne
    # den Schnitt haengt an jedem zweiten Namen ein `L=`, `Ka` oder `f=`.
    #
    # **Erkannt wird sie an der Farbe, nicht an der Groesse.** Eine Flagge ist
    # bunt, Schrift ist es nie — gemessen an 22 Schildern liegt der Anteil
    # gesaettigter Pixel unter den hellen bei einer Flagge zwischen 0,20 und
    # 0,84, bei Text zwischen 0,00 und 0,06. Dazwischen ist nichts.
    #
    # Vorher entschied die Breite des letzten Stuecks, und das ging zweimal
    # daneben: bei den **gesperrt geschriebenen** Namen (`S a p p h y`) steht
    # jeder Buchstabe fuer sich und der letzte flog als vermeintliche Flagge
    # heraus, und bei `Mo By` verschwand das zweite Wort. Beide sind farblos und
    # bleiben jetzt stehen.
    teile = _stuecke(aktiv[li:re + 1], max(3, int(bh * 0.11)))
    if len(teile) >= 2 and (teile[-1][1] - teile[-1][0] + 1) < bh * 1.0:
        s = slice(li + teile[-1][0], li + teile[-1][1] + 1)
        hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV)
        oben, unten = max(0, r0 - 3), r1 + 3
        hell = hsv[oben:unten, s, 2] > 150
        if hell.sum() >= 20 and (hsv[oben:unten, s, 1][hell] > 120).mean() >= 0.15:
            re = li + teile[-2][1]
    return r0, r1, li, re


def _stufe(a: np.ndarray, r1: int, cx_rel: int, bh: float) -> int | None:
    """Die Stufe aus dem Schild unter dem Namen — oder None.

    Das Schild ist ein helles Hexagon mit dunklen Ziffern, direkt unter dem
    Namen. Gesucht wird es **unterhalb des Namensbandes**: im Namensband selbst
    verschmelzen Schild und Schrift zu einer Flaeche, weil beide hell und
    ungesaettigt sind.

    Drei Dinge, die zusammengehoeren — jedes hat auf der Stichprobe einen
    falschen Wert erzeugt, bevor es dastand:

    - **Geschlossen wird ueber die Ziffern hinweg.** Die dunklen Ziffern
      zerschneiden das Hexagon in zwei Lappen; ohne das Schliessen misst man
      einen Lappen und liest die halbe Zahl.
    - **Verankert wird der untere Rand.** Oben ragt das Schild in das
      Namensband hinein und damit aus dem Suchfenster heraus; seine Hoehe steht
      dagegen durch die Zoomstufe fest.
    - **Angeschnitten heisst ungelesen.** Beruehrt eine Ziffer den Kastenrand,
      fehlt die fuehrende: aus 12 wird 2. Genau so entstand der letzte falsche
      Wert der Stichprobe.

    Eine falsche Stufe ist schlimmer als eine fehlende — `NULL` heisst „nicht
    gelesen", und die Oberflaeche zeigt dafuer einen Strich.

    **Im Kerngebiet reichte das noch nicht — zwei weitere Fehler, beide am
    09.09.2026 an der zweiten (blauen) Stichprobe gefunden:**

    - **Hell heisst auch hier nicht weiss.** `S < 60` liess das helle
      Hintergrundbild hinter der Basis (Ruestung, Fell, Eis — alles blass und
      kaum gesaettigt) mit in die Maske: es beruehrte das Hexagon direkt und
      das Schliessen verschmolz beides zu einem Klumpen, der durch die
      Breitenpruefung fiel. Mit `S < 40` bleibt die Kontamination fast immer
      unter der Schwelle, ohne dass das Hexagon selbst darunter faellt.
    - **Angeschnitten wird an der Ziffer gemessen, nicht am Rand.** Vorher
      zaehlte jeder dunkle Pixel am Kastenrand als Schnitt — traf aber meist
      die Facettenkante des Hexagons oder eine duenne Zierlinie, die quer durch
      den ganzen Block laeuft und links wie rechts den Rand beruehrt, ohne eine
      Ziffer zu sein. Eine kurze waagerechte Oeffnung putzt diese Linie weg,
      bevor gezaehlt wird; angeschnitten ist nur noch, wessen **Ziffer-Klumpen**
      selbst den Rand beruehrt. An derselben Stichprobe halbierte das die
      Fehlerquote im Kerngebiet (5 von 18 → 14 von 18), am Kartenrand blieb kein
      einziger Wert falsch.
    """
    hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV)
    V = hsv[:, :, 2].astype(np.int16)
    S = hsv[:, :, 1].astype(np.int16)
    u0 = min(a.shape[0] - 1, r1 + 2)
    u1 = min(a.shape[0], r1 + 2 + int(bh * 1.2))
    schild = ((S[u0:u1] < 40) & (V[u0:u1] > 120)).astype(np.uint8)
    if schild.size == 0:
        return None
    # Die Zierrahmen der geschmueckten Basen — Gelaender, Goldboegen, Bluetenranken —
    # laufen quer durch das Schild und verschmelzen mit ihm; die Fundstelle wird
    # dadurch zu breit und faellt durch die Groessenpruefung. Im Kerngebiet, wo
    # fast jede Basis geschmueckt ist, kostete das die Stufe: dort wurden nur 16 %
    # gelesen gegen 77 % am Kartenrand. Ein Rahmensteg ist duenn, das Schild ist
    # hoch — ein Oeffnen mit senkrechtem Element trennt beides.
    steg = max(3, int(bh * 0.16)) | 1
    schild = cv2.morphologyEx(schild, cv2.MORPH_OPEN, np.ones((steg, 1), np.uint8))
    rz = max(3, int(bh * 0.45)) | 1
    schild = cv2.morphologyEx(schild, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rz, rz)))
    n, _lab, st, ce = cv2.connectedComponentsWithStats(schild, 8)
    breit = [j for j in range(1, n)
             if bh * 0.55 <= st[j][2] <= bh * 1.60 and st[j][4] > 200]
    if not breit:
        return None
    j = min(breit, key=lambda q: abs(ce[q][0] - cx_rel))
    x, y, w, h = st[j][:4]
    # **Waagerecht entscheidet die Fundstelle, senkrecht die Zoomstufe.** Die
    # Breite des Schilds ist verlaesslich; seine Hoehe ist es nicht, sobald es
    # mit dem Bauwerk darunter verschmilzt — im Kerngebiet fuellte die Flaeche
    # dann das ganze Suchfenster (Hoehe 56 statt 23) und fiel durch jede
    # Groessenpruefung. Wo sie senkrecht sitzt, muss man aber gar nicht messen:
    # die Unterkante steht 0,53 Bannerhoehen unter dem Namensband, gemessen an
    # 19 Schildern mit 20 bis 31 px Streuung um 25. Nur wenn die Flaeche auch
    # senkrecht plausibel ist, zaehlt ihre eigene Unterkante — die ist genauer.
    unten = u0 + y + h if h <= bh * 0.70 else r1 + int(bh * 0.53)
    unten = min(a.shape[0], unten)
    oben = max(0, unten - int(bh * 0.62))
    links = max(0, x + w // 2 - int(bh * 0.50))
    rechts = min(a.shape[1], x + w // 2 + int(bh * 0.50))
    block = cv2.cvtColor(a[oben:unten, links:rechts], cv2.COLOR_RGB2GRAY)
    if block.size < 40:
        return None
    block = cv2.resize(block, (block.shape[1] * 5, block.shape[0] * 5),
                       interpolation=cv2.INTER_CUBIC)
    _, hart = cv2.threshold(block, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dunkel = (hart == 0).astype(np.uint8)
    # Die Facettenkante des Hexagons laeuft als duenne waagerechte Linie durch
    # den ganzen Block und beruehrt dabei beide Raender — ohne dieses Wegputzen
    # zaehlte sie als angeschnittene Ziffer, obwohl keine da war.
    linie = max(3, int(hart.shape[0] * 0.12)) | 1
    dunkel = cv2.morphologyEx(dunkel, cv2.MORPH_OPEN, np.ones((linie, 1), np.uint8))
    nn, _l, ss, _c = cv2.connectedComponentsWithStats(dunkel, 8)
    ziffern = [q for q in range(1, nn)
               if ss[q][3] > hart.shape[0] * 0.35 and ss[q][4] > 60]
    saum = max(2, hart.shape[1] // 40)
    if any(ss[q][0] <= saum or ss[q][0] + ss[q][2] >= hart.shape[1] - saum
           for q in ziffern):
        return None                       # angeschnitten — die fuehrende Ziffer fehlt
    klumpen = len(ziffern)
    bild = Image.fromarray(np.pad(hart, 30, constant_values=255))
    # **Die vier Lesemodi muessen sich einig sein.** Vorher gewann der erste, der
    # ueberhaupt eine plausible Zahl lieferte — und das war bei `ΧΑΣΑΠΗΣ`
    # (458/557) ausgerechnet der falsche: psm 8 und 13 lasen `36`, psm 10 und 7
    # `34`, und in der Tabelle stand 36. Der Block ist dort oben angeschnitten,
    # die `4` verliert ihre Spitze und sieht wie eine `6` aus.
    #
    # Das Fenster zu vergroessern hilft nicht — bei 0,80 Bannerhoehen faellt der
    # Kartenrand von 19 auf 8 von 21 richtige Stufen, weil dann das Namensband
    # mit im Block steht. Die Uneinigkeit ist das ehrlichere Signal: wo die Modi
    # auseinandergehen, ist die Ziffer beschaedigt. `NULL` heisst „nicht
    # gelesen", und eine falsche Stufe ist schlimmer als eine fehlende.
    gelesen = []
    for psm in (8, 10, 7, 13):
        txt = _ocr(bild, psm, ziffern=True).replace(" ", "")
        if txt.isdigit() and 1 <= int(txt) <= 40 and len(txt) == klumpen:
            gelesen.append(int(txt))
    if not gelesen:
        return None
    haeufig = Counter(gelesen).most_common()
    if haeufig[0][1] < 2 or (len(haeufig) > 1 and haeufig[0][1] == haeufig[1][1]):
        return None
    return haeufig[0][0]


def schild_lesen(im: Image.Image, cx: float, cy: float, cfg: dict) -> dict:
    """Namensschild einer Basis: Rohtext, Name, Allianz-Kuerzel, Stufe.

    Gelesen wird aus einem **grosszuegigen** Ausschnitt um die Fundstelle, nicht
    aus dem von `_kasten` ausgemessenen Balken. Der misst die dunkle Leiste des
    Allianz- und Gebaeudeschilds; ein Spielername hat keine, und der Kasten fiel
    dort regelmaessig zu schmal aus und schnitt den Namen mitten durch.
    """
    bb, bh = float(cfg["banner_breite"]), float(cfg["banner_hoehe"])
    x0 = max(0, int(cx - bb * 0.70)); x1 = min(im.width, int(cx + bb * 0.70))
    y0 = max(0, int(cy - bh * 1.10)); y1 = min(im.height, int(cy + bh * 1.70))
    leer = {"name": "", "name_roh": "", "allianz": None, "level": None}
    if x1 - x0 < 12 or y1 - y0 < 12:
        return leer
    a = np.asarray(im.crop((x0, y0, x1, y1)))
    # Zwei Durchgaenge: der erste findet mit einer permissiven Maske ueberhaupt
    # das Band, der zweite liest es in **der** Farbe, die dort ueberwiegt. Ohne
    # den ersten gibt es kein Band, in dem sich die Farbe messen liesse.
    band0 = _namensband(a, _schriftmaske(a, bh), int(cx - x0), bh)
    if band0 is None:
        return leer
    ton, rein = _schriftfarbe(a, band0)
    # **Beschriftungen sind in reiner Farbe gezeichnet, Namen nie.** Ueber die
    # Gruppe im Band gemessen: Bergbaustuetzpunkt, Pyramide, Gerichtsplatz und
    # Allianz-Banner liegen bei S-Median 255, Spielernamen bei 113 bis 157.
    # Bis zum 09.09.2026 fielen sie schon durch die feste Saettigungsgrenze;
    # die gibt es nicht mehr, also braucht es die Regel ausdruecklich.
    if rein >= BESCHRIFTUNG_S:
        return leer
    t = _schriftmaske(a, bh, (ton, rein))
    band = _namensband(a, t, int(cx - x0), bh) or band0
    r0, r1, li, re = band
    aus = t[max(0, r0 - 3):r1 + 3, li:re + 1]
    if aus.size == 0 or aus.shape[1] < 8:
        return leer
    # **Gelesen wird mit der Texterkennung von macOS, und zwar auf dem farbigen
    # Ausschnitt.** An den drei Wahrheiten gemessen (09.09.2026) liest sie 33
    # von 38 Namen genau richtig, Tesseract auf der freigestellten Maske 24 —
    # am deutlichsten bei der eigenen Allianz (15/16 gegen 10/16). Sie sieht
    # den Grauverlauf der Schrift, den die Maske gerade wegwirft: aus
    # `LittieFighter` wird `LittleFighter`, aus `marjas2` wieder `marjo42`.
    #
    # Die Maske bleibt trotzdem gebraucht — sie sagt, **wo** das Namensband
    # liegt und welche Farbe die Schrift hat. Und sie bleibt der Rueckfall,
    # wenn es Vision nicht gibt (kein macOS, kein Swift) oder wenn nichts
    # herauskommt.
    farbband = Image.fromarray(a[max(0, r0 - 6):r1 + 6, li:re + 1])
    f = max(3, int(round(120 / max(1, farbband.height))))
    roh = _vision(farbband.resize((farbband.width * f, farbband.height * f),
                                  Image.LANCZOS)) if farbband.height else None
    if not roh or len(roh.strip()) < 3:
        roh = _ocr(_gross(aus), 7)
    # `name_roh` bleibt der unveraenderte Text der Erkennung — er ist der Beleg.
    # Geglaettet wird nur, was in die Spalten `name` und `allianz` geht.
    tag, name = zerlegen(entzwillingen(roh))
    name = _erzeugten_namen_glaetten(name)
    # **Die Stufe bekommt zwei Anlaeufe.** Sie haengt an der Unterkante des
    # Namensbandes, und die Farbmaske schneidet das Band gelegentlich enger als
    # die permissive — bei `Ghost Fighter X` genau so weit, dass das Hexagon aus
    # dem Suchfenster faellt. Ueber `karte_kern` gemessen kostete das 14 von 905
    # Stufen; keine davon wurde falsch, sie fielen auf "nicht gelesen". Ein
    # zweiter Anlauf am permissiven Band holt sie zurueck.
    level = _stufe(a, r1, int(cx - x0), bh)
    if level is None and band0[1] != r1:
        level = _stufe(a, band0[1], int(cx - x0), bh)
    return {"name": name, "name_roh": roh, "allianz": tag, "level": level}


def lesen_roh(im: Image.Image, cx: float, cy: float, w: int, h: int,
              cfg: dict | None = None) -> str:
    """Der unveraenderte OCR-Text eines Schilds — Kuerzel, Name und Zierrat.

    Er wird mitgespeichert, damit eine spaeter verbesserte Erkennung an genau
    demselben Material gemessen werden kann, statt neu scannen zu muessen.
    """
    if cfg is not None:
        return schild_lesen(im, cx, cy, cfg)["name_roh"]
    rx, ry = int(w * 0.04), int(h * 0.16)     # farbigen Rahmen wegschneiden
    roh = im.crop((int(cx - w / 2) + rx, int(cy - h / 2) + ry,
                   int(cx + w / 2) - rx, int(cy + h / 2) - ry))
    if roh.width < 10 or roh.height < 5:
        return ""
    f = max(3, int(round(200 / roh.height)))
    gross = roh.resize((roh.width * f, roh.height * f), Image.LANCZOS)
    hart = ImageOps.invert(ImageOps.grayscale(gross)).point(lambda v: 0 if v < 110 else 255)
    return _ocr(hart, 7)


def lesen(im: Image.Image, cx: float, cy: float, w: int, h: int,
          cfg: dict | None = None) -> str:
    """Nur der Name — der Einstieg der Eichskripte."""
    if cfg is not None:
        return schild_lesen(im, cx, cy, cfg)["name"]
    return zerlegen(lesen_roh(im, cx, cy, w, h))[1]


def welt(cx: float, cy: float, kamera_x: float, kamera_y: float, cfg: dict) -> tuple[float, float]:
    """Weltkoordinate aus der Bannerposition im Vollbild.

    `versatz_x` / `banner_versatz` sind die Pixelversaetze zwischen Bildmitte und
    dem Banner einer Basis, die **auf** der Kameraposition steht. Sie werden
    gemessen, indem man auf eine Basis mit bekannter Koordinate springt
    (`eichen.py`) — nicht geschaetzt.

    Die Umrechnung selbst steht in `ymodell`: die Karte ist geneigt, beide Achsen
    haengen deshalb an einem Neigungsparameter. Ohne `y_modell` in der
    Konfiguration bleibt es beim alten Faktor je Achse — alte Archive lesen sich
    damit unveraendert.
    """
    return ymodell.welt(cx, cy, kamera_x, kamera_y, cfg)


def auswerten(im: Image.Image, kamera_x: int, kamera_y: int, cfg: dict,
              versatz_px: tuple[int, int] = (0, 0)) -> list[dict]:
    """Alle Banner einer Kachel: Rohtext, Weltkoordinate, Balkenmasse.

    `versatz_px` ist der Ursprung des Bildes im Vollbild. Beim Aufnehmen ist er
    (0, 0); wird spaeter ein **gespeicherter Zuschnitt** neu ausgewertet, steht
    dort das Zuschnitt-Rechteck aus dem Manifest. Ohne ihn laege jede Koordinate
    aus dem Archiv um die halbe HUD-Breite daneben.
    """
    bild = np.asarray(im)
    vx, vy = versatz_px
    hud = cfg["karte"] if versatz_px == (0, 0) else [0, 0, im.width, im.height]
    eng = dict(cfg, karte=hud)
    # Gesucht wird bis `SCHWELLE_SCHWACH` hinunter; was zwischen den beiden
    # Schwellen liegt, muss in `basen_bauen` einen Beleg mitbringen. Ein Aufrufer
    # mit eigener Schwelle behaelt seine.
    eng.setdefault("banner_schwelle", SCHWELLE_SCHWACH)
    aus = []
    for cx, cy, w, h, punkt in finde(bild, eng, mit_punkt=True):
        wx, wy = welt(cx + vx, cy + vy, kamera_x, kamera_y, cfg)
        s = schild_lesen(im, cx, cy, cfg)
        aus.append({"name_ocr": s["name"], "name_roh": s["name_roh"],
                    "allianz": s["allianz"], "level": s["level"],
                    "x": round(wx, 2), "y": round(wy, 2), "punkt": round(punkt, 1),
                    "px": [round(cx + vx, 1), round(cy + vy, 1), w, h]})
    return aus
