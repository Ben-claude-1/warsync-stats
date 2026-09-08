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

import numpy as np
from PIL import Image, ImageOps

from scripts.karten_archiv import sprung

FELD_X = (1075, 345, 1225, 408)
FELD_Y = (1380, 345, 1530, 408)
# Mehrere Schwellen, weil die Ziffern auf einem **durchscheinenden** Feld stehen:
# was darunter liegt, wechselt mit dem Kartenausschnitt. Mit einer festen Schwelle
# verschmolzen die Ziffern ueber hellem Gelaende (Wueste) mit dem Hintergrund und
# die Ablesung fiel reihenweise aus.
SCHWELLEN = (140, 170, 200, 230)

# **`--psm 6` muss dabei sein.** Mit `tessedit_char_whitelist` liefern die
# Einzelzeichen-Modi 7, 8 und 13 auf Tesseract 5.5.3 eine leere Ausgabe, sobald im
# Feld nur eine Ziffer steht — ohne Whitelist lesen dieselben Modi dasselbe Bild
# als `0` bzw. `Oo`. Die Whitelist ist mit der LSTM-Engine also nicht verlaesslich,
# und `psm 6` ist der einzige der vier, den sie nicht bricht.
#
# Das war die Ursache des Vollscan-Abbruchs am 07.09.2026: Zeile 0 fuhr bei Y=0,
# die Y-Ablesung war damit einstellig und fiel **jedes Mal** aus. Weil `lesen`
# nichts zurueckgibt, wenn auch nur eine der beiden Zahlen fehlt, war der gesamte
# Rueckfallpfad tot — in allen drei Zeilen, bei jeder Stichprobe.
#
# Dieselbe Falle steht schon in der CLAUDE.md fuer den WS-Dienst („nur mit
# --psm 6, weil die Einzelzeichen-Modi die Null durchfallen lassen"); hier war sie
# nie angekommen.
PSM = (6, 7, 8, 13)


def _weiss(a: Image.Image) -> Image.Image:
    """Nur die reinweisse Dialogschrift, alles andere weg.

    Die Schwellen allein trennen nicht, was **selbst eine Ziffer** ist: hinter dem
    durchscheinenden Feld liegt die Karte, und dort steht mal ein Stufenschild mit
    einer Zahl darauf. Am 07.09.2026 lag hinter der Y-Null eine `10` — Tesseract
    bekam beide zu sehen und lieferte Uneinigkeit statt einer Zahl.

    Die Dialogziffern sind rein weiss, das Gelaende darunter ist es nie. Ueber
    Saettigung und Helligkeit statt ueber Helligkeit allein faellt das Schild
    vollstaendig heraus.
    """
    hsv = np.asarray(a.convert("HSV"), dtype=int)
    maske = (hsv[..., 1] <= 60) & (hsv[..., 2] >= 200)
    return Image.fromarray(np.where(maske, 0, 255).astype(np.uint8))


def _zahl(im: Image.Image, box) -> int | None:
    a = im.crop(box)
    a = a.resize((a.width * 5, a.height * 5), Image.LANCZOS)
    grau = ImageOps.grayscale(a)
    varianten = [_weiss(a)]
    varianten += [grau.point(lambda v, s=s: 255 if v < s else 0) for s in SCHWELLEN]
    kand: list[int] = []
    for g in varianten:
        g = ImageOps.expand(g, border=40, fill=255)   # Tesseract braucht Luft am Rand
        buf = io.BytesIO()
        g.save(buf, "PNG")
        for psm in PSM:
            p = subprocess.run(["tesseract", "stdin", "stdout", "--psm", str(psm),
                                "-c", "tessedit_char_whitelist=0123456789"],
                               input=buf.getvalue(), capture_output=True, timeout=30)
            t = "".join(c for c in p.stdout.decode("utf8", "replace") if c.isdigit())
            if t and len(t) <= 3:
                kand.append(int(t))
        # Frueh aufhoeren, sobald die Aussage steht: die Ablesung sitzt im Sweep
        # zwischen zwei Kacheln, und zwanzig Tesseract-Laeufe sind dort Zeit, die
        # der Lauf hundertfach bezahlt.
        if len(kand) >= 2 and len(set(kand)) == 1:
            return kand[0]
    if not kand:
        return None
    wert, wie_oft = Counter(kand).most_common(1)[0]
    # Ein einzelner Fund gilt nur, wenn ihm nichts widerspricht.
    return wert if wie_oft > 1 or len(set(kand)) == 1 else None


_fehlschlaege = 0
FEHLSCHLAG_MAX = 40


def _fehlschlag(p: Image.Image, warum: str) -> None:
    """Eine misslungene Ablesung hinterlaesst Bild und Grund.

    **Der Grund ist die halbe Diagnose.** „Nicht gelesen" hat zwei sehr
    verschiedene Ursachen: Tesseract bekommt die Ziffern nicht (dann liegt es am
    Untergrund) oder die Schranke verwirft eine gelesene Zahl (dann liegt es an
    der gerechneten Erwartung, also an der Navigation). Von aussen sehen beide
    gleich aus, und am 08.09.2026 kostete genau diese Ununterscheidbarkeit einen
    halben Tag: verdaechtigt wurde die Schranke, kaputt war die Erkennung.

    `dialog_sicherstellen` legt seine Fehlschlaege schon ab; hier fehlte der
    haeufigere Fall. Gedeckelt, weil eine Gegend mit schwierigem Untergrund
    sonst hunderte Bilder erzeugt — die ersten paar sagen dasselbe.
    """
    global _fehlschlaege
    print(f"      Ablesung: {warum}", flush=True)
    _fehlschlaege += 1
    if _fehlschlaege > FEHLSCHLAG_MAX:
        return
    try:
        from datetime import datetime
        from scripts.karten_archiv.archiv import WURZEL
        ordner = WURZEL / "stoerfaelle"
        ordner.mkdir(parents=True, exist_ok=True)
        p.crop((FELD_X[0], FELD_X[1], FELD_Y[2], FELD_Y[3])).save(
            ordner / f"ablesung_{datetime.now():%Y%m%d_%H%M%S_%f}.png")
    except Exception:                    # Beweissicherung darf nie selbst werfen
        pass


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
        _fehlschlag(p, f"unlesbar x={x} y={y}")
        return None
    if erwartet and (abs(x - erwartet[0]) > toleranz or abs(y - erwartet[1]) > toleranz):
        _fehlschlag(p, f"unplausibel {x}/{y} statt {erwartet[0]}/{erwartet[1]} "
                       f"(Toleranz {toleranz})")
        return None
    return x, y
