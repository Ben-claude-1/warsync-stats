"""Misst Balkenfarbe gegen gelesene Uhrzeit — und zaehlt, wer beide Zeiten meldet.

    .venv/bin/python -m scripts.ws_service.pruefe_balken_zeit <mitschnittordner>

Ueber jeder angemeldeten Zeile steht ein farbiger Balken mit der gewaehlten
Uhrzeit. Beides sagt dasselbe — welche der beiden Kampfzeiten jemand gewaehlt
hat —, und beides kann falsch gelesen werden. Diese Pruefung stellt sie
nebeneinander.

Gemessen am Mitschnitt `20260916_124554_lauf9_hand` (242 Zeilen):

    Balken erkannt              242
    Uhrzeit lesbar               26   (11 %)
    Uhrzeit wie die Farbe        22
    Uhrzeit gegen die Farbe       4   (NuSReT 3x, Little Kong 1x)

**Die vier sind Lesefehler der Uhrzeit, nicht der Farbe.** Die Erkennung macht
aus `18:00` ein `13:00`, und das ist die lokale Zeit des *anderen* Teams — bei
`Little Kong` und `NuSReT` steht im Bild nachweislich `Serverzeit: … 18:00 ~
18:30` ueber einem orangen Balken. Deshalb entscheidet seit dem 16.09.2026 die
Farbe und die Uhrzeit springt nur ein, wo keine Farbe erkannt wurde.

Auffallen soll hier der andere Fall: widersprechen sich beide der **Mehrheit**
nach, ist nicht die Erkennung schuld, sondern die Annahme „gruen ist das
fruehere Team" — dann wurde `wsTime` umgestellt. `roster.zeit_farbe_streit`
macht daraus ein Problem im Bericht.

Darunter steht, wer **beide** Zeiten gemeldet hat: wessen Balken ueber mehrere
Bilder hinweg die Farbe wechselt, der koennte in beiden Teams spielen. Die Zahl
der gesehenen Zeilen steht dabei, denn wer nur in einem Bild stand, kann den
Wechsel gar nicht gezeigt haben.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from . import match, roster, tool
from .device import CONFIG


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print(__doc__)
        return 1
    ordner = Path(argv[0]).expanduser()
    roh_datei = ordner / "roh.json"
    if not roh_datei.exists():
        print(f"Kein roh.json in {ordner} — erst auswerten lassen "
              f"(mitschreiben.py --auswerten).")
        return 1
    roh = json.loads(roh_datei.read_text())

    aid = tool.allianz_id(CONFIG["alliance_tag"])
    ws_time = tool.planungsstand(aid).get("wsTime") or {"A": "13:00", "B": "22:00"}
    zeilen = roster.zu_werten(roh["zeilen"], ws_time)

    zahl = Counter()
    zahl["Balken erkannt"] = len(zeilen)
    gegen = []
    for z in zeilen:
        if not z.get("zeit_team"):
            continue
        zahl["Uhrzeit lesbar"] += 1
        if z.get("zeit_streit"):
            zahl["Uhrzeit gegen die Farbe"] += 1
            gegen.append(z)
        else:
            zahl["Uhrzeit wie die Farbe"] += 1

    print(f"{ordner.name} · Zeiten laut Tool: {ws_time}")
    for k, n in zahl.items():
        print(f"  {k:24s} {n}")
    if gegen:
        print("\nGegen die Farbe (Bild · Name · Farbe · gelesene Zeit):")
        for z in gegen:
            print(f"  {z['bild']} · {z.get('name_ocr')!r} · {z['farbe']} · {z.get('zeit')}")
    streit = roster.zeit_farbe_streit(zeilen)
    print("\n" + (streit or "Kein durchgehender Widerspruch — die Farbzuordnung traegt."))

    erg = match.zuordnen(zeilen, tool.kader(aid))
    beide = match.beide_zeiten(erg["treffer"])
    gesehen = Counter(len(t.get("balken_teams") or []) for t in erg["treffer"].values())
    print(f"\n{len(erg['treffer'])} Spieler zugeordnet, davon mit zwei Balkenfarben "
          f"{gesehen.get(2, 0)}:")
    for zeile in match.beide_zeiten_text(beide) or ["  —"]:
        print("  " + zeile)
    return 0


if __name__ == "__main__":
    sys.exit(main())
