#!/usr/bin/env python3
"""Bildmitschnitt aus BlueStacks — läuft neben `touch_aufnahme.py`.

`touch_aufnahme.py` macht nur beim Aufsetzen des Fingers ein Foto. Wer durch
eine Liste scrollt, will aber auch sehen, was *zwischen* den Gesten stand.
Dieses Skript tippt und wischt nichts: es holt im Takt `screencap` und legt
jedes Bild ab, das sich gegen das vorige sichtbar geändert hat.

Aufruf:  .venv/bin/python -u scripts/bild_aufnahme.py --ordner <aufnahme-ordner>
Stopp:   Ctrl-C

Ablage:  <ordner>/bilder/b0000.png …   nur geänderte Bilder
         <ordner>/bilder.jsonl         je Bild: Nummer, Zeitstempel (epoch + Uhr)
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

ADB = "/opt/homebrew/bin/adb"
DEV = "127.0.0.1:5555"
# Mittlere Abweichung (0–255) auf dem verkleinerten Graubild, ab der ein Bild
# als „geändert" gilt. Laufende Uhren und Funkeln im Spiel liegen darunter.
SCHWELLE = 1.5


def foto() -> tuple[bytes, np.ndarray]:
    roh = subprocess.run([ADB, "-s", DEV, "exec-out", "screencap", "-p"],
                         capture_output=True, timeout=15, check=True).stdout
    klein = Image.open(io.BytesIO(roh)).convert("L").resize((256, 256))
    return roh, np.asarray(klein, dtype=np.float32)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--ordner", required=True)
    p.add_argument("--takt", type=float, default=1.0)
    a = p.parse_args()
    ziel = Path(a.ordner) / "bilder"
    ziel.mkdir(parents=True, exist_ok=True)
    log = (Path(a.ordner) / "bilder.jsonl").open("a", buffering=1)
    letztes, n = None, 0
    print(f"Bildmitschnitt nach {ziel} — Ctrl-C beendet.", flush=True)
    try:
        while True:
            t0 = time.time()
            try:
                roh, klein = foto()
            except Exception as e:                       # noqa: BLE001
                print(f"Bild fehlgeschlagen: {e}", flush=True)
                time.sleep(1.0)
                continue
            if letztes is None or float(np.abs(klein - letztes).mean()) > SCHWELLE:
                (ziel / f"b{n:04d}.png").write_bytes(roh)
                log.write(json.dumps({"n": n, "t": round(t0, 3),
                                      "uhr": datetime.now().strftime("%H:%M:%S")}) + "\n")
                print(f"#{n:04d} {datetime.now():%H:%M:%S}", flush=True)
                letztes, n = klein, n + 1
            time.sleep(max(0.0, a.takt - (time.time() - t0)))
    except KeyboardInterrupt:
        pass
    print(f"Beendet. {n} Bilder.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
