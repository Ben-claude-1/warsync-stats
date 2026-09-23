"""Aus vielen gelesenen Bildern eine Tagesliste machen.

Reine Rechnung, ohne Geraet und ohne Datenbank — damit an gespeicherten
Bildern messbar (`pruefe_lesen.py`).

**Zusammengefuehrt wird ueber den Punktwert, nicht ueber den Namen und nicht
ueber den Rang.** Beide anderen Kandidaten sind gemessen schlechter:

- Der **Name** schwankt zwischen zwei Lesungen desselben Bildes
  (`JG ASTRID OG` / `3G ASTRID 9G` / `JG ASTRID JG`) — genau der Fehler, an dem
  der Wuestensturm-Dienst sich eine Zeile doppelt eingetragen hat.
- Der **Rang** faellt bei den ersten drei Plaetzen hinter das Medaillenbild und
  verliert bei zweistelligen Zahlen gern die erste Ziffer (29 und 44 kamen ueber
  den Lauf vom 17.09.2026 beide als `4` an).
- Die **Punkte** waren ueber dieselben 164 Rohzeilen in *jeder* der 50 Zeilen
  einstimmig. Sie sind siebenstellig und damit praktisch eindeutig.

Der Rang wird deshalb **aus der Punktreihenfolge abgeleitet** — die Liste ist
absteigend sortiert, das ist ihre Bauart. Die gelesene Ziffer dient nur noch als
Gegenprobe: stimmt sie ueberwiegend mit der abgeleiteten Stelle ueberein, war
die Liste vollstaendig; klafft eine Luecke, fehlt ein Stueck.
"""
from __future__ import annotations

import collections

# So viele gelesene Rangziffern muessen zur abgeleiteten Stelle passen, damit
# der Lauf als vollstaendig gilt. Nicht 100 %: die ersten drei Plaetze tragen
# ein Medaillenbild statt einer Ziffer, und einzelne Lesefehler gibt es immer.
RANG_QUOTE = 0.85


def _phantome(zeilen: list[dict]) -> tuple[list[dict], list[dict]]:
    """Zeilen entfernen, die es gar nicht gibt.

    **Ein falsch gelesener Punktwert ist eine ganze Zeile zu viel.** Weil ueber
    den Punktwert zusammengefuehrt wird, macht eine einzige verlesene Ziffer aus
    einer Zeile zwei — und weil danach die Reihenfolge den Rang bestimmt,
    verschiebt sie *alles darunter* um eins. Am 17.09.2026 traf das den
    Donnerstag: `Snailnuts` stand einmal mit 15.015.292 (einmal gesehen, ohne
    Rangziffer) und einmal mit 13.847.676 (zweimal gesehen, Rang 36); ab Stelle
    33 lag die abgeleitete Position danach durchgehend eins ueber der gelesenen.

    Die Signatur ist eng gefasst, damit keine echte Zeile faellt: **einmal
    gesehen, keine Rangziffer gelesen, und der Name steht anderswo mit mehr
    Belegen noch einmal da.** Ein Spieler kommt in der Tagesliste genau einmal
    vor; zwei Zeilen mit demselben Namen sind also eine zu viel, und die mit dem
    duennsten Beleg ist die falsche.

    Entfernt wird nie stillschweigend — was rausfliegt, steht im Bericht.
    """
    nach_namen: dict[str, list[dict]] = collections.defaultdict(list)
    for z in zeilen:
        if z["name"]:
            nach_namen[z["name"].lower()].append(z)
    raus = [z for z in zeilen
            if z["gesehen"] == 1 and z["rang_ocr"] is None
            and any(a is not z and a["gesehen"] > z["gesehen"]
                    for a in nach_namen[z["name"].lower()])]
    if not raus:
        return zeilen, []
    behalten = [z for z in zeilen if z not in raus]
    return behalten, raus


def zusammenfuehren(roh: list[dict]) -> dict:
    """Rohzeilen aus allen Bildern → eine Tagesliste samt Gegenproben."""
    nach_punkten: dict[int, list[dict]] = collections.defaultdict(list)
    for z in roh:
        if z.get("punkte") is not None:
            nach_punkten[z["punkte"]].append(z)

    zeilen = []
    for pkt, gruppe in nach_punkten.items():
        namen = collections.Counter(z["name"] for z in gruppe if z["name"])
        raenge = collections.Counter(z["platz"] for z in gruppe if z["platz"] is not None)
        name, stimmen = namen.most_common(1)[0] if namen else ("", 0)
        zeilen.append({
            "punkte": pkt,
            "name": name,
            "name_varianten": [n for n, _ in namen.most_common()],
            "rang_ocr": raenge.most_common(1)[0][0] if raenge else None,
            "gesehen": len(gruppe),
            "einig": len(namen) <= 1,
            "sicher": max((z["sicher"] for z in gruppe), default=0.0),
        })

    # Absteigend nach Punkten — so ist die Liste im Spiel gebaut.
    zeilen.sort(key=lambda z: -z["punkte"])
    zeilen, phantome = _phantome(zeilen)
    for i, z in enumerate(zeilen, 1):
        z["rang"] = i

    passend = sum(1 for z in zeilen if z["rang_ocr"] == z["rang"])
    gelesen = sum(1 for z in zeilen if z["rang_ocr"] is not None)
    abweichung = [z for z in zeilen
                  if z["rang_ocr"] is not None and z["rang_ocr"] != z["rang"]]
    # Der hoechste gelesene Rang muss die Zeilenzahl treffen. Trifft er sie
    # nicht, fehlt entweder unten etwas (zu frueh abgebrochen) oder es ist eine
    # Zeile doppelt hineingeraten.
    hoechster = max((z["rang_ocr"] for z in zeilen if z["rang_ocr"] is not None),
                    default=None)

    return {
        "zeilen": zeilen,
        "rohzeilen": len(roh),
        "rang_passend": passend,
        "rang_gelesen": gelesen,
        "rang_abweichungen": [{"stelle": z["rang"], "gelesen": z["rang_ocr"],
                               "name": z["name"], "punkte": z["punkte"]}
                              for z in abweichung],
        "hoechster_rang": hoechster,
        "einstimmig": sum(1 for z in zeilen if z["einig"]),
        "nur_einmal": [z["name"] for z in zeilen if z["gesehen"] == 1],
        "phantome": [{"name": z["name"], "punkte": z["punkte"]} for z in phantome],
    }


def gegenprobe(erg: dict) -> tuple[bool, list[str]]:
    """Ist die Liste ganz gelesen? (ok, Begruendungen)

    Das Ergebnis entscheidet ueber `vollstaendig`, nicht mehr darueber, *ob*
    geschrieben wird — das tut `schreiben_erlaubt`. Eine halb gelesene Liste
    darf nicht als ganze gelten, denn sie sieht plausibel aus: ein Fehlender
    sähe aus wie jemand, der nicht angetreten ist.

    Geprueft wird dreierlei, und jedes fuer sich: dass die
    gelesenen Rangziffern ueberwiegend zur abgeleiteten Stelle passen, dass die
    hoechste gelesene Ziffer die Zeilenzahl trifft, und dass keine Zeile ohne
    Punktwert durchgerutscht ist.
    """
    zeilen = erg["zeilen"]
    meldungen: list[str] = []
    ok = True
    if not zeilen:
        return False, ["keine einzige Zeile gelesen"]

    if erg["rang_gelesen"]:
        quote = erg["rang_passend"] / erg["rang_gelesen"]
        if quote < RANG_QUOTE:
            ok = False
            meldungen.append(
                f"nur {erg['rang_passend']}/{erg['rang_gelesen']} gelesene Rangziffern "
                f"passen zur Reihenfolge ({quote:.0%}, noetig {RANG_QUOTE:.0%}) — "
                f"die Liste ist vermutlich unvollstaendig")
        else:
            meldungen.append(
                f"Rangziffern: {erg['rang_passend']}/{erg['rang_gelesen']} passend "
                f"({quote:.0%})")
    else:
        ok = False
        meldungen.append("keine einzige Rangziffer gelesen — keine Gegenprobe moeglich")

    if erg["hoechster_rang"] is not None and erg["hoechster_rang"] != len(zeilen):
        ok = False
        meldungen.append(
            f"hoechster gelesener Rang {erg['hoechster_rang']}, aber {len(zeilen)} Zeilen "
            f"gefunden — es fehlt etwas oder es ist etwas doppelt")
    else:
        meldungen.append(f"{len(zeilen)} Zeilen, hoechster gelesener Rang "
                         f"{erg['hoechster_rang']}")
    return ok, meldungen


def schreiben_erlaubt(vollstaendig: bool, gelesen: int, alt: dict | None) -> bool:
    """Darf dieser Lauf den gespeicherten Stand des Tages ersetzen?

    **Geschrieben wird, was gefunden wurde** (Entscheidung Ben, 24.09.2026) —
    auch eine Liste, deren Gegenprobe nicht aufgeht. Sie steht dann als
    `vollstaendig=false` da: die Oberflaeche zeigt fuer einen Fehlenden einen
    Strich statt einer Null, und `--nur-fehlende` liest den Tag beim naechsten
    Lauf erneut, bis er aufgeht. Am 22.09.2026 waeren sonst 96 richtig gelesene
    Zeilen verworfen worden, weil **eine** beim Scrollen durchgefallen war.

    Was nicht geht, ist den Stand **verschlechtern**: `schreibe_tag` loescht den
    Tag zuerst, ein missratener Lauf ersetzte einen guten also, statt daneben zu
    stehen — und das faellt niemandem auf. Deshalb zaehlt die Zahl der gelesenen
    Zeilen, und eine aufgegangene Lesung ist gegen eine unvollstaendige immer im
    Recht, egal wie viele Zeilen die hatte.
    """
    alt = alt or {}
    if vollstaendig:
        return True
    if alt.get("vollstaendig"):
        return False
    return gelesen >= (alt.get("gelesen") or 0)
