"""Der Weg von der Basis bis zur Teilnehmerliste des Schluchtsturms.

Hauptkarte -> Events -> Reiter "Schluchtsturm" -> Einsatztruppe A/B waehlen ->
"Verwalten". Bis zum Reiter ist der Weg identisch zum Wuestensturm und wird
unveraendert aus scripts.ws_service.navigate uebernommen (zur_hauptkarte,
events_oeffnen, reiter_waehlen, liste_offen, dialog_schliessen) — nur der
letzte Schritt (Einsatztruppe waehlen, dann "Verwalten" statt "Teilnehmer
auswaehlen") ist eigen.
"""
from __future__ import annotations

from scripts.ws_service import navigate as ws_nav
from scripts.ws_service import vision as v
from scripts.ws_service.device import Geraet
from scripts.ws_service.navigate import NavigationFehler, liste_offen  # noqa: F401


def einsatztruppe_waehlen(g: Geraet, team: str, log=print) -> None:
    ziel = g.cfg["einsatztruppe"].get(team.upper())
    if not ziel:
        raise NavigationFehler(f"Keine Koordinaten fuer Einsatztruppe {team!r}.")
    log(f"  Einsatztruppe {team.upper()} waehlen ...")
    g.tippen(*ziel, pause=2.0)


def verwalten_oeffnen(g: Geraet, log=print) -> None:
    """'Verwalten' unten antippen — oeffnet dieselbe Art Dialog wie beim
    Wuestensturm 'Teilnehmer auswaehlen' (liste_offen prueft beides gleich).
    """
    ziel = g.cfg["verwalten_knopf"]
    log(f"  'Verwalten' antippen bei {ziel} ...")
    g.tippen(*ziel, pause=3.0)
    if not liste_offen(g):
        raise NavigationFehler(
            "Die Teilnehmerliste ist nach 'Verwalten' nicht aufgegangen. "
            "Stimmt die Koordinate 'verwalten_knopf' in config.json noch?")


def zur_teilnehmerliste(g: Geraet, team: str, log=print) -> None:
    """Kompletter Weg fuer eine Truppe. Anders als beim Wuestensturm zeigt hier
    jede Truppe ihre eigene Teilnehmerliste — 'team' ist deshalb Pflicht, nicht
    optional.
    """
    ws_nav.zur_hauptkarte(g, log=log)
    ws_nav.events_oeffnen(g, log=log)
    ws_nav.reiter_waehlen(g, "Schluchtsturm", log=log)
    einsatztruppe_waehlen(g, team, log=log)
    verwalten_oeffnen(g, log=log)
