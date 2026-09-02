"""Der Weg von der Basis bis zur Teilnehmerliste des Wuestensturms.

Hauptkarte → Events → Reiter „Wuestensturm" → „Teilnehmer auswaehlen".

Der Reiter wird **gesucht, nicht angetippt, wo er letzte Woche war.** Das erste
Blatt ist immer Wettruesten, danach haengt es an den laufenden Events, wie viele
Reiter es gibt und in welcher Reihenfolge — feste Koordinaten treffen dort
frueher oder spaeter den falschen.

Nach dem Anmeldeschluss (Donnerstag 04:00) gibt es „Teilnehmer auswaehlen" nicht
mehr, sondern rechts „Teilnehmer" mit den 30 Eingeteilten. Der Dienst bricht
dann sauber ab, statt irgendwohin zu tippen: `AnmeldungGeschlossen`.
"""
from __future__ import annotations

import time

from . import vision as v
from .device import Geraet


class NavigationFehler(RuntimeError):
    pass


class AnmeldungGeschlossen(RuntimeError):
    """Anmeldephase vorbei — es gibt nichts mehr auszulesen."""


def _box(cfg, name):
    return tuple(cfg[name])


# Der Knopf unten rechts schaltet zwischen den beiden Ansichten um und trägt
# immer den Namen der **anderen**: auf der Basis steht dort „WELT", auf der
# Weltkarte „BASIS". Er ist damit zugleich die verlässlichste Auskunft darüber,
# wo man gerade ist.
_ANSICHT_BOX = (1900, 2280, 2560, 2560)


def auf_hauptkarte(g: Geraet, bild=None) -> bool:
    bild = g.bild() if bild is None else bild
    return v.finde_wort(bild, _ANSICHT_BOX, "welt") is not None


def auf_weltkarte(g: Geraet, bild=None) -> bool:
    bild = g.bild() if bild is None else bild
    return v.finde_wort(bild, _ANSICHT_BOX, "basis") is not None


def zur_hauptkarte(g: Geraet, log=print, versuche: int = 6) -> None:
    """Zurueck auf die Basis — je nach Lage mit dem Knopf oder mit „Zurueck".

    Die Weltkarte braucht den Umschalt-Knopf, **nicht** „Zurueck": dort ist die
    Basis kein Bildschirm weiter unten im Stapel, und die Zurueck-Taste oeffnet
    stattdessen die Frage „Spiel verlassen?". Wer das verwechselt, klopft sich
    in eine Schleife — der Dialog verdeckt den Knopf, die Ansicht wird weiter
    nicht erkannt, und der naechste Zurueck-Druck kommt sofort hinterher.
    Genau das ist am 02.09.2026 passiert.
    """
    g.app_starten(log=log)
    for i in range(versuche):
        bild = g.bild()
        if auf_hauptkarte(g, bild):
            return
        if auf_weltkarte(g, bild):
            log(f"  auf der Weltkarte (Versuch {i + 1}) — auf Basis umschalten ...")
            g.tippen(*g.cfg["basis_knopf"], pause=2.5)
            continue
        log(f"  nicht auf der Hauptkarte (Versuch {i + 1}) — zurueck ...")
        g.zurueck()
    if not auf_hauptkarte(g):
        raise NavigationFehler(
            "Komme nicht auf die Hauptkarte. Haengt Last War in einem Dialog "
            "oder in der Anmeldung? Bitte einmal von Hand nachsehen.")


def events_offen(g: Geraet, bild=None) -> bool:
    bild = g.bild() if bild is None else bild
    return "events" in v._norm(v.ocr(bild, _box(g.cfg, "events_title"), psm=7))


def streifen_frei(g: Geraet, bild=None) -> bool:
    """Liegt ein Hinweisfenster ueber dem Reiterstreifen?

    Gezaehlt werden Woerter statt nach einem bestimmten gesucht: welcher Reiter
    im Streifen steht, wechselt — dass ueberhaupt mehrere lesbar sind, heisst
    aber verlaesslich, dass nichts davorliegt.
    """
    bild = g.bild() if bild is None else bild
    return len(v.woerter(bild, _box(g.cfg, "tab_strip"))) >= 2


def blatt_titel(g: Geraet, bild=None) -> str:
    """Der Name des gerade gezeigten Blattes, oben links im Fenster."""
    bild = g.bild() if bild is None else bild
    return v.ocr(bild, _box(g.cfg, "sheet_title"), psm=7).strip()


def events_oeffnen(g: Geraet, log=print, versuche: int = 6) -> None:
    """Events-Icon antippen, bis der Reiterstreifen frei liegt.

    Beim Oeffnen springt gern ein Hinweisfenster auf („Pruefung des Generals").
    Es liegt ueber dem Streifen, waehrend die Ueberschrift „Events" darueber
    sichtbar bleibt — deshalb reichen weder das eine noch das andere Merkmal
    allein, und deshalb wird in einer Schleife geraeumt statt einmal getippt.
    """
    for i in range(versuche):
        bild = g.bild()
        if events_offen(g, bild) and streifen_frei(g, bild):
            return
        if auf_hauptkarte(g, bild):
            log("  Events oeffnen ...")
            g.tippen(*g.cfg["events_icon"], pause=2.5)
        else:
            log(f"  Fenster liegt davor (Versuch {i + 1}) — schliessen ...")
            g.zurueck()
        time.sleep(0.5)
    raise NavigationFehler("Der Reiterstreifen der Events ist nicht aufgetaucht.")


def reiter_waehlen(g: Geraet, name: str = "Wuestensturm", log=print,
                   schiebe_versuche: int = 5) -> None:
    """Blatt waehlen — gesucht wird ueber den Reitertext, geprueft ueber den Titel.

    **Der aktive Reiter traegt kein Wort, sondern ein Bild.** Wer nur nach dem
    Text sucht, findet das gewaehlte Blatt nie und schiebt den Streifen so lange
    weiter, bis er am Anschlag steht. Deshalb steht die Titelpruefung vorn: ist
    das Blatt schon offen, ist nichts zu tun.

    Wie viele Reiter es gibt, haengt an den laufenden Events; der Streifen kann
    ueber den Bildrand hinausgehen und wird dann seitlich geschoben.
    """
    box = _box(g.cfg, "tab_strip")
    for i in range(schiebe_versuche + 1):
        bild = g.bild()
        if v._norm(name) in v._norm(blatt_titel(g, bild)):
            log(f"  Blatt '{name}' ist offen.")
            return
        treffer = v.finde_wort(bild, box, name)
        if treffer:
            log(f"  Reiter '{name}' bei x={treffer['x']:.0f} — antippen.")
            g.tippen(treffer["x"], treffer["y"], pause=2.5)
            if v._norm(name) in v._norm(blatt_titel(g)):
                return
            log("  ... Titel passt noch nicht, weiter suchen.")
        if i < schiebe_versuche:
            log(f"  '{name}' nicht im Streifen — weiterschieben ({i + 1}) ...")
            mitte_y = (box[1] + box[3]) // 2
            g.wischen(1900, mitte_y, 900, mitte_y, 900, pause_nach=1.2)
    raise NavigationFehler(
        f"Blatt '{name}' nicht gefunden. Laeuft das Event gerade ueberhaupt?")


def anmeldeschluss(g: Geraet, bild=None) -> str | None:
    """„Die Anmeldung endet in 14:22:45" → '14:22:45', sonst None."""
    bild = g.bild() if bild is None else bild
    text = v.ocr(bild, (600, 1300, 2000, 1560), psm=6)
    for zeile in text.splitlines():
        if "endet" in zeile.lower():
            teile = [t for t in zeile.split() if t.count(":") == 2]
            if teile:
                return teile[-1]
    text2 = v.ocr(bild, (600, 1400, 2000, 1560), psm=7)
    teile = [t for t in text2.split() if t.count(":") == 2]
    return teile[-1] if teile else None


def blatt_zeit(g: Geraet, bild=None) -> str | None:
    """Die Kampfzeit des gerade gewaehlten Blattes: „Kampftag: 2026-9-4 13:00 ~ 13:30".

    Sie sagt, welche Einsatztruppe offen ist — 13:00 ist A, 22:00 ist B (welche
    genau, steht im Tool unter `wsTime`). Damit muss zum Bestimmen des Blattes
    **nichts angetippt** werden: je weniger Tipper in einem laufenden Spiel,
    desto weniger kann schiefgehen.
    """
    bild = g.bild() if bild is None else bild
    return v.uhrzeit(v.ocr(bild, _box(g.cfg, "sheet_time"), psm=7))


def einsatztruppe_waehlen(g: Geraet, team: str, log=print) -> None:
    """A oder B umschalten — nur, wenn ausdruecklich verlangt.

    Die beiden Kacheln haben feste Plaetze auf dem Blatt (anders als die Reiter,
    deren Zahl mit den laufenden Events wechselt), deshalb stehen sie in
    config.json. Ueber ihre Beschriftung ginge es nicht verlaesslich: die nicht
    gewaehlte Kachel ist abgedunkelt und wird von der OCR nur als Bruchstueck
    gelesen („ruUPpe").

    Geprueft wird hinterher an der Kampfzeit, nicht am Aussehen der Kachel.
    """
    ziel = g.cfg["einsatztruppe"].get(team.upper())
    if not ziel:
        raise NavigationFehler(f"Keine Koordinaten fuer Einsatztruppe {team!r}.")
    vorher = blatt_zeit(g)
    log(f"  Einsatztruppe {team.upper()} waehlen ...")
    g.tippen(*ziel, pause=2.0)
    nachher = blatt_zeit(g)
    log(f"  Kampfzeit des Blattes: {vorher} → {nachher}")


def teilnehmer_dialog_oeffnen(g: Geraet, log=print) -> None:
    """„Teilnehmer auswaehlen" unten antippen.

    Der Knopf traegt seinen Text auf zwei Zeilen. Gesucht wird deshalb das Wort
    „Teilnehmer" **im unteren Streifen** — nach dem Anmeldeschluss steht dort
    keins mehr (der dann sichtbare Knopf „Teilnehmer" sitzt rechts oben am
    Blatt, ausserhalb dieses Ausschnitts), und genau daran erkennt der Dienst,
    dass es nichts mehr auszulesen gibt.
    """
    bild = g.bild()
    box = _box(g.cfg, "bottom_buttons")
    ziel = v.finde_knopf(bild, box, "Teilnehmer auswaehlen")
    if not ziel:
        raise AnmeldungGeschlossen(
            "Unten steht kein 'Teilnehmer auswaehlen' — die Anmeldephase ist "
            "vorbei. Der Kader steht dann schon fest und wird hier nicht mehr "
            "angefasst.")
    log(f"  '{ziel['text']}' antippen (Aehnlichkeit {ziel['score']}) ...")
    g.tippen(ziel["x"], ziel["y"], pause=3.0)
    if not liste_offen(g):
        raise NavigationFehler("Die Teilnehmerliste ist nicht aufgegangen.")


def liste_offen(g: Geraet, bild=None) -> bool:
    """Erkennbar an den Rang-Kopfzeilen im Listenbereich."""
    bild = g.bild() if bild is None else bild
    x0, y0, x1, y1 = _box(g.cfg, "list_view")
    s = g.cfg["schwellen"]
    baender = v.baender(bild, y0, y1, 700, 1500, v.ist_gruppenbalken,
                        s["gruppe_min_hoehe"])
    return len(baender) >= 1


def dialog_schliessen(g: Geraet) -> None:
    g.tippen(*g.cfg["dialog_close"], pause=1.5)


def zur_teilnehmerliste(g: Geraet, team: str | None = None, log=print) -> dict:
    """Kompletter Weg. `team=None` laesst offen, was offen ist.

    Umgeschaltet wird nur auf ausdruecklichen Wunsch. Die Liste zeigt ohnehin
    beide Teams — das Blatt bestimmt allein, welche Zaehler zur Gegenprobe
    danebenstehen, und welches Blatt das ist, verraet seine Kampfzeit.
    """
    zur_hauptkarte(g, log=log)
    events_oeffnen(g, log=log)
    reiter_waehlen(g, "Wuestensturm", log=log)
    bild = g.bild()
    rest = anmeldeschluss(g, bild)
    if rest:
        log(f"  Anmeldung endet in {rest}.")
    if team:
        einsatztruppe_waehlen(g, team, log=log)
    zeit = blatt_zeit(g)
    log(f"  Offenes Blatt: Kampfzeit {zeit}.")
    teilnehmer_dialog_oeffnen(g, log=log)
    return {"anmeldung_endet_in": rest, "blatt_zeit": zeit}
