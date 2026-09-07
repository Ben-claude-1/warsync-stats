"""Namensbanner finden und lesen — und daraus die Weltkoordinate rechnen.

**Gesucht wird geometrisch, nicht per OCR.** Die frueheren Ketten benutzten
Tesseract als *Finder*: erst wenn ein Wort gelesen war, gab es eine Bannerstelle —
und erst dann lief die gute Einzelbild-Aufbereitung. Wo die OCR das Banner nicht
lesen konnte, wurde es also gar nicht erst gefunden. Das ist zirkulaer und kostete
die Haelfte der Treffer: am selben Bild fand der OCR-Finder 3 von 9 Bannern, der
geometrische 7.

Ein Namensbanner ist eindeutig: ein waagerechter dunkler Balken fester Hoehe mit
hellem Text darin, Seitenverhaeltnis ueber 4:1. Der Text zerreisst den Balken in
der Maske, deshalb wird waagerecht geschlossen, bevor gezaehlt wird.

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


def finde(bild_rgb: np.ndarray, cfg: dict) -> list[tuple[float, float, int, int]]:
    """Mittelpunkte und Maße aller Bannerbalken im HUD-freien Bereich."""
    bb, bh = float(cfg["banner_breite"]), float(cfg["banner_hoehe"])
    grau = cv2.cvtColor(bild_rgb, cv2.COLOR_RGB2GRAY)
    dunkel = (grau < 105).astype(np.uint8)
    kern = cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, int(bh * 0.8)), 3))
    zu = cv2.morphologyEx(dunkel, cv2.MORPH_CLOSE, kern)

    n, _, stats, _ = cv2.connectedComponentsWithStats(zu, connectivity=8)
    treffer = []
    for i in range(1, n):
        x, y, w, h, flaeche = stats[i]
        if not (bh * 0.45 <= h <= bh * 1.9):
            continue
        if not (bb * 0.35 <= w <= bb * 1.6):
            continue
        if flaeche / (w * h) < 0.35 or w / h < 4.0:
            continue
        cx, cy = x + w / 2, y + h / 2
        if _im_hud(cx, cy, cfg["karte"]):
            continue
        treffer.append((float(cx), float(cy), int(w), int(h)))
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
