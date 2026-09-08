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

import cv2
import numpy as np
from PIL import Image, ImageOps

from scripts.karten_archiv import ymodell

MITTE = 1280


def _im_hud(cx: float, cy: float, karte: list[int]) -> bool:
    x0, y0, x1, y1 = karte
    return not (x0 <= cx <= x1 and y0 <= cy <= y1)


SCHWELLE = 12.0     # Punktzahl, ab der ein Hochpunkt als Banner gilt


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


def finde(bild_rgb: np.ndarray, cfg: dict) -> list[tuple[float, float, int, int]]:
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
    treffer: list[tuple[float, float, int, int]] = []
    for cy, cx in roh:
        mx, my, w, h = _kasten(offen, int(cx), int(cy), bb, bh)
        if any(abs(mx - tx) < bb * 0.4 and abs(my - ty) < bh * 0.6 for tx, ty, _, _ in treffer):
            continue
        treffer.append((mx, my, w, h))
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
# Als schliessende Klammer gelten weiterhin `1`, `l` und `I`: Tesseract liest
# `]` regelmaessig so. Das ist jetzt gefahrlos, weil davor eine echte oeffnende
# Klammer stehen muss — ein Zeichen, mit dem kein Spielername beginnt.
_KUERZEL = re.compile(r"^[\[({<|]\s*([A-Za-z0-9]{2,5})\s*[\])}>|1lI]\s*(.+)$")


def zerlegen(t: str) -> tuple[str | None, str]:
    """Rohtext eines Balkens in Allianz-Kuerzel und Namen.

    Ohne Klammernpaar gilt der ganze Text als Name und das Kuerzel bleibt offen:
    lieber keine Allianz als eine falsche — und lieber ein ganzer Name als ein
    halber.
    """
    t = (t or "").strip()
    m = _KUERZEL.match(t)
    if not m:
        return None, t.strip(SAUM)
    return m.group(1).upper(), m.group(2).strip(SAUM)


def _ocr(bild: Image.Image, psm: int, ziffern: bool = False) -> str:
    buf = io.BytesIO()
    bild.save(buf, "PNG")
    cmd = ["tesseract", "stdin", "stdout", "--psm", str(psm)]
    if ziffern:
        cmd += ["-c", "tessedit_char_whitelist=0123456789"]
    p = subprocess.run(cmd, input=buf.getvalue(), capture_output=True, timeout=60)
    return p.stdout.decode("utf8", "replace").strip().replace("\n", " ")


def _gross(maske: np.ndarray, rand: int = 20) -> Image.Image:
    """Schwarze Schrift auf Weiss, auf Lesegroesse gebracht."""
    bild = Image.fromarray(((1 - maske) * 255).astype(np.uint8))
    f = max(3, int(round(120 / bild.height)))
    bild = bild.resize((bild.width * f, bild.height * f), Image.LANCZOS)
    return Image.fromarray(np.pad(np.asarray(bild), rand, constant_values=255))


def _schriftmaske(a: np.ndarray, bh: float) -> np.ndarray:
    """Die weisse Schrift eines Namensschilds, ohne Gelaende und ohne Gelaender.

    Der Name steht als **weisse Schrift mit dunklem Saum** frei auf der Karte —
    es gibt keinen dunklen Balken darunter, anders als bei den Allianz- und
    Gebaeudeschildern. `V > 195 & S < 70` trifft genau diese Schrift: Gras ist
    satt (S um 155), Bauwerke sind dunkler, die Flaggen sind bunt.

    Danach fallen lange waagerechte Strukturen heraus. Zaeune, Gelaender und die
    Zierrahmen um geschmueckte Basen sind hell und ungesaettigt wie die Schrift,
    aber kein Buchstabenstrich ist eine Bannerbreite lang.
    """
    hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV)
    m = ((hsv[:, :, 2] > 195) & (hsv[:, :, 1] < 70)).astype(np.uint8)
    lang = cv2.morphologyEx(m, cv2.MORPH_OPEN,
                            np.ones((1, max(3, int(bh * 1.1))), np.uint8))
    return m & (1 - lang)


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
    mitte = cx_rel
    if not (0 <= mitte < len(nah)) or not nah[mitte]:
        kandidaten = np.flatnonzero(nah)
        if not len(kandidaten):
            return None
        mitte = int(kandidaten[np.argmin(abs(kandidaten - mitte))])
    li = mitte
    while li > 0 and nah[li - 1]:
        li -= 1
    re = mitte
    while re < len(nah) - 1 and nah[re + 1]:
        re += 1

    # **Die Landesflagge steht hinter dem Namen und gehoert nicht dazu.** Nach
    # dem Verschmelzen ueber Buchstabenluecken hinweg ist der Name ein breiter
    # Klumpen und die Flagge ein eigener, schmaler dahinter — sie ist ein Symbol
    # fester Groesse, ein Name hoert nie mit einer solchen Insel auf. Ohne den
    # Schnitt haengt an jedem zweiten Namen ein `L=`, `Ka` oder `f=`.
    teile = _stuecke(aktiv[li:re + 1], max(3, int(bh * 0.11)))
    if len(teile) >= 2:
        breite = lambda p: p[1] - p[0] + 1          # noqa: E731
        if (breite(teile[-1]) < bh * 0.85
                and max(breite(p) for p in teile[:-1]) >= breite(teile[-1])):
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
    """
    hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV)
    V = hsv[:, :, 2].astype(np.int16)
    S = hsv[:, :, 1].astype(np.int16)
    u0 = min(a.shape[0] - 1, r1 + 2)
    u1 = min(a.shape[0], r1 + 2 + int(bh * 1.2))
    schild = ((S[u0:u1] < 60) & (V[u0:u1] > 120)).astype(np.uint8)
    if schild.size == 0:
        return None
    rz = max(3, int(bh * 0.45)) | 1
    schild = cv2.morphologyEx(schild, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rz, rz)))
    n, _lab, st, ce = cv2.connectedComponentsWithStats(schild, 8)
    kandidaten = [(abs(ce[j][0] - cx_rel), j) for j in range(1, n)
                  if bh * 0.55 <= st[j][2] <= bh * 1.45
                  and st[j][3] <= bh * 0.70 and st[j][4] > 200]
    if not kandidaten:
        return None
    _, j = min(kandidaten)
    x, y, w, h = st[j][:4]
    unten = u0 + y + h
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
    saum = max(2, hart.shape[1] // 40)
    if dunkel[:, :saum].any() or dunkel[:, -saum:].any():
        return None                       # angeschnitten — die fuehrende Ziffer fehlt
    nn, _l, ss, _c = cv2.connectedComponentsWithStats(dunkel, 8)
    klumpen = sum(1 for q in range(1, nn)
                  if ss[q][3] > hart.shape[0] * 0.35 and ss[q][4] > 60)
    bild = Image.fromarray(np.pad(hart, 30, constant_values=255))
    for psm in (8, 10, 7, 13):
        txt = _ocr(bild, psm, ziffern=True).replace(" ", "")
        if txt.isdigit() and 1 <= int(txt) <= 40 and len(txt) == klumpen:
            return int(txt)
    return None


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
    t = _schriftmaske(a, bh)
    band = _namensband(a, t, int(cx - x0), bh)
    if band is None:
        return leer
    r0, r1, li, re = band
    aus = t[max(0, r0 - 3):r1 + 3, li:re + 1]
    if aus.size == 0 or aus.shape[1] < 8:
        return leer
    roh = _ocr(_gross(aus), 7)
    tag, name = zerlegen(roh)
    return {"name": name, "name_roh": roh, "allianz": tag,
            "level": _stufe(a, r1, int(cx - x0), bh)}


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
    aus = []
    for cx, cy, w, h in finde(bild, eng):
        wx, wy = welt(cx + vx, cy + vy, kamera_x, kamera_y, cfg)
        s = schild_lesen(im, cx, cy, cfg)
        aus.append({"name_ocr": s["name"], "name_roh": s["name_roh"],
                    "allianz": s["allianz"], "level": s["level"],
                    "x": round(wx, 2), "y": round(wy, 2),
                    "px": [round(cx + vx, 1), round(cy + vy, 1), w, h]})
    return aus
