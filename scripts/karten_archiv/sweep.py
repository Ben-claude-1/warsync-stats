"""Kartenarchiv per Wisch-Navigation — zeilenweise ueber ein Weltrechteck.

    scripts/karten_archiv/im_terminal.sh sweep --von 470 540 --bis 500 580
    scripts/karten_archiv/im_terminal.sh sweep --von 470 540 --bis 500 580 --stufe wisch

Der Unterschied zu `run.py` ist die Navigation, nicht das Ergebnis:

* `run.py` springt je Kachel ueber den Lupe-Dialog. Exakt, aber 5,5 s je Kachel
  — und der Sprung **setzt den Zoom zurueck**, die Stufe ist damit nicht waehlbar.
* `sweep.py` springt nur an den **Zeilenanfang** und wischt die Zeile entlang.
  1,4 s je Kachel, und die Zoomstufe bleibt stehen.

**Der Zeilenanfang ist der Anker.** Die Kette der Verschiebungen sammelt Fehler;
ein Sprung setzt sie auf einen exakten Wert zurueck. Eine Zeile ist damit die
groesste Strecke, ueber die geraten wird — und selbst dort wird nicht geraten:

1. **Der Versatz wird gemessen, nicht angenommen.** Zwei aufeinander folgende
   Kacheln ueberlappen sich zu einem Drittel; ein Vorlagenabgleich liefert die
   Verschiebung auf wenige Pixel genau, ohne Geraetezeit zu kosten.
2. **Der Lupe-Dialog ist die Stichprobe.** Alle `--pruefen` Kacheln wird die
   gerechnete Position gegen die abgelesene gehalten. Weicht sie ab, bricht die
   Zeile ab — eine still verschobene Zeile waere die schlimmste Fehlerart,
   weil das Archiv hinterher vollstaendig aussieht.

**Ohne Ueberlappung keine Messung.** Der Kachelschritt bleibt deshalb bewusst
unter der Kachelbreite. Das ist kein Verlust: die Ueberlappung ist zugleich die
Selbstpruefung der Auswertung, weil dieselbe Basis in zwei Kacheln dieselbe
Koordinate ergeben muss.

## Ein Lauf ueber Stunden

Der Vollscan laeuft zehn Stunden. Drei Dinge muessen deshalb sitzen, und alle
drei haben denselben Grund: **ein Lauf, der still falsch weiterlaeuft, ist
schlimmer als einer, der abbricht** — hinterher sieht das Archiv vollstaendig aus.

* **Stillstand wird erkannt, nicht mitgeschrieben** (`Fortschrittswache`). Nimmt
  die Karte die Wischgeste nicht an — ein Dialog liegt darueber, die App haengt,
  das Fenster hat den Fokus verloren —, dann ist das naechste Bild dasselbe wie
  das vorige. Der Vorlagenabgleich findet dann brav eine Verschiebung von null,
  meldet gute Guete, und die Schleife legt Kachel um Kachel derselben Stelle ab,
  bis die Platte voll ist. Zwei Wachen davor: gleicher Bildhash heisst sofort
  Abbruch, ein zu kleiner Schritt dreimal hintereinander ebenfalls.
* **Abbrechen darf man jederzeit** (Strg-C). Die laufende Kachel wird noch
  fertig gespeichert, danach steht der Merkpunkt in `fortschritt.json`.
* **Fortgesetzt wird mitten in der Zeile**, nicht erst an ihrem Anfang. Der
  Wiedereinstieg ist ein Sprung auf die gemerkte Position, und der ist exakt —
  dieselbe Geste, mit der jede Zeile ohnehin beginnt. Gerundet wird dabei nach
  **unten**: eine Kachel doppelt kostet zwei Sekunden, eine Luecke waere still.
"""
from __future__ import annotations

import argparse
import json
import math
import signal
import sys
import time
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import banner, foto, position, sprung, wisch, zoom
from scripts.karten_archiv.archiv import Archiv
from scripts.karten_archiv.run import CFG


class ZeileAbgebrochen(RuntimeError):
    pass


class Stillstand(ZeileAbgebrochen):
    """Die Kamera bewegt sich nicht mehr, es entstehen aber weiter Kacheln."""


class Unterbrochen(Exception):
    """Strg-C — die laufende Kachel ist gespeichert, der Merkpunkt steht."""


class Fortschrittswache:
    """Merkt, wenn Kacheln entstehen, ohne dass sich die Kamera bewegt.

    Zwei Anzeichen, und sie meinen Verschiedenes:

    * **Gleicher Bildhash** — der Bildschirm steht. Das ist kein Verdacht,
      sondern eine Tatsache, und es wird sofort abgebrochen. Eine Wiederholung
      abzuwarten hiesse, wissentlich ein zweites Duplikat abzulegen.
    * **Zu kleiner Schritt** — die Geste kommt an, bewegt aber fast nichts.
      Das kann einmal am Kartenrand passieren, wo die Karte nicht weiter
      scrollt; dreimal hintereinander heisst, dass es so bleibt.

    Der Kartenrand ist der Grund fuer die Geduld beim zweiten Punkt: dort laeuft
    eine Zeile ohnehin aus, und ein Abbruch ist die richtige Antwort — nur eben
    nicht beim ersten Mal.
    """

    def __init__(self, mindest_welt: float, geduld: int = 3):
        self.mindest = mindest_welt
        self.geduld = geduld
        self.letzter_hash: str | None = None
        self.stumpf = 0

    def kachel(self, h: str, nr: int, k: int) -> None:
        if h == self.letzter_hash:
            raise Stillstand(
                f"Zeile {nr}, Kachel {k}: dasselbe Bild wie die vorige "
                f"(Hash {h}). Der Bildschirm steht — es wuerde ab hier "
                f"dieselbe Stelle immer wieder abgelegt.")
        self.letzter_hash = h

    def schritt(self, dx: float, nr: int, k: int) -> None:
        if abs(dx) >= self.mindest:
            self.stumpf = 0
            return
        self.stumpf += 1
        print(f"      Schritt nur {dx:.2f} E (erwartet ueber {self.mindest:.2f}) "
              f"— {self.stumpf}. Mal", flush=True)
        if self.stumpf >= self.geduld:
            raise Stillstand(
                f"Zeile {nr}, Kachel {k}: {self.geduld} Wische hintereinander ohne "
                f"nennenswerte Bewegung. Entweder ist der Kartenrand erreicht oder "
                f"die Geste kommt nicht an.")


_abbruch = False


def _abbruch_anfordern(signum, rahmen) -> None:
    """Strg-C merken statt sofort abbrechen.

    Mitten in einem ADB-Aufruf auszusteigen liesse das Geraet in einem Zustand
    zurueck, den niemand kennt — und die halb geschriebene Kachel waere ein
    Bild ohne JSON. Der Lauf haelt deshalb an der naechsten Kachelgrenze an.
    Ein zweites Strg-C bricht hart ab (der Handler ist dann wieder der
    voreingestellte).
    """
    global _abbruch
    _abbruch = True
    signal.signal(signal.SIGINT, signal.default_int_handler)
    print("\n[Strg-C] Halte nach dieser Kachel an und schreibe den Merkpunkt. "
          "Nochmal Strg-C bricht sofort ab.", flush=True)


def _kachel_breite(scfg: dict) -> float:
    x0, _, x1, _ = scfg["karte"]
    return (x1 - x0) / scfg["skala_x"]


class Merkpunkt:
    """Wo der Lauf steht — nach **jeder** Kachel fortgeschrieben.

    Die Datei ist zweierlei: der Wiedereinstiegspunkt nach Strg-C und das
    Fenster nach draussen. Wer wissen will, ob der Lauf noch vorankommt, liest
    sie, statt im Terminal mitzuscrollen — `zeit` und `kacheln` stehen darin,
    und beide muessen sich bewegen.

    Geschrieben wird ueber eine Nebendatei und `replace`: ein Abbruch mitten im
    Schreiben liesse sonst eine halbe JSON-Datei zurueck, und der naechste Lauf
    faende keinen Wiedereinstieg — ausgerechnet dann, wenn er ihn braucht.
    """

    def __init__(self, archiv: Archiv, rahmen: dict):
        self.pfad = archiv.pfad / "fortschritt.json"
        self.rahmen = rahmen
        self.kacheln = 0
        self.start = time.time()

    def schreiben(self, zustand: str, zeile: int, y: int, x: float, spalte: int,
                  **rest) -> None:
        satz = {"zustand": zustand, "zeile": zeile, "y": y,
                "x": round(float(x), 3), "spalte": spalte,
                "kacheln": self.kacheln,
                "laeuft_seit_min": round((time.time() - self.start) / 60, 1),
                "zeit": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "rahmen": self.rahmen, **rest}
        vor = self.pfad.with_suffix(".json.neu")
        vor.write_text(json.dumps(satz, indent=2, ensure_ascii=False))
        vor.replace(self.pfad)

    @staticmethod
    def lesen(archiv: Archiv, rahmen: dict) -> tuple[int, float, int] | None:
        """Wiedereinstieg (Zeile, X, Spalte) — oder nichts.

        **Ein Merkpunkt aus einem anderen Rahmen gilt nicht.** Zeilennummern
        sind Indizes in die Zeilenliste; mit anderem `--von`/`--bis`/`--stufe`
        meint dieselbe Nummer eine andere Zeile, und der Lauf setzte an der
        falschen Stelle auf, ohne dass es jemandem auffiele.

        **`laeuft` zaehlt genauso wie `unterbrochen`.** Der Merkpunkt wird nach
        jeder Kachel fortgeschrieben und nennt immer eine Kachel, die auf der
        Platte liegt. Wer das Terminalfenster zuklappt, den Rechner verliert
        oder den Lauf abschiesst, hat deshalb denselben Wiedereinstieg wie nach
        einem sauberen Strg-C — sonst waere ausgerechnet der ungeplante Abbruch
        der teure. Dass nicht zwei Laeufe gleichzeitig darauf aufsetzen,
        verhindert die BlueStacks-Sperre in `ws_service.device`, nicht diese
        Datei.
        """
        p = archiv.pfad / "fortschritt.json"
        if not p.exists():
            return None
        try:
            satz = json.loads(p.read_text())
        except json.JSONDecodeError:
            return None
        if satz.get("rahmen") != rahmen:
            return None
        if satz.get("zustand") not in ("laeuft", "unterbrochen"):
            return None
        return int(satz["zeile"]), float(satz["x"]), int(satz["spalte"])


def zeile_fahren(g, scfg, archiv, bild, nr, von_x, bis_x, y, laenge, pruefen, lesen,
                 wache=None, merk=None, k0=0):
    """Eine Zeile: Sprung an den Anfang, dann wischen bis zum Ende.

    `von_x` ist beim Wiedereinstieg nicht der Zeilenanfang, sondern die gemerkte
    Stelle — der Sprung dorthin ist derselbe Vorgang und ebenso exakt. `k0` fuehrt
    die Kachelnummerierung fort, damit der Wiedereinstieg die schon abgelegten
    Kacheln der Zeile nicht ueberschreibt.
    """
    sprung.springen(g, CFG, von_x, y, bild)
    roh = sprung.dialog_sicherstellen(g, CFG, False, bild)
    zoom.nach_sprung(g, scfg)
    if scfg.get("raus_gesten"):
        roh = bild()

    pos_x, pos_y = float(von_x), float(y)
    # Die Erwartung startet beim konfigurierten Traegheitsfaktor und wird danach
    # aus den eigenen Messungen fortgeschrieben. Der Faktor aus der Datei ist ein
    # Startwert, kein Messwert: er wurde auf einer Zoomstufe gemessen und muss
    # auf einer anderen nicht gelten — am 07.09.2026 lag er um 15 % daneben.
    erwartet_px = laenge * wisch.traegheit(scfg)
    k = k0
    gemessen: list[float] = []
    gemessen_px: list[float] = []
    while True:
        extra = {"zeile": nr, "spalte": k}
        if lesen:
            gefunden = banner.auswerten(Image.fromarray(roh), pos_x, pos_y, scfg)
            extra["banner"] = gefunden
            extra["banner_anzahl"] = len(gefunden)
        h = archiv.speichern(pos_x, pos_y, Image.fromarray(roh), extra,
                             stamm=f"z{nr:03d}_k{k:04d}")
        if merk:
            merk.kacheln += 1
            merk.schreiben("laeuft", nr, y, pos_x, k)
        print(f"  {nr:3d}/{k:4d}  X:{pos_x:7.2f} Y:{pos_y:7.2f}"
              f"{'  ' + str(extra['banner_anzahl']) + ' Banner' if lesen else ''}",
              flush=True)
        if wache:
            wache.kachel(h, nr, k)
        if _abbruch:
            # Die Kachel ist abgelegt, der Merkpunkt zeigt auf sie. Fortgesetzt
            # wird bei genau dieser Stelle, nicht bei der naechsten: der Sprung
            # dorthin ist exakt, und eine Kachel doppelt schadet nicht.
            if merk:
                merk.schreiben("unterbrochen", nr, y, pos_x, k)
            raise Unterbrochen()
        if pos_x >= bis_x:
            return k + 1 - k0, gemessen, gemessen_px

        vorher = roh
        wisch.geste(g, scfg, "x+", laenge)
        roh = bild()
        sx, sy, guete = wisch.versatz_nachziehen(vorher, roh, scfg,
                                                 (erwartet_px, 0.0))
        dx, dy = wisch.welt_versatz(sx, sy, scfg)
        if guete >= 0.30:
            gemessen_px.append(sx)
            erwartet_px = float(np.median(gemessen_px[-5:]))
        if guete < 0.30:
            # Strukturloses Gelaende: der Abgleich ist nicht belastbar. Statt zu
            # raten wird die Position erfragt — teuer, aber selten.
            print(f"      Abgleich schwach (Guete {guete:.2f}) — Position wird "
                  f"erfragt", flush=True)
            p = position.lesen(g, CFG, bild,
                               erwartet=(round(pos_x + dx), round(pos_y + dy)),
                               toleranz=4)
            if p is None:
                raise ZeileAbgebrochen(
                    f"Zeile {nr}: Versatz weder messbar (Guete {guete:.2f}) noch "
                    f"ablesbar. Ohne Position keine Kachel — hier wird nicht geraten.")
            pos_x, pos_y = float(p[0]), float(p[1])
            roh = bild()
        else:
            pos_x, pos_y = pos_x + dx, pos_y + dy
            gemessen.append(dx)
            if wache:
                wache.schritt(dx, nr, k)
        k += 1

        if pruefen and k % pruefen == 0:
            p = position.lesen(g, CFG, bild,
                               erwartet=(round(pos_x), round(pos_y)), toleranz=6)
            if p is None:
                print(f"      Stichprobe: Position nicht lesbar — weiter mit der "
                      f"gerechneten", flush=True)
            else:
                ab = max(abs(p[0] - pos_x), abs(p[1] - pos_y))
                print(f"      Stichprobe: Dialog {p[0]}/{p[1]}, gerechnet "
                      f"{pos_x:.2f}/{pos_y:.2f} — Abweichung {ab:.2f} E", flush=True)
                if ab > 2.5:
                    raise ZeileAbgebrochen(
                        f"Zeile {nr}: gerechnete Position {pos_x:.2f}/{pos_y:.2f} "
                        f"weicht um {ab:.2f} Einheiten vom Dialog ab.")
                if ab > 0.75:
                    # Uebernommen wird der Dialog, nicht die Kette. Er ist auf
                    # ganze Einheiten gerundet — das kostet bis zu 0,5 Einheiten
                    # und beendet dafuer jede Drift. Eine Kette aus gemessenen
                    # Verschiebungen kann beliebig weit weglaufen; ein abgelesener
                    # Wert nicht.
                    print(f"      → Position auf den Dialogwert gesetzt.", flush=True)
                    pos_x, pos_y = float(p[0]), float(p[1])
            roh = bild()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--von", nargs=2, type=int, required=True, metavar=("X", "Y"))
    p.add_argument("--bis", nargs=2, type=int, required=True, metavar=("X", "Y"))
    p.add_argument("--name", default="sweep")
    p.add_argument("--stufe", default="sprung",
                   help="Zoomstufe aus config.json (sprung = die, auf der der "
                        "Sprung landet; wisch = eine Geste weiter draussen)")
    p.add_argument("--ueberlappung", type=float, default=0.35,
                   help="Anteil der Kachelbreite, um den sich zwei Kacheln "
                        "ueberschneiden — darunter misst der Abgleich nichts mehr")
    p.add_argument("--pruefen", type=int, default=15,
                   help="alle N Kacheln die Position im Dialog gegenlesen (0 = nie)")
    p.add_argument("--lesen", action="store_true", help="Banner sofort mit auswerten")
    p.add_argument("--pause", type=float, default=None,
                   help="Beruhigungspause nach dem Wisch in Sekunden. Zu kurz "
                        "heisst: fotografiert wird, waehrend die Karte noch "
                        "gleitet — die Kachel gehoert dann nicht zu der Position, "
                        "unter der sie abgelegt wird.")
    a = p.parse_args()

    scfg = dict(zoom.stufe(CFG, a.stufe), navigation="wisch")
    if a.pause is not None:
        scfg["wisch_geste"] = dict(scfg["wisch_geste"], pause=a.pause)
    g = Geraet()
    g.starten()
    g.app_starten()

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG, bild)
    if not zoom.lupe_da(bild(), CFG):
        print("Kein Lupe-Knopf — ohne Detailmodus gibt es weder Sprung noch Banner.",
              file=sys.stderr)
        return 1

    breite = _kachel_breite(scfg)
    schritt = breite * (1 - a.ueberlappung)
    laenge = wisch.gestenlaenge(scfg, schritt * scfg["skala_x"])
    tatsaechlich = laenge * wisch.traegheit(scfg) / scfg["skala_x"]
    zeilen = list(range(a.von[1], a.bis[1] + 1, scfg["schritt_y"]))
    je_zeile = int((a.bis[0] - a.von[0]) / tatsaechlich) + 1

    archiv = Archiv(a.name, scfg)
    rahmen = {"von": a.von, "bis": a.bis, "stufe": a.stufe,
              "ueberlappung": a.ueberlappung}
    merk = Merkpunkt(archiv, rahmen)
    weiter = Merkpunkt.lesen(archiv, rahmen)

    print(f"Archiv {archiv.pfad}")
    print(f"Stufe {a.stufe!r}: {scfg['skala_x']:.1f} px je Welteinheit, Kachel "
          f"{breite:.1f} x {(scfg['karte'][3]-scfg['karte'][1])/scfg['skala_y']:.1f} E")
    print(f"Wisch {laenge} px → {tatsaechlich:.1f} E Schritt "
          f"({100*(1-tatsaechlich/breite):.0f} % Ueberlappung)")
    print(f"{len(zeilen)} Zeilen x rund {je_zeile} Kacheln = {len(zeilen)*je_zeile}")
    if weiter:
        print(f"Wiedereinstieg: Zeile {weiter[0]}, X {weiter[1]:.2f}, "
              f"ab Kachel {weiter[2]}")
    print("Strg-C haelt nach der laufenden Kachel an.\n", flush=True)

    signal.signal(signal.SIGINT, _abbruch_anfordern)
    signal.signal(signal.SIGTERM, _abbruch_anfordern)
    signal.signal(signal.SIGHUP, _abbruch_anfordern)   # Terminalfenster zugeklappt

    t_start = time.time()
    kacheln = 0
    hintereinander_gescheitert = 0
    gescheiterte_zeilen: list[int] = []
    for nr, y in enumerate(zeilen):
        if archiv.zeile_fertig(nr):
            print(f"Zeile {nr} (Y {y}) schon fertig — uebersprungen", flush=True)
            continue
        start_x, k0 = a.von[0], 0
        if weiter and weiter[0] == nr:
            # Abrunden: lieber eine Kachel doppelt als eine Luecke, die
            # hinterher niemand sieht.
            start_x, k0 = int(math.floor(weiter[1])), weiter[2]
            print(f"   (Wiedereinstieg bei X {start_x}, Kachel {k0})", flush=True)
        # Zeilen **vor** dem Merkpunkt werden bewusst nicht uebersprungen: was
        # fertig ist, traegt seine `.done`-Datei. Fehlt sie, ist die Zeile beim
        # letzten Lauf gescheitert — sie hier zu ueberspringen hiesse, eine
        # Luecke zu hinterlassen, die spaeter niemand mehr sieht.
        print(f"── Zeile {nr}  Y {y}  X {start_x} → {a.bis[0]}", flush=True)
        t0 = time.time()
        wache = Fortschrittswache(tatsaechlich * 0.25)
        try:
            n, gemessen, gem_px = zeile_fahren(g, scfg, archiv, bild, nr, start_x,
                                               a.bis[0], y, laenge, a.pruefen,
                                               a.lesen, wache, merk, k0)
        except Unterbrochen:
            ges = time.time() - t_start
            print(f"\nAngehalten. {merk.kacheln} Kacheln in diesem Lauf, "
                  f"{ges/60:.1f} min.")
            print(f"Merkpunkt: {merk.pfad}\nWeiter mit demselben Aufruf — "
                  f"er setzt dort auf.")
            return 0
        except (ZeileAbgebrochen, wisch.WischFehler, sprung.SprungFehler) as e:
            # **Eine kaputte Zeile beendet nicht den Lauf.** Jede Zeile beginnt
            # mit einem absoluten Sprung, ist also von der vorigen unabhaengig;
            # weiterzumachen kann nichts verschieben. Bleibt es aber bei jeder
            # Zeile dabei, steht das Spiel irgendwo, wo es nicht hingehoert —
            # dann ist Weitermachen sinnlos und richtet nur Platz zugrunde.
            hintereinander_gescheitert += 1
            gescheiterte_zeilen.append(nr)
            print(f"\n{e}\nZeile {nr} bleibt unvollstaendig und wird beim naechsten "
                  f"Lauf neu gefahren ({hintereinander_gescheitert} in Folge).",
                  file=sys.stderr, flush=True)
            if hintereinander_gescheitert >= 3:
                merk.schreiben("gescheitert", nr, y, start_x, k0,
                               gescheiterte_zeilen=gescheiterte_zeilen)
                print("Drei Zeilen hintereinander gescheitert — Abbruch. "
                      "Das ist kein Zeilenproblem mehr.", file=sys.stderr)
                return 2
            continue
        hintereinander_gescheitert = 0
        dauer = time.time() - t0
        faktor = (float(np.median(gem_px)) / laenge) if gem_px else None
        archiv.zeile_abschliessen(nr, {"y": y, "kacheln": n, "ab_spalte": k0,
                                       "sekunden": round(dauer, 1),
                                       "wischlaenge_px": laenge,
                                       "pixel_faktor_gemessen":
                                           round(faktor, 3) if faktor else None,
                                       "schritte_welt": [round(v, 2) for v in gemessen]})
        if faktor:
            print(f"   Traegheitsfaktor gemessen: {faktor:.3f} "
                  f"(Konfiguration {wisch.traegheit(scfg)})", flush=True)
        kacheln += n
        print(f"   {n} Kacheln in {dauer/60:.1f} min ({dauer/n:.2f} s je Kachel)\n",
              flush=True)

    ges = time.time() - t_start
    merk.schreiben("fertig", len(zeilen) - 1, zeilen[-1] if zeilen else 0,
                   a.bis[0], 0, gescheiterte_zeilen=gescheiterte_zeilen)
    print(f"Fertig. {kacheln} Kacheln in {ges/60:.1f} min"
          + (f" ({ges/kacheln:.2f} s je Kachel)" if kacheln else ""))
    if gescheiterte_zeilen:
        print(f"{len(gescheiterte_zeilen)} Zeilen unvollstaendig: "
              f"{gescheiterte_zeilen}\nDerselbe Aufruf faehrt genau sie noch einmal.")
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
