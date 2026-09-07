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


def lesen(im: Image.Image, cx: float, cy: float, w: int, h: int) -> str:
    """Namen aus einem gefundenen Balken.

    Ohne Aufbereitung liest Tesseract die verschnoerkelte Bannerschrift kaum;
    zugeschnitten, vergroessert, invertiert (helle Schrift auf dunklem Balken) und
    hart geschwellt wird sie brauchbar. Der Name steht hinter dem `]` des
    Allianz-Kuerzels — davor und dahinter steht Zierrat (Rahmen, Landesflagge).
    """
    rx, ry = int(w * 0.04), int(h * 0.16)     # farbigen Rahmen wegschneiden
    roh = im.crop((int(cx - w / 2) + rx, int(cy - h / 2) + ry,
                   int(cx + w / 2) - rx, int(cy + h / 2) - ry))
    if roh.width < 10 or roh.height < 5:
        return ""
    f = max(3, int(round(200 / roh.height)))
    gross = roh.resize((roh.width * f, roh.height * f), Image.LANCZOS)
    hart = ImageOps.invert(ImageOps.grayscale(gross)).point(lambda v: 0 if v < 110 else 255)
    buf = io.BytesIO()
    hart.save(buf, "PNG")
    p = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "7"],
                       input=buf.getvalue(), capture_output=True, timeout=60)
    t = p.stdout.decode("utf8", "replace").strip().replace("\n", " ")
    m = re.search(r"\]([^|]{2,24})", t)
    return (m.group(1) if m else t).strip(" _-—=*.,;:'\"|()")


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
        aus.append({"name_ocr": lesen(im, cx, cy, w, h),
                    "x": round(wx, 2), "y": round(wy, 2),
                    "px": [round(cx + vx, 1), round(cy + vy, 1), w, h]})
    return aus
