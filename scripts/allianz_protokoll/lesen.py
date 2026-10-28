"""Ein Bild des Allianz-Protokolls (Reiter „Mitglieder") in Einträge zerlegen.

Ohne Gerät: alles hier arbeitet auf einem Bild, damit sich jede Änderung an
den abgelegten Bildern eines Laufs nachmessen lässt (`run.py --ordner`).

Ein Eintrag ist eine Karte: links das Symbol, daneben ein bis zwei Zeilen
Text, rechts unten der Zeitstempel `2026-10-27 11:31:42`. Der Zeitstempel ist
der Anker — alles zwischen ihm und dem vorigen gehört zu dieser Karte.

Vier Arten, je an Satz **und** Symbolfarbe erkennbar:

| Text | Symbol | art |
|---|---|---|
| „X hat die Allianz verlassen." | rot | `abgang` |
| „Y hat X aus der Allianz entfernt." | rot | `entfernt` |
| „Y hat die Beitrittsanfrage von X akzeptiert." | blau | `zugang` |
| „Y hat den Rang von X von 3 auf 1 geändert." | gelb | `rang` |

**Die Farbe ist die Gegenprobe zum Text.** Der Satz entscheidet, welcher Name
wohin gehört; die Farbe sagt unabhängig davon, ob es ein Eintritt oder ein
Austritt war. Widersprechen sich beide, ist der Eintrag `unsicher` und wird
nicht angewendet — ein falsch verstandener Satz würde sonst jemanden aus dem
Kader nehmen, der gerade beigetreten ist. Gemessen am 28.10.2026 an sechs
Karten der Aufnahme: rot 0,31 · blau 0,33 · gelb 0,14–0,16 Anteil, jeweils
0,00–0,01 bei den anderen beiden Farben.
"""
from __future__ import annotations

import re
from datetime import datetime

import numpy as np

from scripts.ws_service import ergebnis

# Die Liste im Fenster, in Pixeln der 2560×2560-Auflösung (Aufnahme 28.10.2026).
LISTE_BOX = (600, 360, 1960, 2240)
# Text steht zwischen Symbol und Zeitstempel. **Erst ab x=880**: im gelben
# Rang-Symbol steht ein „R", und mitgelesen wurde daraus `von2 R auf 1`.
TEXT_X_VON = 880
TEXT_X_BIS = 1450
SYMBOL_X = (660, 860)

_DATUM = re.compile(r"(20\d\d)\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})\s+(\d{1,2})\s*[:.]\s*(\d{2})\s*[:.]\s*(\d{2})")

# Abstand von der ersten Textzeile einer Karte bis zu ihrem Zeitstempel:
# gemessen 160–290 px (ein- bzw. zweizeilig), Kartenabstand rund 290 px.
KARTE_PX = 300
_EINBLENDUNG = re.compile(r"erhalten\s*!", re.I)

# Die Sätze, wie das Spiel sie schreibt. „geändert" kommt oft ohne Umlaut an.
_MUSTER = [
    ("zugang", re.compile(r"^(?P<akteur>.+?)\s+hat\s+die\s+Beitrittsanfrage\s+von\s+"
                          r"(?P<spieler>.+?)\s+akzeptiert", re.I)),
    ("entfernt", re.compile(r"^(?P<akteur>.+?)\s+hat\s+(?P<spieler>.+?)\s+aus\s+der\s+"
                            r"Allianz\s+entfernt", re.I)),
    ("abgang", re.compile(r"^(?P<spieler>.+?)\s+hat\s+die\s+Allianz\s+verlassen", re.I)),
    ("rang", re.compile(r"^(?P<akteur>.+?)\s+hat\s+den\s+Rang\s+von\s+(?P<spieler>.+?)\s*"
                        r"von\s*(?P<von>\d)\s*auf\s*(?P<nach>\d)\s*ge", re.I)),
]

# Welche Symbolfarbe zu welcher Art gehört.
FARBE_VON = {"zugang": "blau", "abgang": "rot", "entfernt": "rot", "rang": "gelb"}


def symbolfarbe(bild: np.ndarray, y0: int, y1: int) -> str | None:
    """Farbe des Symbols links neben der Karte zwischen y0 und y1."""
    a = bild[max(0, int(y0)):int(y1), SYMBOL_X[0]:SYMBOL_X[1]].reshape(-1, 3).astype(int)
    if not len(a):
        return None
    r, g, b = a[:, 0], a[:, 1], a[:, 2]
    blau = ((b > 170) & (r < 140) & (b - r > 60)).mean()
    gelb = ((r > 190) & (g > 140) & (b < 100)).mean()
    rot = ((r > 170) & (g < 120) & (b < 110)).mean()
    if blau > 0.15:
        return "blau"
    if gelb > 0.08:
        return "gelb"
    if rot > 0.2:
        return "rot"
    return None


def deuten(text: str) -> dict:
    """Satz → {art, spieler, akteur, rang_von, rang_nach}. Unbekannt → `sonstig`."""
    t = re.sub(r"\s+", " ", text).strip()
    for art, m in ((a, rx.match(t)) for a, rx in _MUSTER):
        if m:
            d = m.groupdict()
            return {"art": art, "spieler": d["spieler"].strip(),
                    "akteur": (d.get("akteur") or "").strip() or None,
                    "rang_von": int(d["von"]) if d.get("von") else None,
                    "rang_nach": int(d["nach"]) if d.get("nach") else None}
    return {"art": "sonstig", "spieler": t, "akteur": None,
            "rang_von": None, "rang_nach": None}


def eintraege_im_bild(bild: np.ndarray, erstes_bild: bool = False
                      ) -> tuple[list[dict], bool]:
    """(Einträge, Einblendung?) — alle vollständig sichtbaren Einträge eines
    Bildes, von oben nach unten.

    **Die oberste Karte zählt nur im ersten Bild.** Gescrollt wird nach unten,
    neuer Inhalt kommt also unten herein. Die oberste Karte eines späteren
    Bildes kann oben angeschnitten sein — Vision liest dann nur ihre zweite
    Zeile („von 3 auf 1 geändert.") und daraus würde ein `sonstig`. Sie stand
    im Bild davor vollständig da. Im ersten Bild steht die Liste am Anfang,
    dort ist auch die oberste Karte ganz.

    **Ohne Zeitstempel kein Eintrag.** Die unterste Karte ist oft unten
    angeschnitten und kommt im nächsten Bild ganz.

    **Eine Karte ist höchstens `KARTE_PX` hoch.** Wird ein Zeitstempel nicht
    gelesen, fielen die Zeilen seiner Karte sonst der nächsten zu: in der
    Aufnahme vom 28.10.2026 stand so `SyDdu38` (21.10.) als zweiter Eintrag
    unter dem 20.10. Aus demselben Grund gilt eine Lesung mit zwei Sätzen
    („… hat … hat …") nicht.

    Das zweite Rückgabefeld meldet eine Einblendung über der Liste („Sarahs
    Geschenk erhalten!"). Sie zerstört den Satz der Karte darunter; wer sie
    sieht, nimmt das Bild einen Augenblick später neu auf.
    """
    texte = sorted(ergebnis.zeilen_lesen(bild, LISTE_BOX, ergebnis.SPRACHEN_NAMEN),
                   key=lambda t: t["y"])
    stempel = []
    for t in texte:
        m = _DATUM.search(t["t"])
        if m and t["x"] > TEXT_X_BIS - 200:
            try:
                zeit = datetime(*map(int, m.groups()))
            except ValueError:
                continue
            stempel.append((t, zeit))

    einblendung = any(_EINBLENDUNG.search(t["t"]) for t in texte)
    out = []
    oben = LISTE_BOX[1]
    for i, (st, zeit) in enumerate(stempel):
        zeilen = [t for t in texte if TEXT_X_VON <= t["x"] < TEXT_X_BIS and max(oben, st["y"] - KARTE_PX) <= t["y"] < st["y"]
                  and not _DATUM.search(t["t"])]
        grenze_oben = oben
        oben = st["y"] + st["h"]
        if not zeilen or (i == 0 and not erstes_bild):
            continue
        text = " ".join(t["t"] for t in zeilen)
        if len(re.findall(r"\bhat\b", text)) > 1:
            continue
        d = deuten(text)
        farbe = symbolfarbe(bild, max(grenze_oben, zeilen[0]["y"] - 40), st["y"])
        soll = FARBE_VON.get(d["art"])
        out.append({**d, "zeit": zeit.isoformat(sep=" "), "text": text, "symbol": farbe,
                    "unsicher": bool(soll and farbe and soll != farbe),
                    "y": round(st["y"])})
    return out, einblendung


def _aehnlich(a: str, b: str) -> float:
    import difflib
    from scripts.ws_service.match import norm
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def zusammenfuehren(lesungen: list[dict]) -> list[dict]:
    """Die Lesungen aller Bilder zu einer Liste von Einträgen, neueste zuerst.

    **Jede Karte steht in mehreren Bildern, und das wird genutzt.** Ein kurz
    eingeblendeter Hinweis („Sarahs Geschenk erhalten!") legt sich über die
    Liste und zerstört in genau einem Bild den Satz einer Karte — im Bild davor
    oder danach steht er sauber da. Gesammelt wird deshalb je Zeitstempel, und
    eine Lesung, die einen Satz ergibt, schlägt jede, die keinen ergibt.
    `sonstig` bleibt nur, wo **keine** Lesung einen bekannten Satz traf.

    **Derselbe Zeitstempel kann zwei Einträge tragen** (zwei Rauswürfe in einer
    Sekunde). Innerhalb eines Zeitstempels wird deshalb nach Art und ähnlichem
    Namen gruppiert, nicht alles zu einem Eintrag gefaltet. Je Gruppe gewinnt
    die häufigste Schreibweise — `154I` gegen `1541` entscheidet die Mehrheit.
    """
    from collections import Counter
    je_zeit: dict[str, list[dict]] = {}
    for x in lesungen:
        je_zeit.setdefault(x["zeit"], []).append(x)
    out = []
    for zeit, gruppe in je_zeit.items():
        gedeutet = [x for x in gruppe if x["art"] != "sonstig"]
        kandidaten = gedeutet or gruppe
        haufen: list[list[dict]] = []
        for x in kandidaten:
            for h in haufen:
                if h[0]["art"] == x["art"] and _aehnlich(h[0]["spieler"], x["spieler"]) >= 0.6:
                    h.append(x)
                    break
            else:
                haufen.append([x])
        for h in haufen:
            name = Counter(x["spieler"] for x in h).most_common(1)[0][0]
            beste = next(x for x in h if x["spieler"] == name)
            akteur = Counter(x["akteur"] for x in h if x["akteur"]).most_common(1)
            rang = Counter((x["rang_von"], x["rang_nach"]) for x in h
                           if x["rang_von"] is not None).most_common(1)
            farben = Counter(x["symbol"] for x in h if x["symbol"])
            symbol = farben.most_common(1)[0][0] if farben else None
            soll = FARBE_VON.get(beste["art"])
            out.append({
                "zeit": zeit, "art": beste["art"], "spieler": name,
                "akteur": akteur[0][0] if akteur else None,
                "rang_von": rang[0][0][0] if rang else None,
                "rang_nach": rang[0][0][1] if rang else None,
                "text": beste["text"], "symbol": symbol,
                "unsicher": bool(soll and symbol and soll != symbol),
                "lesungen": len(h),
            })
    return sorted(out, key=lambda x: x["zeit"], reverse=True)
