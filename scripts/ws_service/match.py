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
    # Welche Lesart in diesem Durchlauf schon vergeben wurde. Der Kandidatenkreis
    # schrumpft hier mit jedem Treffer (`frei.discard`) — ohne dieses Gedaechtnis
    # bekommt dieselbe Zeile aus dem naechsten Bild zwangslaeufig einen *anderen*
    # Namen, weil ihr eigener gerade vergeben wurde. Am 16.09.2026 wurde
    # `'JG ASTRID OG'` so zweimal zugeordnet: einmal `ʚɞ ASTRID ʚɞ` (0,60) und
    # einmal `Stargreg` (0,44). Der zweite war frei erfunden und hob die Zahl der
    # gesetzten Spieler von 20 auf 21.
    vergeben: dict[str, str] = {}
    for z in offen:
        gesucht = norm(z.get("name_ocr", ""))
        kraft = z.get("kraft")
        if gesucht in vergeben:
            neue_treffer.append({**z, "spieler": vergeben[gesucht], "aehnlichkeit": None,
                                 "grund": "gleiche Lesart wie eine zugeordnete Zeile"})
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
            vergeben[gesucht] = beste[2]
        else:
            grund = z.get("grund", "")
            bestmoeglich = beste or (bewertet[0] if bewertet else None)
            if bestmoeglich:
                grund += (f" | Rest-Kader: {bestmoeglich[2]!r} (Name {bestmoeglich[0]:.2f}, "
                          f"Kraft-Abw. {bestmoeglich[1]*100:.0f}%)")
            noch_offen.append({**z, "grund": grund})
    return noch_offen, neue_treffer


def zuordnen(zeilen: list[dict], kader: list[dict]) -> dict:
    """Jede Zeile einem Kadernamen zuordnen.

    Ergebnis: {'treffer': [...], 'offen': [...], 'konflikte': [...]}
    `offen` sind Zeilen ohne sicheren Treffer — die werden **nicht** geschrieben,
    sondern gemeldet. Lieber eine Luecke im Bericht als ein Wert beim Falschen.
    """
    tabelle = {}
    for p in kader:
        tabelle.setdefault(norm(p["name"]), p)
    # Bekannte Fehllesungen kommen als **zusaetzliche Schreibweise** desselben
    # Spielers dazu, nicht als Sonderweg daneben: damit laufen sie durch
    # dieselbe Aehnlichkeitspruefung, und eine leicht abweichende Lesung
    # (`XAZANHM` statt `XAZANHZ`) trifft weiterhin.
    nach_name = {p["name"]: p for p in kader}
    for lesart, name in aliase().items():
        p = nach_name.get(name)
        if p is not None and lesart not in tabelle:
            tabelle[lesart] = p
    schluessel = list(tabelle)

    treffer, offen = [], []
    for z in zeilen:
        gesucht = norm(z.get("name_ocr", ""))
        if not gesucht:
            offen.append({**z, "grund": "kein Name gelesen"})
            continue
        # Je Spieler zaehlt seine **beste** Schreibweise. Ohne das Zusammenziehen
        # stuenden bei einem Aliastreffer Alias und echter Name als Erst- und
        # Zweitplatzierter da — und der Abstandstest verwuerfe den eindeutigsten
        # Treffer, den es ueberhaupt gibt.
        je_name: dict[str, tuple] = {}
        for k in schluessel:
            p = tabelle[k]
            score = difflib.SequenceMatcher(None, gesucht, k).ratio()
            eintrag = (score + _kraft_bonus(z.get("kraft"), p.get("hero_power")),
                       score, p["name"])
            if eintrag > je_name.get(p["name"], (-1, -1, "")):
                je_name[p["name"]] = eintrag
        bewertet = sorted(je_name.values(), reverse=True)
        beste, zweite = bewertet[0], (bewertet[1] if len(bewertet) > 1 else (0, 0, ""))
        if beste[1] < MIN_AEHNLICHKEIT or beste[0] - zweite[0] < MIN_ABSTAND:
            offen.append({**z, "grund": f"unsicher: {beste[2]!r} ({beste[1]:.2f}) "
                                        f"vs {zweite[2]!r} ({zweite[1]:.2f})"})
            continue
        treffer.append({**z, "spieler": beste[2], "aehnlichkeit": round(beste[1], 3)})

    # Eine Lesart, die in Runde 1 sicher zugeordnet wurde, gehoert auch dann
    # diesem Spieler, wenn dieselbe Zeile in einem anderen Bild knapp unter der
    # Schwelle blieb — es ist dieselbe Zeile, nicht ein zweiter Mensch.
    #
    # Ohne diesen Schritt landet die knappere Lesung im Rest-Durchlauf, und der
    # findet dort *einen anderen* freien Kadernamen: am 16.09.2026 wurde
    # `'JG ASTRID OG'` (116,7M) einmal `ʚɞ ASTRID ʚɞ` (0,60) und einmal
    # `Stargreg` (0,44 bei 1,4% Kraftabstand). Aus 20 gesetzten Spielern wurden
    # so 21, und die Gegenprobe gegen die Zaehler des Spiels fiel durch —
    # ausgerechnet an einem Lauf, der die Liste vollstaendig gesehen hatte.
    schon_zugeordnet = {norm(t["name_ocr"]): t["spieler"] for t in treffer}
    noch_offen = []
    for z in offen:
        spieler = schon_zugeordnet.get(norm(z.get("name_ocr", "")))
        if spieler:
            treffer.append({**z, "spieler": spieler, "aehnlichkeit": None,
                            "grund": "gleiche Lesart wie eine sichere Zeile"})
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
                                   "zeilen_gesehen": len(gruppe)}
                continue
            konflikte.append({"spieler": name, "werte": sorted(w or "?" for w in werte),
                              "zeilen": gruppe})
            continue
        eindeutig[name] = {**gruppe[0], "balken_teams": balken,
                           "zeilen_gesehen": len(gruppe)}

    benutzt = set(eindeutig) | {k["spieler"] for k in konflikte}
    rest_kader = [p for p in kader if p["name"] not in benutzt]
    if offen and rest_kader:
        offen, neue = _rest_durchlauf(offen, rest_kader)
        for t in neue:
            eindeutig[t["spieler"]] = {**t, "balken_teams": _balken_teams([t]),
                                       "zeilen_gesehen": 1}

    return {"treffer": eindeutig, "offen": offen, "konflikte": konflikte}


def _balken_teams(gruppe: list[dict]) -> list[str]:
    return sorted({z.get("balken_team") for z in gruppe if z.get("balken_team")})


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
