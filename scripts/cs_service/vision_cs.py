"""Das eine Bildmerkmal, das der Wuestensturm-Dienst nicht kennt: das rote
Overlay 'Bitte um Einsatz fuer Truppe [X]'.

Wie in scripts/ws_service/vision.py gilt: Zustand wird gemessen, nicht aus
Text gewonnen. Der Text im Overlay nennt zwar den Truppen-Buchstaben, aber
der steht ohnehin fest (er entspricht der gerade geoeffneten Truppe) — gebraucht
wird nur, *ob* das Overlay ueberhaupt da ist.
"""
from __future__ import annotations

import io
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_TEMPLATE_MIN_SCORE = 0.75
_TEMPLATE_MIN_ABSTAND = 0.15
_TEMPLATE_CACHE: dict[str, np.ndarray] = {}


def _templates() -> dict[str, np.ndarray]:
    """A/B-Referenzbilder des Gesetzt-/Ersatz-Feldes, einmal geladen.

    Am 06.09.2026 live gemessen: Tesseract liest den dick umrandeten
    Icon-Buchstaben nicht als Text (aus 'A' wurde `'[4\\'`) — das ist kein
    Antialiasing-Problem, sondern eine Spielschrift, keine Lesetypo. Ein
    Bildvergleich gegen zwei bekannte Referenzen ist hier zuverlaessiger als
    OCR: Graustufen-Korrelation lag bei 1.0 gegen sich selbst und nur 0.34
    zwischen A und B — ein deutlicher Abstand.
    """
    if not _TEMPLATE_CACHE:
        for buchstabe in ("A", "B"):
            pfad = _TEMPLATES_DIR / f"feld_{buchstabe.lower()}.png"
            _TEMPLATE_CACHE[buchstabe] = np.array(Image.open(pfad).convert("L")).astype(float)
    return _TEMPLATE_CACHE


def _ncc(a: np.ndarray, b: np.ndarray) -> float:
    """Normierte Kreuzkorrelation zweier gleich grosser Graustufenbilder."""
    a = a - a.mean()
    b = b - b.mean()
    nenner = np.sqrt((a * a).sum()) * np.sqrt((b * b).sum())
    return float((a * b).sum() / nenner) if nenner else 0.0


def ist_rot(r, g, b):
    """Deutlich roetlicher als das Orange des Wuestensturms (dort nur r>g+25).

    Gemessen am echten Overlay: r-g ≈ 99, r-b ≈ 114. Die Schwelle liegt weit
    darunter, damit Kompressionsartefakte am Rand nicht durchfallen.
    """
    return (r > g + 50) & (r > b + 50) & (r > 140)


def ist_blau(r, g, b):
    """Die 'gemeldet'-Zahl vor dem Schraegstrich in jeder Rang-Kopfzeile
    ('19' in '19/81'), gemessen an echten Pixeln: Fuellfarbe ≈ (118,117,246).
    Der weisse Nenner (Mitgliederzahl) hat kein derartiges Blau-Uebergewicht
    und faellt hier heraus — wie `bruch()` in ws_service/vision.py es umgekehrt
    mit der blauen Zahl macht.
    """
    return (b > r + 60) & (b > g + 60) & (b > 180)


def blaue_zahl(bild: np.ndarray, box: tuple[int, int, int, int]) -> int | None:
    """Wie `zahl()`/`hell_text()` in ws_service/vision.py, nur fuer die blaue
    statt die weisse Zaehlerschrift.

    Dieselbe Grenze gilt hier wie dort: manche Ziffern (kurz getestet: '0' und
    zweistellige Zahlen zuverlaessig, ein alleinstehendes '5' nicht immer)
    liefert Tesseract trotz sauberer Maske keinen Treffer. Eine nicht lesbare
    Ziffer wird deshalb als `None` behandelt statt geraten — wie ueberall in
    diesem Dienst gilt: eine fehlende Gegenprobe ist besser als eine falsche.
    """
    x0, y0, x1, y1 = box
    a = bild[y0:y1, x0:x1].astype(int)
    if a.size == 0:
        return None
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    maske = ist_blau(r, g, b)
    im = Image.fromarray(np.where(maske, 0, 255).astype("uint8"))
    im = im.resize((im.width * 4, im.height * 4), Image.LANCZOS)
    rand = Image.new("L", (im.width + 80, im.height + 80), 255)
    rand.paste(im, (40, 40))
    buf = io.BytesIO()
    rand.save(buf, "PNG")
    p = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "6",
                        "-c", "tessedit_char_whitelist=0123456789"],
                       input=buf.getvalue(), capture_output=True, timeout=60)
    ziffern = "".join(c for c in p.stdout.decode("utf8", "replace") if c.isdigit())
    return int(ziffern) if ziffern else None


def wunsch_anteil(bild: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> float:
    """Rotanteil in einem Fenster — direkt vergleichbar mit `blau_signal` beim
    Wuestensturm: ein Skalar statt eines Ja/Nein, damit die Schwelle im
    config.json sitzt und nicht im Code.
    """
    a = bild[y0:y1, x0:x1].astype(int)
    if a.size == 0:
        return 0.0
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    return float((ist_rot(r, g, b)).mean())


def feld_buchstabe(bild: np.ndarray, box: tuple[int, int, int, int],
                    leer_grau: int = 181, abweichung_schwelle: float = 0.05) -> str | None:
    """Der Buchstabe (A/B) im Gesetzt- oder Ersatz-Feld neben einer Karte.

    Anders als das rote Wunsch-Overlay zeigt dieses Feld den tatsaechlich
    zugewiesenen Truppen-Buchstaben — unabhaengig davon, welche Truppe gerade
    geoeffnet ist (live bestaetigt am 06.09.2026: LittleFighter zeigte 'B',
    waehrend Truppe A offen war). Ein unbelegtes Feld ist eine einfarbige
    graue Kachel; erst eine deutliche Streuung um diesen Grauton verrät, dass
    ueberhaupt ein Icon/Buchstabe drin steckt.

    Gelesen wird per Bildvergleich, nicht per OCR: Tesseract scheitert an der
    dick umrandeten Spiel-Icon-Schrift (aus 'A' wurde probeweise `'[4\\'`,
    auch ohne Whitelist) — hier zaehlt die Form, nicht ein lesbarer Font.
    """
    x0, y0, x1, y1 = box
    a = bild[y0:y1, x0:x1].astype(int)
    if a.size == 0:
        return None
    abweichung = np.abs(a - leer_grau).max(axis=2)
    if float((abweichung > 25).mean()) < abweichung_schwelle:
        return None                      # praktisch einfarbig grau -> leer

    kandidat = np.array(Image.fromarray(bild[y0:y1, x0:x1]).convert("L")).astype(float)
    vorlagen = _templates()
    bewertet = sorted(
        ((_ncc(kandidat, vorlage) if vorlage.shape == kandidat.shape else
          _ncc(kandidat, np.array(Image.fromarray(vorlage.astype("uint8"))
                                   .resize((kandidat.shape[1], kandidat.shape[0]))).astype(float)),
          buchstabe) for buchstabe, vorlage in vorlagen.items()),
        reverse=True)
    (beste_score, beste), (zweite_score, _) = bewertet[0], bewertet[1]
    if beste_score < _TEMPLATE_MIN_SCORE or beste_score - zweite_score < _TEMPLATE_MIN_ABSTAND:
        return None                      # nicht sicher genug — lieber Luecke als Fehlgriff
    return beste
