"""Dienste, die das Spiel auslesen und das Tool nachziehen.

Bisher einer: `run.py` liest die Wuestensturm-Anmeldung aus Last War (ueber
BlueStacks und ADB) und schreibt sie als `teamAssign` in den Planungsstand.

Die Bausteine sind bewusst getrennt, damit der naechste Dienst (Schluchtsturm)
nur `roster`/`run` braucht und Geraet, Bilderkennung und Tool-Zugang erbt:

    device.py    ADB: Bild holen, tippen, wischen
    vision.py    Text (Tesseract) und Zustaende (Farbe)
    navigate.py  Basis → Events → Reiter → Teilnehmerliste
    roster.py    die Liste durchscrollen und Zeilen deuten
    match.py     gelesenen Namen dem Kader zuordnen
    tool.py      lesen/schreiben ueber PostgREST
    run.py       Ablauf und Kommandozeile
"""
