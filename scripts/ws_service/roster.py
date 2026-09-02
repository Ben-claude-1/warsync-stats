"""Die Teilnehmerliste auslesen.

Was eine Zeile bedeutet — die ganze Logik des Dienstes in vier Saetzen:

* **Farbe der Zeitkopfzeile = Team.** Wer sich angemeldet hat, bekommt ueber
  seiner Zeile einen Balken „Lokale Zeit: … 13:00 ~ 13:30". Die Uhrzeit sagt,
  fuer welches Team: 13:00 ist A, 22:00 ist B (nachgeschlagen in `wsTime` des
  Tools, nicht fest verdrahtet — die Zeiten sind je Team umstellbar).
* **Badge links = gesetzt, Badge rechts = Ersatz.** Die beiden Spalten stehen
  genau unter den Zaehlern der Kopfzeile (👤x und 👤↺).
* **Kopfzeile ohne Badge = C.** Angemeldet, aber keiner der 30 Plaetze.
* **Keine Kopfzeile = gar nicht angemeldet.** Diese Zeilen werden bewusst
  uebergangen: sie sind keine Aussage, und im Tool darf dafuer nichts stehen.

Die Rang-Gruppen (R5…R1) sind zugeklappt oder aufgeklappt. Der Dienst klappt
jede genau einmal auf — erkannt am OCR-Text des Balkens, der sich beim Scrollen
nicht aendert. Ohne dieses Gedaechtnis wuerde derselbe Balken in mehreren
Bildern erneut angetippt und damit wieder zugeklappt.
"""
from __future__ import annotations

import re
import time

import cv2
import numpy as np

from . import vision as v
from .device import Geraet


class ScanFehler(RuntimeError):
    pass


ZAEHLER = re.compile(r"(\d+)\s*/\s*(\d+)")


# ── Bausteine eines Bildes ────────────────────────────────────────────────
def gruppenbalken(g: Geraet, bild) -> list[tuple[int, int]]:
    x0, y0, x1, y1 = g.cfg["list_view"]
    s = g.cfg["schwellen"]
    roh = v.baender(bild, y0, y1, 700, 1500, v.ist_gruppenbalken, s["gruppe_min_hoehe"])
    return [(a, b) for a, b in roh if b - a <= s["gruppe_max_hoehe"]]


def zeitkoepfe(g: Geraet, bild) -> list[tuple[int, int, str]]:
    """Alle Zeitkopfzeilen im Bild, mit 'A-Farbe'/'B-Farbe' als Rohkennung."""
    x0, y0, x1, y1 = g.cfg["list_view"]
    s = g.cfg["schwellen"]
    out = []
    for pruefer, kennung in ((v.ist_gruen, "gruen"), (v.ist_orange, "orange")):
        for a, b in v.baender(bild, y0, y1, 700, 1500, pruefer, s["kopf_min_hoehe"]):
            out.append((a, b, kennung))
    return sorted(out)


def zeile_lesen(g: Geraet, bild, y_kopf_ende: int) -> dict:
    """Name, Kraft, Uhrzeit und Badge-Zustand einer Zeile."""
    nx0, nx1 = g.cfg["name_box_x"]
    text = v.ocr(bild, (nx0, y_kopf_ende + 8, nx1, y_kopf_ende + 205), psm=6)
    zeilen = [z.strip() for z in text.splitlines() if z.strip()]
    name = zeilen[0] if zeilen else ""
    schwelle = g.cfg["schwellen"]["badge_blau_minus_rot"]
    badges = {}
    for rolle, x in g.cfg["badge_x"].items():
        badges[rolle] = v.blau_signal(bild, x, y_kopf_ende + 40, y_kopf_ende + 230)
    if badges["gesetzt"] > schwelle:
        platz = "gesetzt"
    elif badges["ersatz"] > schwelle:
        platz = "ersatz"
    else:
        platz = "ohne"
    return {"name_ocr": name, "kraft": v.kraft(text), "platz": platz,
            "badge_signal": {k: round(x, 1) for k, x in badges.items()}}


def kopfzeit(g: Geraet, bild, y0: int, y1: int) -> str | None:
    return v.uhrzeit(v.ocr(bild, (700, y0 - 4, 1900, y1 + 4), psm=7))


def gruppen_zaehler(g: Geraet, bild, y0: int) -> dict:
    """Die drei Zahlen einer Rang-Kopfzeile: Kommandant, gesetzt, Ersatz.

    **Sie sind die Gegenprobe des Scans.** Je Rang gezaehlt, damit ein Fehler
    auch zeigt, *wo* er sitzt — die Summe allein sagt nur, dass etwas fehlt.
    Ihre Summe muss zur Zahl ueber der Liste passen; tut sie es nicht, ist beim
    Durchscrollen etwas verlorengegangen.
    """
    dy0, dy1 = g.cfg["group_counter_dy"]
    return {rolle: v.zahl(bild, (x0, y0 + dy0, x1, y0 + dy1))
            for rolle, (x0, x1) in g.cfg["group_counter_x"].items()}


def dialog_zaehler(g: Geraet, bild) -> dict:
    """Die Zahlen ueber der Liste: eingeteilt / Plaetze, fuer beide Rollen.

    Dieselbe Groesse wie die Rang-Zaehler, nur als Gesamtsumme — und damit die
    zweite Gegenprobe.

    Dass sie sich waehrend eines Nachmittags aendern, heisst **nicht**, dass der
    Scan falsch lag: in der Anmeldephase duerfen R4 und R5 die Zuordnung jederzeit
    umstellen. Der Dienst liest einen Zustand, keine Wahrheit auf Dauer.
    """
    text = v.ocr(bild, tuple(g.cfg["dialog_header"]), psm=6)
    paare = ZAEHLER.findall(text)
    if len(paare) < 2:
        return {}
    gesetzt, ersatz = paare[-2], paare[-1]
    return {"gesetzt": int(gesetzt[0]), "gesetzt_max": int(gesetzt[1]),
            "ersatz": int(ersatz[0]), "ersatz_max": int(ersatz[1])}


# ── Der Durchlauf ─────────────────────────────────────────────────────────
def _balken_schluessel(g: Geraet, bild, y0: int, zaehler: dict) -> str:
    """Wiedererkennungsmerkmal einer Rang-Gruppe ueber Bilder hinweg.

    Aus den **Zahlen** gebaut, nicht aus dem Fliesstext des Balkens: der wandert
    beim Scrollen um ein paar Pixel, und die OCR liefert dann leicht anderen
    Buchstabensalat („Bu a0 Bo 42 30"). Ein wechselnder Schluessel liesse
    dieselbe Gruppe als neu erscheinen — und ein zweiter Tipp klappt sie wieder zu.

    **Nur die beiden Einteilungs-Zahlen tragen den Schluessel.** Die
    Mitgliederzahl stand hier frueher mit drin und hat am 02.09.2026 dieselbe
    R3-Gruppe dreimal gezaehlt: ihr Bruch wurde mal als „80", mal als „380"
    gelesen (die Ziffer des Zaehlers blutet in den Nenner), der Kommandanten-
    Zaehler mal als 0, mal gar nicht. Aus 17 gesetzten wurden so 54 — und die
    Gegenprobe schlug fehl, obwohl der Scan stimmte.

    Ausnahme: eine Gruppe **ohne** Einteilung (0/0) traegt die Mitgliederzahl
    weiter mit. Zwei leere Rang-Gruppen waeren sonst nicht zu unterscheiden und
    die zweite wuerde nie aufgeklappt — dort sitzen die 'C'-Spieler, die sich
    angemeldet haben, ohne einen Platz zu bekommen. Fuer die Summe ist es
    gleichgueltig, ob 0 einmal oder zweimal gezaehlt wird.
    """
    ges, ers = zaehler.get("gesetzt"), zaehler.get("ersatz")
    if ges is not None and ers is not None and (ges or ers):
        return f"{ges}|{ers}"
    dy0, dy1 = g.cfg["group_counter_dy"]
    x0, x1 = g.cfg["group_members_x"]
    mitglieder = v.bruch(bild, (x0, y0 + dy0 - 10, x1, y0 + dy1))
    teile = [zaehler.get("kommandant"), ges, ers, mitglieder]
    return "|".join("?" if t is None else str(t) for t in teile)


def _zugeklappt(y1: int, balken: list[tuple[int, int]], idx: int) -> bool | None:
    """Folgt direkt der naechste Rang-Balken, ist die Gruppe zu.

    None heisst „nicht entscheidbar" — der Balken ist der unterste im Bild und
    was darunter kommt, sieht man erst nach dem naechsten Schritt.
    """
    if idx + 1 < len(balken):
        return balken[idx + 1][0] - y1 < 45
    return None


def zum_listenanfang(g: Geraet, log=print, max_schritte: int = 25) -> None:
    letzte = None
    for _ in range(max_schritte):
        bild = g.bild()
        sig = _signatur(g, bild)
        if letzte is not None and _steht(sig, letzte):
            return
        letzte = sig
        g.liste_weiter(rueckwaerts=True)
    log("  (Listenanfang nicht sicher erreicht — weiter mit dem, was da ist.)")


def _signatur(g: Geraet, bild) -> np.ndarray:
    x0, y0, x1, y1 = g.cfg["list_view"]
    return bild[y0:y1:7, x0:x1:7].astype(np.int16)


def _versatz(g: Geraet, vorher, nachher) -> int | None:
    """Um wie viele Pixel ist der Listeninhalt nach oben gerutscht?

    Ein Ja/Nein („bewegt sich") sagt nicht, ob ein Schritt zu kurz oder gar
    nicht angekommen ist. Die Zahl steht deshalb im Protokoll: ein wirkungsloser
    Schritt faellt damit sofort auf, statt erst am mageren Endergebnis.

    None heisst „nicht messbar" — die Wiedererkennung war zu unsicher, meist
    weil sich sehr viel geaendert hat.
    """
    if vorher is None or nachher is None:
        return None
    x0, y0, x1, y1 = g.cfg["list_view"]
    a = cv2.cvtColor(vorher, cv2.COLOR_RGB2GRAY)[y0:y1, x0:x1]
    b = cv2.cvtColor(nachher, cv2.COLOR_RGB2GRAY)[y0:y1, x0:x1]
    h = a.shape[0]
    muster = a[h - 260:h - 60, :]
    suchraum = b[max(0, h - 260 - 900):h - 60, :]
    if suchraum.shape[0] < muster.shape[0]:
        return None
    treffer = cv2.matchTemplate(suchraum, muster, cv2.TM_CCOEFF_NORMED)
    _, guete, _, ort = cv2.minMaxLoc(treffer)
    if guete < 0.55:
        return None
    return -((max(0, h - 260 - 900) + ort[1]) - (h - 260))


def _steht(a: np.ndarray, b: np.ndarray, toleranz: float = 0.02) -> bool:
    """Zwei Bilder derselben Scrollstellung — mit Nachsicht verglichen.

    Nicht auf Gleichheit pruefen: im Dialog schimmern die Kopfzeilen leicht, und
    ein Byte-Vergleich findet deshalb **nie** zwei gleiche Bilder. Der Dienst
    hielte den Listenanfang nie fuer erreicht und wischte stur bis zum
    Schleifenende weiter — von aussen sieht das aus, als haenge er.
    """
    if a is None or b is None or a.shape != b.shape:
        return False
    return float((np.abs(a - b).max(axis=2) > 20).mean()) < toleranz


def durchlauf(g: Geraet, log=print, max_bilder: int = 120,
              max_aufklapp: int = 10) -> dict:
    """Einmal von oben nach unten. Gibt Rohzeilen und die Zaehler zurueck."""
    zum_listenanfang(g, log=log)
    bild = g.bild()
    zaehler = dialog_zaehler(g, bild)
    if zaehler:
        log(f"  Eingeteilt laut Spiel: {zaehler['gesetzt']}/{zaehler['gesetzt_max']} "
            f"gesetzt, {zaehler['ersatz']}/{zaehler['ersatz_max']} Ersatz")

    gesehen_balken: dict[str, dict] = {}
    # Zweitschluessel: gesetzt-Zahl → Schluessel der Gruppe, die sie trug.
    # Faellt in einem Bild der Ersatz-Zaehler aus (die OCR liefert dann None),
    # entsteht ein anderer Schluessel fuer dieselbe Gruppe — und sie zaehlt ein
    # zweites Mal. Am 02.09.2026 wurden aus 15 gesetzten so 35. Ueber die
    # gesetzt-Zahl findet sie sich trotzdem wieder; der bessere der beiden
    # Lesevorgaenge gewinnt.
    gesehen_nach_gesetzt: dict[int, str] = {}
    zeilen: list[dict] = []
    letzte_sig = None
    letztes_bild = None
    strecken: list[int] = []
    gleich_hintereinander = 0
    aufklapp_tipps = 0

    for schritt in range(max_bilder):
        bild = g.bild()
        balken = gruppenbalken(g, bild)
        _, _, _, view_unten = g.cfg["list_view"]

        # 1) Eine noch nicht behandelte, zugeklappte Gruppe aufklappen.
        aktion = False
        unentschieden = None
        for i, (y0, y1) in enumerate(balken):
            if y1 + 45 >= view_unten:
                continue                      # zu nah am Rand, spaeter nochmal
            zaehler_gruppe = gruppen_zaehler(g, bild, y0)
            schluessel = _balken_schluessel(g, bild, y0, zaehler_gruppe)
            ges = zaehler_gruppe.get("gesetzt")
            # Schon bekannt? Entweder unter demselben Schluessel oder — wenn ein
            # Zaehler in einem der beiden Bilder ausfiel — ueber die gesetzt-Zahl.
            bekannt = schluessel if schluessel in gesehen_balken else (
                gesehen_nach_gesetzt.get(ges) if ges else None)
            if bekannt is not None:
                # Dieselbe Gruppe, nur anders gelesen. Jedes Feld, das bisher
                # None war, wird nachgetragen: die Kopfzeile klebt beim Scrollen
                # oben fest und ist weiter unten oft besser lesbar als beim
                # ersten Blick. Ohne das Nachtragen bleibt die Summe None und
                # die Gegenprobe faellt ganz aus, obwohl die Zahl laengst
                # dastand.
                # Ein Nachtrag ohne Gegenprobe kann danebengehen: am 02.09.2026
                # las die OCR den Ersatz-Zaehler derselben Gruppe beim zweiten
                # Blick als 288 statt 8 — die Ziffern eines benachbarten Felds
                # bluten hinein. Unplausible Werte werden deshalb verworfen
                # statt uebernommen; ein fehlender Nachtrag heisst nur „keine
                # Gegenprobe", ein falscher heisst „falsche Gegenprobe".
                grenze = {"gesetzt": 40, "ersatz": 30, "kommandant": 10}
                alt = gesehen_balken[bekannt]
                for feld, wert in zaehler_gruppe.items():
                    if alt.get(feld) is not None or wert is None:
                        continue
                    if wert > grenze.get(feld, 40):
                        log(f"  Gruppe {bekannt}: {feld}={wert} verworfen (unplausibel)")
                        continue
                    alt[feld] = wert
                    log(f"  Gruppe {bekannt}: {feld} nachgetragen = {wert}")
                continue
            zu = _zugeklappt(y1, balken, i)
            if zu is None:
                # Ob eine Gruppe zugeklappt ist, verraet erst das, was UNTER
                # ihrem Balken steht — und beim untersten Balken im Bild steht
                # dort noch nichts. Sie jetzt als gesehen abzulegen hiesse: nie
                # wieder anfassen, auch nicht, wenn sich gleich zeigt, dass sie
                # zu ist. Genau daran ist am 02.09.2026 die letzte Rang-Gruppe
                # komplett durchgefallen. Also merken und im naechsten Bild
                # erneut ansehen.
                unentschieden = (y0, y1, schluessel, zaehler_gruppe, ges)
                continue
            gesehen_balken[schluessel] = zaehler_gruppe
            if ges:
                gesehen_nach_gesetzt[ges] = schluessel
            log(f"  Gruppe {schluessel}: {zaehler_gruppe}")
            if zu:
                # Eine leere Gruppe sieht auch aufgeklappt zugeklappt aus — sie
                # hat ja nichts zu zeigen. Ohne Obergrenze klappte der Dienst sie
                # in jedem Bild erneut auf und käme nie zum Scrollen.
                if aufklapp_tipps >= max_aufklapp:
                    log("  (Obergrenze fuers Aufklappen erreicht — weiter.)")
                    continue
                aufklapp_tipps += 1
                log(f"  Gruppe {schluessel} aufklappen ...")
                g.tippen(g.cfg["group_arrow_x"], (y0 + y1) // 2, pause=1.6)
                aktion = True
                break
        if aktion:
            continue

        # 2) Zeilen dieses Bildes lesen.
        for y0, y1, farbe in zeitkoepfe(g, bild):
            if y1 + 210 >= view_unten:
                continue                      # Zeile angeschnitten — naechstes Bild
            z = zeile_lesen(g, bild, y1)
            z["farbe"] = farbe
            z["zeit"] = kopfzeit(g, bild, y0, y1)
            if z["kraft"] is None:
                continue                      # ohne Kraftwert keine brauchbare Zeile
            zeilen.append(z)

        # 3) Weiter — und merken, ob sich ueberhaupt noch etwas bewegt.
        #
        # Ein stehendes Bild heisst **nicht** ohne Weiteres „Listenende": die
        # Liste nimmt regelmaessig einen Wisch nicht an. Wer das verwechselt,
        # bricht mitten im Kader ab und haelt eine halbe Liste fuer die ganze —
        # genau das ist am 02.09.2026 passiert (31 statt 76 Zeilen).
        #
        # Drei Versuche waren dafuer zu wenig, sechs auch noch: an dem Tag
        # blieb die Liste zweimal ganze fuenf Versuche lang stehen — bei jeder
        # Geste, jeder Spalte, sogar beim Wechsel auf den Wisch (device.py,
        # `rad_schritt`). Das ist kein Gesten-Problem, sondern eine kurze
        # echte Pause des Spiels selbst beim Nachladen unbekannten
        # Listenterrains. Ein zusaetzlicher Anlauf kostet Sekunden, ein zu
        # frueher Abbruch den ganzen Lauf — deshalb zehn, mit waechsenden
        # Pausen ab dem dritten Versuch.
        # Die grobe Signatur (_steht) hakt an genau der Stelle: am echten
        # Listenende blinkt der rote Online-Punkt neben den Profilbildern
        # weiter, obwohl nichts mehr scrollt. Alle paar Bilder faellt dieses
        # Blinken durch die 2-%-Toleranz und _steht meldet faelschlich
        # „bewegt" — der Zaehler faengt endlos wieder bei 0 an und die
        # Rang-Gruppe R2 (nur 8 Mitglieder, am 02.09.2026 beobachtet) wird nie
        # zu Ende gescannt. Die gemessene Pixel-Verschiebung (_versatz) ist die
        # praezisere Auskunft und entscheidet deshalb zuerst; die grobe
        # Signatur bleibt nur der Rueckfall, wenn sich kein Muster wiederfinden
        # laesst (z.B. weil eine Gruppe gerade auf-/zugeklappt wurde).
        sig = _signatur(g, bild)
        steht = _steht(sig, letzte_sig)
        px = _versatz(g, letztes_bild, bild)
        letzte_sig = sig
        letztes_bild = bild
        # Bewusst NICHT auf `steht` zurueckfallen, wenn `px` mal nicht messbar
        # ist (kurz nach dem Aufklappen einer Gruppe zum Beispiel — dieser Fall
        # nimmt aber ohnehin den `aktion`-Zweig oben und kommt hier gar nicht
        # an). Ein Rueckfall auf `steht` fuehrte am 02.09.2026 in eine
        # Endlosschleife: am echten Listenende (nur 8 Mitglieder in R2) matchte
        # das Schablonenbild manchmal zu unsicher fuer `px`, und `steht` riss
        # es dann durch das Blinken des Online-Punkts staendig wieder auf
        # „bewegt" — der Zaehler kam nie ueber 4 hinaus.
        bewegt = px is not None and px != 0
        if bewegt:
            if px is not None:
                strecken.append(px)
            gleich_hintereinander = 0
            g.liste_weiter()
            continue
        # Steht die Liste und der unterste Balken ist noch unentschieden, dann
        # kommt unter ihm nichts mehr — er ist zugeklappt. Das ist der einzige
        # Moment, in dem sich das sicher sagen laesst, und der letzte, in dem
        # man es noch aendern kann: ohne diesen Griff fehlt die ganze
        # Rang-Gruppe im Ergebnis, ohne dass irgendetwas danach aussieht.
        if unentschieden is not None and aufklapp_tipps < max_aufklapp:
            y0u, y1u, schl, zg, ges_u = unentschieden
            # Erst vermerken, dann tippen. Nach dem Aufklappen ist der Balken
            # naemlich immer noch der unterste im Bild — seine Mitglieder sind
            # keine Balken — und bliebe damit „unentschieden". Ohne diesen
            # Vermerk tippt der Dienst im naechsten Bild erneut und klappt die
            # Gruppe wieder zu: auf, zu, auf, zu, bis die Obergrenze greift.
            gesehen_balken[schl] = zg
            if ges_u:
                gesehen_nach_gesetzt[ges_u] = schl
            log(f"  Gruppe {schl}: {zg}")
            aufklapp_tipps += 1
            log("  Unterster Balken am Listenende ist zugeklappt — aufklappen ...")
            g.tippen(g.cfg["group_arrow_x"], (y0u + y1u) // 2, pause=1.6)
            gleich_hintereinander = 0
            letzte_sig = None
            continue
        gleich_hintereinander += 1
        if gleich_hintereinander >= 10:
            log(f"  Listenende nach {schritt + 1} Bildern "
                f"({len(zeilen)} Zeilen gelesen).")
            break
        log(f"  Liste bewegt sich nicht ({gleich_hintereinander}, "
            f"gemessen {px if px is not None else '?'} px) — anders ansetzen ...")
        g.liste_weiter(variante=gleich_hintereinander)
    else:
        raise ScanFehler(f"Nach {max_bilder} Bildern kein Listenende — abgebrochen.")

    if strecken:
        s = sorted(strecken)
        log(f"  Scrollen: {len(strecken)} Schritte, Median {s[len(s) // 2]} px, "
            f"groesster {s[-1]} px, gesamt {sum(strecken)} px.")

    # Summe der Rang-Zaehler = wie viele das Spiel als eingeteilt fuehrt.
    # Fehlt eine Zahl (OCR daneben), bleibt die Summe None — dann gibt es keine
    # Gegenprobe, und das soll auffallen statt stillschweigend durchzugehen.
    summe = {}
    for rolle in ("gesetzt", "ersatz"):
        werte = [z.get(rolle) for z in gesehen_balken.values()]
        summe[rolle] = None if any(w is None for w in werte) else sum(werte)

    return {"zeilen": zeilen, "zaehler": zaehler,
            "gruppen": {k: v for k, v in gesehen_balken.items()},
            "gruppen_summe": summe}


# ── Aus Rohzeilen werden Zuordnungen ──────────────────────────────────────
def zeit_zu_team(zeit: str | None, farbe: str, ws_time: dict) -> str | None:
    """'13:00' → 'A'. Die Zuordnung kommt aus dem Tool, nicht aus dem Code.

    Welche Uhrzeit welches Team spielt, ist je Team einstellbar (WS_ZEITEN) und
    wechselt. Faellt die OCR der Uhrzeit aus, entscheidet ersatzweise die Farbe
    des Balkens — gruen ist die frueheste, orange die spaetere Zeit.
    """
    if zeit:
        for team, t in (ws_time or {}).items():
            if t == zeit:
                return team.upper()
    return {"gruen": "A", "orange": "B"}.get(farbe)


def zu_werten(zeilen: list[dict], ws_time: dict) -> list[dict]:
    """Rohzeile → REG_WERTE ('A', 'AE', 'B', 'BE', 'C')."""
    out = []
    for z in zeilen:
        team = zeit_zu_team(z.get("zeit"), z["farbe"], ws_time)
        if not team:
            z["wert"] = None
            z["warnung"] = "Team nicht bestimmbar"
        elif z["platz"] == "gesetzt":
            z["wert"] = team
        elif z["platz"] == "ersatz":
            z["wert"] = team + "E"
        else:
            z["wert"] = "C"
        out.append(z)
    return out
