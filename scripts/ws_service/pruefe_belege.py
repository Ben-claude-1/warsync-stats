"""Misst, ob auf dem Beweisbild wirklich der Spieler steht, fuer den es abliegt.

    .venv/bin/python -m scripts.ws_service.pruefe_belege <mitschnitt-ordner>

Ein Beleg, der die falsche Zeile zeigt, ist schlimmer als keiner — man legt ihn
jemandem vor. Geprueft wird deshalb nicht, *dass* eine Datei entstanden ist,
sondern **was darauf steht**: die Tafel wird noch einmal durch die
Texterkennung geschickt und die Heldenkraft darauf gegen die Zahl gehalten, die
der Lauf fuer diesen Spieler gelesen hat.

Die Heldenkraft ist dafuer der bessere Pruefstein als der Name. Sie steht in
derselben Zeile, sie ist der Tiebreak des Namensabgleichs — und sie ist auch
dort lesbar, wo der Name es nicht ist (`ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ`, `V ベジータ王子`).
Ein Beleg fuer die falsche Zeile traegt eine andere Kraft.

Gemessen wird ueber einen abgelegten Mitschnitt, nicht am Geraet: dieselbe
Haltung wie bei `pruefe_team_abzeichen.py` — die Bilder liegen da, eine Messung
muss dafuer nicht das Spiel abfahren.
"""
from __future__ import annotations

import collections
import difflib
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from . import belege, match, vision as v
from .device import CONFIG


def _texte(bild) -> list[dict]:
    """Alle Textstuecke eines Bildes mit Lage — macOS Vision, Japanisch zuerst."""
    from .ergebnis import SPRACHEN_NAMEN, zeilen_lesen
    try:
        return zeilen_lesen(bild, (0, 0, bild.shape[1], bild.shape[0]),
                            SPRACHEN_NAMEN)
    except Exception:
        return []


def pruefen(ordner: Path, grenze: int = 40, versatz: int = 0) -> int:
    """`versatz` verschiebt den Schnitt um so viele Pixel — die Gegenprobe.

    Eine Messung, die nur bei richtigem Ergebnis gruen wird, ist keine: sie
    koennte auch etwas anderes messen. Mit `--gegenprobe` wird der Ausschnitt um
    eine Zeilenhoehe (320 px) nach unten geschoben — dann zeigt jeder Beleg den
    **Nachbarn**, und die Messung muss rot werden. Wird sie es nicht, prueft sie
    nicht, was sie behauptet.
    """
    ordner = ordner.expanduser().resolve()
    roh = json.loads((ordner / "roh.json").read_text())
    zeilen = roh["zeilen"]
    print(f"{len(zeilen)} Rohzeilen aus {ordner.name}")

    ziel = ordner / "_pruefe_belege"
    shutil.rmtree(ziel, ignore_errors=True)
    sammler = belege.Sammler(ziel, CONFIG, kopf="Pruefung")
    for z in zeilen:
        quelle = ordner / z["bild"]
        if quelle.exists():
            y0 = z.get("y0")
            z["beleg"] = sammler.merken_aus(
                quelle, None if y0 is None else y0 + versatz, z["y"] + versatz)

    # Ohne Tool-Zugriff: die Zeilen werden nicht dem Kader zugeordnet, sondern
    # nach ihrer eigenen Kraftzahl gruppiert. Fuer diese Messung genuegt das —
    # gefragt ist, ob der Ausschnitt zur Zeile passt, nicht wem die Zeile gehoert.
    je_kraft: dict[float, list[dict]] = {}
    for z in zeilen:
        if z.get("beleg") and z.get("kraft"):
            je_kraft.setdefault(z["kraft"], []).append(z)

    auswahl = sorted(je_kraft.items(), key=lambda kv: -len(kv[1]))[:grenze]
    spieler = {f"{kraft}M": {"wert": g[0].get("platz"), "kraft": kraft,
                             "belege": match._belege(g)}
               for kraft, g in auswahl}
    # Die haeufigste Lesung des Namens je Kraftwert — sie ist das zweite
    # Merkmal unten und faengt die Faelle ab, in denen die Kraftziffer wackelt.
    namen_je_kraft = {kraft: collections.Counter(
        z.get("name_ocr", "") for z in g).most_common(1)[0][0]
        for kraft, g in auswahl}
    index = sammler.abschliessen(spieler)

    treffer = daneben = unlesbar = 0
    for name, angaben in sorted(index["spieler"].items()):
        tafel = Image.open(ziel / angaben["datei"])
        # Die Fusszeile traegt Datum und Uhrzeit — die haelt die Kraft-Erkennung
        # fuer eine Zahl. Gemessen wird deshalb nur der Bildteil darueber.
        oben = np.asarray(tafel.crop((0, 0, tafel.width,
                                      tafel.height - belege.FUSS_HOEHE)))
        # **Gemessen wird, ob die Kraft auf der Tafel steht — nicht, ob die
        # letzte gelesene Zahl sie ist.** Eine Tafel traegt mehrere Ausschnitte
        # derselben Zeile, und die Erkennung liest denselben Wert nicht jedes
        # Mal gleich (`110,1M` kam einmal als `10,1M` an). Die Frage hier ist,
        # was ein Mensch auf dem Bild sieht, und der sieht alle Ausschnitte.
        text = v.ocr(oben, psm=6)
        zahlen = {float(f"{a}.{b}") for a, b in
                  re.findall(r"(\d+)[.,](\d+)\s*M", text)}
        soll = angaben["kraft"]
        # **Zwei Merkmale, und eines genuegt.** Die Kraft ist der schaerfere
        # Pruefstein, aber ihre letzte Ziffer steht selbst auf der Kippe: bei
        # `EmpatroN` liest dieselbe Zeile mal 140,3 und mal 140,8 — eine 3, die
        # wie eine 8 aussieht. Der Beleg zeigt trotzdem seine Zeile, und der
        # Name daneben sagt das. Eine Messung, die daran scheitert, misst die
        # Ziffernerkennung und nicht den Ausschnitt.
        # Der Name wird mit **derselben** Erkennung gelesen wie im Lauf (macOS
        # Vision, Japanisch zuerst) und nicht mit Tesseract ueber den ganzen
        # Streifen. Letzteres ist an `NuSReT` gescheitert: psm 6 ueber die volle
        # Zeilenbreite wirft Bild, Balken und Schrift zusammen und lieferte
        # `8 vs ”= Gesarptkampfkraft …` — die Messung mass dort ihre eigene
        # Ablesung, nicht den Ausschnitt.
        name_soll = match.norm(namen_je_kraft.get(soll, ""))
        name_da = bool(name_soll) and any(
            difflib.SequenceMatcher(None, name_soll, match.norm(t["t"])).ratio() >= 0.62
            for t in _texte(np.asarray(tafel)))
        if not zahlen and not name_da:
            unlesbar += 1
            zeichen = "?"
        elif any(abs(z - soll) < 0.05 for z in zahlen) or name_da:
            treffer += 1
            zeichen = "+"
        else:
            daneben += 1
            zeichen = "!"
        print(f"  {zeichen} {name:>10s}  Beleg zeigt {sorted(zahlen)}"
              f"{' · Name passt' if name_da else ''}  "
              f"({angaben['ausschnitte']} Ausschnitte)")

    gesamt = treffer + daneben + unlesbar
    print(f"\nBeleg zeigt die richtige Zeile: {treffer}/{gesamt} · "
          f"falsche Zeile: {daneben} · Kraft nicht lesbar: {unlesbar}")

    # Eine fehlende Zelle darf keine Zeile verschieben — dieselbe Regel wie beim
    # Markenraster in der Anmeldeliste: was fehlt, muss als Luecke sichtbar sein
    # und nicht als Nachruecken der naechsten Angabe.
    ohne = [n for n, a in index["spieler"].items() if not a["ausschnitte"]]
    if ohne:
        print(f"WARNUNG: {len(ohne)} Eintraege ohne Ausschnitt in der Tafel")

    # Dateinamen: was ein Dateisystem nicht tragen kann, muss ersetzt sein —
    # und der Rest muss stehenbleiben, sonst findet man die Datei nicht wieder.
    proben = ["ʚɞ ASTRID ʚɞ", "H A N A N", "A/B", "ΧΑΣΑΠΗΣ", "Ben_the_men"]
    print("\nDateinamen:")
    for p in proben:
        print(f"  {p!r} → {belege.dateiname(p)!r}")

    shutil.rmtree(ziel, ignore_errors=True)
    if versatz:
        # Umgekehrte Erwartung: verschoben **muss** es danebengehen.
        print(f"\nGegenprobe (Schnitt um {versatz} px verschoben): "
              f"{'BESTANDEN — die Messung merkt den falschen Ausschnitt' if daneben else 'FEHLGESCHLAGEN — sie merkt ihn nicht'}")
        return 0 if daneben else 1
    return 0 if daneben == 0 and treffer > 0 else 1


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    gegenprobe = "--gegenprobe" in argv
    argv = [a for a in argv if not a.startswith("--")]
    if not argv:
        print(__doc__.splitlines()[2].strip())
        return 1
    return pruefen(Path(argv[0]), versatz=320 if gegenprobe else 0)


if __name__ == "__main__":
    sys.exit(main())
