"""Die Schreibregel des VS-Dienstes gegenpruefen.

    .venv/bin/python -m scripts.vs_service.pruefe_schreibregel

`lauf.schreiben_erlaubt` entscheidet, ob ein Lauf den gespeicherten Stand eines
Tages ersetzen darf. Zwei Fehler soll sie ausschliessen, und beide sind schon
passiert:

- **Ein guter Lauf wird verworfen.** Am 22.09.2026 fiel eine einzige Zeile beim
  Scrollen durch; 96 richtig gelesene Zeilen landeten deshalb nirgends, und der
  Dienstag fehlte in der Auswertung.
- **Ein schlechter Lauf ersetzt einen guten.** `tool.schreibe_tag` loescht den
  Tag zuerst — 26 Zeilen aus der ersten Stunde des Tages wuerden 96 von gestern
  Nacht stillschweigend ueberschreiben.

Geprueft wird die Entscheidung, nicht die Formulierung: jeder Fall nennt den
gespeicherten Stand, den neuen Lauf und das, was herauskommen muss.
"""
from __future__ import annotations

import sys

from .lauf import schreiben_erlaubt

# (Beschreibung, vollstaendig, gelesen, alt, erwartet)
FAELLE = [
    ("nichts gespeichert, Lesung geht auf",
     True, 98, None, True),
    ("nichts gespeichert, Lesung geht nicht auf — trotzdem schreiben",
     False, 97, None, True),
    ("eine Zeile fehlte, jetzt geht sie auf",
     True, 98, {"gelesen": 97, "vollstaendig": False}, True),
    ("zweiter Anlauf findet eine Zeile mehr, beide unvollstaendig",
     False, 97, {"gelesen": 96, "vollstaendig": False}, True),
    ("gleich viele Zeilen, beide unvollstaendig — die neuere Lesung gilt",
     False, 97, {"gelesen": 97, "vollstaendig": False}, True),
    ("halber Lauf gegen einen vollstaendigen — nicht anfassen",
     False, 40, {"gelesen": 98, "vollstaendig": True}, False),
    ("halber Lauf gegen einen besseren unvollstaendigen — nicht anfassen",
     False, 26, {"gelesen": 96, "vollstaendig": False}, False),
    ("aufgegangene Lesung mit weniger Zeilen schlaegt eine unvollstaendige",
     True, 95, {"gelesen": 96, "vollstaendig": False}, True),
    ("gar nichts gelesen kann nichts ersetzen",
     False, 0, {"gelesen": 96, "vollstaendig": False}, False),
]


def main() -> int:
    fehler = 0
    for text, voll, gelesen, alt, erwartet in FAELLE:
        ist = schreiben_erlaubt(voll, gelesen, alt)
        ok = ist == erwartet
        fehler += not ok
        print(f"  {'✓' if ok else '✗'} {text}: "
              f"{'schreiben' if ist else 'stehen lassen'}"
              f"{'' if ok else f' — erwartet {erwartet}'}")
    print(f"\n{len(FAELLE) - fehler}/{len(FAELLE)} Faelle wie erwartet.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
