"""Prueft die Zustandslogik des Einstell-Dienstes — ohne Geraet, ohne Spiel.

    .venv/bin/python -m scripts.ws_service.pruefe_einstellen

Zwei Behauptungen stehen in `einstellen.py`, und beide sind hier nachgerechnet
statt behauptet:

1. **Jeder Uebergang fuehrt ans Ziel.** `schritte_fuer` liefert fuer jedes Paar
   aus Ist und Soll eine Folge von Feldtipps; nach ihr muss der Zustand der Zeile
   das Soll sein — und ein fremdes oder unklares Abzeichen darf nie angefasst
   werden.
2. **Mehrere Durchlaeufe kommen ans Ende.** Alle vier Toepfe sind voll, ein Zug
   in einen vollen Topf geht nicht, Abmelden geht immer. Die Behauptung ist, dass
   sich das ueber Durchlaeufe in Listenreihenfolge von selbst aufloest. Der
   zweite Teil spielt dafuer ein volles Blatt durch: 30 belegte Plaetze, ein
   umgekehrtes Ziel, und mitgezaehlt wird, wie viele Durchlaeufe es braucht.

Der Fall, um den es beim zweiten Punkt wirklich geht, ist der Ringtausch, an dem
die Schrittfolge fuer die Hand am 16.09.2026 steckenblieb: `A → AE` und
`AE → A` bei 20/20 und 10/10. Er steht ausdruecklich als eigener Fall unten.
"""
from __future__ import annotations

import sys

from .einstellen import ist_wert, schritte_fuer

MAX = {"gesetzt": 20, "ersatz": 10}


def _zeile_nach(ist: str, schritte: list[tuple[str, str]], blatt: str) -> str:
    """Den Feldtipps folgen und sagen, was danach auf der Zeile steht."""
    platz = {"frei": "ohne", blatt: "gesetzt", blatt + "E": "ersatz"}[ist]
    for rolle, danach in schritte:
        # Getippt wird immer auf das Feld `rolle`; `danach` ist die Zusage, die
        # der Dienst hinterher am Bild pruefen wird.
        assert danach in ("ohne", rolle), f"{rolle} kann nicht {danach} werden"
        platz = danach
    return ist_wert({"platz": platz, "team_abzeichen": blatt}, blatt)


def uebergaenge(blatt: str = "A") -> list[str]:
    e, c = blatt + "E", blatt + "C"
    fremd = "B" if blatt == "A" else "A"
    fehler = []
    for ist in ("frei", blatt, e, "fremd", "unklar"):
        for soll in (blatt, e, c, fremd, fremd + "E", fremd + "C"):
            schritte = schritte_fuer(ist, soll, blatt)
            if ist in ("fremd", "unklar"):
                if schritte:
                    fehler.append(f"{ist} → {soll}: angefasst, obwohl fremd/unklar")
                continue
            nach = _zeile_nach(ist, schritte, blatt)
            erwartet = soll if soll in (blatt, e) else "frei"
            if nach != erwartet:
                fehler.append(f"{ist} → {soll}: endet auf {nach}, erwartet {erwartet}")
            # Wer schon richtig steht, darf nicht angetippt werden — jeder Tipp
            # ist ein Risiko, und ein ueberfluessiger ist reines Risiko.
            if ist == erwartet and schritte:
                fehler.append(f"{ist} → {soll}: {len(schritte)} Tipps, obwohl nichts zu tun")
    return fehler


def durchlaeufe(ist: dict[str, str], soll: dict[str, str], blatt: str,
                max_runden: int = 6) -> tuple[int, dict[str, str]]:
    """Spielt die Liste durch wie der Dienst: in Reihenfolge, was gerade geht."""
    stand = dict(ist)
    parken = False
    for runde in range(1, max_runden + 1):
        zaehler = {"gesetzt": sum(1 for w in stand.values() if w == blatt),
                   "ersatz": sum(1 for w in stand.values() if w == blatt + "E")}
        getan, darf_parken = 0, parken
        for name in ist:                       # Listenreihenfolge, fest
            schritte = schritte_fuer(stand[name], soll.get(name, stand[name]), blatt)
            if not schritte:
                continue
            ziel_rolle, danach = schritte[-1]
            if danach != "ohne" and zaehler[ziel_rolle] >= MAX[ziel_rolle]:
                if not (darf_parken and schritte[0][1] == "ohne"):
                    continue                   # Topf voll — spaeter nochmal
                schritte, darf_parken = schritte[:1], False
            for rolle, d in schritte:
                zaehler[rolle] += -1 if d == "ohne" else 1
            stand[name] = _zeile_nach(stand[name], schritte, blatt)
            getan += 1
        if not getan:
            if parken:
                return runde, stand
            parken = True
        else:
            parken = False
    return max_runden, stand


def main() -> int:
    fehler = uebergaenge("A") + uebergaenge("B")
    print(f"Uebergaenge: {'in Ordnung' if not fehler else str(len(fehler)) + ' Fehler'}")
    for f in fehler:
        print(f"  {f}")

    # Ein volles Blatt A: 20 gesetzt, 10 Ersatz, 9 ohne Platz — und ein Ziel,
    # das alles umdreht. Das ist der Ringtausch in gross.
    namen = [f"P{i:02d}" for i in range(39)]
    ist = {n: ("A" if i < 20 else "AE" if i < 30 else "frei") for i, n in enumerate(namen)}
    soll = {n: ("AE" if i < 10 else "AC" if i < 20 else "A" if i < 30 else "A"
                if i < 39 else "AC") for i, n in enumerate(namen)}
    # 10 von A auf die Bank, 10 von A raus, 10 von AE nach A, 9 ohne Platz nach A
    # → 19 gesetzt … das sprengt die 20 nicht und laesst genau eine Luecke.
    runden, stand = durchlaeufe(ist, soll, "A")
    falsch = {n: (stand[n], soll[n]) for n in namen if stand[n] != soll[n]
              and soll[n] in ("A", "AE")}
    voll = {"gesetzt": sum(1 for w in stand.values() if w == "A"),
            "ersatz": sum(1 for w in stand.values() if w == "AE")}
    print(f"Volles Blatt: nach {runden} Durchlaeufen {voll['gesetzt']}/20 gesetzt, "
          f"{voll['ersatz']}/10 Ersatz, {len(falsch)} nicht erreicht")
    for n, (a, b) in list(falsch.items())[:5]:
        print(f"  {n}: steht {a}, soll {b}")
    if voll["gesetzt"] > 20 or voll["ersatz"] > 10:
        fehler.append("Topf uebergelaufen")
    fehler += [f"{n} nicht erreicht" for n in falsch]

    # Der Ringtausch als kleinster Fall: zwei Spieler tauschen ihre Felder,
    # beide Toepfe sind bis zum Rand voll.
    klein_ist = {f"g{i}": "A" for i in range(20)} | {f"e{i}": "AE" for i in range(10)}
    klein_soll = dict(klein_ist) | {"g0": "AE", "e0": "A"}
    runden, stand = durchlaeufe(klein_ist, klein_soll, "A")
    ok = all(stand[n] == klein_soll[n] for n in klein_ist)
    print(f"Ringtausch: nach {runden} Durchlaeufen {'geloest' if ok else 'STECKEN'}")
    if not ok:
        fehler.append("Ringtausch nicht geloest")

    print("\n" + ("Alles in Ordnung." if not fehler else f"{len(fehler)} Probleme."))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
