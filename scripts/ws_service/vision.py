"""Was auf dem Bildschirm steht — Text ueber Tesseract, Zustaende ueber Farbe.

Die Aufteilung ist Absicht: **Text wird gelesen, Zustand wird gemessen.**

Namen aus einem Spiel-UI liest keine OCR fehlerfrei; „IIBlackJackII" kommt als
„IBlackJackli" zurueck. Das ist kein Problem, weil der Name hinterher gegen die
bekannte Kaderliste abgeglichen wird (siehe roster.zuordnen) — dort zaehlt
Aehnlichkeit, nicht Buchstabentreue.

Wovon die Auswertung abhaengt, wird deshalb **nicht** aus Text gewonnen:

* Ob jemand eingeteilt ist, steht im Badge-Feld — gemessen als Blau-Rot-Abstand.
  Ein Badge liegt bei ~+56, ein leeres Feld bei ~-2. Dazwischen ist nichts.
* Zu welchem Team, steht in der Farbe der Zeitkopfzeile (gruen/orange), und
  welche Uhrzeit das ist, sagt die OCR derselben Zeile — die liest sich sauber,
  weil es Ziffern in klarer Schrift sind.

Eine Zahl wie 146,6M liest Tesseract zuverlaessig. Sie dient als zweiter
Schluessel beim Zuordnen: Name *und* Kraft muessen zusammenpassen.
"""
from __future__ import annotations

import io
import re
import subprocess

import numpy as np
from PIL import Image

_ZAHL = re.compile(r"(\d{1,4})[,.](\d)\s*M")
_UHR = re.compile(r"(\d{1,2})\s*[:.]\s*(\d{2})")


def ocr(bild: np.ndarray, box: tuple[int, int, int, int] | None = None,
        psm: int = 6, lang: str = "deu", skalieren: int = 2) -> str:
    """Text eines Ausschnitts. Verdoppelt vorher — Tesseract mag grosse Glyphen."""
    im = Image.fromarray(bild)
    if box:
        im = im.crop(box)
    if skalieren > 1:
        im = im.resize((im.width * skalieren, im.height * skalieren), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    p = subprocess.run(["tesseract", "stdin", "stdout", "-l", lang, "--psm", str(psm)],
                       input=buf.getvalue(), capture_output=True, timeout=60)
    return p.stdout.decode("utf8", "replace")


def woerter(bild: np.ndarray, box: tuple[int, int, int, int],
            psm: int = 11, lang: str = "deu", min_conf: float = 40.0,
            skalieren: int = 2) -> list[dict]:
    """Einzelne Woerter mit Mittelpunkt im Vollbild — fuer Knoepfe und Reiter.

    Reiter dürfen nicht über feste Koordinaten angetippt werden: wie viele es
    gibt, wechselt mit den laufenden Events. Gesucht wird deshalb das Wort.
    """
    im = Image.fromarray(bild).crop(box)
    im = im.resize((im.width * skalieren, im.height * skalieren), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    p = subprocess.run(["tesseract", "stdin", "stdout", "-l", lang,
                        "--psm", str(psm), "tsv"],
                       input=buf.getvalue(), capture_output=True, timeout=60)
    out = []
    for zeile in p.stdout.decode("utf8", "replace").splitlines()[1:]:
        f = zeile.split("\t")
        if len(f) < 12 or not f[11].strip():
            continue
        try:
            conf = float(f[10])
        except ValueError:
            continue
        if conf < min_conf:
            continue
        x, y, w, h = (int(f[6]), int(f[7]), int(f[8]), int(f[9]))
        out.append({
            "text": f[11].strip(),
            "conf": conf,
            "x": box[0] + (x + w / 2) / skalieren,
            "y": box[1] + (y + h / 2) / skalieren,
        })
    return out


def finde_wort(bild: np.ndarray, box: tuple[int, int, int, int], gesucht: str,
               **kw) -> dict | None:
    """Erstes Wort, das `gesucht` enthaelt — Gross/Klein und Umlaute egal."""
    ziel = _norm(gesucht)
    for w in woerter(bild, box, **kw):
        if ziel in _norm(w["text"]):
            return w
    return None


def finde_knopf(bild: np.ndarray, box: tuple[int, int, int, int], wunsch: str,
                min_score: float = 0.6, min_abstand: float = 0.1,
                **kw) -> dict | None:
    """Knopf ueber seinen *ganzen* Text finden, nicht ueber ein einzelnes Wort.

    Die Knopfschrift ist verziert; „Teilnehmer" liest Tesseract schon mal als
    „tieillnehmer" — ein Wortvergleich scheitert daran, ein Aehnlichkeitsmass
    nicht. Zusammengefasst wird nach x-Naehe, weil die Beschriftung auf zwei
    Zeilen steht („Teilnehmer" / „auswaehlen").

    Der Abstand zum Zweitbesten muss stimmen: „Kampfzeit auswaehlen" steht
    daneben und teilt sich die halbe Beschriftung.
    """
    import difflib

    ws = woerter(bild, box, **kw)
    gruppen: list[list[dict]] = []
    for w in sorted(ws, key=lambda w: w["x"]):
        if gruppen and abs(w["x"] - gruppen[-1][-1]["x"]) < 200:
            gruppen[-1].append(w)
        else:
            gruppen.append([w])
    ziel = _norm(wunsch)
    bewertet = []
    for gr in gruppen:
        text = " ".join(w["text"] for w in sorted(gr, key=lambda w: w["y"]))
        score = difflib.SequenceMatcher(None, _norm(text), ziel).ratio()
        bewertet.append((score, {
            "text": text, "score": round(score, 3),
            "x": sum(w["x"] for w in gr) / len(gr),
            "y": sum(w["y"] for w in gr) / len(gr),
        }))
    if not bewertet:
        return None
    bewertet.sort(key=lambda t: t[0], reverse=True)
    beste = bewertet[0]
    zweite = bewertet[1][0] if len(bewertet) > 1 else 0.0
    if beste[0] < min_score or beste[0] - zweite < min_abstand:
        return None
    return beste[1]


def _norm(s: str) -> str:
    """Fuer Bedienelemente, nicht fuer Spielernamen (die macht match.norm).

    Umlaute fallen auf den Grundvokal **und** die Umschreibung darauf: sonst
    findet ein im Quelltext als „Wuestensturm" geschriebener Reiter nie das
    gelesene „Wüstensturm" — das eine wird zu 'wuestensturm', das andere zu
    'wustensturm', und der Streifen wird bis zum Anschlag weitergeschoben.
    """
    s = s.lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "s")):
        s = s.replace(a, b)
    s = "".join(c for c in s if c.isalnum())
    for a, b in (("ae", "a"), ("oe", "o"), ("ue", "u")):
        s = s.replace(a, b)
    return s


def kraft(text: str) -> float | None:
    """„Gesamtkampfkraft der Helden: 146,6M" → 146.6"""
    treffer = _ZAHL.findall(text)
    if not treffer:
        return None
    g, k = treffer[-1]
    return float(f"{g}.{k}")


def uhrzeit(text: str) -> str | None:
    """„Lokale Zeit: 2026-9-4    13:00 ~ 13:30" → '13:00'

    Das Datum steht in derselben Zeile und enthaelt keinen Doppelpunkt, deshalb
    ist der erste Treffer die Startzeit.
    """
    m = _UHR.search(text)
    if not m:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def blau_signal(bild: np.ndarray, x: int, y_von: int, y_bis: int,
                radius: int = 32) -> float:
    """Staerkstes Blau-Rot-Signal in einem senkrechten Fenster.

    Gesucht wird ueber einen Bereich statt an einem Punkt, weil die Zeilenhoehe
    je nach Namenslaenge um ein paar Pixel wandert. Ein leeres Feld liefert
    negative Werte, ein Badge deutlich positive — die Luecke dazwischen ist so
    gross, dass die Schwelle unkritisch ist.
    """
    best = -99.0
    h = bild.shape[0]
    for yy in range(max(y_von, radius), min(y_bis, h - radius), 15):
        fenster = bild[yy - 25:yy + 25, x - radius:x + radius].reshape(-1, 3).astype(int)
        if not len(fenster):
            continue
        best = max(best, float((fenster[:, 2] - fenster[:, 0]).mean()))
    return best


def hell_text(bild: np.ndarray, box: tuple[int, int, int, int],
              zeichen: str = "0123456789", hell: int = 228) -> str:
    """Kleine weisse Schrift auf hellem Grund lesen.

    Die Zaehler in den Rang-Kopfzeilen sind weiss mit schwarzem Rand auf
    Flieder — auf dem Rohbild liest Tesseract davon gar nichts. Erst die
    Umkehrung (nur die weisse Fuellung, schwarz auf weiss, vierfach vergroessert
    und mit Rand) macht sie lesbar. `--psm 6` ist dabei der einzige Modus, der
    auch die Null erkennt; die Einzelzeichen-Modi lassen ihren Ring durchfallen.

    Blaue Schrift faellt hier bewusst heraus — siehe `bruch()`.
    """
    x0, y0, x1, y1 = box
    a = bild[y0:y1, x0:x1].astype(int)
    if a.size == 0:
        return ""
    maske = (a[:, :, 0] > hell) & (a[:, :, 1] > hell) & (a[:, :, 2] > hell)
    im = Image.fromarray(np.where(maske, 0, 255).astype("uint8"))
    im = im.resize((im.width * 4, im.height * 4), Image.LANCZOS)
    rand = Image.new("L", (im.width + 80, im.height + 80), 255)
    rand.paste(im, (40, 40))
    buf = io.BytesIO()
    rand.save(buf, "PNG")
    p = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "6",
                        "-c", "tessedit_char_whitelist=" + zeichen],
                       input=buf.getvalue(), capture_output=True, timeout=60)
    return p.stdout.decode("utf8", "replace").strip()


def zahl(bild: np.ndarray, box: tuple[int, int, int, int],
         hell: int = 228) -> int | None:
    text = "".join(c for c in hell_text(bild, box, hell=hell) if c.isdigit())
    return int(text) if text else None


def bruch(bild: np.ndarray, box: tuple[int, int, int, int],
          hell: int = 228) -> int | None:
    """Der Nenner aus „16/80" — die Mitgliederzahl eines Ranges.

    Nur der Nenner: der Zaehler davor ist blau und faellt bei der Aufhellung
    heraus, weshalb je nach Ausschnitt mal „80" und mal „180" herauskaeme. Ein
    Schluessel, der zwischen zwei Bildern springt, laesst dieselbe Rang-Gruppe
    als neue erscheinen — und die zaehlt dann doppelt in die Gegenprobe.
    """
    text = hell_text(bild, box, zeichen="0123456789/", hell=hell)
    if "/" in text:
        text = text.rsplit("/", 1)[1]
    ziffern = "".join(c for c in text if c.isdigit())
    return int(ziffern) if ziffern else None


def baender(bild: np.ndarray, y_von: int, y_bis: int, x_von: int, x_bis: int,
            pruefer, min_hoehe: int, min_anteil: float = 0.4) -> list[tuple[int, int]]:
    """Zusammenhaengende waagerechte Streifen aus Pixeln, die `pruefer` erfuellen.

    Gezaehlt wird der **Anteil** passender Pixel je Zeile, nicht der Mittelwert
    der Zeile. Ein Rang-Balken traegt in seiner Mitte Symbole und Zahlen; im
    Mittelwert kippt er dort weg, und der Streifen zerfaellt in zwei duenne
    Raender ober- und unterhalb, die durch jede Mindesthoehe fallen. Nach Anteil
    gemessen bleibt er ueber die ganze Hoehe bei 0,6…1,0, waehrend Spielerzeilen
    bei 0,0 liegen — dazwischen ist nichts.
    """
    a = bild[:, x_von:x_bis].astype(int)
    maske = pruefer(a[:, :, 0], a[:, :, 1], a[:, :, 2])
    treffer = maske.mean(1) >= min_anteil
    out, y = [], y_von
    while y < y_bis:
        if treffer[y]:
            y0 = y
            while y < y_bis and treffer[y]:
                y += 1
            if y - y0 >= min_hoehe:
                out.append((y0, y))
        else:
            y += 1
    return out


def ist_gruen(r, g, b):
    return (g > r + 12) & (g > b + 20) & (g > 110)


def ist_orange(r, g, b):
    return (r > g + 25) & (g > b + 15) & (r > 120)


def ist_gruppenbalken(r, g, b):
    """Rang-Kopfzeile (R5..R1): fliederfarbener Balken, Blau ueber Rot.

    Die Zeilenhintergruende sind warmweiss (Blau *unter* Rot) und ausgegraute
    Zeilen neutralgrau — beide fallen damit heraus.
    """
    return (b > r + 4) & ((r + g + b) / 3 > 190)
