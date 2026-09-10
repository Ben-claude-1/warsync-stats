"""Die Namenserkennung gegen eine von Hand abgelesene Wahrheit.

    .venv/bin/python -m scripts.karten_archiv.pruefe_namen
    .venv/bin/python -m scripts.karten_archiv.pruefe_namen --zeigen   # Fehlschlaege als Bild

Ohne Geraet: gemessen wird an 24 Bannern aus dem Archiv `karte_nah`, die am
08.09.2026 am Bildschirm abgelesen wurden. Das ist die einzige Wahrheit, die
nicht aus der Erkennung selbst stammt — `pruefe_banner.py` misst, *ob* ein Banner
gefunden wird, dieses Skript misst, *was* darauf steht.

**Die Stichprobe ist gezogen, nicht ausgesucht.** Sie stammt aus einer festen
Zufallsauswahl ueber das ganze Archiv (`random.seed(7)`), damit sie den Bestand
abbildet und nicht die Faelle, die gerade gut aussehen. Deshalb stehen vier
Schilder darin, die **keine Basis** sind: das Allianz-Banner `[KURL] Kein Plan
Allianz`, zwei Beschriftungen von Bergbaustuetzpunkten und ein Gebaeudeschild.
Sie gehoeren dazu — der Finder liefert sie, und die Erkennung muss sie aussortieren
statt sie als Spieler in die Tabelle zu schreiben.

**Der Nummernschild-Test ist der eigentliche Punkt.** 19 der 20 Basen tragen
*kein* Allianz-Kuerzel; sie stehen am Kartenrand, wo die Neulinge siedeln. Genau
dort zerbrach die alte `zerlegen()`: sie durfte die oeffnende Klammer weglassen
und nahm die Ziffer `1` als schliessende, weshalb aus `Conand1990` die Allianz
`ONAND` mit dem Namen `990` wurde. Diese Faelle sind hier in der Mehrheit.

Stand an derselben Stichprobe, gemessen am 08.09.2026:

| | vorher | jetzt |
|---|---|---|
| Name genau richtig | 0 / 20 | 19 / 20 |
| Name brauchbar (>= 0.75) | 6 / 20 | 19 / 20 |
| Stufe gelesen | 0 / 21 (gar nicht) | 19 / 21, keine falsche |
| erfundene Allianz-Kuerzel | 2 | 0 |

Der erste Sprung (0 -> 12) kam nicht von besserer OCR, sondern davon, **was**
ihr vorgelegt wird: vorher der von `_kasten` ausgemessene Balken, hart
geschwellt — ein Mass, das fuer die dunkle Leiste der Allianzschilder gedacht
ist und den freistehenden Spielernamen mitten durchschnitt. Danach die
freigestellte Schrift aus einem grosszuegigen Ausschnitt (`_schriftmaske`).

Der zweite (12 -> 16, bei der eigenen Allianz 10 -> 15) kam dann doch von der
OCR: gelesen wird seit dem 09.09.2026 mit der Texterkennung von macOS
(`vision_ocr.swift`), und zwar auf dem **farbigen** Ausschnitt statt auf der
Maske. Die Maske sagt weiterhin, wo das Band liegt und welche Farbe die Schrift
hat; Tesseract bleibt der Rueckfall, wo es Vision nicht gibt.
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from PIL import Image, ImageDraw

from scripts.karten_archiv import banner
from scripts.karten_archiv.archiv import WURZEL

ARCHIV = "karte_nah"

# (Kachel, cx, cy, Name, Stufe, Allianz) — am Bildschirm abgelesen.
# Name None = kein Spielerschild (Allianz-Banner, Gebaeude); die Erkennung soll
# es verwerfen. Stufe None = kein Stufenschild vorhanden.
WAHRHEIT = [
    ("z015_k0005", 1550, 544, "Jill team", 28, None),
    ("z015_k0005", 358, 344, "Conand1990", 18, None),
    ("z015_k0005", 357, 1372, "Andrea Belli", 16, None),
    ("z001_k0090", 140, 1058, "ConnorMcLoud", 30, None),
    ("z001_k0090", 834, 456, "Vydrysek", 20, None),
    ("z001_k0090", 1281, 236, "Sgt titouf", 17, None),
    ("z002_k0081", 64, 458, "MiniElyvoid", 30, None),
    ("z003_k0062", 349, 854, "Kommandant199bd1668", 26, None),
    ("z013_k0101", 176, 344, "Commander 263611668", 16, None),
    ("z002_k0022", 480, 756, "MgChk", 23, None),
    ("z001_k0046", 451, 1036, "Gilette385", 17, None),
    ("z003_k0029", 616, 628, "izrick", 33, None),
    ("z017_k0094", 1574, 1474, "Commander 1e68d1668", 15, None),
    ("z017_k0094", 307, 1592, "SeuronSp", 16, None),
    ("z002_k0071", 815, 138, "IsoldeWygsen", 20, None),
    ("z009_k0019", 642, 140, None, None, None),          # [KURL] Kein Plan Allianz
    ("z009_k0019", 912, 742, "Kommandant18ac01657", 3, None),
    ("z009_k0019", 64, 1156, "Comandante 273db1657", 5, None),   # links angeschnitten
    ("z009_k0019", 570, 204, None, None, None),          # #1668 Bergbaustuetzpunkt
    ("z003_k0048", 1195, 842, "Commander 1c6a31657", 12, None),
    ("z002_k0027", 1578, 768, None, None, None),         # Gebaeudeschild "Bergba..."
    ("z004_k0076", 1096, 554, "Mahmoudsalmaeh", 29, "JO09"),
    ("z004_k0076", 1337, 1482, "Vggdsdssdd", 15, None),
    ("z002_k0038", 316, 358, "Kommandant1ceaa1668", 5, None),
]

# Nr. 17 laeuft am linken Kachelrand aus dem Bild; im Nachbarbild steht sie ganz.
# Sie zaehlt beim Verwerfen und bei der Stufe mit, aber nicht beim Namen.
ANGESCHNITTEN = {17}

# --- Zweite Stichprobe: die eigene Allianz ------------------------------------
#
# Die Wahrheit oben stammt vom Kartenrand und besteht ausschliesslich aus
# *weissen* Namen. Sie konnte den schwersten Fehler dieser Erkennung deshalb gar
# nicht sehen: Last War zeichnet die Namen der **eigenen** Allianzmitglieder
# hellblau (S um 96), und die alte Maske `S < 70` liess davon fast nichts durch.
# In der Kachel unten war vorher **kein einziger** Name zu gebrauchen — aus
# `[XP33]S a p p h y` wurde `z£Ts`. Aufgefallen ist es Ben, nicht der Pruefung.
#
# Alle 18 stammen aus einer Kachel im XP33-Gebiet, am 09.09.2026 am Bildschirm
# abgelesen. Sie decken zugleich zwei Dinge ab, die es am Rand nicht gibt:
# gesperrt geschriebene Namen (`S a p p h y`) und die Zierrahmen der
# ausgebauten Basen.
ARCHIV_BLAU = "karte_kern"
WAHRHEIT_BLAU = [
    ("z011_k0003", 511, 555, "Ghost Fighter X", 33, "XP33"),
    ("z011_k0003", 1294, 555, "ARCHĀNGEL", 33, "XP33"),
    ("z011_k0003", 468, 855, "LittleFighter", 34, "XP33"),
    ("z011_k0003", 884, 555, "Stalker24601", 33, "XP33"),
    ("z011_k0003", 97, 844, "Tony mont ana", 33, "XP33"),      # links angeschnitten
    ("z011_k0003", 127, 555, "RSPDMint2728", 33, "XP33"),
    ("z011_k0003", 1326, 844, "ayanakamura1", 33, "XP33"),
    ("z011_k0003", 1350, 1169, "SyDdu38", 33, "XP33"),
    ("z011_k0003", 899, 264, "lKaizerl", 33, "XP33"),
    ("z011_k0003", 120, 263, "S a p p h y", 35, "XP33"),
    ("z011_k0003", 995, 1170, "KlaMaVo", 33, "XP33"),
    ("z011_k0003", 919, 1494, "cirdecs", 34, "XP33"),
    ("z011_k0003", 80, 1154, "MasterFreestyle", 34, "XP33"),   # links angeschnitten
    ("z011_k0003", 494, 1169, "Longrow", 34, "XP33"),
    ("z011_k0003", 104, 1495, "Zenrath", 34, "XP33"),
    ("z011_k0003", 892, 856, "Mo By", 34, "XP33"),
    ("z011_k0003", 575, 265, "LittleAnt", 34, "XP33"),
    ("z011_k0003", 397, 1490, "marjo42", 33, "XP33"),
]
ANGESCHNITTEN_BLAU = {4, 12}

# --- Dritte Stichprobe: die Farben, die keine der beiden ersten enthaelt ------
#
# Auch die zweite Stichprobe hatte einen blinden Fleck, und er kostete
# ausgerechnet **Bens eigene Basis**: sie steht gelbgruen auf der Karte, nicht
# weiss und nicht hellblau. Die feste Saettigungsgrenze liess davon nichts
# durch, gelesen wurde `zr`, und weil ein Fund ohne Namen damals ganz
# herausflog, fehlte die Basis in der Tabelle vollstaendig — mit richtiger
# Koordinate und richtig gelesener Stufe 33 daneben. Aufgefallen ist es wieder
# Ben, nicht der Pruefung: sie enthielt den Fall nicht.
#
# `Puwe` steht daneben, weil dort dieselbe Maske an etwas anderem scheiterte:
# hellblaue Schrift in einem hellen Goldrahmen. Beide zusammen sind die
# Begruendung dafuer, dass die Schriftfarbe im Band **gemessen** wird
# (`_schriftfarbe`) statt in einer Konstante zu stehen.
#
# Der dritte Eintrag steht wegen seiner **Stufe** hier, nicht wegen des Namens:
# bei ihm lasen die vier Ziffernmodi `36`, `34`, `34`, `36`, und `_stufe` nahm
# den ersten — also den falschen. Sein Name ist griechisch (`ΧΑΣΑΠΗΣ`) und mit
# dem lateinischen Zeichensatz nicht zu lesen; er zaehlt deshalb bei der Stufe
# mit und beim Namen nicht (`ANGESCHNITTEN_EIGEN` ist der vorhandene Weg dafuer).
ARCHIV_EIGEN = "karte_kern"
WAHRHEIT_EIGEN = [
    ("z010_k0004", 926, 551, "Ben the men", 33, "XP33"),   # gelbgruen
    ("z010_k0002", 1096, 856, "Puwe", 33, "XP33"),         # blau im Goldrahmen
    ("z010_k0001", 1420, 263, "ΧΑΣΑΠΗΣ", 34, "XP33"),      # Ziffernmodi uneinig
]
ANGESCHNITTEN_EIGEN = {2}


def _cfg(archiv: str = ARCHIV) -> dict:
    man = json.loads((WURZEL / archiv / "manifest.json").read_text())
    return dict(man["modell"], karte=man["zuschnitt"])


def _aehnlich(a: str, b: str) -> float:
    import difflib

    from scripts.ws_service.match import norm
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def _durchgang(titel: str, archiv: str, wahrheit: list,
               angeschnitten: set) -> tuple[int, int, int]:
    cfg = _cfg(archiv)
    genau = fast = stufe_ok = verworfen_ok = 0
    zu_pruefen = tote = 0
    schlecht = []

    for i, (stem, cx, cy, soll, soll_stufe, soll_tag) in enumerate(wahrheit):
        im = Image.open(WURZEL / archiv / "kacheln" / f"{stem}.png").convert("RGB")
        erg = banner.schild_lesen(im, cx, cy, cfg)
        ist, ist_stufe, ist_tag = erg["name"], erg["level"], erg["allianz"]

        if soll is None:
            tote += 1
            if not ist:
                verworfen_ok += 1
            else:
                schlecht.append((i, stem, cx, cy, "(kein Spieler)", ist))
            continue

        zu_pruefen += 1
        if ist_stufe == soll_stufe:
            stufe_ok += 1
        if i in angeschnitten:
            continue
        s = _aehnlich(ist or "", soll)
        if s >= 0.999:
            genau += 1
            fast += 1
        elif s >= 0.75:
            fast += 1
            schlecht.append((i, stem, cx, cy, soll, f"{ist!r} ({s:.2f})"))
        else:
            schlecht.append((i, stem, cx, cy, soll, f"{ist!r} ({s:.2f})"))
        if soll_tag and ist_tag != soll_tag:
            schlecht.append((i, stem, cx, cy, f"Allianz {soll_tag}", f"{ist_tag!r}"))
        if not soll_tag and ist_tag:
            schlecht.append((i, stem, cx, cy, "keine Allianz", f"{ist_tag!r}"))

    voll = zu_pruefen - len(angeschnitten)
    print(f"── {titel}")
    print(f"Namen genau richtig : {genau:2d} / {voll}")
    print(f"Namen brauchbar     : {fast:2d} / {voll}  (Aehnlichkeit >= 0.75)")
    print(f"Stufe richtig       : {stufe_ok:2d} / {zu_pruefen}")
    if tote:
        print(f"Nicht-Spieler weg   : {verworfen_ok:2d} / {tote}")
    if schlecht:
        print("Abweichungen:")
        for i, stem, cx, cy, soll, ist in schlecht:
            print(f"  {i:2d} {stem} {cx},{cy}  soll {soll!r}  ist {ist}")
    print()
    return genau, fast, stufe_ok


def pruefen(zeigen: bool = False) -> tuple[int, int, int]:
    """Alle drei Stichproben. Zurueck kommt, wie viele Namen je Satz genau stimmen."""
    rand = _durchgang("Kartenrand, weisse Namen", ARCHIV, WAHRHEIT, ANGESCHNITTEN)
    blau = _durchgang("Eigene Allianz, blaue Namen", ARCHIV_BLAU,
                      WAHRHEIT_BLAU, ANGESCHNITTEN_BLAU)
    eigen = _durchgang("Gelbgruen, Goldrahmen, uneinige Ziffern", ARCHIV_EIGEN,
                       WAHRHEIT_EIGEN, ANGESCHNITTEN_EIGEN)
    if zeigen:
        _bild(_cfg())
    return rand[0], blau[0], eigen[0]


def _bild(cfg: dict) -> None:
    bb, bh = cfg["banner_breite"], cfg["banner_hoehe"]
    teile = []
    for i, (stem, cx, cy, soll, *_r) in enumerate(WAHRHEIT):
        im = Image.open(WURZEL / ARCHIV / "kacheln" / f"{stem}.png").convert("RGB")
        c = im.crop((int(cx - bb * 0.62), int(cy - bh * 0.85),
                     int(cx + bb * 0.62), int(cy + bh * 1.6)))
        d = ImageDraw.Draw(c)
        d.text((4, 4), f"{i} {soll}", fill=(255, 0, 255))
        teile.append(c)
    breite = max(t.width for t in teile)
    can = Image.new("RGB", (breite, sum(t.height for t in teile)), (15, 15, 15))
    y = 0
    for t in teile:
        can.paste(t, (0, y))
        y += t.height
    ziel = WURZEL / ARCHIV / "namen_pruefung.png"
    can.save(ziel)
    print(f"\nBild: {ziel}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--zeigen", action="store_true")
    p.add_argument("--rand", type=int, default=19,
                   help="so viele der 19 weissen Namen muessen genau stimmen")
    p.add_argument("--blau", type=int, default=15,
                   help="so viele der 16 blauen Namen muessen genau stimmen "
                        "(beides der gemessene Stand, nicht ein Wunsch)")
    p.add_argument("--eigen", type=int, default=2,
                   help="beide lesbaren Namen der dritten Stichprobe — gelbgruen "
                        "und Goldrahmen; hier gilt kein Abschlag, sie waren der "
                        "Anlass. Der griechische Name zaehlt nur bei der Stufe.")
    a = p.parse_args()
    for archiv in (ARCHIV, ARCHIV_BLAU, ARCHIV_EIGEN):
        if not (WURZEL / archiv / "manifest.json").exists():
            print(f"Archiv {archiv} fehlt.")
            return 2
    rand, blau, eigen = pruefen(a.zeigen)
    fehler = []
    if rand < a.rand:
        fehler.append(f"Kartenrand {rand} < {a.rand}")
    if blau < a.blau:
        fehler.append(f"eigene Allianz {blau} < {a.blau}")
    if eigen < a.eigen:
        fehler.append(f"gelbgruen/Goldrahmen {eigen} < {a.eigen}")
    if fehler:
        print("ZU WENIG: " + ", ".join(fehler))
        return 1
    print("In Ordnung.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
