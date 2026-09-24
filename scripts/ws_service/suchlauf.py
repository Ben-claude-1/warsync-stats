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
"""
from __future__ import annotations

import argparse
import difflib
import json
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

from . import belege, match, navigate, roster, tool
from .device import Geraet, GeraetFehler
from .navigate import AnmeldungGeschlossen, NavigationFehler

BERICHTE = Path.home() / ".local" / "state" / "warsync" / "ws_service"

FELD = (1280, 950)            # „Mitglieder suchen" im Dialog
EINGABEZEILE = (1024, 2493)   # die Zeile, die das Spiel unten einblendet
EINGABE_STREIFEN = (200, 2460, 2360, 2530)
EINGABE_HELL = 200            # heller Streifen = die Zeile ist offen

# Wie oft je Name hingesehen wird. Wer sich fuer beide Uhrzeiten gemeldet hat,
# zeigt sie **abwechselnd und nicht halbe-halbe**: ueber fuenf Proben stand
# `ZephyrusXI` viermal auf 09:00 und einmal auf 18:00. Mit zwei Proben fand der
# erste Durchgang am 23.09.2026 genau einen Doppelmelder, mit fuenf waren es
# zwei — die Zahl der Proben ist also direkt die Zahl der gefundenen.
PROBEN = 5
PROBE_PAUSE = 1.6

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
    subprocess.run(["pbcopy"], input=name.encode("utf-8"), check=True,
                   env={"LANG": "en_US.UTF-8", "PATH": "/usr/bin:/bin"})
    _aktivieren("Terminal")
    time.sleep(1.0)
    _aktivieren("BlueStacks")
    time.sleep(1.5)
    g.taste(279)                       # KEYCODE_PASTE


def name_eingeben(g: Geraet, name: str, versuche: int = 4) -> bool:
    for _ in range(versuche):
        if not eingabezeile_offen(g):
            g.tippen(*FELD, pause=2.0)
        if not eingabezeile_offen(g):
            raise NavigationFehler(
                "Die Eingabezeile oeffnet nicht — steht der Dialog noch offen?")
        g.tippen(*EINGABEZEILE, pause=1.2)
        feld_leeren(g)
        time.sleep(0.8)
        einfuegen(g, name)
        time.sleep(2.5)
        return True
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
    """Mehrfach hinsehen und je **verschiedenem** Balken eine Zeile behalten.

    Der Balken eines Doppelmelders wechselt rund alle drei Sekunden. Nur die
    erste Probe zu nehmen hiesse, eine der beiden Meldungen zu verlieren — und
    zwar stillschweigend, denn die uebrige sieht vollstaendig aus.

    Ohne Balken wird am Trennstreifen zwischen den Zeilenkarten geankert
    (`roster.zeilenkoepfe`). Das ist der Fall „nicht angemeldet", und er braucht
    seinen Beleg genauso — sonst stuende gegen eine Rueckfrage nur eine Zahl.
    """
    gesehen: dict[tuple, dict] = {}
    for p in range(PROBEN):
        bild = g.bild()
        koepfe = roster.zeitkoepfe(g, bild) or roster.zeilenkoepfe(g, bild)
        for y0, y1, farbe in koepfe[:1]:          # das Suchergebnis ist eine Zeile
            z = roster.zeile_lesen(g, bild, y1)
            z["farbe"] = farbe
            z["zeit"] = roster.kopfzeit(g, bild, y0, y1) if farbe else None
            schluessel = (farbe, z["zeit"])
            if schluessel in gesehen:
                continue
            z["beleg"] = sammler.merken(bild, y0, y1)
            gesehen[schluessel] = z
        if p < PROBEN - 1:
            time.sleep(PROBE_PAUSE)
    return list(gesehen.values())


def lauf(g: Geraet, namen: list[str] | None, team: str | None,
         schreiben: bool, erzwingen: bool) -> int:
    aid = tool.allianz_id(g.cfg["alliance_tag"])
    stempel = datetime.now().strftime("%Y%m%d_%H%M%S")
    ordner = BERICHTE / f"suche_{stempel}"
    ordner.mkdir(parents=True, exist_ok=True)

    kader = [p for p in tool.kader(aid) if p.get("active")]
    nach_name = {p["name"]: p for p in kader}
    if namen:
        fehlt = [n for n in namen if n not in nach_name]
        if fehlt:
            _log(f"Nicht im Kader: {', '.join(fehlt)}")
        namen = [n for n in namen if n in nach_name]
    else:
        namen = sorted(nach_name)
    _log(f"{len(namen)} Namen nachzuschlagen (~{len(namen) * 19 // 60} Minuten).")

    g.starten(log=_log)
    randdaten = navigate.zur_teilnehmerliste(g, team=team, log=_log)
    zaehler = roster.dialog_zaehler(g, g.bild())

    sammler = belege.Sammler(ordner / "belege", g.cfg)
    zeilen: list[dict] = []
    unsicher: list[str] = []
    nicht_gefunden: list[str] = []

    g.tippen(*FELD, pause=1.5)
    for i, name in enumerate(namen, 1):
        _log(f"[{i}/{len(namen)}] {name!r}")
        if not name_eingeben(g, name):
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
        sicher = any(_bestaetigt(name, z.get("name_ocr"), z.get("kraft"),
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
    a = p.parse_args(argv)

    g = Geraet()
    try:
        return lauf(g, a.namen, a.team, a.schreiben, a.erzwingen)
    except AnmeldungGeschlossen as e:
        _log(str(e))
        return 3
    except (GeraetFehler, NavigationFehler, roster.ScanFehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
