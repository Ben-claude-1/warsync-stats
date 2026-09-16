"""Die Teilnehmerliste mitschreiben, waehrend ein Mensch sie scrollt.

Der Dienst (`run.py`) scrollt selbst und bleibt dabei regelmaessig haengen —
in der Nacht zum 16.09.2026 wurden sechs Erklaerungen durchgemessen und alle
widerlegt; die Trennung ist sauber: Laeufe mit Bens Hand kamen auf 52–63
zugeordnete Zeilen, Laeufe ohne auf 15–36. Solange das offen ist, braucht es
einen Weg, die Liste **ohne** eine einzige Geste des Rechners zu erfassen.

Dieses Modul tippt und wischt deshalb nicht. Es macht ausschliesslich
Bildschirmfotos (`screencap` liest nur) und legt jedes Bild ab, in dem sich
etwas geaendert hat. Gescrollt wird von Hand. Ausgewertet wird hinterher aus
den abgelegten Bildern — dieselbe Haltung wie beim Kartenarchiv und bei den
Kampfergebnissen: erst das Material sichern, dann beliebig oft darueber lesen.

    .venv/bin/python -u -m scripts.ws_service.mitschreiben --name lauf9
    .venv/bin/python -m scripts.ws_service.mitschreiben --auswerten <ordner>

Die BlueStacks-Sperre wird trotzdem geholt: laeuft nebenher ein Scan, scrollen
zwei gegeneinander und der Mitschnitt zeigt einen Zustand, den niemand
hergestellt hat.

Ablage: ~/.local/state/warsync/ws_mitschrift/<zeit>_<name>/
          bild_000.png …   nur Bilder, in denen sich etwas geaendert hat
          verlauf.jsonl    je Bild: Uhrzeit, gemessener Versatz, Zeitkoepfe
          meta.json        Zaehler ueber der Liste, Start- und Endzeit
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image
import io

from . import navigate, roster
from .device import Geraet, GeraetFehler

MITSCHRIFT = Path.home() / ".local" / "state" / "warsync" / "ws_mitschrift"


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _foto(g: Geraet) -> tuple[bytes, np.ndarray]:
    """Rohes PNG **und** Bildmatrix in einem Zug.

    Das Bild kommt vom Geraet bereits als PNG. Es zum Ablegen neu zu kodieren
    kostet knapp eine Sekunde je Bild — bei einem Mitschnitt, der Schritt
    halten muss, ist das der Unterschied zwischen luecklos und nicht.
    """
    roh = subprocess.check_output(
        [g.adb, "-s", g.dev, "exec-out", "screencap", "-p"], timeout=60)
    return roh, np.array(Image.open(io.BytesIO(roh)).convert("RGB"))


def mitschreiben(g: Geraet, name: str, takt: float) -> int:
    ordner = MITSCHRIFT / f"{datetime.now():%Y%m%d_%H%M%S}_{name}"
    ordner.mkdir(parents=True, exist_ok=True)
    (MITSCHRIFT / "aktuell").unlink(missing_ok=True)
    (MITSCHRIFT / "aktuell").symlink_to(ordner)
    verlauf = (ordner / "verlauf.jsonl").open("a", buffering=1)

    w, h = g.aufloesung()
    soll_w, soll_h = g.cfg["screen"]
    if (w, h) != (soll_w, soll_h):
        raise GeraetFehler(
            f"Aufloesung ist {w}x{h}, erwartet {soll_w}x{soll_h}. "
            f"Erst 'scripts/bluestacks_start.sh' laufen lassen.")

    _, bild = _foto(g)
    offen = navigate.liste_offen(g, bild)
    zaehler = roster.dialog_zaehler(g, bild) if offen else {}
    _log(f"Ablage: {ordner}")
    _log(f"Teilnehmerliste offen: {offen}")
    if zaehler:
        _log(f"Laut Spiel: {zaehler.get('gesetzt')}/{zaehler.get('gesetzt_max')} gesetzt, "
             f"{zaehler.get('ersatz')}/{zaehler.get('ersatz_max')} Ersatz")
    elif not offen:
        _log("WARNUNG: Es sind keine Rang-Balken zu sehen — steht die Liste offen?")

    _, view_oben, _, view_unten = g.cfg["list_view"]
    fenster = view_unten - view_oben

    (ordner / "meta.json").write_text(json.dumps({
        "start": datetime.now().isoformat(timespec="seconds"),
        "zaehler": zaehler, "liste_offen": offen,
        "allianz": g.cfg["alliance_tag"], "fenster_px": fenster,
    }, ensure_ascii=False, indent=1))

    print()
    _log("Mitschnitt laeuft — jetzt von Hand durch die Liste scrollen.")
    _log("Beenden mit Ctrl-C. Der Rechner tippt und wischt nichts.")
    print()

    n = 0
    letztes = None
    letzte_sig = None
    gesamt_px = 0
    zu_schnell = 0
    try:
        while True:
            t0 = time.time()
            try:
                roh, bild = _foto(g)
            except Exception as e:                       # noqa: BLE001
                _log(f"Bild fehlgeschlagen: {e}")
                time.sleep(1.0)
                continue

            sig = roster._signatur(g, bild)
            steht = roster._steht(sig, letzte_sig)
            letzte_sig = sig
            if steht and letztes is not None:
                time.sleep(max(0.0, takt - (time.time() - t0)))
                continue

            px = roster._versatz(g, letztes, bild) if letztes is not None else None
            letztes = bild
            (ordner / f"bild_{n:03d}.png").write_bytes(roh)
            koepfe = roster.zeitkoepfe(g, bild)
            lesbar = sum(1 for _, y1, _ in koepfe if y1 + 210 < view_unten)
            if px:
                gesamt_px += max(0, px)
            # Bewegt sich der Inhalt zwischen zwei Bildern weiter als das
            # Fenster hoch ist, war eine Zeile in keinem der beiden ganz zu
            # sehen — genau die faellt dann durch. Deshalb hier melden und
            # nicht erst in der Auswertung.
            warnung = ""
            if px is not None and px > fenster - 210:
                zu_schnell += 1
                warnung = "  ← ZU SCHNELL, bitte langsamer"
            verlauf.write(json.dumps({
                "n": n, "uhr": datetime.now().strftime("%H:%M:%S.%f")[:-3],
                "versatz_px": px, "zeitkoepfe": len(koepfe), "lesbar": lesbar,
            }) + "\n")
            print(f"#{n:03d} {datetime.now():%H:%M:%S}  "
                  f"{('+%4d px' % px) if px is not None else '   ?  px'}  "
                  f"{lesbar} Zeilen lesbar{warnung}", flush=True)
            n += 1
            time.sleep(max(0.0, takt - (time.time() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        meta = json.loads((ordner / "meta.json").read_text())
        meta.update({"ende": datetime.now().isoformat(timespec="seconds"),
                     "bilder": n, "gescrollt_px": gesamt_px,
                     "zu_schnell": zu_schnell})
        (ordner / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
        print()
        _log(f"Beendet. {n} Bilder, {gesamt_px} px gescrollt.")
        if zu_schnell:
            _log(f"{zu_schnell} Schritte waren weiter als das Fenster — "
                 f"dort koennen Zeilen fehlen.")
        _log(f"Auswerten mit:  .venv/bin/python -m scripts.ws_service.mitschreiben "
             f"--auswerten {ordner}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--name", default="mitschrift", help="Kennung fuer den Ordner")
    p.add_argument("--takt", type=float, default=0.8,
                   help="Sekunden zwischen zwei Bildern (Vorgabe 0.8)")
    p.add_argument("--auswerten", metavar="ORDNER", default=None,
                   help="Abgelegte Bilder lesen statt neu mitschreiben")
    p.add_argument("--team", default=None, choices=["A", "B"],
                   help="Welches Blatt offen war (sonst aus den Zeilen geschlossen)")
    p.add_argument("--schreiben", action="store_true",
                   help="Einteilung ins Tool uebernehmen (nur mit --auswerten)")
    p.add_argument("--erzwingen", action="store_true",
                   help="Auch schreiben, wenn die Gegenprobe nicht aufgeht")
    p.add_argument("--nur-rechnen", action="store_true", dest="nur_rechnen",
                   help="Aus roh.json rechnen, Bilder nicht neu lesen")
    a = p.parse_args(argv)

    if a.auswerten:
        from .mitlesen import auswerten
        return auswerten(Path(a.auswerten), team=a.team, schreiben=a.schreiben,
                         erzwingen=a.erzwingen, nur_rechnen=a.nur_rechnen)

    g = Geraet()
    if not g.verbunden():
        _log("Keine ADB-Verbindung zu BlueStacks.")
        return 1
    return mitschreiben(g, a.name, a.takt)


if __name__ == "__main__":
    sys.exit(main())
