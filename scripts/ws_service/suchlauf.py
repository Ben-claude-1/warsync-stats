"""Jeden Kadernamen einzeln im Suchfeld nachschlagen — und belegen.

    .venv/bin/python -m scripts.ws_service.suchlauf
    .venv/bin/python -m scripts.ws_service.suchlauf --namen "Ben_the_men" "Puwe"
    .venv/bin/python -m scripts.ws_service.suchlauf --schreiben

Ueber der Teilnehmerliste steht „Mitglieder suchen". Ein Name hinein, und
darunter steht **seine eine Zeile** — ohne einen einzigen Wisch. Das ist der
Weg am Scroll-Haenger vorbei (siehe `docs/themen/bluestacks-steuerung.md`), und
er ist zugleich der einzige, der die Frage beantwortet, um die es hier geht:

**„War er angemeldet oder nicht?"** Der Scroll-Lauf ankert seine Zeilen am
Zeit-Balken und sieht deshalb ueberhaupt nur die Angemeldeten — wer dort fehlt,
ist „nicht gesehen", und das ist keine Auskunft. Der Suchlauf schlaegt jeden
Kadernamen einzeln nach und sieht die Zeile in beiden Faellen: mit Balken heisst
angemeldet, ohne Balken heisst nicht angemeldet. Beides wird als Bild abgelegt.

Der Preis ist Zeit statt Zuverlaessigkeit: rund 19 s je Name, gut eine halbe
Stunde fuer hundert. Dafuer kann keine Zeile uebersprungen werden — es gibt
keine Schrittweite, die daneben liegen koennte.

**Der Scan muss vor Donnerstag 04:00 laufen.** Danach zeichnet Last War die
Zeit-Balken nicht mehr, und dann sagt ihr Fehlen nichts mehr aus (siehe
`navigate.AnmeldungGeschlossen` und die Themen-Datei).

**Getippt wird die Schreibweise des Spiels, nicht der Kadername**
(`suchnamen.json`, geladen von `match.suchname`). Das Suchfeld sucht woertlich:
`Ben_the_men` steht im Spiel als `Ben the men` und lieferte deshalb am
29.09.2026 als einziger von 97 Namen ueberhaupt keine Zeile — was wie „nicht
angemeldet" aussieht und keines ist. Gemeldet und geschrieben wird weiterhin
unter dem Kadernamen; angeglichen wird der Kader ausdruecklich nicht.
"""
from __future__ import annotations

import argparse
import difflib
import json
import shlex
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

from . import belege, match, navigate, roster, tool
from . import vision as v
from .device import Geraet, GeraetFehler
from .navigate import AnmeldungGeschlossen, NavigationFehler

BERICHTE = Path.home() / ".local" / "state" / "warsync" / "ws_service"

FELD = (1280, 950)            # „Mitglieder suchen" — Rueckfall, siehe suchfeld()
# Grosszuegig, weil der Dialog zwei Fassungen hat: steht darueber das
# Auswahlfeld „Einsatztruppe" (nach dem Anmeldeschluss), sitzt alles rund
# 170 px hoeher.
SUCHFELD_BOX = (700, 640, 1900, 1060)
EINGABEZEILE = (1024, 2493)   # die Zeile, die das Spiel unten einblendet
EINGABE_STREIFEN = (200, 2460, 2360, 2530)
EINGABE_HELL = 200            # heller Streifen = die Zeile ist offen

# Wie lange je Name hingesehen wird. Wer sich fuer beide Uhrzeiten gemeldet
# hat, zeigt die beiden Balken abwechselnd — und zwar **gleichmaessig**: am
# 22.10.2026 an `jgShadow` gemessen (`messe_wechsel.py`, 89 Bilder in 30 s),
# stand jede Farbe 2,71 … 3,12 s, im Mittel 3,0 s. Wer so lange auf eine Zeile
# sieht, hat beide Farben gesehen, falls es zwei gibt; laenger zu warten bringt
# nichts. Das Fenster ist die laengste Stehzeit plus ein Bildabstand (0,34 s).
#
# Die fruehere Beobachtung „abwechselnd, aber nicht halbe-halbe" (ZephyrusXI
# viermal 09:00, einmal 18:00) war ein Messfehler der alten Probenfolge: fuenf
# Bilder im Abstand von 1,6 s plus Texterkennung fallen bei einer Periode von
# 6 s auf immer dieselbe Phase.
WECHSEL_FENSTER = 3.5
# Ohne Balken gibt es nichts abzuwarten — eine Zeile ohne Zeit-Balken ist
# nicht angemeldet und kann auch keinen zweiten zeigen. Ein zweites Bild
# trotzdem, falls das erste in den Aufbau des Suchergebnisses fiel.
OHNE_BALKEN_BILDER = 2

# Ab welcher Aehnlichkeit die Zeile als die des gesuchten Spielers gilt.
NAME_BESTAETIGT = 0.62
KRAFT_ABWEICHUNG = 0.05


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _aktivieren(app: str) -> None:
    subprocess.run(["osascript", "-e", f'tell application "{app}" to activate'],
                   capture_output=True)


def eingabezeile_offen(g: Geraet, bild=None) -> bool:
    """Die Eingabezeile des Spiels ist ein heller Streifen am unteren Rand.

    **Sie muss dasein, bevor dorthin getippt wird.** Ist sie es nicht, liegt
    unter der Stelle der Ereignis-Bildschirm — und ein Tipp schliesst den
    Dialog. Genau so ging der erste Anlauf am 23.09.2026 verloren.
    """
    import numpy as np
    b = bild if bild is not None else g.bild()
    x0, y0, x1, y1 = EINGABE_STREIFEN
    return float(np.asarray(b)[y0:y1, x0:x1].mean()) > EINGABE_HELL


def feld_leeren(g: Geraet) -> None:
    """Der X-Knopf neben dem Feld leert es nicht.

    Ohne diese Kontrolle sammelte sich der Text Name fuer Name an
    (`ZenrathS a p p h yGeneralBl…`) und die Suche traf nichts mehr.
    """
    g.taste(123)                       # ans Ende
    for _ in range(45):
        g.taste(67)                    # Ruecktaste


def _tippbar(name: str) -> bool:
    """Kann `adb shell input text` den Namen tippen? Nur druckbares ASCII,
    und kein `%`, das dort als Platzhalter gilt."""
    return all(" " <= c <= "~" for c in name) and "%" not in name


def einfuegen(g: Geraet, name: str) -> None:
    """Auf den Mac kopieren, den Gast abholen lassen, einfuegen.

    `adb shell input text` kann nur ASCII — `ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ` und
    `V ベジータ王子` sind so nicht zu suchen. Die Zwischenablage von BlueStacks
    haengt dagegen an der des Macs.

    Zwei Stolpersteine, jeder einmal eingetreten:

    - **`pbcopy` braucht ein UTF-8-Gebietsschema.** Ohne `LANG` liest es seine
      Eingabe als MacRoman: aus `ΧΑΣΑΠΗΣ` wurde `ŒßŒëŒ£ŒëŒ†ŒóŒ£`. Das sah nach
      einem kaputten Zwischenablage-Uebergang von BlueStacks aus und war der Mac.
    - **BlueStacks holt die Zwischenablage erst beim Fensterwechsel.** Bleibt
      sein Fenster durchgehend vorn, fuegt `keyevent 279` den **vorigen** Namen
      ein — so stand `H A N A N` im Feld, waehrend der Lauf `ꜱɪɴɴᴇʀ` suchte, und
      das leere Ergebnis sah aus wie „nicht angemeldet".
    """
    if _tippbar(name):
        # **Ohne Umweg, wo es geht** (seit 22.10.2026). Der Weg ueber die
        # Zwischenablage kostet je Name 2,5 s Fensterwechsel — gebraucht wird er
        # nur fuer Namen, die `input text` nicht kann. `%s` ist dort das
        # Leerzeichen; quotiert wird fuer die Shell im Gast, sonst bricht ein
        # `(` oder `'` im Namen den Befehl.
        g._sh("shell", "input", "text", shlex.quote(name.replace(" ", "%s")))
        return
    subprocess.run(["pbcopy"], input=name.encode("utf-8"), check=True,
                   env={"LANG": "en_US.UTF-8", "PATH": "/usr/bin:/bin"})
    _aktivieren("Terminal")
    time.sleep(1.0)
    _aktivieren("BlueStacks")
    time.sleep(1.5)
    g.taste(279)                       # KEYCODE_PASTE


# Wie viel hoeher der Dialog sitzt (siehe navigate.dialog_versatz) — einmal
# gemessen, fuer den ganzen Lauf gemerkt: sobald ein Name im Feld steht, ist die
# Beschriftung „Mitglieder suchen" weg und nur der Rueckfall traegt noch.
_VERSATZ = 0


def suchfeld(g: Geraet, bild=None) -> tuple[int, int]:
    """Wo „Mitglieder suchen" steht — **gemessen, nicht gesetzt.**

    Der Dialog hat zwei Fassungen. Nach dem Anmeldeschluss steht ueber der
    Liste zusaetzlich das Auswahlfeld „Einsatztruppe A/B", und alles darunter
    sitzt rund 170 px hoeher. Der feste Punkt traf dort den **Rang-Balken** —
    der Lauf klappte also eine Gruppe auf, statt das Suchfeld zu oeffnen, und
    brach mit „Die Eingabezeile oeffnet nicht" ab (25.09.2026).
    """
    bild = g.bild() if bild is None else bild
    ziel = v.finde_knopf(bild, SUCHFELD_BOX, "Mitglieder suchen")
    # `input tap` will ganze Zahlen — `finde_knopf` misst in Bruchteilen.
    if ziel:
        return (int(ziel["x"]), int(ziel["y"]))
    return (FELD[0], FELD[1] + _VERSATZ)


# Wo der eingegebene Name im Feld steht — **gemessen** (30.09.2026): in
# (740, 920, 1800, 990) liest psm 7 `'Neilujl3'` fuer `Neiluj13`, waehrend der
# groessere Ausschnitt das X des Loeschknopfes mitnimmt (`'X Neiluj13'`).
FELD_TEXT_BOX = (740, 920, 1800, 990)
# Wie lange nach der Eingabe hoechstens auf den Namen im Feld gewartet wird
# (vorher fest), und wie lange danach die Trefferliste Zeit bekommt.
FELD_WARTEN = 2.5
TREFFER_RUHE = 0.6

# Ab welcher Aehnlichkeit das Feld als „traegt den Namen" gilt. Grosszuegiger
# als `NAME_BESTAETIGT`, denn hier wird gegen den **getippten** Text verglichen
# und nur die Erkennung steht dazwischen.
FELD_BESTAETIGT = 0.70


def feld_text(g: Geraet, bild=None) -> str:
    """Was im Suchfeld steht."""
    bild = g.bild() if bild is None else bild
    x0, y0, x1, y1 = FELD_TEXT_BOX
    return v.ocr(bild, (x0, y0 + _VERSATZ, x1, y1 + _VERSATZ), psm=7).strip()


def _ascii_kern(s: str) -> str:
    """Nur die lateinischen Buchstaben und Ziffern, klein.

    Verglichen wird im Feld auf dem **Kern**, nicht auf dem ganzen Namen. Was
    dazwischen steht, kann die Erkennung ohnehin nicht treffen: `H一A一N一A一Nツ`
    kommt als `H-A—N—-A—NY` an — die Trennzeichen `一` liest sie als Striche,
    und `ツ` als `Y`. Ueber den vollen Text verglichen fiel der Name durch,
    obwohl er richtig im Feld stand; ueber den Kern (`hanan` gegen `hanany`)
    trifft er. Dass zwei verschiedene Namen denselben Kern haben koennten,
    faengt die Gegenprobe an der Zeile ab — hier geht es nur um die Frage, ob
    noch einmal getippt werden muss.
    """
    return "".join(c for c in s.lower() if c.isascii() and c.isalnum())


def _lateinisch(name: str) -> bool:
    """Genug ASCII, dass die Erkennung den Namen im Feld wiedererkennen kann."""
    return len(_ascii_kern(name)) >= 3


# Zeichen, die in der Schrift des Spiels **gleich aussehen**: grosses I,
# kleines l und die Eins; O und die Null. Gefaltet wird ausschliesslich fuer die
# Frage „steht mein Name im Feld?" — die Gegenprobe an der Zeile (Name **und**
# Heldenkraft) bleibt streng, und nur sie entscheidet, wem ein Tipp gilt.
#
# Am 01.10.2026 kostete das `I54I` zweimal einen ganzen Lauf: der Name kam
# richtig im Feld an, gelesen wurde `1541`, der Vergleich schlug fehl, und der
# Dienst tippte ihn viermal vergeblich neu, statt seine Zeile anzusehen. Er war
# damit der einzige Spieler, den beide Suchlaeufe der Nacht nicht lesen konnten
# — obwohl er im Spiel richtig eingeteilt war.
_FELD_ZWILLINGE = str.maketrans({"i": "1", "l": "1", "o": "0"})


def _feld_kern(s: str) -> str:
    return _ascii_kern(s).translate(_FELD_ZWILLINGE)


def feld_traegt(name: str, jetzt: str) -> bool | None:
    """Steht `name` im Feld? `None` heisst „nicht zu entscheiden".

    Ein Name ohne genug lateinische Zeichen (`ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ`,
    `V ベジータ王子`) ist im Feld nicht wiederzuerkennen — dazu `None` statt
    `False`, denn „ich kann es nicht lesen" ist keine Absage. Wer fragt,
    entscheidet selbst, was er daraus macht.
    """
    if not _lateinisch(name):
        return None
    return difflib.SequenceMatcher(
        None, _feld_kern(name), _feld_kern(jetzt)).ratio() >= FELD_BESTAETIGT


def name_eingeben(g: Geraet, name: str, versuche: int = 4) -> bool:
    """Den Namen ins Suchfeld bringen — und **nachsehen, ob er dort steht**.

    `input text` kommt mal sofort an und mal gar nicht, und die Zwischenablage
    von BlueStacks haengt an einem Fensterwechsel, der auch misslingen kann.
    Ohne Gegenprobe steht dann die Anfrage des **vorigen** Namens im Feld —
    und damit dessen Zeile unter dem neuen Namen.

    Diese Schleife lief bis zum 30.09.2026 ins Leere: sie gab am Ende des
    ersten Durchgangs bedingungslos `True` zurueck. Am 29.09. kostete das 17
    Zeilen, die dem Falschen gehoerten; am 30.09. blieb beim Einstellen ueber
    das Suchfeld nach dem ersten Namen **28-mal** dieselbe alte Zeile stehen
    (`IIBlackJackll`, 179,5 M), und der Lauf setzte einen einzigen Spieler.
    Beide Male hat erst die Pruefung *danach* den Schaden verhindert — die
    Wiederholung, die ihn vermeidet, gab es nur auf dem Papier.

    Ein Name ohne genug lateinische Zeichen (`ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ`,
    `V ベジータ王子`) ist im Feld nicht wiederzuerkennen. Fuer ihn gilt die
    schwaechere, aber ehrliche Bedingung: das Feld muss sich ueberhaupt
    **veraendert** haben. Den Rest traegt die Gegenprobe an der Zeile.
    """
    for versuch in range(1, versuche + 1):
        if not eingabezeile_offen(g):
            g.tippen(*suchfeld(g), pause=2.0)
        if not eingabezeile_offen(g):
            raise NavigationFehler(
                "Die Eingabezeile oeffnet nicht — steht der Dialog noch offen?")
        g.tippen(*EINGABEZEILE, pause=1.2)
        vorher = feld_text(g)
        feld_leeren(g)
        time.sleep(0.8)
        einfuegen(g, name)
        # **Nachsehen statt fest warten** (seit 22.10.2026). Steht ein lesbarer
        # Name im Feld, geht es weiter, sobald er dort steht — vorher waren es
        # immer 2,5 s. Danach noch `TREFFER_RUHE`: das Feld steht einen Hauch
        # vor der Trefferliste, und ein Bild zu frueh zeigte die Zeile des
        # vorigen Namens. Ein nicht lesbarer Name (`ΧΑΣΑΠΗΣ`) bekommt die
        # volle Zeit wie bisher, denn an ihm laesst sich nichts ablesen.
        ende = time.monotonic() + FELD_WARTEN
        while True:
            jetzt = feld_text(g)
            passt = feld_traegt(name, jetzt)
            if passt or passt is None or time.monotonic() >= ende:
                break
            time.sleep(0.3)
        if passt is None:                  # nicht lesbar — nur „hat sich geregt"
            time.sleep(max(0.0, ende - time.monotonic()))
            jetzt = feld_text(g)
            passt = bool(jetzt) and jetzt != vorher
        if passt:
            time.sleep(TREFFER_RUHE)
            if versuch > 1:
                _log(f"     Suchfeld traegt {name!r} erst im {versuch}. Versuch.")
            return True
        _log(f"     Suchfeld traegt {jetzt!r} statt {name!r} — noch einmal "
             f"({versuch}/{versuche}).")
    return False


def _bestaetigt(gesucht: str, gelesen: str, kraft, hero_power) -> bool:
    """Ist die Zeile im Bild wirklich die des gesuchten Spielers?

    **Die Gegenprobe ist der Name im Trefferbild, nicht „das Feld hat sich
    geaendert".** Der Pixelvergleich des Feldes bestand am 23.09.2026 genau
    dort faelschlich, wo er gebraucht wurde: das Feld *hatte* sich geaendert —
    auf den alten Inhalt der Gast-Zwischenablage.

    Der Name allein reicht aber nicht: ein Teil des Kaders ist in Schriften
    geschrieben, die die Erkennung nicht kennt. Fuer die tritt die Heldenkraft
    ein, die im Tool steht — dieselbe Zahl steht neben dem Namen in der Zeile.
    """
    if gelesen and difflib.SequenceMatcher(
            None, match.norm(gesucht), match.norm(gelesen)).ratio() >= NAME_BESTAETIGT:
        return True
    if kraft and hero_power:
        return abs(kraft * 1e6 - hero_power) / hero_power <= KRAFT_ABWEICHUNG
    return False


def _proben(g: Geraet, sammler: belege.Sammler) -> list[dict]:
    """So lange hinsehen, wie ein Wechsel dauert, und je Balkenfarbe eine Zeile
    behalten.

    Der Balken eines Doppelmelders wechselt alle drei Sekunden. Nur die erste
    Probe zu nehmen hiesse, eine der beiden Meldungen zu verlieren — und zwar
    stillschweigend, denn die uebrige sieht vollstaendig aus.

    **Gelesen wird nur, wenn sich die Farbe aendert.** Je Bild kostet die
    Farbmessung kaum etwas; Name, Kraft und Uhrzeit (Texterkennung) nur beim
    ersten Bild jeder Farbe. Fertig ist die Zeile, sobald zwei Farben gesehen
    sind, oder nach `WECHSEL_FENSTER` ab dem ersten Balken.

    Ohne Balken wird am Trennstreifen zwischen den Zeilenkarten geankert
    (`roster.zeilenkoepfe`). Das ist der Fall „nicht angemeldet", und er braucht
    seinen Beleg genauso — sonst stuende gegen eine Rueckfrage nur eine Zahl.
    """
    gesehen: dict[str | None, dict] = {}
    erster_balken = None
    ohne_balken = 0
    beginn = time.monotonic()
    while True:
        bild = g.bild()
        jetzt = time.monotonic()
        koepfe = roster.zeitkoepfe(g, bild)
        if koepfe:
            erster_balken = erster_balken or jetzt
        else:
            koepfe = roster.zeilenkoepfe(g, bild)
            if koepfe:
                ohne_balken += 1
        for y0, y1, farbe in koepfe[:1]:          # das Suchergebnis ist eine Zeile
            if farbe in gesehen:
                continue
            z = roster.zeile_lesen(g, bild, y1)
            z["farbe"] = farbe
            z["zeit"] = roster.kopfzeit(g, bild, y0, y1) if farbe else None
            z["beleg"] = sammler.merken(bild, y0, y1)
            gesehen[farbe] = z
        farben = [f for f in gesehen if f]
        if len(farben) >= 2:
            break
        if erster_balken and jetzt - erster_balken >= WECHSEL_FENSTER:
            break
        if not erster_balken and ohne_balken >= OHNE_BALKEN_BILDER:
            break
        if jetzt - beginn >= WECHSEL_FENSTER + 1.0:   # gar keine Zeile
            break
    # Eine Zeile ohne Balken neben einer mit Balken ist ein Bild aus dem Aufbau
    # des Suchergebnisses, keine zweite Aussage.
    if any(f for f in gesehen):
        gesehen.pop(None, None)
    return list(gesehen.values())


def lauf(g: Geraet, namen: list[str] | None, team: str | None,
         schreiben: bool, erzwingen: bool, offen: bool = False,
         truppe: str | None = None) -> int:
    aid = tool.allianz_id(g.cfg["alliance_tag"])
    stempel = datetime.now().strftime("%Y%m%d_%H%M%S")
    ordner = BERICHTE / f"suche_{stempel}"
    ordner.mkdir(parents=True, exist_ok=True)

    kader = [p for p in tool.kader(aid) if p.get("active")]
    nach_name = {p["name"]: p for p in kader}
    if namen:
        # **Ausdruecklich genannte Namen werden auch stillgelegt gesucht.** Genau
        # so prueft man, ob ein im Allianz-Protokoll als ausgetreten Erkannter
        # wirklich weg ist — er ist dann schon `active=false`. Ohne `--namen`
        # bleibt es beim aktiven Kader; geschrieben wird mit `--namen` ohnehin nie.
        alle = {p["name"]: p for p in tool.kader(aid)}
        kader = [alle[n] for n in namen if n in alle]
        nach_name = {p["name"]: p for p in kader}
        fehlt = [n for n in namen if n not in nach_name]
        if fehlt:
            _log(f"Nicht im Kader: {', '.join(fehlt)}")
        namen = [n for n in namen if n in nach_name]
    else:
        namen = sorted(nach_name)
    _log(f"{len(namen)} Namen nachzuschlagen (~{len(namen) * 9 // 60} Minuten).")

    g.starten(log=_log)
    # Erst schauen, dann tippen: am 28.10.2026 lief der Suchlauf direkt nach
    # dem Neustart an, Last War lud noch, und sechsmal „Zurueck" beendete das
    # Spiel. Dieselbe Falle wie beim VS-Dienst (14.–16.10.2026).
    if not offen:
        if not g.app_laeuft():
            g.app_starten(log=_log)
        navigate.warte_auf_spiel(g, log=_log)
    # `--offen` liest den Dialog, der schon auf dem Bildschirm steht — nach dem
    # Anmeldeschluss der einzige Weg hinein (siehe run.py). Mit
    # `--truppe ALLE` steht dabei jeder Name zur Verfuegung; auf ein Blatt
    # gefiltert findet das Suchfeld nur, wer in **dieser** Einsatztruppe steht.
    if offen:
        # **Erst den Versatz messen, dann pruefen.** `liste_offen` sucht die
        # Rang-Balken in `list_view` — steht der Dialog 195 px hoeher und zeigt
        # nur eine Zeile (Suchtreffer), liegt der Balken darueber, und die
        # Pruefung meldet „kein Dialog offen", obwohl er offen ist.
        global _VERSATZ
        _VERSATZ = navigate.listenfenster_mitziehen(g, log=_log)
        if not navigate.liste_offen(g):
            raise NavigationFehler(
                "Kein offener Teilnehmer-Dialog auf dem Bildschirm. `--offen` "
                "liest, was da ist, und navigiert bewusst nicht selbst.")
        if truppe:
            navigate.truppe_filtern(g, truppe, log=_log)
        _log(f"Offener Dialog: Auswahlfeld steht auf {navigate.truppe_label(g)!r}.")
        randdaten = {"anmeldung_endet_in": None, "blatt_zeit": None}
    else:
        randdaten = navigate.zur_teilnehmerliste(g, team=team, log=_log)
    zaehler = roster.dialog_zaehler(g, g.bild())

    sammler = belege.Sammler(ordner / "belege", g.cfg)
    zeilen: list[dict] = []
    unsicher: list[str] = []
    nicht_gefunden: list[str] = []

    g.tippen(*suchfeld(g), pause=1.5)
    for i, name in enumerate(namen, 1):
        # Getippt wird, wie das Spiel ihn schreibt (`match.suchnamen`), gemeldet
        # wird der Kadername — geschrieben wird am Ende gegen den Kader.
        getippt = match.suchname(name)
        _log(f"[{i}/{len(namen)}] {name!r}"
             + (f" — im Spiel {getippt!r}" if getippt != name else ""))
        if not name_eingeben(g, getippt):
            unsicher.append(name)
            continue
        gefunden = _proben(g, sammler)
        if not gefunden:
            # Keine Zeile heisst nicht „nicht angemeldet", sondern „im Spiel
            # nicht gefunden" — Umbenennung, Austritt, oder ein Name, den die
            # Tastatur nicht trifft. Am 23.09.2026 waren das acht Namen, davon
            # fuenf ausgetreten und zwei umbenannt.
            nicht_gefunden.append(name)
            _log("     keine Zeile — im Spiel nicht gefunden")
            continue
        p = nach_name[name]
        # Verglichen wird gegen `getippt`: im Bild steht der Name des Spiels,
        # nicht der des Kaders. Bei `Ben the men` gegen `Ben_the_men` macht das
        # nichts aus (`norm` wirft das `_` weg), bei einer echt abweichenden
        # Schreibweise ist es der Unterschied zwischen Treffer und Rueckfall
        # auf die Heldenkraft.
        sicher = any(_bestaetigt(getippt, z.get("name_ocr"), z.get("kraft"),
                                 p.get("hero_power")) for z in gefunden)
        if not sicher:
            unsicher.append(name)
            _log("     ⚠ Zeile nicht als seine bestaetigt — nur gemeldet")
        for z in gefunden:
            z["spieler"] = name
            z["bestaetigt"] = sicher
        zeilen += gefunden
        balken = sorted({z["zeit"] or z["farbe"] for z in gefunden if z["farbe"]})
        _log("     " + (f"angemeldet: {', '.join(balken)}" if balken
                        else "kein Zeit-Balken — nicht angemeldet"))

    navigate.dialog_schliessen(g)

    # ── Werte bilden ──────────────────────────────────────────────────────
    stand = tool.planungsstand(aid)
    ws_time = stand.get("wsTime") or {"A": "13:00", "B": "22:00"}
    bz = randdaten.get("blatt_zeit")
    blatt = next((t.upper() for t, z in ws_time.items()
                  if bz and (z == bz or roster.eu_zu_server(z) == bz)),
                 (team or "").upper() or None)
    farb_team, farb_meldung = roster.farb_teams(zeilen, ws_time, blatt)
    roster.zu_werten(zeilen, ws_time, farb_team)

    je_spieler: dict[str, list[dict]] = {}
    for z in zeilen:
        je_spieler.setdefault(z["spieler"], []).append(z)

    # ── Heldenkraft: immer, wenn sie gelesen wurde ────────────────────────
    # Neben jedem Namen steht seine Heldenkraft — dieselbe Zahl, mit der oben
    # `_bestaetigt` die Zeile ueberhaupt erst als seine erkennt. Sie hier
    # liegenzulassen hiesse, eine frisch gemessene Zahl wegzuwerfen, die sonst
    # niemand nachtraegt: am 30.09.2026 waren das 25 Werte aus einem einzigen
    # Lauf (I54I 145,6 → 150,5 Mio).
    #
    # **Ohne `--schreiben` und ohne Ruecksicht auf die Gegenprobe** (Vorgabe
    # Ben, 30.09.2026) — und ohne die Bedingung „ganzer Kader", an der der
    # Schreibweg fuer `teamAssign` haengt. Der Grund ist derselbe wie in
    # `run.py`: `teamAssign` ist eine Aussage ueber die **Liste** und nur als
    # Ganzes richtig, die Heldenkraft eine ueber die **einzelne Zeile**. Eine
    # Teilliste darf `teamAssign` deshalb nicht ersetzen, wohl aber die Kraft
    # der 25 Spieler tragen, die sie gesehen hat.
    #
    # Nur `bestaetigt` — eine Zeile, die nicht als die des Gesuchten belegt
    # ist, duerfte die Heldenkraft eines Fremden ueberschreiben.
    treffer = {}
    for name, gruppe in je_spieler.items():
        kraft = next((z.get("kraft") for z in gruppe
                      if z.get("bestaetigt") and z.get("kraft")), None)
        if kraft:
            treffer[name] = {"kraft": kraft}
    heldenkraft = tool.schreibe_heldenkraft(aid, kader, treffer)
    if heldenkraft:
        _log(f"Heldenkraft aktualisiert: {len(heldenkraft)} von "
             f"{len(treffer)} gelesenen.")

    zuordnung: dict[str, str] = {}
    konflikte: list[dict] = []
    nicht_angemeldet: list[str] = []
    for name, gruppe in sorted(je_spieler.items()):
        werte = {z.get("wert") for z in gruppe if z.get("wert")}
        if not werte:
            # Zeile da, kein Balken, kein Abzeichen: das ist die Aussage
            # „hat sich nicht angemeldet" — und nur der Suchlauf kann sie
            # ueberhaupt treffen.
            nicht_angemeldet.append(name)
            continue
        if len(werte) == 1:
            zuordnung[name] = werte.pop()
            continue
        vereint = roster.ohne_platz_vereinen(werte)
        if vereint:
            zuordnung[name] = vereint
        else:
            konflikte.append({"spieler": name, "werte": sorted(werte)})

    verteilung = Counter(zuordnung.values())
    _log(f"Zugeordnet: {dict(sorted(verteilung.items()))}")

    sammler.kopf = (f"{g.cfg['alliance_tag']} · Blatt {blatt or '?'} · "
                    f"Suchlauf {datetime.now().strftime('%d.%m.%Y %H:%M')}")
    beleg_index = sammler.abschliessen(
        {n: {"wert": zuordnung.get(n), "kraft": g_[0].get("kraft"),
             "belege": [z["beleg"] for z in g_ if z.get("beleg")]}
         for n, g_ in je_spieler.items()},
        ohne_beleg=nicht_gefunden,
        hinweis="Suchlauf: jeder Kadername einzeln nachgeschlagen. Ein Beleg "
                "ohne Zeit-Balken belegt, dass der Spieler sich **nicht** "
                "angemeldet hatte. Wer ohne Beleg gefuehrt wird, war im Spiel "
                "unter diesem Namen gar nicht zu finden.")
    _log(f"Beweisbilder: {sammler.ordner} ({len(beleg_index['spieler'])} Spieler)")
    # Hochladen laeuft unabhaengig von --schreiben, wie die Beweisbilder selbst
    # schon immer — ein Fehler hier darf den sonst gelungenen Lauf nicht
    # abbrechen. Der Suchlauf ist die einzige Quelle, die auch "nicht
    # angemeldet" (wert=None) beweisen kann — siehe db/2026-10-09_*.sql.
    try:
        n = tool.schreibe_belege(aid, "ws", "suchlauf", sammler.ordner, beleg_index["spieler"])
        _log(f"Beweisbilder ins Tool hochgeladen: {n}")
    except Exception as e:
        _log(f"Beweisbilder-Upload fehlgeschlagen: {e}")

    probleme = []
    if farb_meldung:
        probleme.append(farb_meldung)
    if not blatt:
        probleme.append("Kampfzeit des Blattes nicht lesbar — keine Gegenprobe")
    else:
        probleme += roster.zaehler_pruefen({}, verteilung, blatt, zaehler)
    if konflikte:
        probleme.append(f"{len(konflikte)} Spieler mit widerspruechlichen Zeilen")
    if unsicher:
        probleme.append(f"{len(unsicher)} Zeilen nicht als die des Gesuchten "
                        f"bestaetigt")

    bericht = {
        "zeitpunkt": datetime.now().isoformat(timespec="seconds"),
        "art": "suchlauf", "allianz": g.cfg["alliance_tag"],
        "team_blatt": blatt, "blatt_zeit": bz,
        "anmeldung_endet_in": randdaten.get("anmeldung_endet_in"),
        "zaehler_gesamt": zaehler, "farb_team": farb_team,
        "nachgeschlagen": namen,
        "verteilung": dict(sorted(verteilung.items())),
        "zuordnung": zuordnung,
        "nicht_angemeldet": sorted(nicht_angemeldet),
        "nicht_gefunden": sorted(nicht_gefunden),
        "unsicher": sorted(unsicher),
        "konflikte": konflikte,
        "heldenkraft": {n: {"vorher": v, "nachher": nw}
                        for n, (v, nw) in heldenkraft.items()},
        "probleme": probleme,
        "belege": str(sammler.ordner),
        "geschrieben": False,
    }

    print()
    print(f"── Suchlauf {g.cfg['alliance_tag']} · Blatt {blatt or '?'} ──")
    for wert in ("A", "AE", "B", "BE", "AC", "BC", "ABC"):
        n = sorted(x for x, w in zuordnung.items() if w == wert)
        if n:
            print(f"{wert:4s} ({len(n):2d}): {', '.join(n)}")
    print(f"nicht angemeldet ({len(nicht_angemeldet)}): "
          f"{', '.join(sorted(nicht_angemeldet)) or '—'}")
    if nicht_gefunden:
        print(f"im Spiel nicht gefunden ({len(nicht_gefunden)}): "
              f"{', '.join(sorted(nicht_gefunden))}")
    print("PROBLEME: " + (" · ".join(probleme) if probleme else "keine"))

    if schreiben and probleme and not erzwingen:
        _log("NICHT geschrieben — die Gegenprobe geht nicht auf (siehe oben).")
    elif schreiben:
        if len(namen) < len(kader):
            _log("NICHT geschrieben — nur ein Teil des Kaders nachgeschlagen. "
                 "Ein Suchlauf ersetzt `teamAssign` ganz; mit einer Teilliste "
                 "loeschte er den Rest.")
        else:
            sicherung = tool.sicherung_schreiben(aid, BERICHTE / "sicherungen")
            _log(f"Sicherung des bisherigen Stands: {sicherung}")
            # **Ersetzend, nicht zusammenfuehrend.** `tool.zusammenfuehren` ist
            # fuer den Scroll-Lauf richtig — der sieht nicht jede Zeile, und
            # wozu er nichts sagt, bleibt stehen. Der Suchlauf sagt zu **jedem**
            # Kadernamen etwas; ein stehengebliebenes 'A' waere die Aufstellung
            # des vorigen Kampftags.
            tool.schreibe_teamassign(aid, zuordnung)
            bericht["geschrieben"] = True
            bericht["sicherung"] = str(sicherung)
            _log(f"Geschrieben: {len(zuordnung)} Werte (ersetzend).")
            _log("Im Browser einmal neu laden.")

    (ordner / "bericht.json").write_text(
        json.dumps(bericht, ensure_ascii=False, indent=1))
    _log(f"Bericht: {ordner / 'bericht.json'}")
    return 0 if not probleme else 2


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--namen", nargs="*", default=None,
                   help="Nur diese Namen nachschlagen (sonst der ganze Kader).")
    p.add_argument("--team", default=None, choices=["A", "B"])
    p.add_argument("--schreiben", action="store_true",
                   help="Ergebnis ins Tool uebernehmen — ersetzend.")
    p.add_argument("--erzwingen", action="store_true")
    p.add_argument("--offen", action="store_true",
                   help="Den Teilnehmer-Dialog lesen, der schon offen ist, "
                        "statt selbst dorthin zu navigieren. Nach dem "
                        "Anmeldeschluss der einzige Weg hinein.")
    p.add_argument("--truppe", default=None, choices=["A", "B", "ALLE"],
                   help="Auswahlfeld im offenen Dialog. 'ALLE' ist die "
                        "richtige Wahl beim Nachschlagen einzelner Namen — "
                        "auf ein Blatt gefiltert findet das Suchfeld nur, wer "
                        "dort eingeteilt ist. Nur mit --offen.")
    a = p.parse_args(argv)

    g = Geraet()
    try:
        if a.truppe and not a.offen:
            _log("--truppe wirkt nur mit --offen (Auswahlfeld im Dialog).")
            return 1
        return lauf(g, a.namen, a.team, a.schreiben, a.erzwingen,
                    offen=a.offen, truppe=a.truppe)
    except AnmeldungGeschlossen as e:
        _log(str(e))
        return 3
    except (GeraetFehler, NavigationFehler, roster.ScanFehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
