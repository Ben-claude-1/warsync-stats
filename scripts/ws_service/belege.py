"""Beweisbilder: je Spieler der Ausschnitt, aus dem sein Wert gelesen wurde.

Ein Bericht sagt `A`, `BE` oder gar nichts. Wer daraufhin fragt „ich war doch
angemeldet", bekommt bisher eine Zahl als Antwort und muss sie glauben. Das
Bild ist die bessere Antwort: darauf stehen sein Name, seine Heldenkraft, der
Zeit-Balken mit der gemeldeten Uhrzeit — oder eben keiner — und das Abzeichen
des Teams, in das er eingeteilt ist.

**Geschnitten wird aus genau dem Bild, aus dem auch gelesen wurde.** Ein
spaeter nachgestellter Screenshot waere kein Beleg: in der Anmeldephase duerfen
R4 und R5 die Zuordnung jederzeit umstellen, und zwei Minuten danach steht dort
etwas anderes. Der Dienst liest einen Zustand, keine Wahrheit auf Dauer — ein
Beleg muss deshalb den Zeitpunkt mittragen, und er tut es doppelt: als
Fusszeile im Bild und als Ordnername.

**Wer zwei Balken hat, bekommt beide.** Wer sich fuer beide Uhrzeiten meldet,
steht zweimal in der Liste; ein einzelner Ausschnitt zeigte davon nur eine
Haelfte und saehe aus wie eine Meldung fuer eine Zeit. Bis `MAX_TAFEL`
Ausschnitte werden deshalb untereinander auf eine Tafel gesetzt.

**Ein fehlender Beleg ist eine eigene Auskunft.** Wessen Zeile ein Lauf nie im
lesbaren Streifen hatte, ueber den weiss er nichts — weder „angemeldet" noch
„nicht angemeldet". Die stehen in `ohne_beleg` und ausdruecklich nicht bei den
Nicht-Angemeldeten; sonst belegte das Bild eine Aussage, die niemand getroffen
hat.
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# Wie viele Ausschnitte hoechstens auf eine Tafel kommen. Zwei Balken sind der
# Regelfall bei Doppelmeldern, drei der Puffer; darueber hinaus zeigt jede
# weitere Lesung dasselbe noch einmal und macht das Bild nur unhandlich.
MAX_TAFEL = 3

# Wie weit der Ausschnitt ueber den Kopf hinaus nach oben und unter die Zeile
# reicht. Oben genuegt ein Rand, damit der Balken als Balken zu erkennen ist;
# unten muessen Name, Heldenkraft und **beide** Badge-Felder mit hinein —
# `zeile_lesen` misst sie bis y_kopf_ende + 230.
RAND_OBEN = 10
RAND_UNTEN = 240

FUSS_HOEHE = 52
SCHRIFTEN = ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
             "/System/Library/Fonts/Helvetica.ttc")


def _schrift(groesse: int):
    """Eine Schrift, die auch Griechisch und Japanisch zeichnen kann.

    Die Fusszeile traegt den Spielernamen, und ein Teil des Kaders heisst
    `ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ` oder `V ベジータ王子`. Mit der eingebauten Bitmap-Schrift
    von PIL stuenden dort Kaestchen — ausgerechnet im Beleg, den jemand vorgelegt
    bekommt. Arial Unicode zuerst, weil es alle drei Schriften traegt.
    """
    for pfad in SCHRIFTEN:
        if Path(pfad).exists():
            try:
                return ImageFont.truetype(pfad, groesse)
            except OSError:
                continue
    return ImageFont.load_default()


def dateiname(name: str) -> str:
    """Spielername → Dateiname, so aehnlich wie moeglich.

    Der Name ist das, wonach Ben die Datei spaeter sucht, also bleibt er stehen
    — samt Sonderzeichen. Ersetzt wird nur, was ein Dateiname nicht tragen kann
    (`/`, `:`) oder was unsichtbar waere (Steuerzeichen, Leerzeichen am Rand).
    """
    sauber = re.sub(r"[/:\x00-\x1f]", "_", name).strip()
    return (sauber or "unbenannt") + ".png"


def ausschnitt(bild, y0: int, y1: int, cfg: dict) -> Image.Image:
    """Der Streifen einer Zeile: Balken, Name, Heldenkraft, beide Badge-Felder.

    `y0`/`y1` sind Anfang und Ende des Kopfes ueber der Zeile — beim Zeit-Balken
    dessen Kanten, nach dem Anmeldeschluss die des Trennstreifens
    (`roster.zeilenkoepfe`). Beide Male liegt die Zeile darunter, der Schnitt
    ist derselbe.
    """
    x0, _, x1, _ = cfg["list_view"]
    if not isinstance(bild, Image.Image):
        bild = Image.fromarray(np.asarray(bild))
    b, h = bild.size
    kasten = (max(0, x0), max(0, y0 - RAND_OBEN),
              min(b, x1), min(h, y1 + RAND_UNTEN))
    return bild.crop(kasten)


def tafel(bilder: list[Image.Image], fusszeile: str) -> Image.Image:
    """Mehrere Ausschnitte untereinander, darunter eine Zeile Klartext.

    Die Fusszeile macht das Bild fuer sich allein lesbar. Weitergereicht wird es
    ohne den Bericht daneben — ohne Zeitpunkt und Blatt waere es ein Ausschnitt
    aus irgendeiner Woche.
    """
    breite = max(b.size[0] for b in bilder)
    hoehe = sum(b.size[1] for b in bilder) + FUSS_HOEHE
    ziel = Image.new("RGB", (breite, hoehe), "white")
    y = 0
    for b in bilder:
        ziel.paste(b, (0, y))
        y += b.size[1]
    zeichner = ImageDraw.Draw(ziel)
    zeichner.rectangle([0, y, breite, hoehe], fill=(28, 32, 40))
    zeichner.text((14, y + 13), fusszeile, fill="white", font=_schrift(26))
    return ziel


class Sammler:
    """Sammelt Ausschnitte waehrend des Laufs und legt sie am Ende je Spieler ab.

    Waehrend des Scans ist noch unbekannt, wem eine Zeile gehoert — der Abgleich
    gegen den Kader laeuft erst danach, und er fasst mehrere Lesungen derselben
    Zeile zusammen. Gesammelt wird deshalb zuerst anonym (`merken`), benannt erst
    zum Schluss (`abschliessen`).

    **Geschrieben wird sofort auf die Platte, nicht in den Speicher.** Ein Lauf
    liest ueber zweihundert Rohzeilen; als entpackte Bilder waeren das mehrere
    hundert Megabyte im Arbeitsspeicher, von denen am Ende ein Fuenftel gebraucht
    wird. Was nicht gebraucht wurde, raeumt `abschliessen` weg.
    """

    def __init__(self, ordner: Path, cfg: dict, kopf: str = ""):
        self.ordner = Path(ordner)
        self.roh = self.ordner / "_roh"
        self.cfg = cfg
        self.kopf = kopf
        self.roh.mkdir(parents=True, exist_ok=True)
        self._n = 0

    def merken(self, bild, y0: int, y1: int) -> str:
        """Ausschnitt ablegen, Kennung zurueckgeben (kommt in die Rohzeile)."""
        self._n += 1
        kennung = f"z{self._n:04d}"
        ausschnitt(bild, y0, y1, self.cfg).save(self.roh / f"{kennung}.png")
        return kennung

    def merken_aus(self, pfad, y0: int | None, y1: int) -> str:
        """Dasselbe aus einem abgelegten Vollbild statt aus dem Geraet.

        Das ist der Weg fuer `--nur-rechnen`: die Bilder des Mitschnitts liegen
        noch da, die Belege lassen sich daraus jederzeit neu schneiden, ohne
        dafuer die Texterkennung ein zweites Mal ueber 220 Bilder zu schicken.

        `y0` fehlt in Rohdaten, die vor dieser Aenderung entstanden sind — dort
        stand nur das Ende des Kopfes. Der Rueckfall schaetzt die Balkenhoehe;
        das reicht fuer einen Beleg, der ohnehin einen Rand mitnimmt.
        """
        return self.merken(Image.open(pfad), y0 if y0 is not None else y1 - 70, y1)

    def _laden(self, kennung: str) -> Image.Image | None:
        pfad = self.roh / f"{kennung}.png"
        return Image.open(pfad) if pfad.exists() else None

    def abschliessen(self, spieler: dict, ohne_beleg: list[str] | None = None,
                     hinweis: str = "") -> dict:
        """Je Spieler eine Tafel schreiben, dazu ein Verzeichnis.

        `spieler`: Name → {"wert": str|None, "belege": [Kennung, ...],
                           "kraft": float|None}
        `ohne_beleg`: Kadernamen, deren Zeile dieser Lauf nicht gesehen hat.
        """
        index = {"zeitpunkt": datetime.now().isoformat(timespec="seconds"),
                 "kopf": self.kopf, "hinweis": hinweis,
                 "spieler": {}, "ohne_beleg": sorted(ohne_beleg or [])}
        for name, angaben in sorted(spieler.items()):
            bilder = [b for b in (self._laden(k) for k in
                                  (angaben.get("belege") or [])[:MAX_TAFEL]) if b]
            if not bilder:
                index["ohne_beleg"] = sorted(set(index["ohne_beleg"]) | {name})
                continue
            wert = angaben.get("wert")
            datei = dateiname(name)
            tafel(bilder, f"{name} → {wert or 'nicht angemeldet'}"
                          f"{'  ·  ' + self.kopf if self.kopf else ''}"
                  ).save(self.ordner / datei)
            index["spieler"][name] = {
                "wert": wert, "datei": datei, "kraft": angaben.get("kraft"),
                # Wie viele **verschiedene** Balken auf der Tafel stehen. Zwei
                # heisst: fuer beide Uhrzeiten gemeldet. Nicht zu verwechseln
                # mit der Zahl der gesehenen Zeilen — dieselbe Zeile in vier
                # Bildern ergibt einen Ausschnitt, nicht vier.
                "ausschnitte": len(angaben.get("belege") or []),
            }
        (self.ordner / "index.json").write_text(
            json.dumps(index, ensure_ascii=False, indent=1))
        (self.ordner / "uebersicht.html").write_text(_html(index))
        shutil.rmtree(self.roh, ignore_errors=True)
        return index


def _html(index: dict) -> str:
    """Eine Seite zum Durchblaettern — der Ordner allein sortiert nach Namen.

    Gesucht wird aber meistens andersherum: „wer stand auf `BC`". Die Seite
    gruppiert deshalb nach Wert und zeigt das Bild gleich mit.
    """
    nach_wert: dict[str, list] = {}
    for name, a in index["spieler"].items():
        nach_wert.setdefault(a["wert"] or "nicht angemeldet", []).append((name, a))
    teile = ["<!doctype html><meta charset=utf-8>",
             "<title>Belege Wuestensturm-Anmeldung</title>",
             "<style>body{font:15px system-ui;margin:2rem;background:#f6f7f9}"
             "h2{margin-top:2rem}figure{margin:0 0 1.5rem}"
             "img{max-width:100%;border:1px solid #ccd;border-radius:6px}"
             "figcaption{color:#555;margin:.3rem 0}</style>",
             f"<h1>Belege · {index['kopf']}</h1>",
             f"<p>Gelesen {index['zeitpunkt']}."
             + (f" {index['hinweis']}" if index["hinweis"] else "") + "</p>"]
    for wert in sorted(nach_wert):
        teile.append(f"<h2>{wert} ({len(nach_wert[wert])})</h2>")
        for name, a in sorted(nach_wert[wert]):
            teile.append(f"<figure><figcaption>{name}</figcaption>"
                         f"<img src=\"{a['datei']}\" alt=\"{name}\"></figure>")
    if index["ohne_beleg"]:
        teile.append(f"<h2>Ohne Beleg ({len(index['ohne_beleg'])})</h2>"
                     "<p>Diese Zeilen hat der Lauf nicht gesehen — ueber sie "
                     "sagt er nichts, auch nicht, dass sie nicht angemeldet "
                     "waren.</p><p>"
                     + ", ".join(index["ohne_beleg"]) + "</p>")
    return "\n".join(teile)
