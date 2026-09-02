"""ADB-Zugriff auf die BlueStacks-Instanz.

Die Teilnehmerliste wird **nicht** gewischt, sondern per Mausrad-Geste
gescrollt (`rad_schritt`) — ein Wisch (`input swipe`, egal ob langsam oder
schnell) blieb an dieser Liste regelmaessig haengen. Details und Messwerte
stehen am `rad_schritt`-Docstring.
"""
from __future__ import annotations

import io
import json
import subprocess
import time
from pathlib import Path

import numpy as np
from PIL import Image

CONFIG = json.loads((Path(__file__).resolve().parent / "config.json").read_text())
REPO = Path(__file__).resolve().parents[2]


class GeraetFehler(RuntimeError):
    pass


class Geraet:
    def __init__(self, cfg: dict | None = None):
        self.cfg = cfg or CONFIG
        self.adb = self.cfg["adb"]
        self.dev = self.cfg["device"]

    # ── Verbindung ────────────────────────────────────────────────────────
    def _sh(self, *args: str, timeout: int = 30) -> str:
        p = subprocess.run([self.adb, "-s", self.dev, *args],
                           capture_output=True, timeout=timeout)
        return p.stdout.decode("utf8", "replace")

    def verbunden(self) -> bool:
        p = subprocess.run([self.adb, "-s", self.dev, "shell", "true"],
                           capture_output=True, timeout=15)
        return p.returncode == 0

    def starten(self, log=print) -> None:
        """BlueStacks hochfahren, falls noetig — ueber das vorhandene Startskript.

        Das Skript setzt auch `wm size` auf 2560x2560. Der Override ueberlebt
        keinen Neustart der Instanz, deshalb laeuft er dort bei jedem Start neu;
        alle Koordinaten in config.json haengen daran.
        """
        if self.verbunden():
            log("BlueStacks laeuft, ADB verbunden.")
        else:
            log("Starte BlueStacks ...")
            subprocess.run(["bash", str(REPO / "scripts" / "bluestacks_start.sh")],
                           check=True, timeout=300)
        w, h = self.aufloesung()
        soll_w, soll_h = self.cfg["screen"]
        if (w, h) != (soll_w, soll_h):
            raise GeraetFehler(
                f"Aufloesung ist {w}x{h}, erwartet {soll_w}x{soll_h}. "
                f"Erst 'scripts/bluestacks_start.sh' laufen lassen — sonst zeigen "
                f"alle Koordinaten in config.json ins Leere.")

    def aufloesung(self) -> tuple[int, int]:
        out = self._sh("shell", "wm", "size")
        zeile = [l for l in out.splitlines() if "size:" in l][-1]
        w, h = zeile.split(":")[-1].strip().split("x")
        return int(w), int(h)

    def app_laeuft(self) -> bool:
        return bool(self._sh("shell", "ps", "-A").find(self.cfg["package"]) >= 0)

    def app_starten(self, log=print) -> None:
        if self.app_laeuft():
            return
        log("Last War laeuft nicht — starte es ...")
        self._sh("shell", "monkey", "-p", self.cfg["package"],
                 "-c", "android.intent.category.LAUNCHER", "1")
        time.sleep(25)

    # ── Eingabe ───────────────────────────────────────────────────────────
    def tippen(self, x: int, y: int, pause: float = 1.2) -> None:
        self._sh("shell", "input", "tap", str(int(x)), str(int(y)))
        time.sleep(pause)

    def zurueck(self, pause: float = 1.5) -> None:
        self._sh("shell", "input", "keyevent", "KEYCODE_BACK")
        time.sleep(pause)

    def wischen(self, x: int, y1: int, y2: int, dauer_ms: int,
                pause_vor: float = 0.0, pause_nach: float = 1.0) -> None:
        if pause_vor:
            time.sleep(pause_vor)
        self._sh("shell", "input", "swipe",
                 str(int(x)), str(int(y1)), str(int(x)), str(int(y2)), str(int(dauer_ms)),
                 timeout=int(dauer_ms / 1000) + 20)
        time.sleep(pause_nach)

    # Ereigniscodes des Linux-Eingabesystems, wie `getevent -l` sie benennt.
    _EV_SYN, _EV_KEY, _EV_ABS = 0, 1, 3
    _SYN_REPORT = 0
    _BTN_TOUCH = 0x14A
    _ABS_MT_POSITION_X, _ABS_MT_POSITION_Y, _ABS_MT_TRACKING_ID = 0x35, 0x36, 0x39

    def rad_schritt(self, rueckwaerts: bool = False, variante: int = 0) -> None:
        """Eine Mausrad-Rastung, nachgebaut aus rohen Touch-Ereignissen.

        **Warum nicht `input swipe`.** Der Dienst hat lange gewischt, und die
        Liste nahm die Geste unregelmaessig nicht an: am 02.09.2026 endeten vier
        Laeufe mitten im Kader, bei 89, 112, 131 und erneut 116 Mio Heldenkraft.
        Weder langsamer (2000 ms) noch schneller (185 ms, die Geste der S-Taste)
        half zuverlaessig.

        Das Mausrad haengt dagegen nie — und ein Mitschnitt von `getevent`
        zeigt, warum es etwas anderes ist als ein Wisch: BlueStacks erzeugt je
        Rastung eine Beruehrung mit **zwoelf gleichmaessigen Y-Schritten von je
        41 px** ueber 234 ms, zusammen 492 px. Kein Anfassen und Ziehen, sondern
        ein getakteter Stapel kleiner Bewegungen. Genau das laesst sich mit
        `sendevent` nachbilden, mit `input swipe` nicht.

        Gemessen ueber zehn Rastungen: Median 520 px, hoechstens 557 px, **kein
        einziger Stillstand**. Die Fensterhoehe von 850 px wird dabei nie
        erreicht — es kann also keine Zeile durchfallen. Wer die Werte aendert,
        muss beides nachmessen: dass es sich immer bewegt und dass die Bewegung
        unter der Fensterhoehe bleibt.

        Der Takt zwischen den Punkten ist noetig. Ohne ihn feuern die Ereignisse
        so schnell, wie ADB sie durchreicht; die Strecke schwankte dann zwischen
        210 und 546 px und zweimal von acht bewegte sich nichts.
        """
        # Ab dem dritten Fehlversuch erst eine laengere Ruhepause, dann ein Wisch
        # statt eines weiteren Rad-Nachbaus. Am 02.09.2026 blieb die Liste an
        # zwei verschiedenen Stellen mehrfach ganze fuenf Versuche lang stehen
        # — bei jeder Geste, jeder Spalte, sogar beim Wechsel auf den Wisch.
        # Das spricht nicht fuer eine falsche Geste, sondern dafuer, dass Last
        # War beim Scrollen in unbekanntes Listenterrain kurz selbst blockiert
        # (vermutlich laedt es Mitgliederdaten nach). Dagegen hilft nur Zeit,
        # keine ausgefeiltere Nachbildung — die Pause waechst deshalb mit jedem
        # weiteren Versuch statt konstant zu bleiben.
        if variante >= 3:
            time.sleep(1.5 * (variante - 2))
            s = self.cfg["rad"]
            self.wischen(s["x"], s["y"], s["y"] - (400 if not rueckwaerts else -400),
                        900, pause_vor=0, pause_nach=0)
            return

        r = self.cfg["rad"]
        faktor = 32768 / self.cfg["screen"][1]
        x = int(r["x"] * faktor)
        y = int(r["y"] * faktor)
        # Bleibt die Liste stehen, wird die naechste Rastung etwas breiter und
        # in einer anderen Spalte angesetzt.
        weite = r["weite_px"] + 60 * variante
        x += int((80 * variante if variante % 2 else -80 * variante) * faktor)
        schritt = int(weite * faktor / r["punkte"])
        if rueckwaerts:
            schritt = -schritt

        d = "/dev/input/event2"
        def ev(typ, code, wert):
            return f"sendevent {d} {typ} {code} {wert}"
        teile = [ev(self._EV_ABS, self._ABS_MT_TRACKING_ID, 0),
                 ev(self._EV_ABS, self._ABS_MT_POSITION_X, x),
                 ev(self._EV_ABS, self._ABS_MT_POSITION_Y, y),
                 ev(self._EV_KEY, self._BTN_TOUCH, 1),
                 ev(self._EV_SYN, self._SYN_REPORT, 0)]
        for _ in range(r["punkte"]):
            y -= schritt
            teile += [f"sleep {r['takt_s']}",
                      ev(self._EV_ABS, self._ABS_MT_POSITION_Y, y),
                      ev(self._EV_SYN, self._SYN_REPORT, 0)]
        teile += [ev(self._EV_ABS, self._ABS_MT_TRACKING_ID, -1),
                  ev(self._EV_KEY, self._BTN_TOUCH, 0),
                  ev(self._EV_SYN, self._SYN_REPORT, 0)]
        self._sh("shell", ";".join(teile), timeout=60)
        time.sleep(r["pause_nach_s"] + 0.3 * variante)

    def liste_weiter(self, rueckwaerts: bool = False, variante: int = 0) -> None:
        """Ein Schritt in der Teilnehmerliste."""
        self.rad_schritt(rueckwaerts=rueckwaerts, variante=variante)

    # ── Bild ──────────────────────────────────────────────────────────────
    def bild(self) -> np.ndarray:
        roh = subprocess.check_output([self.adb, "-s", self.dev, "exec-out",
                                       "screencap", "-p"], timeout=60)
        return np.array(Image.open(io.BytesIO(roh)).convert("RGB"))
