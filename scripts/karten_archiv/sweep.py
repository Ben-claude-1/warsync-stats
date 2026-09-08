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

**Wie weit man wischen darf, entscheidet die Vorlage, nicht der Geschmack.** Die
Kachel ist 1660 px breit — das HUD-freie Rechteck, das sich nicht dehnen laesst.
Was dem Abgleich als Vorlage bleibt, ist `Breite - Schritt - 2 x Toleranz`, und
das schrumpft doppelt so schnell wie die Ueberlappung:

| Ueberlappung | Schritt | Vorlage | Kacheln | Zeit  |
|--------------|---------|---------|---------|-------|
| 35 %         | 5,42 E  | 301 px  | 15.540  | 10,6 h|
| **25 %**     | 6,25 E  | 136 px  | 13.440  | 9,2 h |
| 20 %         | 6,67 E  |  52 px  | —       | bricht|

Unter 100 px lehnt `_vorlage_fenster` ab; 20 % sind damit nicht knapp, sondern
unmoeglich. **25 % ist der Wert, der noch traegt** — und er traegt erst, seit der
Rueckfall auf den Lupe-Dialog wieder funktioniert (siehe `position.py`): die
Wischgeste streut gemessen zwischen 4,55 und 5,96 E, und ein Ausreisser nach oben
frisst die schmale Vorlage auf. Vorher beendete das die Zeile; jetzt wird die
Position abgelesen und weitergefahren.

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
* **Ein Fehlgriff kostet Sekunden, kein Zeilenende** (`NACHBLICKE`,
  `ABLESE_VERSUCHE`, `NOTSPRUNG_MAX`). Verliert der Abgleich den Halt, wird
  nacheinander noch einmal hingesehen, die Position erfragt und notfalls
  gesprungen — der Sprung setzt die Kamera, er muss sie nicht finden. Erst wenn
  eine Zeile das reihenweise braucht, ist sie wirklich verloren. Die Grenze ist
  nicht Kosmetik: am 08.09.2026 starben vier Zeilen an je *einem* solchen
  Augenblick, drei davon hintereinander, und mit ihnen der ganze Lauf.
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


def _angehalten(merk: "Merkpunkt", t_start: float) -> int:
    """Geordneter Abgang nach Strg-C — auf beiden Wegen derselbe.

    Der Merkpunkt zeigt schon auf die letzte vollstaendig abgelegte Kachel; hier
    wird nur noch der Zustand gesetzt und gesagt, wie es weitergeht.
    """
    satz = json.loads(merk.pfad.read_text())
    merk.schreiben("unterbrochen", satz["zeile"], satz["y"], satz["x"],
                   satz["spalte"])
    print(f"\nAngehalten. {merk.kacheln} Kacheln in diesem Lauf, "
          f"{(time.time() - t_start)/60:.1f} min.")
    print(f"Weiter bei Zeile {satz['zeile']}, X {satz['x']:.2f} — derselbe "
          f"Aufruf setzt dort auf.\nMerkpunkt: {merk.pfad}")
    return 0


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


# **Eine Zeile darf nicht an einem einzelnen Fehlgriff sterben.** Im Vollscan vom
# 08.09.2026 verlor der Abgleich 43 Mal den Halt; 39 Mal fing die Ablesung das auf,
# vier Mal nicht — und diese vier kosteten je eine ganze Zeile, zusammen den Lauf
# (drei Ausfaelle hintereinander). Der Fehler war jedes Mal derselbe *Augenblick*,
# nicht derselbe Zustand: an denselben Stellen lief hinterher alles sauber durch.
# Gegen einen Augenblick hilft ein zweiter Versuch, nicht eine bessere Messung.
NACHBLICKE = 2            # erneute Bildvergleiche, bevor der Dialog bemueht wird
NACHBLICK_PAUSE = 0.6     # s — genug, dass die Karte ausgeglitten ist
ABLESE_VERSUCHE = 3       # Anlaeufe fuer die Positionsablesung
NOTSPRUNG_MAX = 8         # Notspruenge je Zeile, danach ist es kein Einzelfall mehr


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
    # Anker der letzten *abgelesenen* Wahrheit. Zwischen zwei Stichproben laesst
    # sich daraus zurueckrechnen, wie weit ein Wisch wirklich getragen hat — die
    # einzige Zahl im Lauf, die nicht aus dem Vorlagenabgleich selbst stammt.
    anker_x, anker_k = float(von_x), k0
    abgelesen_px: list[float] = []
    notspruenge = 0
    stichprobe_blind = 0
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
        # **Die Kachel zeigt auch rechts von ihrem Mittelpunkt Karte.** Die Zeile
        # ist fertig, sobald die letzte Aufnahme bis `bis_x` reicht — nicht erst,
        # wenn die Kameramitte dort steht. Der Unterschied ist eine halbe
        # Kachelbreite und kostete am 08.09.2026 drei Zeilen des Vollscans: sie
        # kamen bis X 993…998 von 999, wischten dann gegen den Kartenrand, wo sich
        # nichts mehr bewegt, und wurden mit „Versatz nicht messbar" als
        # gescheitert verbucht — obwohl sie die Strecke vollstaendig abgefahren
        # hatten. Am Rand kann die Kamera nicht weiter; das ist kein Fehlschlag,
        # sondern das Ende der Zeile.
        halbe = (scfg["karte"][2] - scfg["karte"][0]) / scfg["skala_x"] / 2
        if pos_x + halbe >= bis_x:
            return k + 1 - k0, gemessen, gemessen_px

        vorher = roh
        wisch.geste(g, scfg, "x+", laenge)
        roh = bild()
        sx, sy, guete = wisch.versatz_nachziehen(vorher, roh, scfg,
                                                 (erwartet_px, 0.0))
        dx, dy = wisch.welt_versatz(sx, sy, scfg)
        if guete < 0.30:
            # **Ein schwacher Abgleich ist noch kein Befund.** Das Bild faellt
            # gelegentlich in die noch gleitende Karte; dann findet sich die
            # Vorlage nirgends wieder — im Vollscan vom 08.09.2026 stand elf Mal
            # von 43 eine glatte Guete 0,00, die es bei strukturlosem Gelaende so
            # nicht gibt. Ein zweiter Blick kostet ein Bildschirmfoto und loest
            # das ohne Dialog und ohne Sprung.
            for versuch in range(1, NACHBLICKE + 1):
                time.sleep(NACHBLICK_PAUSE)
                roh = bild()
                sx, sy, guete = wisch.versatz_nachziehen(vorher, roh, scfg,
                                                         (erwartet_px, 0.0))
                dx, dy = wisch.welt_versatz(sx, sy, scfg)
                if guete >= 0.30:
                    print(f"      Zweiter Blick ({versuch}.): Guete {guete:.2f} — "
                          f"der Abgleich traegt doch", flush=True)
                    break
        if guete >= 0.30:
            gemessen_px.append(sx)
            erwartet_px = float(np.median(gemessen_px[-5:]))
        if guete < 0.30:
            # Strukturloses Gelaende: der Abgleich ist nicht belastbar. Statt zu
            # raten wird die Position erfragt — teuer, aber selten.
            print(f"      Abgleich schwach (Guete {guete:.2f}) — Position wird "
                  f"erfragt", flush=True)
            # **Die Schranke muss die ganze Unsicherheit umfassen.** `dx` ist hier
            # gerade *nicht* gemessen — bei Guete 0 gibt `versatz_nachziehen` die
            # Erwartung zurueck, nicht einen Befund. Hat die Karte den Wisch nicht
            # angenommen, steht die Kamera noch bei `pos_x`; hat sie ihn ganz
            # angenommen, bei `pos_x + dx`. Beide Faelle sind moeglich, und mit der
            # festen Toleranz 4 fiel die richtige Ablesung durch, sobald der
            # Schritt groesser war — auf der Stufe 'nah' sind das 9 Einheiten. Am
            # 08.09.2026 starb daran Zeile 0 am Suedrand, wo der Abgleich mangels
            # Struktur ohnehin nichts findet. Gefragt wird deshalb nach der Mitte
            # beider Moeglichkeiten, mit einer Schranke, die beide einschliesst.
            spanne = max(abs(dx), abs(dy))
            # **Die Ablesung bekommt mehrere Anlaeufe.** Sie haengt an einem
            # Dialog, der aufgehen muss, und an Tesseract — beides scheitert
            # gelegentlich an einer Ueberlagerung oder einem unguenstigen
            # Augenblick, nicht an der Stelle. Ein zweiter Anlauf kostet drei
            # Sekunden, ein Zeilenausfall zehn Minuten.
            p = None
            for versuch in range(1, ABLESE_VERSUCHE + 1):
                try:
                    p = position.lesen(
                        g, CFG, bild,
                        erwartet=(round(pos_x + dx / 2), round(pos_y + dy / 2)),
                        toleranz=int(spanne / 2) + 4)
                except sprung.SprungFehler as e:
                    # Der Dialog ging nicht auf oder nicht zu. Das ist hier kein
                    # Zeilenende: die naechste Runde raeumt ihn mit derselben
                    # Zurueck-Taste weg, mit der `dialog_sicherstellen` es
                    # ohnehin versucht.
                    print(f"      Ablesung {versuch}/{ABLESE_VERSUCHE}: {e}",
                          flush=True)
                    p = None
                if p is not None:
                    break
                if versuch < ABLESE_VERSUCHE:
                    print(f"      Ablesung {versuch}/{ABLESE_VERSUCHE} misslungen "
                          f"— noch ein Anlauf", flush=True)
                    time.sleep(NACHBLICK_PAUSE)
            if p is not None:
                pos_x, pos_y = float(p[0]), float(p[1])
                # Auch das ist eine abgelesene Wahrheit — sie taugt als Anker fuer
                # die naechste Rueckrechnung. `k` wird gleich erhoeht, daher k + 1.
                anker_x, anker_k = float(p[0]), k + 1
            else:
                # **Der Notsprung: die Kamera wird gesetzt, statt sie zu suchen.**
                # Bis zum 08.09.2026 endete die Zeile hier — und das war die
                # teuerste Reaktion von allen, denn der Sprung auf eine Koordinate
                # ist genau der Vorgang, mit dem jede Zeile ohnehin beginnt. Er
                # braucht die aktuelle Position gar nicht zu kennen: er setzt sie.
                # Wo die Kamera gerade steht, ist damit gleichgueltig — auch der
                # Fall „die Karte hat den Wisch nicht angenommen" ist abgedeckt.
                #
                # Gesprungen wird auf die *beabsichtigte* naechste Stelle, nicht
                # auf die vermutete aktuelle: die Kachel liegt damit dort, wo das
                # Raster sie erwartet, und die Ueberlappung zur vorigen stimmt.
                if notspruenge >= NOTSPRUNG_MAX:
                    raise ZeileAbgebrochen(
                        f"Zeile {nr}: {notspruenge} Notspruenge — der Abgleich "
                        f"traegt hier grundsaetzlich nicht, und jede Kachel "
                        f"einzeln anzuspringen ist die falsche Betriebsart.")
                notspruenge += 1
                ziel_x, ziel_y = min(round(pos_x + dx), bis_x), round(pos_y)
                print(f"      Weder messbar noch ablesbar — Notsprung auf "
                      f"{ziel_x}/{ziel_y} ({notspruenge}. in dieser Zeile)",
                      flush=True)
                sprung.springen(g, CFG, ziel_x, ziel_y, bild)
                sprung.dialog_sicherstellen(g, CFG, False, bild)
                # Der Sprung setzt den Zoom auf die Standardstufe zurueck — ohne
                # das Herauszoomen faende sich die Zeile auf einer anderen Stufe
                # wieder, mit anderer Kachelbreite und anderem Massstab.
                zoom.nach_sprung(g, scfg)
                pos_x, pos_y = float(ziel_x), float(ziel_y)
                anker_x, anker_k = float(ziel_x), k + 1
            roh = bild()
        else:
            pos_x, pos_y = pos_x + dx, pos_y + dy
            gemessen.append(dx)
            if wache:
                wache.schritt(dx, nr, k)
        k += 1

        if pruefen and k % pruefen == 0:
            # **Eine ausgefallene Stichprobe ist keine gescheiterte Zeile.** Der
            # Dialog kann an einer Ueberlagerung haengenbleiben; am 08.09.2026
            # starben daran zwei Zeilen bei X 458, obwohl an derselben Stelle
            # hinterher alles sauber lief. Blind weiterfahren darf der Lauf
            # deswegen trotzdem nicht — die Stichprobe ist die einzige Instanz,
            # die eine still verschobene Zeile ueberhaupt bemerkt. Ausgesetzt
            # wird sie deshalb, aufgegeben erst nach drei Ausfaellen in Folge.
            try:
                p = position.lesen(g, CFG, bild,
                                   erwartet=(round(pos_x), round(pos_y)), toleranz=6)
            except sprung.SprungFehler as e:
                print(f"      Stichprobe: {e}", flush=True)
                p = None
            if p is None:
                stichprobe_blind += 1
                if stichprobe_blind >= 3:
                    raise ZeileAbgebrochen(
                        f"Zeile {nr}: {stichprobe_blind} Stichproben in Folge nicht "
                        f"lesbar — die gerechnete Position ist seit "
                        f"{stichprobe_blind * pruefen} Kacheln ungeprueft.")
                print(f"      Stichprobe: Position nicht lesbar ({stichprobe_blind}. "
                      f"in Folge) — weiter mit der gerechneten", flush=True)
            else:
                stichprobe_blind = 0
                ab = max(abs(p[0] - pos_x), abs(p[1] - pos_y))
                print(f"      Stichprobe: Dialog {p[0]}/{p[1]}, gerechnet "
                      f"{pos_x:.2f}/{pos_y:.2f} — Abweichung {ab:.2f} E", flush=True)
                if ab > 2.5:
                    raise ZeileAbgebrochen(
                        f"Zeile {nr}: gerechnete Position {pos_x:.2f}/{pos_y:.2f} "
                        f"weicht um {ab:.2f} Einheiten vom Dialog ab.")
                # **Die Erwartung wird mitgezogen, nicht nur die Position.** Ohne
                # das behebt die Stichprobe jedes Mal dieselbe Ursache neu: der
                # Abgleich unterschaetzte am 07.09.2026 durchgehend um 2–3 %,
                # gelegentlich um 5 %, und weil die Erwartung aus eben diesen
                # Messungen fortgeschrieben wird, zog sie das Suchfenster hinter
                # dem wahren Versatz her — bis er am Rand lag und dort einrastete.
                # Zwischen zwei Ablesungen steht dagegen fest, wie weit wirklich
                # gefahren wurde; das ist die einzige unabhaengige Zahl im Lauf.
                #
                # **Geglaettet, nicht nachgeplappert.** Der Dialog rundet auf ganze
                # Einheiten; bei 32 E ueber fuenf Wische sind das schon ±1,5 %
                # Rauschen. Wer jeder einzelnen Ablesung folgt, uebernimmt es — am
                # 08.09.2026 riss so ein Ausreisser die Erwartung auf 1314 px hoch,
                # obwohl der wahre Schritt bei rund 1257 lag, und der zu grosse
                # Wert liess die Vorlage auf 66 px zusammenfallen. Der Median der
                # letzten Ablesungen ist gegen einzelne Ausreisser unempfindlich
                # und folgt einer echten Aenderung trotzdem binnen weniger Proben.
                strecke, wische = p[0] - anker_x, k - anker_k
                if wische > 0 and strecke > 0:
                    abgelesen_px.append(strecke / wische * scfg["skala_x"])
                    neu_px = float(np.median(abgelesen_px[-5:]))
                    if abs(neu_px - erwartet_px) > 0.02 * erwartet_px:
                        print(f"      → Schritt-Erwartung {erwartet_px:.0f} → "
                              f"{neu_px:.0f} px ({strecke:.0f} E in {wische} "
                              f"Wischen)", flush=True)
                    erwartet_px = neu_px
                    # Die alten Abgleich-Messungen wuerden die frische Erwartung
                    # sonst im naechsten Median sofort wieder nach unten ziehen.
                    gemessen_px.clear()
                anker_x, anker_k = float(p[0]), k
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
    p.add_argument("--ueberlappung", type=float, default=0.25,
                   help="Anteil der Kachelbreite, um den sich zwei Kacheln "
                        "ueberschneiden — darunter misst der Abgleich nichts mehr")
    p.add_argument("--pruefen", type=int, default=10,
                   help="alle N Kacheln die Position im Dialog gegenlesen (0 = nie). "
                        "Nicht hoeher setzen, ohne die Drift nachzumessen: die Kette "
                        "unterschaetzt den Weg um rund 2,7 % (Probelauf 07.09.2026), "
                        "bei 15 Kacheln sind das 3,4 E — ueber der Abbruchgrenze 2,5.")
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
            return _angehalten(merk, t_start)
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
        except Exception:
            # **Strg-C trifft auch das `adb`-Kind.** Es haengt in derselben
            # Vordergrund-Prozessgruppe wie der Sweep; ein `exec-out screencap`
            # mitten im Bild stirbt daran und meldet sich als
            # CalledProcessError, bevor die Schleife ihre Abbruchmarke ueberhaupt
            # liest. Das ist kein Fehler, sondern der Abbruch — nur auf dem Umweg
            # ueber das Kind. Die zuletzt vollstaendig gespeicherte Kachel steht
            # bereits im Merkpunkt; dort wird aufgesetzt. Ohne gesetzte
            # Abbruchmarke bleibt es ein echter Fehler und fliegt weiter.
            if not _abbruch:
                raise
            return _angehalten(merk, t_start)
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
