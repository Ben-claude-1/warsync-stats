"""Bildschirmfotos — roh statt als PNG.

`screencap -p` laesst das **Geraet** das PNG kodieren, und genau das ist der
Flaschenhals: gemessen 1780 ms je Bild bei 2560x2560. Ohne `-p` liefert derselbe
Befehl den rohen Bildspeicher — 26 MB statt 4,5 MB ueber ADB, aber **523 ms**,
also mehr als dreimal so schnell. Die Uebertragung ist hier nicht das Problem,
das Kodieren ist es.

Ueber 5.000 Kacheln macht dieser eine Unterschied rund vier Stunden aus.

Kopf: vier uint32 (Breite, Hoehe, Format, Farbraum), danach RGBA. Die Kopflaenge
wird nicht angenommen, sondern aus der Gesamtlaenge gerechnet — aeltere Android-
Versionen schicken zwoelf statt sechzehn Byte.
"""
from __future__ import annotations

import subprocess

import numpy as np


def bild(g, breite: int = 2560, hoehe: int = 2560) -> np.ndarray:
    roh = subprocess.check_output(
        [g.adb, "-s", g.dev, "exec-out", "screencap"], timeout=60)
    nutz = breite * hoehe * 4
    if len(roh) < nutz:
        raise RuntimeError(f"Bildschirmfoto zu kurz: {len(roh)} statt {nutz} Byte")
    kopf = np.frombuffer(roh[:8], dtype="<u4")
    if tuple(kopf) != (breite, hoehe):
        raise RuntimeError(f"Bildschirmfoto meldet {tuple(kopf)}, erwartet "
                           f"{(breite, hoehe)} — Aufloesung geprueft?")
    return np.frombuffer(roh[len(roh) - nutz:], dtype=np.uint8) \
             .reshape(hoehe, breite, 4)[:, :, :3]
