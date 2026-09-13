"""Dienst: Schluchtsturm-Anmeldung aus dem Spiel lesen und ins Tool schreiben.

Baut auf scripts/ws_service auf und erbt von dort Geraet, Bilderkennung und
Tool-Zugang unveraendert (device.py, vision.py, match.py, tool-Grundfunktionen)
— genau wie es der Docstring von ws_service/__init__.py fuer diesen Dienst
vorgesehen hat. Eigen sind nur: die Navigation bis zur Teilnehmerliste
(navigate.py), das Ablesen des Team-Wunschs statt einer Gesetzt/Ersatz-Rolle
(roster.py) und das Schreiben von 'A'/'B' statt der fuenf WS-Werte (tool.py).

Der wichtigste Unterschied zum Wuestensturm steckt im Bildschirm selbst: die
Teilnehmerliste zeigt **immer alle** Allianzmitglieder (zum Einladen), nicht
nur Bewerber. Wer sich angemeldet hat, traegt ein gruenes Zeitband ueber dem
Namen — wie beim Wuestensturm. Ein rotes Overlay „Bitte um Einsatz fuer
Truppe [X]" erscheint zusaetzlich, aber nur, waehrend genau diese Truppe
geoeffnet ist.

**Korrigiert am 06.09.2026** (vorher stand hier das Gegenteil): die zwei
grauen Felder neben jedem Namen sind keine bedeutungslosen Buttons, sondern
zeigen den tatsaechlich zugewiesenen Truppen-Buchstaben (A/B) — links
„gesetzt", rechts „Ersatz" — und zwar **unabhaengig davon, welche Truppe
gerade geoeffnet ist**. Live bestaetigt: LittleFighter zeigte 'B' im
Gesetzt-Feld, waehrend Truppe A offen war und kein rotes Overlay zu sehen
war. Ein Durchlauf ueber Truppe A reicht deshalb fuer beide Truppen
(`roster.zu_werten_einzeln`): das Feld gilt, wenn vorhanden; fehlt es, gilt
das rote Overlay fuer die offene Truppe, und angemeldet ohne Overlay heisst
zwangslaeufig „will die andere Truppe" — es gibt nur zwei.
"""
