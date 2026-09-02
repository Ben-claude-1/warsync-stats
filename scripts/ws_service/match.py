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
"""
from __future__ import annotations

import difflib
import unicodedata

MIN_AEHNLICHKEIT = 0.62
MIN_ABSTAND = 0.06      # Vorsprung vor dem Zweitplatzierten


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("ı", "i").replace("İ", "i").replace("ł", "l")
    return "".join(c for c in s.lower() if c.isalnum())


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


def zuordnen(zeilen: list[dict], kader: list[dict]) -> dict:
    """Jede Zeile einem Kadernamen zuordnen.

    Ergebnis: {'treffer': [...], 'offen': [...], 'konflikte': [...]}
    `offen` sind Zeilen ohne sicheren Treffer — die werden **nicht** geschrieben,
    sondern gemeldet. Lieber eine Luecke im Bericht als ein Wert beim Falschen.
    """
    tabelle = {}
    for p in kader:
        tabelle.setdefault(norm(p["name"]), p)
    schluessel = list(tabelle)

    treffer, offen = [], []
    for z in zeilen:
        gesucht = norm(z.get("name_ocr", ""))
        if not gesucht:
            offen.append({**z, "grund": "kein Name gelesen"})
            continue
        bewertet = []
        for k in schluessel:
            p = tabelle[k]
            score = difflib.SequenceMatcher(None, gesucht, k).ratio()
            bewertet.append((score + _kraft_bonus(z.get("kraft"), p.get("hero_power")),
                             score, p["name"]))
        bewertet.sort(reverse=True)
        beste, zweite = bewertet[0], (bewertet[1] if len(bewertet) > 1 else (0, 0, ""))
        if beste[1] < MIN_AEHNLICHKEIT or beste[0] - zweite[0] < MIN_ABSTAND:
            offen.append({**z, "grund": f"unsicher: {beste[2]!r} ({beste[1]:.2f}) "
                                        f"vs {zweite[2]!r} ({zweite[1]:.2f})"})
            continue
        treffer.append({**z, "spieler": beste[2], "aehnlichkeit": round(beste[1], 3)})

    # Dieselbe Zeile taucht in aufeinanderfolgenden Bildern erneut auf. Erst
    # nach der Zuordnung laesst sich sauber entdoppeln: zwei Bilder desselben
    # Spielers landen auf demselben Kadernamen, zwei Spieler mit zufaellig
    # gleicher Kraft nicht.
    je_spieler: dict[str, list[dict]] = {}
    for t in treffer:
        je_spieler.setdefault(t["spieler"], []).append(t)

    eindeutig, konflikte = {}, []
    for name, gruppe in je_spieler.items():
        werte = {t.get("wert") for t in gruppe}
        if len(werte) > 1:
            konflikte.append({"spieler": name, "werte": sorted(w or "?" for w in werte),
                              "zeilen": gruppe})
            continue
        eindeutig[name] = gruppe[0]
    return {"treffer": eindeutig, "offen": offen, "konflikte": konflikte}
