"""Gelesenen Namen dem Spieler im Tool zuordnen.

Die OCR liest Spielernamen nicht buchstabengetreu — aus „IIBlackJackII" wird
„IBlackJackli", aus „ZephyrusXI" ein „ZephyrusXl". Das muss sie auch nicht: der
Kader steht im Tool, gesucht wird also nicht *was da steht*, sondern *wer von
den bekannten hundert gemeint ist*.

Verglichen wird **normalisiert** — ohne Leerzeichen, ohne Diakritika,
kleingeschrieben. Beim Import der T1-Werte am 02.09.2026 fehlten roh verglichen
38 von 135 Namen, normalisiert waren es drei. Der Grund steht in der Schreibweise
selbst: das Spiel zeigt manche Namen gesperrt („H A N A N"), das Tool fuehrt sie
zusammengeschrieben, und `ADİGE 55` traegt ein tuerkisches İ.

Die Kraft dient als **Tiebreak, nicht als Schluessel**: sie steht im Tool oft
veraltet — das ist ja gerade der Grund, warum sie dort gepflegt wird.

Manche Namen bestehen ganz aus einer Schrift, die die OCR nicht kennt (Griechisch
`ΧΑΣΑΠΗΣ`, Japanisch `V ベジータ王子`, Chinesisch `小木瓜lemon`) — dort kommt nie
mehr als Zeichenmuell heraus, gegen den kein Ähnlichkeitswert der Welt hilft.
Ein zweiter Durchlauf (`_rest_durchlauf`) grenzt den Kandidatenkreis danach auf
die Kadermitglieder ein, die in der ersten Runde **keine** Zeile abbekommen
haben — bei hundert moeglichen Namen ist "Kraft fast exakt gleich" Zufall, bei
einer Handvoll uebrigen ist es ein Beweis. Am 06.09.2026 waren so von 13 zunaechst
offenen Zeilen sechs eindeutig: `XAAZATIH2Z`→Zenrath (Kraft exakt gleich),
`Mo By peitte`→Mo By, `anzibo66`→dnzl666, `ASTRDIYR`→ASTRID 1ッド, `11sabD`→Tiisab,
`AIOHS3`→XTO43 — nur beim Namens-Rest (0,00-0,29 Aehnlichkeit) blieb die Kraft die
einzige Spur, und die zeigt bei stark veralteten Werten in die falsche Richtung
(siehe `REST_MIN_AEHNLICHKEIT`).
"""
from __future__ import annotations

import collections
import difflib
import json
import unicodedata
from pathlib import Path

from . import roster

# Bekannte Fehllesungen: Kadername → wie die Erkennung ihn schreibt.
ALIAS_DATEI = Path(__file__).resolve().parent / "aliase.json"

MIN_AEHNLICHKEIT = 0.62
MIN_ABSTAND = 0.06      # Vorsprung vor dem Zweitplatzierten

# Zweiter Durchlauf, nur gegen den Rest-Kader (siehe zuordnen()). Die Schwelle
# liegt bewusst niedriger als MIN_AEHNLICHKEIT, aber nicht bei null: am
# 06.09.2026 lag der hoechste Zufallstreffer zwischen zwei komplett unabhaengigen
# Zeilen/Kadermitgliedern bei 0,29 (`| BO 7` vs `HY07`), der niedrigste echte
# Treffer bei 0,36 (`AIOHS3` vs `XTO43`) — 0,30 trennt beide Gruppen sauber.
REST_MIN_AEHNLICHKEIT = 0.30
REST_MAX_ABWEICHUNG = 0.05   # 5% Wachstum seit der letzten Erfassung gilt als plausibel

# Ab wann zwei Lesungen als **dieselbe Zeile** gelten (siehe `_dieselbe_zeile`).
# Die Schwelle liegt weit ueber MIN_AEHNLICHKEIT, und das ist kein Widerspruch:
# hier vergleicht nicht ein Bild einen Kadernamen, sondern zwei Lesungen
# **derselben Pixel** einander. `jgastrid3g` gegen `dgastrid3g` kommt auf 0,90.
GLEICHE_ZEILE_MIN = 0.75

# Wie weit zwei Zeilen **im selben Bild** mindestens auseinanderliegen, um
# verschiedene Zeilen zu sein. Eine Zeile ist rund 210 px hoch (`list_view` und
# die Fenster in `roster.zeile_lesen`); naeher als das kann eine zweite nicht
# stehen, ohne sie zu ueberdecken.
ZEILE_MIN_ABSTAND_PX = 150


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("ı", "i").replace("İ", "i").replace("ł", "l")
    return "".join(c for c in s.lower() if c.isalnum())


def aliase() -> dict[str, str]:
    """{normalisierte Lesart: Kadername} aus `aliase.json`.

    **Nicht der Kader wird angepasst, sondern die Lesart.** Die Namen im Tool
    sind richtig; falsch ist, was die Texterkennung aus dem Bild macht. Wer den
    Kader an die OCR anpasst, verliert den echten Namen — und damit die
    Anzeige, den Abgleich mit LW Atlas und jede spaetere Zuordnung.

    Gebraucht wird das dort, wo kein Aehnlichkeitswert hilft, weil zwischen
    Bild und Kader kein gemeinsames Zeichen steht: Griechisch (`ΧΑΣΑΠΗΣ` kommt
    als `XAZANHZ` an) und die Kapitaelchen-Unicodes (`ꜱɪɴɴᴇʀ` → `SINNER`).
    Beide sind am 16.09.2026 als einzige Zeilen offengeblieben, die die
    Gegenprobe nicht aufgehen liessen.

    Eine Lesart, die sich mit einem echten Kadernamen beisst, wird verworfen:
    ein Alias darf niemandem seinen Namen wegnehmen.
    """
    try:
        roh = json.loads(ALIAS_DATEI.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    out = {}
    for name, lesarten in roh.items():
        if name.startswith("_"):
            continue
        for lesart in lesarten:
            k = norm(lesart)
            if k:
                out[k] = name
    return out


def _kraft_bonus(kraft, hero_power) -> float:
    """0…0.08 — je naeher die Kraft, desto mehr. Fehlt eine Seite: kein Bonus."""
    if not kraft or not hero_power:
        return 0.0
    tool_mio = hero_power / 1e6
    abstand = abs(tool_mio - kraft)
    if abstand <= 0.15:
        return 0.08
    if abstand <= 3.0:
        return 0.04
    return 0.0


def _rest_durchlauf(offen: list[dict], rest_kader: list[dict]) -> tuple[list[dict], dict]:
    """Zweiter Versuch fuer das, was gegen den vollen Kader offen blieb.

    Kandidatenkreis ist nur noch `rest_kader` — wer in der ersten Runde schon
    eine Zeile bekommen hat, kommt hier nicht mehr infrage. Verglichen wird
    weiterhin ueber `REST_MIN_AEHNLICHKEIT`, aber zusaetzlich muss die Kraft
    fast passen (`REST_MAX_ABWEICHUNG`) — beide zusammen trennen echte Treffer
    von zufaelliger Naehe (siehe Modul-Doku).
    """
    tabelle = {norm(p["name"]): p for p in rest_kader}
    schluessel = list(tabelle)

    noch_offen, neue_treffer, frei = [], [], set(schluessel)
    # Was in diesem Durchlauf schon zugeordnet wurde. Der Kandidatenkreis
    # schrumpft hier mit jedem Treffer (`frei.discard`) — ohne dieses Gedaechtnis
    # bekommt dieselbe Zeile aus dem naechsten Bild zwangslaeufig einen *anderen*
    # Namen, weil ihr eigener gerade vergeben wurde. Am 16.09.2026 wurde
    # `'JG ASTRID OG'` so zweimal zugeordnet: einmal `ʚɞ ASTRID ʚɞ` (0,60) und
    # einmal `Stargreg` (0,44). Der zweite war frei erfunden und hob die Zahl der
    # gesetzten Spieler von 20 auf 21.
    #
    # Verglichen wurde dabei die woertliche Lesart, und daran ist es am
    # 17.09.2026 noch einmal vorbeigelaufen: dieselben vier Bilder derselben
    # Zeile kamen als `'JG ASTRID 3g'`, `'DG ASTRID 3G'`, `'JG ASTRID JG'` und
    # `'JG ASTRID 9G'` an — vier Texte, eine Zeile, und `Stargreg` stand wieder
    # da. Wiedererkannt wird sie deshalb an Kraft, Platz und Abzeichen
    # (`_dieselbe_zeile`), nicht am Text.
    for z in offen:
        gesucht = norm(z.get("name_ocr", ""))
        kraft = z.get("kraft")
        schon = _dieselbe_zeile(z, neue_treffer)
        if schon:
            neue_treffer.append({**z, "spieler": schon["spieler"], "aehnlichkeit": None,
                                 "grund": "dieselbe Zeile wie eine zugeordnete Lesung"})
            continue
        if not gesucht or not kraft or not frei:
            noch_offen.append(z)
            continue
        bewertet = []
        for k in frei:
            p = tabelle[k]
            hero_power = p.get("hero_power")
            if not hero_power:
                continue
            abweichung = abs(hero_power / 1e6 - kraft) / (hero_power / 1e6)
            score = difflib.SequenceMatcher(None, gesucht, k).ratio()
            bewertet.append((score, abweichung, p["name"], k))
        bewertet.sort(key=lambda b: (-b[0], b[1]))
        # Der Abstand zum Zweitplatzierten zaehlt nur unter den Kandidaten, die
        # die Kraft-Toleranz einhalten — sonst verhindert ein Name mit
        # zufaellig aehnlichem Score, aber voellig abwegiger Kraft (z.B. 38%
        # Abweichung), einen sonst eindeutigen Treffer.
        plausibel = [b for b in bewertet if b[1] <= REST_MAX_ABWEICHUNG]
        beste = plausibel[0] if plausibel else None
        zweite_score = plausibel[1][0] if len(plausibel) > 1 else 0
        if beste and beste[0] >= REST_MIN_AEHNLICHKEIT and beste[0] - zweite_score >= MIN_ABSTAND:
            neue_treffer.append({**z, "spieler": beste[2], "aehnlichkeit": round(beste[0], 3),
                                 "kraft_abweichung": round(beste[1], 3)})
            frei.discard(beste[3])
        else:
            grund = z.get("grund", "")
            bestmoeglich = beste or (bewertet[0] if bewertet else None)
            if bestmoeglich:
                grund += (f" | Rest-Kader: {bestmoeglich[2]!r} (Name {bestmoeglich[0]:.2f}, "
                          f"Kraft-Abw. {bestmoeglich[1]*100:.0f}%)")
            noch_offen.append({**z, "grund": grund})
    return noch_offen, neue_treffer


def namenstabelle(kader: list[dict]) -> dict[str, dict]:
    """{normalisierte Schreibweise: Kadermitglied} — samt bekannter Fehllesungen.

    Bekannte Fehllesungen kommen als **zusaetzliche Schreibweise** desselben
    Spielers dazu, nicht als Sonderweg daneben: damit laufen sie durch dieselbe
    Aehnlichkeitspruefung, und eine leicht abweichende Lesung (`XAZANHM` statt
    `XAZANHZ`) trifft weiterhin.
    """
    tabelle: dict[str, dict] = {}
    for p in kader:
        tabelle.setdefault(norm(p["name"]), p)
    nach_name = {p["name"]: p for p in kader}
    for lesart, name in aliase().items():
        p = nach_name.get(name)
        if p is not None and lesart not in tabelle:
            tabelle[lesart] = p
    return tabelle


def eine_zeile(z: dict, tabelle: dict[str, dict]) -> dict:
    """Eine einzelne Zeile bewerten — die Formel der ersten Runde, ausgelagert.

    Zurueck kommt immer ein Urteil, nie eine Ausnahme:
    `{'spieler': str|None, 'aehnlichkeit': float, 'zweiter': str, 'grund': str}`.

    Ausgelagert, weil `einstellen.py` dieselbe Frage **je Zeile** stellen muss:
    dort wird auf eine Zeile getippt, und das darf nur passieren, wenn genau
    diese Zeile sicher zugeordnet ist. Die Bewertung dafuer nachzubauen waere
    eine zweite Fassung derselben Entscheidung — sie liefe frueher oder spaeter
    anders als der Bericht, und dann tippt der Dienst auf einen anderen
    Spieler, als der Bericht nennt.
    """
    gesucht = norm(z.get("name_ocr", ""))
    if not gesucht:
        return {"spieler": None, "aehnlichkeit": 0.0, "zweiter": "",
                "grund": "kein Name gelesen"}
    # Je Spieler zaehlt seine **beste** Schreibweise. Ohne das Zusammenziehen
    # stuenden bei einem Aliastreffer Alias und echter Name als Erst- und
    # Zweitplatzierter da — und der Abstandstest verwuerfe den eindeutigsten
    # Treffer, den es ueberhaupt gibt.
    je_name: dict[str, tuple] = {}
    for k, p in tabelle.items():
        score = difflib.SequenceMatcher(None, gesucht, k).ratio()
        eintrag = (score + _kraft_bonus(z.get("kraft"), p.get("hero_power")),
                   score, p["name"])
        if eintrag > je_name.get(p["name"], (-1, -1, "")):
            je_name[p["name"]] = eintrag
    bewertet = sorted(je_name.values(), reverse=True)
    beste = bewertet[0] if bewertet else (0, 0, "")
    zweite = bewertet[1] if len(bewertet) > 1 else (0, 0, "")
    if beste[1] < MIN_AEHNLICHKEIT or beste[0] - zweite[0] < MIN_ABSTAND:
        return {"spieler": None, "aehnlichkeit": round(beste[1], 3), "zweiter": zweite[2],
                "grund": f"unsicher: {beste[2]!r} ({beste[1]:.2f}) "
                         f"vs {zweite[2]!r} ({zweite[1]:.2f})"}
    return {"spieler": beste[2], "aehnlichkeit": round(beste[1], 3),
            "zweiter": zweite[2], "grund": ""}


def zuordnen(zeilen: list[dict], kader: list[dict]) -> dict:
    """Jede Zeile einem Kadernamen zuordnen.

    Ergebnis: {'treffer': [...], 'offen': [...], 'konflikte': [...]}
    `offen` sind Zeilen ohne sicheren Treffer — die werden **nicht** geschrieben,
    sondern gemeldet. Lieber eine Luecke im Bericht als ein Wert beim Falschen.
    """
    tabelle = namenstabelle(kader)

    treffer, offen = [], []
    for z in zeilen:
        urteil = eine_zeile(z, tabelle)
        if not urteil["spieler"]:
            offen.append({**z, "grund": urteil["grund"]})
            continue
        treffer.append({**z, "spieler": urteil["spieler"],
                        "aehnlichkeit": urteil["aehnlichkeit"]})

    # Eine Zeile, die in Runde 1 sicher zugeordnet wurde, gehoert auch dann
    # diesem Spieler, wenn dieselbe Zeile in einem anderen Bild knapp unter der
    # Schwelle blieb — es ist dieselbe Zeile, nicht ein zweiter Mensch.
    #
    # Ohne diesen Schritt landet die knappere Lesung im Rest-Durchlauf, und der
    # findet dort *einen anderen* freien Kadernamen: am 16.09.2026 wurde
    # `'JG ASTRID OG'` (116,7M) einmal `ʚɞ ASTRID ʚɞ` (0,60) und einmal
    # `Stargreg` (0,44 bei 1,4% Kraftabstand). Aus 20 gesetzten Spielern wurden
    # so 21, und die Gegenprobe gegen die Zaehler des Spiels fiel durch —
    # ausgerechnet an einem Lauf, der die Liste vollstaendig gesehen hatte.
    #
    # Verglichen wurde dafuer zuerst die **woertliche** Lesart, und genau daran
    # ist es am 17.09.2026 erneut vorbeigelaufen: dieselbe Zeile kam als
    # `'JG ASTRID 3g'` und als `'DG ASTRID 3G'` an, der Wortvergleich sah zwei
    # verschiedene Dinge, und `Stargreg` stand wieder da. Eine Zeile ist
    # deshalb nicht ihr Text (siehe `_dieselbe_zeile`).
    noch_offen = []
    for z in offen:
        sicher = _dieselbe_zeile(z, treffer)
        if sicher:
            # Auch der **Wert** kommt von der sicheren Lesung. Es sind dieselben
            # Pixel: wo dort ein Abzeichen erkannt wurde und hier keines, ist
            # nicht ein zweiter Zustand gemessen worden, sondern derselbe
            # schlechter. Sonst brauete die Dublette einen Widerspruch
            # („A und AE") zusammen, den es im Spiel gar nicht gibt.
            treffer.append({**z, "spieler": sicher["spieler"], "aehnlichkeit": None,
                            "wert": sicher.get("wert"),
                            "grund": "dieselbe Zeile wie eine sichere Lesung"})
        else:
            noch_offen.append(z)
    offen = noch_offen

    # Dieselbe Zeile taucht in aufeinanderfolgenden Bildern erneut auf. Erst
    # nach der Zuordnung laesst sich sauber entdoppeln: zwei Bilder desselben
    # Spielers landen auf demselben Kadernamen, zwei Spieler mit zufaellig
    # gleicher Kraft nicht.
    je_spieler: dict[str, list[dict]] = {}
    for t in treffer:
        je_spieler.setdefault(t["spieler"], []).append(t)

    eindeutig, konflikte = {}, []
    for name, gruppe in je_spieler.items():
        balken = _balken_teams(gruppe)
        werte = {t.get("wert") for t in gruppe}
        if len(werte) > 1:
            # Zwei Zeilen muessen kein Widerspruch sein: wer sich fuer beide
            # Uhrzeiten meldet, steht zweimal in der Liste — einmal unter dem
            # 13:00-, einmal unter dem 22:00-Balken. Lassen sich die Werte zu
            # einem „ohne Platz" zusammenziehen, ist das die Aussage des
            # Spielers und keine Unstimmigkeit.
            vereint = roster.ohne_platz_vereinen(werte)
            if vereint:
                eindeutig[name] = {**gruppe[0], "wert": vereint, "balken_teams": balken,
                                   "zeilen_gesehen": len(gruppe),
                                   "belege": _belege(gruppe)}
                continue
            konflikte.append({"spieler": name, "werte": sorted(w or "?" for w in werte),
                              "zeilen": gruppe, "belege": _belege(gruppe)})
            continue
        eindeutig[name] = {**gruppe[0], "balken_teams": balken,
                           "zeilen_gesehen": len(gruppe),
                           "belege": _belege(gruppe)}

    benutzt = set(eindeutig) | {k["spieler"] for k in konflikte}
    rest_kader = [p for p in kader if p["name"] not in benutzt]
    if offen and rest_kader:
        # **Eine Zeile, ein Versuch.** Der Rest-Durchlauf streicht jeden
        # getroffenen Kadernamen aus dem Kandidatenkreis — das ist richtig, aber
        # es setzt voraus, dass jede Zeile ihm genau einmal vorgelegt wird. Vier
        # Lesungen derselben Zeile sind vier Versuche, und ab dem zweiten ist der
        # eigene Name des Spielers schon vergeben: am 17.09.2026 wurde dieselbe
        # Ersatz-Zeile (116,7M) einmal `ʚɞ ASTRID ʚɞ` (0,60) und einmal
        # `Stargreg` (0,44) — bei 10 von 10 belegten Ersatzplaetzen stand die
        # Bank damit auf 11.
        #
        # Die Faltung davor ist dieselbe Ueberlegung wie `_nachbarn_falten` im
        # Kartenarchiv: erst das Material zu einer Sache zusammenziehen, dann
        # ueber die Sache urteilen.
        gruppen = _zeilen_falten(offen)
        vertreter = [_beste_lesung(g) for g in gruppen]
        _, neue = _rest_durchlauf(vertreter, rest_kader)
        nach_zeile = {_zeilen_schluessel(t): t for t in neue}
        offen = []
        for gruppe, v in zip(gruppen, vertreter):
            t = nach_zeile.get(_zeilen_schluessel(v))
            if t:
                eindeutig[t["spieler"]] = {**t, "balken_teams": _balken_teams(gruppe),
                                           "zeilen_gesehen": len(gruppe)}
            else:
                offen.extend(gruppe)

    return {"treffer": eindeutig, "offen": offen, "konflikte": konflikte}


def _zeilen_schluessel(z: dict) -> tuple:
    return (z.get("bild"), z.get("y"), z.get("name_ocr"))


def _beste_lesung(gruppe: list[dict]) -> dict:
    """Welche der Lesungen derselben Zeile antritt — die haeufigste.

    Dieselbe Begruendung wie bei den Kampfergebnissen: jede Zeile steht in
    mehreren Bildern, und gewonnen hat die Lesung, die am oeftesten so
    herauskam. Bei Gleichstand die laengste — ein abgeschnittener Name ist der
    haeufigere Fehler als ein erfundenes Zeichen.
    """
    haeufig = collections.Counter(norm(z.get("name_ocr", "")) for z in gruppe)
    return max(gruppe, key=lambda z: (haeufig[norm(z.get("name_ocr", ""))],
                                      len(norm(z.get("name_ocr", "")))))


def _zeilen_falten(zeilen: list[dict]) -> list[list[dict]]:
    """Lesungen, die dieselbe Zeile meinen, zu je einer Gruppe zusammenziehen."""
    gruppen: list[list[dict]] = []
    for z in zeilen:
        for g in gruppen:
            if _dieselbe_zeile(z, g):
                g.append(z)
                break
        else:
            gruppen.append([z])
    return gruppen


def _dieselbe_zeile(z: dict, treffer: list[dict]) -> dict | None:
    """Die schon zugeordnete Zeile, die dieselbe ist wie `z` — oder None.

    Dieselbe Zeile steht in mehreren aufeinanderfolgenden Bildern. Woran man
    sie wiedererkennt, ist **nicht ihr Text**: die Texterkennung liest dieselben
    Pixel von Bild zu Bild verschieden (`'JG ASTRID 3g'` / `'DG ASTRID 3G'`).
    Sie wiederzuerkennen ist trotzdem noetig, sonst sucht sich die knappere
    Lesung im Rest-Durchlauf einen zweiten Kadernamen, und aus einem Spieler
    werden zwei.

    Drei Merkmale muessen zusammen stimmen, und erst zusammen tragen sie:

    * **Die Kraftzahl** ist die stabilste Groesse der Zeile — reine Ziffern,
      und sie steht so im Bild. Allein reicht sie nicht: bei einer Stelle hinter
      dem Komma und 112 Spielern auf rund tausend moegliche Werte ist ein
      Zusammentreffen zweier Spieler nicht selten, sondern zu erwarten (rund
      sechs Paare je Kader).
    * **Platz und Abzeichen** — gesetzt/Ersatz/ohne und A/B. Zwei Zeilen, die
      sich darin unterscheiden, sind nie dieselbe.
    * **Die Aehnlichkeit der beiden Lesungen** (`GLEICHE_ZEILE_MIN`). Das ist
      der Teil, der die zufaellige Kraftgleichheit ausschliesst: zwei
      verschiedene Spieler mit gleicher Kraft haben verschiedene Namen, und
      eine Erkennung, die aus beiden fast denselben Text macht, gibt es nicht.

    **Im selben Bild entscheidet die Lage statt des Textes.** Die Liste wird
    beim Scrollen neu gezeichnet, und ein Bild trifft sie gelegentlich mitten
    darin: derselbe Kopf wird zweimal gefunden, ein paar Dutzend Pixel
    versetzt, und die zweite Lesung faellt entsprechend aus — am 17.09.2026
    stand `ღ SWORD ღ` einmal als `'n3 SWORD n'` und 39 px darueber als
    `'JOOパンセーとン'`. Ueber den Text ist da nichts wiederzuerkennen, ueber
    den Ort schon: zwei *verschiedene* Zeilen liegen in einem Bild immer eine
    ganze Zeilenhoehe auseinander (`ZEILE_MIN_ABSTAND_PX`). Das Abzeichen darf
    dabei fehlen — `None` heisst „nicht gelesen", nicht „anderes Team".
    """
    n = norm(z.get("name_ocr", ""))
    if not n or z.get("kraft") is None:
        return None
    for t in treffer:
        if (t.get("kraft") != z.get("kraft")
                or t.get("platz") != z.get("platz")):
            continue
        if (t.get("bild") == z.get("bild") and t.get("y") is not None
                and z.get("y") is not None
                and abs(t["y"] - z["y"]) < ZEILE_MIN_ABSTAND_PX):
            return t
        if t.get("team_abzeichen") != z.get("team_abzeichen"):
            continue
        andere = norm(t.get("name_ocr", ""))
        if (andere == n or difflib.SequenceMatcher(None, andere, n).ratio()
                >= GLEICHE_ZEILE_MIN):
            return t
    return None


def _balken_teams(gruppe: list[dict]) -> list[str]:
    return sorted({z.get("balken_team") for z in gruppe if z.get("balken_team")})


def _belege(gruppe: list[dict]) -> list[str]:
    """Je Balkenfarbe **ein** Ausschnitt — mehr sagt nichts Neues.

    Dieselbe Zeile steht in mehreren Bildern, und ihre Ausschnitte sehen alle
    gleich aus: es sind dieselben Pixel, nur ein Bild spaeter. Drei davon
    untereinander machen den Beleg laenger, nicht besser.

    **Verschiedene Farben sind dagegen verschiedene Aussagen.** Wer sich fuer
    beide Uhrzeiten gemeldet hat, steht unter zwei verschieden farbigen Balken;
    ein Beleg mit nur einem davon sieht aus wie eine Meldung fuer eine Zeit.
    Genommen wird je Farbe die Lesung, deren Uhrzeit dastand — auf dem Bild
    steht sie ohnehin, aber sie sagt auch, dass dieser Ausschnitt scharf genug
    ist, um gelesen zu werden.
    """
    je_farbe: dict = {}
    for z in gruppe:
        kennung = z.get("beleg")
        if not kennung:
            continue
        farbe = z.get("farbe")
        if farbe not in je_farbe or (z.get("zeit") and not je_farbe[farbe][1]):
            je_farbe[farbe] = (kennung, z.get("zeit"))
    return [k for k, _ in je_farbe.values()]


def beide_zeiten(treffer: dict) -> dict[str, int]:
    """{Spieler: Zahl der gesehenen Zeilen} fuer alle, die sich fuer **beide** Uhrzeiten gemeldet haben.

    Der Balken ueber einer Zeile nennt die Zeit, fuer die sich jemand gemeldet
    hat; das Abzeichen daneben das Team, in das er eingeteilt **ist**. Wer beide
    Zeiten angibt, dessen Balken wechselt staendig zwischen ihnen hin und her —
    ueber mehrere Bilder gesehen stehen dann beide Farben da. Das ist kein
    Flackern der Anzeige und kein Widerspruch, sondern die nuetzlichste Auskunft
    beim Nachruecken: dieser Mensch liesse sich in **beiden** Teams einplanen.

    Die Zahl der Zeilen steht dabei, weil sie die Aussagekraft begrenzt: Wer nur
    in *einem* Bild stand, kann den Wechsel gar nicht gezeigt haben. Ein Name,
    der hier fehlt, heisst deshalb „nicht gesehen", nicht „nur eine Zeit" —
    dieselbe Unterscheidung wie zwischen `NULL` und „Stufe 0" beim Kartenscan.
    """
    return {n: t.get("zeilen_gesehen", 1)
            for n, t in sorted(treffer.items())
            if len(t.get("balken_teams") or []) > 1}


def beide_zeiten_text(d: dict[str, int]) -> list[str]:
    """Die Zeilen fuer den Bericht — einmal geschrieben, von beiden Wegen benutzt.

    Dienst (`run.py`) und Mitschrift (`mitlesen.py`) berichten dasselbe; zwei
    Fassungen liefen frueher oder spaeter auseinander.
    """
    if not d:
        return []
    return ["Beide Zeiten gemeldet (in beiden Teams einsetzbar): "
            + ", ".join(f"{n} ({z} Zeilen)" for n, z in d.items())]
