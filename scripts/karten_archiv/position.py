"""Kameraposition aus dem Lupe-Dialog ablesen.

**Der Dialog verraet die Position, ohne dass gesprungen wird.** Nur „Suchen" setzt
den Zoom auf die Standardstufe zurueck; das blosse Oeffnen und Schliessen laesst
ihn stehen (gemessen 07.09.2026: Bannerhoehe 41 → 42 px ueber Oeffnen/Schliessen,
Standardstufe waere 65). Damit ist er als reine Positionsanzeige brauchbar — und
genau das fehlte allen frueheren Anlaeufen, die die Schwenkweite raten mussten.

Die Ziffern stehen **weiss auf durchscheinender Karte**: ohne Schwelle liest
Tesseract das Hintergrundgewimmel mit. Zugeschnitten, fuenffach vergroessert,
geschwellt und mit weissem Rand versehen sind sie sauber.

**Bei Uneinigkeit wird nichts zurueckgegeben.** Gelesen wird in drei
Segmentierungsmodi; nur was mehrfach oder eindeutig herauskommt, gilt. Eine
falsch gelesene Position waere schlimmer als keine — sie verschoebe stillschweigend
alle folgenden Kacheln.
"""
from __future__ import annotations

import io
import subprocess
from collections import Counter

from PIL import Image, ImageOps

from scripts.karten_archiv import sprung

FELD_X = (1075, 345, 1225, 408)
FELD_Y = (1380, 345, 1530, 408)
# Mehrere Schwellen, weil die Ziffern auf einem **durchscheinenden** Feld stehen:
# was darunter liegt, wechselt mit dem Kartenausschnitt. Mit einer festen Schwelle
# verschmolzen die Ziffern ueber hellem Gelaende (Wueste) mit dem Hintergrund und
# die Ablesung fiel reihenweise aus.
SCHWELLEN = (140, 170, 200, 230)


def _zahl(im: Image.Image, box) -> int | None:
    a = im.crop(box)
    a = a.resize((a.width * 5, a.height * 5), Image.LANCZOS)
    grau = ImageOps.grayscale(a)
    kand: list[int] = []
    for schwelle in SCHWELLEN:
        g = grau.point(lambda v, s=schwelle: 255 if v < s else 0)
        g = ImageOps.expand(g, border=40, fill=255)   # Tesseract braucht Luft am Rand
        buf = io.BytesIO()
        g.save(buf, "PNG")
        for psm in (7, 8, 13):
            p = subprocess.run(["tesseract", "stdin", "stdout", "--psm", str(psm),
                                "-c", "tessedit_char_whitelist=0123456789"],
                               input=buf.getvalue(), capture_output=True, timeout=30)
            t = "".join(c for c in p.stdout.decode("utf8", "replace") if c.isdigit())
            if t and len(t) <= 3:
                kand.append(int(t))
    if not kand:
        return None
    wert, wie_oft = Counter(kand).most_common(1)[0]
    # Ein einzelner Fund gilt nur, wenn ihm nichts widerspricht.
    return wert if wie_oft > 1 or len(set(kand)) == 1 else None


def lesen(g, cfg: dict, bild, erwartet: tuple[int, int] | None = None,
          toleranz: int = 6) -> tuple[int, int] | None:
    """Kameraposition; laesst den Dialog geschlossen zurueck.

    `erwartet` ist die Plausibilitaetsschranke. Die Ziffern werden gelegentlich
    verstuemmelt gelesen — am 07.09.2026 kam `52` statt `534` und `5` statt `554`
    heraus. Ohne Schranke haette das die Kameraposition scheinbar um 482 Einheiten
    versetzt, und der Scanner haette **alle folgenden Kacheln still an der falschen
    Stelle** abgelegt. Wer weiss, wo er ungefaehr steht, soll das mitgeben; eine
    unplausible Ablesung gilt dann als „nicht gelesen".
    """
    im = sprung.dialog_sicherstellen(g, cfg, True, bild)
    p = Image.fromarray(im)
    x, y = _zahl(p, FELD_X), _zahl(p, FELD_Y)
    sprung.dialog_sicherstellen(g, cfg, False, bild)
    if x is None or y is None:
        return None
    if erwartet and (abs(x - erwartet[0]) > toleranz or abs(y - erwartet[1]) > toleranz):
        return None
    return x, y
