"""Gegnerliste als PNG — zum Posten in der Allianz.

    .venv/bin/python -m scripts.lwatlas.bild
    .venv/bin/python -m scripts.lwatlas.bild --ohne XP33 kiSS --ohne-spieler bonfooyage
    .venv/bin/python -m scripts.lwatlas.bild --anzahl 50 --datei Pics/gegner.png

Die Koordinate steht **mit in der Zeile**: eine Gefahrenliste ohne Ort ist im
Spiel nutzlos — wer sie liest, will hinspringen.

**Die Namensnennung gehoert ins Bild.** Es wird in der Allianz gepostet und ist
damit genau das, was §8a der Nutzungsbedingungen meint: etwas, das auf
LW-Atlas-Daten aufbaut. Im Tool steht der Hinweis unter der Seite, hier muss er
im Bild selbst stehen — das Bild wandert ohne die Seite weiter.

Gezeichnet wird mit `Arial Unicode`, nicht mit der Standardschrift: in den Namen
stehen griechische, kyrillische und japanische Zeichen (`ΨLeonidasΨ`, `Jor EĻ`,
`N A N A ッ`), und PIL faellt nicht selbst auf eine andere Schrift zurueck — es
malt Kaestchen.
"""
from __future__ import annotations

import argparse
import subprocess
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SCHRIFT = "/Library/Fonts/Arial Unicode.ttf"
SCHRIFT_FETT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

BG = (247, 248, 250)
KOPF = (28, 42, 68)
ZEILE_A = (255, 255, 255)
ZEILE_B = (240, 243, 247)
TEXT = (26, 32, 44)
GRAU = (120, 130, 145)
ROT = (192, 57, 43)

SPALTEN = [("#", 60, "r"), ("Spieler", 300, "l"), ("Allianz", 110, "m"),
           ("Lv", 60, "m"), ("Koordinate", 190, "m"), ("Kraft", 130, "r"), ("Kills", 130, "r")]


def holen(server: str, anzahl: int, ohne: list[str], ohne_spieler: list[str]) -> list[dict]:
    bed = ["server=" + _q(server), "army_kill is not null"]
    if ohne:
        bed.append("coalesce(allianz,'') not in (" + ",".join(_q(a) for a in ohne) + ")")
    if ohne_spieler:
        bed.append("name not in (" + ",".join(_q(n) for n in ohne_spieler) + ")")
    sql = ("select name, coalesce(allianz,''), level, x, y, power, army_kill, "
           "coalesce(to_char(last_active_at,'YYYY-MM-DD'),'') "
           f"from lwa_spieler where {' and '.join(bed)} "
           f"order by army_kill desc limit {int(anzahl)}")
    roh = subprocess.run(["docker", "exec", "-i", "supabase-db", "psql", "-U", "postgres",
                          "-At", "-F", "|", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    aus = []
    for z in roh.strip().splitlines():
        n, al, lv, x, y, pw, kl, akt = z.split("|")
        aus.append({"name": n, "allianz": al, "level": lv, "x": x, "y": y,
                    "power": int(pw or 0), "kills": int(kl or 0), "aktiv": akt})
    return aus


def _q(s: str) -> str:
    return "'" + str(s).replace("'", "''") + "'"


def _mio(n: int) -> str:
    return f"{n/1e6:.1f}".replace(".", ",") + " Mio"


def zeichnen(zeilen: list[dict], titel: str, unter: str, ziel: Path) -> Path:
    f_titel = ImageFont.truetype(SCHRIFT_FETT, 40)
    f_unter = ImageFont.truetype(SCHRIFT, 20)
    f_kopf = ImageFont.truetype(SCHRIFT_FETT, 20)
    f_zeile = ImageFont.truetype(SCHRIFT, 21)
    f_fett = ImageFont.truetype(SCHRIFT_FETT, 21)
    f_fuss = ImageFont.truetype(SCHRIFT, 18)

    breite = sum(s[1] for s in SPALTEN) + 60
    kopf_h, zeilen_h, fuss_h = 130, 40, 56
    hoehe = kopf_h + 42 + len(zeilen) * zeilen_h + fuss_h

    bild = Image.new("RGB", (breite, hoehe), BG)
    d = ImageDraw.Draw(bild)

    d.rectangle([0, 0, breite, kopf_h], fill=KOPF)
    d.text((30, 26), titel, font=f_titel, fill=(255, 255, 255))
    d.text((30, 82), unter, font=f_unter, fill=(165, 180, 205))

    y = kopf_h + 10
    x = 30
    for name, w, _ in SPALTEN:
        d.text((x + 4, y), name.upper(), font=f_kopf, fill=GRAU)
        x += w
    y += 32
    d.line([(24, y - 4), (breite - 24, y - 4)], fill=(205, 212, 222), width=2)

    for i, z in enumerate(zeilen, 1):
        d.rectangle([24, y, breite - 24, y + zeilen_h], fill=ZEILE_A if i % 2 else ZEILE_B)
        werte = [str(i), z["name"], z["allianz"] or "–", z["level"] or "–",
                 f"X:{z['x']}  Y:{z['y']}", _mio(z["power"]), _mio(z["kills"])]
        x = 30
        for ((_, w, aus), wert) in zip(SPALTEN, werte):
            schrift = f_fett if aus == "r" and wert.endswith("Mio") and _ == "Kills" else f_zeile
            schrift = f_fett if i <= 3 else schrift
            farbe = ROT if i <= 3 else TEXT
            tb = d.textbbox((0, 0), wert, font=schrift)
            tw = tb[2] - tb[0]
            px = x + 4 if aus == "l" else (x + w - 8 - tw if aus == "r" else x + (w - tw) // 2)
            d.text((px, y + 8), wert, font=schrift, fill=farbe)
            x += w
        y += zeilen_h

    # Namensnennung — Bedingung fuer den API-Schluessel, siehe Modul-Kopf.
    d.text((30, hoehe - 40), "Powered by LW Atlas · lwatlas.com", font=f_fuss, fill=GRAU)
    hinweis = f"{len(zeilen)} Spieler"
    tb = d.textbbox((0, 0), hinweis, font=f_fuss)
    d.text((breite - 30 - (tb[2] - tb[0]), hoehe - 40), hinweis, font=f_fuss, fill=GRAU)

    ziel.parent.mkdir(parents=True, exist_ok=True)
    bild.save(ziel)
    return ziel


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--server", default="#1668")
    p.add_argument("--anzahl", type=int, default=30)
    p.add_argument("--ohne", nargs="*", default=[], help="Allianz-Kuerzel auslassen")
    p.add_argument("--ohne-spieler", nargs="*", default=[], help="einzelne Namen auslassen")
    p.add_argument("--datei", default="Pics/gegner.png")
    p.add_argument("--titel", default=None)
    a = p.parse_args()

    zeilen = holen(a.server, a.anzahl, a.ohne, a.ohne_spieler)
    titel = a.titel or f"Gefährlichste Gegner · {a.server}"
    teile = [f"nach Kills · Stand {datetime.now():%d.%m.%Y}"]
    if a.ohne:
        teile.append("ohne " + ", ".join(a.ohne))
    if a.ohne_spieler:
        teile.append(f"{len(a.ohne_spieler)} Spieler ausgenommen")
    ziel = zeichnen(zeilen, titel, " · ".join(teile), Path(a.datei))
    print(f"{len(zeilen)} Spieler → {ziel.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
