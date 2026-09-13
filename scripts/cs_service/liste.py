"""Wächter über den Zustand der Rang-Gruppen in der Teilnehmerliste.

**Warum das kein Vorsatz sein darf, sondern Code.** Vor dem Scan einer Rang-Gruppe
müssen alle anderen eingeklappt sein. Ist zufällig eine zweite offen, liest der Scan
deren Mitglieder mit — und die Zähler-Gegenprobe je Rang schlägt an der falschen
Stelle an oder geht scheinbar auf. Das Ergebnis sieht dann plausibel aus und ist
falsch; genau daran sind über Tage mehrere Läufe gescheitert.

Der Einstieg über „Verwalten" landet **nicht** verlässlich in einer eingeklappten
Liste: das Spiel merkt sich den zuletzt offenen Rang. Der erste Schritt nach dem
Betreten der Liste ist deshalb immer `alle_schliessen`.

**Erkannt wird über Geometrie, nicht über die Pfeilrichtung.** Ein Versuch, ▲ gegen
▼ am hellen Dreieck zu unterscheiden, hat alle Balken als offen gemeldet: der Knopf
ist oben heller als unten, der Verlauf überstimmt das Dreieck. Eingeklappt stehen
die Balken dagegen dicht gestapelt — jede Lücke, in die eine Spielerkarte passt,
heißt, dass darüber ein Rang offen ist. Das ist unabhängig von Farbe und Beleuchtung.
"""
from __future__ import annotations

from scripts.ws_service import roster as ws_roster
from scripts.ws_service.device import Geraet
from scripts.ws_service.navigate import NavigationFehler

# Abstand zwischen zwei dicht gestapelten Balken. Eine Spielerkarte ist rund
# 300 px hoch — alles darueber ist zweifelsfrei aufgeklappter Inhalt.
_LUECKE_MAX = 90
_RAENGE = 5


class RangZustandFehler(NavigationFehler):
    """Die Liste liess sich nicht in den verlangten Zustand bringen."""


def _luecken(balken: list[tuple[int, int]]) -> list[int]:
    return [b0 - a1 for (_, a1), (b0, _) in zip(balken, balken[1:])]


def alle_zu(g: Geraet, bild=None) -> bool:
    """Sind alle Rang-Gruppen eingeklappt?

    Eingeklappt passen alle Baender zugleich ins Fenster und stehen dicht
    beieinander. Sind weniger als `_RAENGE` sichtbar, schiebt offener Inhalt den
    Rest hinaus.
    """
    balken = ws_roster.gruppenbalken(g, bild if bild is not None else g.bild())
    return len(balken) >= _RAENGE and all(l <= _LUECKE_MAX for l in _luecken(balken))


def _offener(balken: list[tuple[int, int]]) -> tuple[int, int]:
    """Der Balken, der zugeklappt werden muss."""
    for band, luecke in zip(balken, _luecken(balken)):
        if luecke > _LUECKE_MAX:
            return band
    # Keine Luecke sichtbar und trotzdem nicht alle da: der Inhalt haengt unter
    # dem letzten Balken — oder wir stehen mitten in einer offenen Gruppe, deren
    # Balken oben klebt.
    return balken[0] if len(balken) == 1 else balken[-1]


def alle_schliessen(g: Geraet, log=print, versuche: int = 10) -> None:
    """Klappt zu, bis alle Rang-Gruppen nachweislich eingeklappt sind."""
    x = g.cfg["group_arrow_x"]
    for runde in range(1, versuche + 1):
        balken = ws_roster.gruppenbalken(g, g.bild())
        if not balken:
            raise RangZustandFehler(
                "Kein einziger Rang-Balken sichtbar — steht die Teilnehmerliste "
                "ueberhaupt offen?")
        if len(balken) >= _RAENGE and all(l <= _LUECKE_MAX for l in _luecken(balken)):
            log(f"  alle {len(balken)} Rang-Gruppen eingeklappt.")
            return
        a, b = _offener(balken)
        log(f"  Runde {runde}: {len(balken)} Balken, klappe y={a}..{b} zu ...")
        g.tippen(x, (a + b) // 2, pause=1.8)
    raise RangZustandFehler(
        f"Nach {versuche} Runden sind noch nicht alle Rang-Gruppen zu.")


def rang_oeffnen(g: Geraet, nummer: int, log=print) -> tuple[int, int]:
    """Öffnet genau eine Rang-Gruppe — und **nur** aus dem geschlossenen Zustand.

    `nummer` zählt von oben ab 0 (0 = R5, 1 = R4, ...). Der Aufruf von
    `alle_schliessen` steht bewusst hier drin und nicht beim Aufrufer: so kann
    keine Scan-Stelle ihn vergessen.
    """
    alle_schliessen(g, log=log)
    balken = ws_roster.gruppenbalken(g, g.bild())
    if nummer >= len(balken):
        raise RangZustandFehler(
            f"Rang {nummer} gibt es nicht — nur {len(balken)} Balken sichtbar.")
    a, b = balken[nummer]
    log(f"  Rang {nummer} oeffnen (y={a}..{b}) ...")
    g.tippen(g.cfg["group_arrow_x"], (a + b) // 2, pause=2.0)
    nachher = ws_roster.gruppenbalken(g, g.bild())
    if len(nachher) >= _RAENGE and all(l <= _LUECKE_MAX for l in _luecken(nachher)):
        raise RangZustandFehler(f"Rang {nummer} ist nach dem Tippen nicht offen.")
    return a, b
