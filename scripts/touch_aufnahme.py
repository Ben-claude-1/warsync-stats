#!/usr/bin/env python3
"""Mitschnitt der Touch-Eingaben in BlueStacks — Grundlage für ein Skript.

Liest die rohen Ereignisse von „BlueStacks Virtual Touch" (/dev/input/event2)
über `adb shell getevent` mit und fasst sie zu Gesten zusammen: Tippen,
langes Drücken, Wischen, Mehrfinger (Zoomen). Zu jeder Geste gehört ein
Bildschirmfoto, aufgenommen beim Aufsetzen des Fingers — also der Zustand,
den man sieht, *bevor* das Spiel reagiert. Der Zustand danach ist das Bild
der nächsten Geste.

Koordinaten stehen in Bildschirmpixeln der 2560×2560-Auflösung, die
`scripts/bluestacks_start.sh` setzt — also genau das, was `adb shell input
tap` erwartet. Der Rohbereich 0–32767 bildet in Y auf 2560 ab, in X aber auf
das ganze 16:9-Fenster (siehe `BREITE_X`). Die Rohwerte werden daneben
mitgeschrieben.

Aufruf:  .venv/bin/python -u scripts/touch_aufnahme.py [--name bagger]
Stopp:   Ctrl-C im Fenster, oder `kill $(cat <ordner>/pid)`

Ablage:  ~/.local/state/warsync/aufnahme/<zeit>_<name>/
           gesten.jsonl   eine Zeile je Geste
           shots/         g001_vorher.png, …
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import signal
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

ADB = "/opt/homebrew/bin/adb"
DEV = "127.0.0.1:5555"
INPUT = "/dev/input/event2"
SCREEN = 2560
RAW = 32768
# Der Rohbereich deckt in X das ganze 16:9-Fenster ab (physisch 2560×1440),
# nicht nur den quadratischen Bildschirm in dessen Mitte. Gemessen am
# 11.09.2026 gegen die Kopfzeile von „Zeigerposition": Y stimmt mit 2560/32768
# aufs Pixel, X nur in der Mitte — bei x≈640 lag der naive Wert 280 px daneben.
BREITE_X = SCREEN * 2560 / 1440

TAP_MAX_PX = 30          # weiter bewegt = Wischen
LANG_MS = 600            # länger gehalten = langes Drücken

ZEILE = re.compile(r"\[\s*([\d.]+)\]\s+(?:\S+:\s+)?(\w+)\s+(\w+)\s+(\w+)")


def px(raw: int) -> int:
    return round(raw * SCREEN / RAW)


def px_x(raw: int) -> int:
    return round(SCREEN / 2 + (raw / RAW - 0.5) * BREITE_X)


class Aufnahme:
    def __init__(self, ordner: Path):
        self.ordner = ordner
        self.shots = ordner / "shots"
        self.shots.mkdir(parents=True, exist_ok=True)
        self.log = (ordner / "gesten.jsonl").open("a", buffering=1)
        self.n = 0
        self.t0_geraet: float | None = None
        self.letztes_ende: float | None = None
        self.slot = 0
        # Letzte bekannte Position je Slot. Das Eingabesystem meldet einen Wert
        # nur, wenn er sich geaendert hat: tippt man zweimal auf dieselbe Stelle,
        # kommt beim zweiten Mal keine X- (oder keine Y-)Zeile. Ohne dieses
        # Gedaechtnis fiel so eine Geste ganz aus der Aufnahme.
        self.pos: dict[int, list] = {}
        self.finger: dict[int, dict] = {}   # aktive Slots
        self.fertig: list[dict] = []        # abgehobene Finger der laufenden Geste
        self.geste: dict | None = None
        self.foto_laeuft = 0
        self.lock = threading.Lock()

    # ---- Bildschirmfoto im Hintergrund, damit kein Ereignis verloren geht
    def foto(self, pfad: Path) -> None:
        with self.lock:
            if self.foto_laeuft >= 2:
                return
            self.foto_laeuft += 1

        def lauf():
            try:
                data = subprocess.check_output(
                    [ADB, "-s", DEV, "exec-out", "screencap", "-p"], timeout=10)
                pfad.write_bytes(data)
            except Exception as e:  # noqa: BLE001
                print(f"    [Foto fehlgeschlagen: {e}]", flush=True)
            finally:
                with self.lock:
                    self.foto_laeuft -= 1

        threading.Thread(target=lauf, daemon=True).start()

    # ---- Ereignisse
    def ereignis(self, t: float, typ: str, code: str, wert: str) -> None:
        if self.t0_geraet is None:
            self.t0_geraet = t
        if typ == "EV_ABS":
            v = int(wert, 16)
            if code == "ABS_MT_SLOT":
                self.slot = v
            elif code == "ABS_MT_TRACKING_ID":
                if v == 0xFFFFFFFF:
                    f = self.finger.pop(self.slot, None)
                    if f:
                        f["t_ende"] = t
                        self.fertig.append(f)
                else:
                    self.finger[self.slot] = self.neuer_finger(t)
                    if self.geste is None:
                        self.beginn(t)
            elif code in ("ABS_MT_POSITION_X", "ABS_MT_POSITION_Y"):
                f = self.finger.get(self.slot)
                if f is None:  # Gerät ohne Tracking-ID: Finger implizit
                    f = self.finger[self.slot] = self.neuer_finger(t)
                    if self.geste is None:
                        self.beginn(t)
                achse = 0 if code.endswith("X") else 1
                if not f["pfad"] or f["pfad"][-1][3]:
                    letzte = f["pfad"][-1] if f["pfad"] else [t, None, None, False]
                    f["pfad"].append([t, letzte[1], letzte[2], False])
                f["pfad"][-1][1 + achse] = v
                self.pos.setdefault(self.slot, [None, None])[achse] = v
                f["pfad"][-1][0] = t
        elif typ == "EV_SYN" and code == "SYN_REPORT":
            for f in self.finger.values():
                if f["pfad"]:
                    f["pfad"][-1][3] = True
            if self.geste is not None and not self.finger and self.fertig:
                self.ende()
        elif typ == "EV_KEY" and code == "BTN_TOUCH" and wert == "UP":
            # Sicherheitsnetz, falls ein Gerät kein TRACKING_ID ffffffff sendet
            for s in list(self.finger):
                f = self.finger.pop(s)
                f["t_ende"] = t
                self.fertig.append(f)

    def neuer_finger(self, t: float) -> dict:
        x, y = self.pos.get(self.slot, [None, None])
        return {"t_start": t, "pfad": [[t, x, y, False]]}

    def beginn(self, t: float) -> None:
        self.n += 1
        shot = self.shots / f"g{self.n:03d}_vorher.png"
        self.geste = {"t": t, "wand": time.time(), "shot": shot}
        self.foto(shot)

    def ende(self) -> None:
        g = self.geste
        t_ende = max(f["t_ende"] for f in self.fertig)
        finger = []
        for f in self.fertig:
            p = [q for q in f["pfad"] if q[1] is not None and q[2] is not None]
            if not p:
                continue
            finger.append({
                "start": [px_x(p[0][1]), px(p[0][2])],
                "ende": [px_x(p[-1][1]), px(p[-1][2])],
                "roh_start": [p[0][1], p[0][2]],
                "roh_ende": [p[-1][1], p[-1][2]],
                "dauer_ms": round((f["t_ende"] - f["t_start"]) * 1000),
                "punkte": len(p),
                "pfad": [[round((q[0] - f["t_start"]) * 1000), px_x(q[1]), px(q[2])]
                         for q in p],
            })
        self.geste, self.fertig = None, []
        if not finger:
            return

        f0 = finger[0]
        weg = math.dist(f0["start"], f0["ende"])
        if len(finger) > 1:
            art = f"{len(finger)}-Finger"
        elif weg <= TAP_MAX_PX:
            art = "lang" if f0["dauer_ms"] >= LANG_MS else "tipp"
        else:
            art = "wisch"

        rel = g["t"] - (self.t0_geraet or g["t"])
        pause = None
        if self.letztes_ende is not None:
            pause = round((g["t"] - self.letztes_ende) * 1000)
        self.letztes_ende = t_ende

        rec = {
            "n": self.n,
            "art": art,
            "uhr": datetime.fromtimestamp(g["wand"]).strftime("%H:%M:%S.%f")[:-3],
            "t_s": round(rel, 3),
            "pause_ms": pause,
            "x": f0["start"][0], "y": f0["start"][1],
            "bis": f0["ende"] if art != "tipp" else None,
            "dauer_ms": f0["dauer_ms"],
            "weg_px": round(weg),
            "finger": finger,
            "shot": g["shot"].name,
        }
        self.log.write(json.dumps(rec, ensure_ascii=False) + "\n")

        if art == "tipp":
            text = f"TIPP   ({f0['start'][0]:4d},{f0['start'][1]:4d})"
        elif art == "lang":
            text = f"LANG   ({f0['start'][0]:4d},{f0['start'][1]:4d})"
        elif art == "wisch":
            text = (f"WISCH  ({f0['start'][0]:4d},{f0['start'][1]:4d}) → "
                    f"({f0['ende'][0]:4d},{f0['ende'][1]:4d})  {round(weg)} px")
        else:
            text = art.upper() + "  " + "  ".join(
                f"({f['start'][0]},{f['start'][1]})→({f['ende'][0]},{f['ende'][1]})"
                for f in finger)
        p = f"  +{pause / 1000:5.1f}s" if pause is not None else "        "
        print(f"#{self.n:03d} {rec['uhr']}{p}  {text}  {f0['dauer_ms']} ms", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="aufnahme")
    a = ap.parse_args()

    stamm = Path.home() / ".local/state/warsync/aufnahme"
    ordner = stamm / f"{datetime.now():%Y%m%d_%H%M%S}_{a.name}"
    ordner.mkdir(parents=True, exist_ok=True)
    (ordner / "pid").write_text(str(os.getpid()))
    (stamm / "aktuell").unlink(missing_ok=True)
    (stamm / "aktuell").symlink_to(ordner)

    subprocess.run([ADB, "connect", DEV], capture_output=True)
    groesse = subprocess.run([ADB, "-s", DEV, "shell", "wm", "size"],
                             capture_output=True, text=True).stdout
    if "2560x2560" not in groesse:
        print("WARNUNG: Auflösung ist nicht 2560×2560 — Koordinaten stimmen nicht.\n"
              "         Erst scripts/bluestacks_start.sh laufen lassen.\n" + groesse)

    rec = Aufnahme(ordner)
    print("=== Touch-Aufnahme läuft ===")
    print(f"Ablage: {ordner}")
    print("Jede Geste erscheint hier als Zeile. Beenden mit Ctrl-C.\n", flush=True)
    rec.foto(ordner / "shots" / "g000_start.png")

    proc = subprocess.Popen(
        [ADB, "-s", DEV, "shell", "getevent", "-lt", INPUT],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)

    def stopp(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stopp)

    try:
        for zeile in proc.stdout:
            m = ZEILE.search(zeile)
            if m:
                rec.ereignis(float(m.group(1)), m.group(2), m.group(3), m.group(4))
    except KeyboardInterrupt:
        pass
    finally:
        proc.terminate()
        subprocess.run([ADB, "-s", DEV, "exec-out", "screencap", "-p"],
                       stdout=(ordner / "shots" / "g999_ende.png").open("wb"))
        print(f"\nBeendet. {rec.n} Gesten aufgezeichnet → {ordner}", flush=True)
        (ordner / "pid").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
