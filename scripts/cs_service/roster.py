"""Die Teilnehmerliste des Schluchtsturms lesen.

Scrollen, Rang-Gruppen aufklappen und die Gegenprobe ueber die Rang-Zaehler
sind identisch zum Wuestensturm — das macht unveraendert `ws_service.roster.
durchlauf`. Anders ist, was an einer einzelnen Zeile abzulesen ist: die
tatsaechliche Gesetzt-/Ersatz-Zuteilung steckt in einem Buchstaben-Feld statt
in einem reinen Vorhanden/Fehlt-Badge, ergaenzt um einen Team-Wunsch aus
einem roten Overlay fuer noch nicht zugeteilte Bewerber (siehe vision_cs.py
und das Modul-Docstring in __init__.py). `zu_werten_einzeln` fuehrt beides
zu einem Ergebnis je Zeile zusammen.
"""
from __future__ import annotations

import re
import time

from scripts.ws_service import roster as ws_roster
from scripts.ws_service import vision as v
from scripts.ws_service.device import Geraet

from . import vision_cs as vc

_ZAHL = re.compile(r"(\d+)")


class MusterAbweichung(RuntimeError):
    """Der Bildschirm verhaelt sich nicht wie erwartet — der Lauf haelt sofort
    an, statt es als 'fertig' zu werten und weiterzumachen. Der Zustand auf
    dem Geraet bleibt dabei unangetastet, damit er sich direkt ansehen laesst:
    genau das hat bei den fruehen Versuchen gefehlt, als ein steckengebliebener
    Scroll nach zehn Fehlversuchen stillschweigend als 'Rang fertig' galt.
    """


_ANSATZ_RAND = 30            # Sicherheitsabstand zu einer Rang-Leiste
# Nicht tiefer als 1830 ansetzen: die Liste endet bei y~1926, und auf der
# angeschnittenen letzten Karte darueber nimmt sie die Geste nicht an — am
# 06.09.2026 gemessen, y=1880 lieferte siebenmal in Folge 0 px, waehrend
# y=1830 und tiefer im selben Zustand sofort 460 px brachten.
_ANSATZ_VON, _ANSATZ_BIS = 1650, 1830
_STRECKE = 450               # ~1,6 Karten — die Karten ueberlappen also immer
_DAUER_MS = 2500


def _freier_ansatz(g: Geraet, bild, variante: int = 0) -> int | None:
    """Ein Ansatzpunkt fuer die Scroll-Geste, der auf keiner Rang-Leiste liegt.

    **Der teuerste Fehler des Dienstes.** Eine Rang-Leiste ist ein Knopf, und
    sie verschluckt jede Beruehrung, die auf ihr beginnt: die Liste scrollt
    nicht und die Gruppe klappt um. Am 06.09.2026 nachgestellt — ein Wisch, der
    auf der R2-Leiste ansetzt, bewegt 0 px und klappt R2 auf.

    Genau daraus entstanden alle drei Symptome, die vorher jedes fuer sich
    erklaert wurden: die "Δ=0"-Stillstaende, "zwei Listen gleichzeitig offen"
    und der Lauf, der mit 4 bis 43 von 81 Karten als fertig galt — klappt R3
    mitten im Durchlauf zu, ist die Liste kurz, das Listenende sofort erreicht
    und der Rang sieht abgearbeitet aus.

    `rad_schritt` setzt fest bei `rad.y` an und weicht bei Fehlversuchen nur in
    **x** aus (±80 px). Das half nie, denn eine Leiste laeuft ueber die ganze
    Breite; deshalb blieb die Liste damals "bei jeder Geste, jeder Spalte" und
    auch beim Wechsel auf den Wisch stehen. Ausgewichen werden muss in y.

    Gibt None zurueck, wenn kein freier Punkt zu finden ist — dann ist der
    Bildschirm nicht der erwartete und der Aufrufer soll anhalten, nicht raten.
    """
    sperr = [(a - _ANSATZ_RAND, b + _ANSATZ_RAND)
             for a, b in ws_roster.gruppenbalken(g, bild)]
    # Von unten nach oben: je tiefer der Ansatz, desto sicherer bleibt das
    # Ende der Geste innerhalb der Liste.
    kandidaten = list(range(_ANSATZ_BIS, _ANSATZ_VON - 1, -50))
    frei = [y for y in kandidaten
            if not any(a <= y <= b for a, b in sperr)]
    return frei[variante % len(frei)] if frei else None


def weiter(g: Geraet, bild=None, variante: int = 0, log=print) -> None:
    """Ein Scroll-Schritt, der garantiert nicht auf einer Rang-Leiste ansetzt.

    **Warum `input swipe` und nicht die Mausrad-Geste.** Fuer den Wuestensturm
    ist `rad_schritt` die zuverlaessige Geste (dort gemessen: kein einziger
    Stillstand). Im Schluchtsturm-Dialog ist es umgekehrt: am 06.09.2026
    lieferte das Rad in R3 achtmal hintereinander 0 px — auch mit vier Sekunden
    Pause zwischen den Versuchen — waehrend ein `input swipe` im selben,
    scheinbar festgefahrenen Zustand sofort wieder Bewegung brachte.

    Langsam gezogen, nicht geschnippt: derselbe Weg in 600 ms wirft die Liste
    um rund acht Karten weiter (Schwung), in 2500 ms bewegt sie sich etwa 1:1
    zur Fingerstrecke. Geschnippt fallen Mitglieder durch.
    """
    bild = g.bild() if bild is None else bild
    y = _freier_ansatz(g, bild, variante)
    if y is None:
        raise MusterAbweichung(
            "Kein Ansatzpunkt fuer die Scroll-Geste gefunden, der frei von "
            "Rang-Leisten ist — der Bildschirm ist nicht die erwartete Liste.")
    g.wischen(g.cfg["rad"]["x"], y, y - _STRECKE, _DAUER_MS, pause_nach=1.4)


def zeile_lesen_cs(g: Geraet, bild, y_kopf_ende: int, registriert: bool = True) -> dict:
    """Name, Kraft und Team-Wunsch einer Zeile.

    `y_kopf_ende` ist das Ende des gruenen Zeitbandes (aus `zeitkoepfe`) — der
    Anker, an dem sowohl der Name als auch das rote Overlay haengen. Fuer
    Zeilen ohne Band (nicht angemeldet) liefert `_alle_karten_anker` denselben
    Anker rechnerisch aus der 'Gesamtkampfkraft'-Zeile, damit hier dieselbe
    Funktion greift — ein rotes Overlay kann dort ohnehin nicht gefunden werden.
    """
    nx0, nx1 = g.cfg["name_box_x"]
    text = v.ocr(bild, (nx0, y_kopf_ende + 8, nx1, y_kopf_ende + 205), psm=6)
    zeilen = [z.strip() for z in text.splitlines() if z.strip()]
    name = zeilen[0] if zeilen else ""

    wx0, wx1 = g.cfg["wunsch_x"]
    wdy0, wdy1 = g.cfg["wunsch_dy"]
    anteil = vc.wunsch_anteil(bild, wx0, y_kopf_ende + wdy0, wx1, y_kopf_ende + wdy1)
    wunsch = registriert and anteil >= g.cfg["wunsch_schwelle"]

    # Gesetzt-/Ersatz-Feld: zeigt den tatsaechlichen Truppen-Buchstaben,
    # unabhaengig davon, welche Truppe gerade geoeffnet ist (siehe
    # vision_cs.feld_buchstabe). Nur fuer registrierte Karten sinnvoll, aber
    # das Lesen selbst schadet bei unregistrierten nicht — dort ist die Kachel
    # ohnehin leer.
    fdy0, fdy1 = g.cfg["feld_dy"]
    gx0, gx1 = g.cfg["feld_gesetzt_x"]
    ex0, ex1 = g.cfg["feld_ersatz_x"]
    gesetzt = vc.feld_buchstabe(bild, (gx0, y_kopf_ende + fdy0, gx1, y_kopf_ende + fdy1),
                                 g.cfg.get("feld_leer_grau", 181),
                                 g.cfg.get("feld_abweichung_schwelle", 0.05)) if registriert else None
    ersatz = vc.feld_buchstabe(bild, (ex0, y_kopf_ende + fdy0, ex1, y_kopf_ende + fdy1),
                                g.cfg.get("feld_leer_grau", 181),
                                g.cfg.get("feld_abweichung_schwelle", 0.05)) if registriert else None

    return {"name_ocr": name, "kraft": v.kraft(text), "wunsch": wunsch,
            "wunsch_anteil": round(anteil, 3), "registriert": registriert,
            "gesetzt": gesetzt, "ersatz": ersatz}


# Versatz von der 'Gesamtkampfkraft'-Zeile (Mittelpunkt) zurueck auf das
# rechnerische 'y_kopf_ende' (Namens-Boxanfang minus 8px), kalibriert an zwei
# bekannten Karten vom 06.09.2026: EmpatroN (unregistriert, Name y=1273,
# Kraft y=1331) und Republica58 (registriert, echtes Zeitband-Ende y=1577,
# Kraft y=1686) — beide ergeben ~86px.
_KRAFT_ANKER_VERSATZ = 86


def _alle_karten_anker(g: Geraet, bild) -> list[tuple[int, bool]]:
    """Ein Anker (rechnerisches 'y_kopf_ende') je Spielerkarte im Bild —
    registriert oder nicht.

    Die 'Gesamtkampfkraft der Helden'-Zeile hat **jede** Karte, unabhaengig
    von einer Anmeldung — anders als das gruene Zeitband, das nur registrierte
    Karten tragen. Sie ist deshalb der universelle Anker; das Zeitband wird nur
    noch benutzt, um zu entscheiden, *ob* diese Karte zusaetzlich registriert
    ist (dann zaehlt auch das rote Overlay).

    Ohne diesen Anker wuerden unregistrierte Karten beim Lesen komplett
    uebersprungen — genau das ist am 06.09.2026 passiert: nur ~25 von ~100
    Mitgliedern kamen in die Liste, weil `zeitkoepfe` allein nur angemeldete
    Zeilen findet.
    """
    x0, y0, x1, y1 = g.cfg["list_view"]
    treffer = v.woerter(bild, (x0, y0, x1, y1), min_conf=40)
    # "ampfkraft" statt nur "kampfkraft": Tesseract schneidet das fuehrende
    # 'Gesamtk' der Zeile gelegentlich ab (live beobachtet an Republica58s
    # Karte am 06.09.2026) — mit dem vollen Wort waere die Karte durchgerutscht.
    anker_y = sorted({int(w["y"]) for w in treffer if "ampfkraft" in v._norm(w["text"])})
    koepfe = ws_roster.zeitkoepfe(g, bild)
    out = []
    for ay in anker_y:
        y_kopf_ende = ay - _KRAFT_ANKER_VERSATZ
        passend = next((k for k in koepfe if abs(k[1] - y_kopf_ende) < 40), None)
        if passend:
            out.append((passend[1], True))
        else:
            out.append((y_kopf_ende, False))
    return out


def gruppen_zaehler_cs(g: Geraet, bild, y0: int) -> dict:
    """Wie `ws_roster.gruppen_zaehler`, ergaenzt um 'gemeldet' — die blaue Zahl
    vor dem Schraegstrich der Mitgliederzahl (siehe config.json). 'kommandant'
    bleibt drin, weil `_balken_schluessel` ihn zur Wiedererkennung derselben
    Gruppe ueber mehrere Bilder hinweg braucht, auch wenn er inhaltlich
    uninteressant ist.
    """
    zaehler = ws_roster.gruppen_zaehler(g, bild, y0)
    x0, x1 = g.cfg["group_members_x"]
    dy0, dy1 = g.cfg["gemeldet_dy"]
    zaehler["gemeldet"] = vc.blaue_zahl(bild, (x0, y0 + dy0, x1, y0 + dy1))
    zaehler["mitglieder"] = v.bruch(bild, (x0, y0 + g.cfg["group_counter_dy"][0] - 10,
                                            x1, y0 + g.cfg["group_counter_dy"][1]))
    return zaehler


def _kartenrand(g: Geraet) -> int:
    """Wie tief eine Karte unter ihrem Anker reicht — bestimmt, ab wann eine
    Karte am unteren Rand als 'angeschnitten' gilt und ausgelassen wird.

    Muss mindestens das Gesetzt-/Ersatz-Feld einschliessen (`feld_dy[1]`):
    sonst gilt eine Karte schon als vollstaendig sichtbar, obwohl der
    Knopfstreifen unter der Liste ihr Feld noch verdeckt — am 06.09.2026 kam
    ZephyrusXI so mit `gesetzt=None` heraus, obwohl das Feld ein 'A' zeigte.
    """
    return max(140, g.cfg.get("feld_dy", [0, 140])[1])


def _gruppe_lesen(g: Geraet, bild, gesehen: set, zeilen: list, log) -> None:
    """Alle noch nicht gesehenen Karten dieses Bildes anhaengen — registriert
    oder nicht (siehe `_alle_karten_anker`)."""
    rand = _kartenrand(g)
    for anker_y, registriert in _alle_karten_anker(g, bild):
        if anker_y + rand >= g.cfg["list_view"][3]:
            continue  # angeschnitten, kommt im naechsten Bild wieder
        z = zeile_lesen_cs(g, bild, anker_y, registriert=registriert)
        if not z["name_ocr"] and z["kraft"] is None:
            continue  # nichts Lesbares -- kein echter Treffer
        schluessel = (z["name_ocr"], z["kraft"])
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        zeilen.append(z)
        stand = "reg" if registriert else "  -"
        log(f"    [{stand}] {z['kraft']}M Wunsch={z['wunsch']} {z['name_ocr']!r}")


def _rang_schliessen(g: Geraet, log) -> None:
    bild = g.bild()
    balken = ws_roster.gruppenbalken(g, bild)
    if not balken:
        log("  Kein Balken zum Zuklappen gefunden — bleibt offen.")
        return
    y0, y1 = balken[0]  # die gerade bearbeitete Gruppe klebt beim Scrollen oben
    g.tippen(g.cfg["group_arrow_x"], (y0 + y1) // 2, pause=1.6)


def durchlauf_je_rang(g: Geraet, log=print, max_schritte_je_rang: int = 90) -> dict:
    """Eine Rang-Gruppe nach der anderen: oeffnen, **nur innerhalb** scrollen
    und lesen, wieder schliessen — dann erst die naechste.

    Der fruehere Ansatz (ws_roster.durchlauf mit `leser=zeile_lesen_cs`) hat
    beim Schluchtsturm mehrfach zu Verwirrung gefuehrt: mehrere Gruppen waren
    gleichzeitig offen/im Zuklappen, und am 06.09.2026 endete ein Lauf sogar
    ausserhalb des Dialogs im Allianz-Chat. Rang fuer Rang ist langsamer, aber
    eindeutig: waehrend eine Gruppe bearbeitet wird, sind alle anderen
    eingeklappt, und nach dem Zuklappen springt die Ansicht nachweislich exakt
    auf den sauberen Ausgangszustand zurueck (live verifiziert).

    Vorbedingung: der Dialog zeigt **alle** Rang-Gruppen eingeklappt (das ist
    der Zustand direkt nach dem Oeffnen ueber 'Verwalten'). Es wird nicht
    versucht, das selbst herzustellen — anders als beim Namens-Durchlauf lohnt
    sich in diesem Zustand kein Scrollen (siehe frueherer `uebersicht()`-Versuch:
    eingeklappt bewegt sich die Liste nicht, vermutlich weil ohnehin alles ins
    Fenster passt).

    Das Rang-Ende wird an der **Zielzahl aus der Rang-Kopfzeile** erkannt
    (`mitglieder`, z.B. 81 bei R3) — nicht daran, ob ein weiterer Rang-Balken
    sichtbar ist. Genau das war bis zum 06.09.2026 die Abbruchbedingung und der
    Grund, warum nie alle Mitglieder gelesen wurden: die eingeklappten Balken
    der **uebrigen** Raenge stehen waehrend des Scrollens dauerhaft mit im
    Bild, `len(gruppenbalken) > 1` ist also schon beim ersten Schritt wahr.
    Jeder Rang meldete daraufhin sofort "fertig" — R4 nach 2 von 10 Karten,
    R3 nach 3 von 81 — und der Lauf sah hinterher erfolgreich aus.
    """
    # Keine Vorab-Zaehlung mehr: der allererste Blick auf den frisch
    # geoeffneten Dialog hat wiederholt zu wenige Balken gefunden (mal 3, mal
    # 2 statt 5), obwohl ein Screenshot kurz danach alle zeigte — ein
    # einmaliger Rendering-Aussetzer, kein echter Zustand. Eine falsche
    # Vorab-Zahl `n` liess den Lauf danach mit vertauschten Raengen
    # weiterlaufen (am 06.09.2026 live beobachtet). Stattdessen wird bei
    # jedem Schritt frisch geprueft, ob an Position `i` noch ein Balken
    # steht — und das erst nach einer zweiten Bestaetigung verneint.
    alle_zeilen: list[dict] = []
    gruppen: dict[str, dict] = {}

    i = 0
    while True:
        bild = g.bild()
        balken = ws_roster.gruppenbalken(g, bild)
        if i >= len(balken):
            # Zweite Bestaetigung, bevor "fertig" gilt — derselbe Aussetzer
            # wie bei der frueheren Vorab-Zaehlung koennte sonst einen Rang
            # kurz vor Schluss verschlucken.
            bild2 = g.bild()
            balken2 = ws_roster.gruppenbalken(g, bild2)
            if i >= len(balken2):
                log(f"  Keine weitere Rang-Gruppe an Position {i + 1} — {i} insgesamt bearbeitet.")
                break
            bild, balken = bild2, balken2
        y0, y1 = balken[i]
        zaehler = gruppen_zaehler_cs(g, bild, y0)
        # Schluessel nur zur Anzeige/Fehlersuche — als Dict-Key mit dem Index
        # kombiniert, weil zwei verschiedene Raenge zufaellig dieselben
        # Gesetzt/Ersatz-Zahlen tragen koennen (hier: R3 und R4 beide "4|0").
        # Ohne den Index wuerde einer die Gegenprobe-Summe des anderen
        # stillschweigend ueberschreiben.
        schluessel = ws_roster._balken_schluessel(g, bild, y0, zaehler)
        gruppen[f"{i}:{schluessel}"] = zaehler
        # Ziel ist 'mitglieder' (alle Karten der Gruppe, registriert oder
        # nicht) — seit `_alle_karten_anker` auch unregistrierte Karten in
        # `zeilen` landen, ist das wieder die richtige Zielzahl. Vorher stand
        # hier 'gemeldet' (nur die Anmeldungen), weil zeilen ausschliesslich
        # aus registrierten Karten bestand — das ergab am 06.09.2026 nur ~25
        # von ~100 Mitgliedern insgesamt, obwohl fuer jeden Rang "fertig"
        # gemeldet wurde.
        ziel = zaehler.get("mitglieder")
        log(f"  Rang {i + 1} ({schluessel}): {zaehler} — oeffnen ...")
        g.tippen(g.cfg["group_arrow_x"], (y0 + y1) // 2, pause=1.6)

        gesehen: set = set()
        zeilen: list[dict] = []
        _gruppe_lesen(g, g.bild(), gesehen, zeilen, log)

        # Fortschritt wird an **neu gelesenen Karten** gemessen, nicht am
        # Pixelversatz. `ws_roster._versatz` liefert im CS-Dialog immer wieder
        # `None` ("nicht messbar"), und der fruehere Code wertete das wie
        # "nicht bewegt" — daraus wurde am 06.09.2026 ein Abbruch mitten in
        # R4, obwohl die Liste nachweislich lief (gemessen: die Mausrad-Geste
        # bewegt hier 175…524 px, kein einziger Stillstand). Neue Karten sind
        # ohnehin das, worauf es ankommt.
        leerlauf = 0
        for schritt in range(max_schritte_je_rang):
            # `ziel == 0` ist ein gueltiges, sogar haeufiges Ergebnis (Raenge
            # ohne jede Anmeldung wie R5 hier) und muss sofort greifen — daher
            # "is not None" statt eines Wahrheitswert-Tests.
            if ziel is not None and len(zeilen) >= ziel:
                log(f"    {len(zeilen)}/{ziel} Karten erfasst — Rang fertig.")
                break

            vor_diesem_schritt = len(zeilen)
            weiter(g, variante=leerlauf, log=log)
            _gruppe_lesen(g, g.bild(), gesehen, zeilen, log)

            if len(zeilen) > vor_diesem_schritt:
                leerlauf = 0
                continue

            leerlauf += 1
            log(f"    Keine neue Karte ({leerlauf}. Mal in Folge) — Extra-Pause ...")
            time.sleep(1.5)
            if leerlauf < 4:
                continue
            if ziel is None:
                log("    Kein Fortschritt mehr, keine Zielzahl lesbar — "
                    "Rang-Ende angenommen.")
                break
            raise MusterAbweichung(
                f"Rang {i + 1} ({schluessel}): vier Gesten ohne eine einzige neue "
                f"Karte — {len(zeilen)}/{ziel} erfasst.")
        else:
            raise MusterAbweichung(
                f"Rang {i + 1} ({schluessel}): Obergrenze von {max_schritte_je_rang} "
                f"Scroll-Schritten erreicht, ohne dass der Rang als fertig erkannt wurde — "
                f"{len(zeilen)}/{ziel if ziel is not None else '?'} Karten erfasst.")

        alle_zeilen += zeilen
        log(f"  Rang {i + 1}: {len(zeilen)} Zeilen gelesen, zuklappen ...")
        _rang_schliessen(g, log)
        i += 1

    summe = {}
    for rolle in ("gesetzt", "ersatz"):
        werte = [z.get(rolle) for z in gruppen.values()]
        summe[rolle] = None if any(w is None for w in werte) else sum(werte)
    gemeldet_werte = [z.get("gemeldet") for z in gruppen.values()]
    gemeldet_summe = None if any(w is None for w in gemeldet_werte) else sum(gemeldet_werte)

    return {"zeilen": alle_zeilen, "gruppen": gruppen,
            "gruppen_summe": summe, "gemeldet_summe": gemeldet_summe}


def dialog_gesamt(g: Geraet, bild) -> int | None:
    """Die Zahl hinter 'Teilnehmer: N' unter der Liste — die Gegenprobe.

    Anders als beim Wuestensturm gibt es hier keine Gesetzt/Ersatz-Slots zu
    treffen (die Kacheln im Bild sind Spielinterna, siehe __init__.py) — die
    einzige verlaessliche Zahl ist die Gesamtzahl der Bewerber fuer die gerade
    offene Truppe.
    """
    text = v.ocr(bild, tuple(g.cfg["dialog_gesamt"]), psm=7)
    m = _ZAHL.search(text)
    return int(m.group(1)) if m else None


def durchlauf(g: Geraet, log=print) -> dict:
    """Alle Rang-Gruppen der gerade geoeffneten Truppe, eine nach der anderen
    (siehe `durchlauf_je_rang`). Ergaenzt die Gesamtzahl aus der Fusszeile.
    """
    roh = durchlauf_je_rang(g, log=log)
    bild = g.bild()
    roh["gesamt"] = dialog_gesamt(g, bild)
    if roh["gesamt"] is not None:
        log(f"  Laut Spiel insgesamt {roh['gesamt']} Bewerber fuer diese Truppe.")
    return roh


def zu_werten_einzeln(zeilen: list[dict], offene_truppe: str = "A") -> list[dict]:
    """Rohzeile -> 'A'/'B', aus einem einzigen Durchlauf.

    Bis zum 06.09.2026 brauchte es dafuer zwei Durchlaeufe (Truppe A und B),
    weil nur das rote Wunsch-Overlay ausgewertet wurde — das erscheint nur auf
    dem Bildschirm der jeweils offenen Truppe. Seitdem ist bestaetigt: das
    Gesetzt-/Ersatz-Feld zeigt den tatsaechlichen Buchstaben unabhaengig vom
    offenen Bildschirm (live beobachtet: LittleFighter zeigte 'B' im
    Gesetzt-Feld, waehrend Truppe A offen war und kein rotes Overlay zu sehen
    war). Damit reicht ein Durchlauf:

    1. Steht im Gesetzt- oder Ersatz-Feld ein Buchstabe, gilt der — das ist
       die vom Spiel selbst gefuehrte Zuteilung, verlaesslicher als jede
       Ableitung.
    2. Sonst entscheidet der Wunsch: ein rotes Overlay gilt nur fuer die
       offene Truppe.
    3. Angemeldet (gruenes Band, sonst waere die Zeile gar nicht in `zeilen`),
       aber ohne Feld-Buchstaben und ohne Overlay auf der offenen Truppe —
       dann bleibt nur die andere Truppe, es gibt schliesslich nur zwei.
    """
    andere = "B" if offene_truppe == "A" else "A"
    out = []
    for z in zeilen:
        if z.get("gesetzt") in ("A", "B"):
            wert, rolle = z["gesetzt"], "gesetzt"
        elif z.get("ersatz") in ("A", "B"):
            wert, rolle = z["ersatz"], "ersatz"
        elif z.get("wunsch"):
            wert, rolle = offene_truppe, "wunsch"
        else:
            wert, rolle = andere, "wunsch"
        z["wert"] = wert
        z["rolle"] = rolle
        out.append(z)
    return out
