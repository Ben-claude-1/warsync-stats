"""Allianz-Kuerzel und Name aus dem Rohtext — gegen echte Lesungen der Karte.

    .venv/bin/python -m scripts.karten_archiv.pruefe_kuerzel

Ohne Archiv und ohne Bild: jede Zeile unten ist ein Rohtext, wie ihn die
Erkennung am 09.09.2026 in `karte_basen.name_roh` geschrieben hat, und daneben,
was davon Kuerzel und was Name ist. `pruefe_namen.py` misst, ob die Schrift
richtig gelesen wird; dieses Skript misst, ob sie danach richtig **zerlegt**
wird.

Anlass war Bens Beobachtung, dass in der Liste der Basen bei vielen der Rest
der Allianz im Namen stand. Die Klammern werden schlecht gelesen — aus `]` wird
`J`, `/`, `T`, `i` oder ein Leerzeichen —, aber zwischen ihnen stehen immer die
vier Zeichen des Kuerzels, und die gehoeren nie zum Namen.

Die zweite Haelfte der Tabelle sind die Faelle, die **nicht** zerlegt werden
duerfen: Namen ohne Allianz, in denen zufaellig eine Klammer, eine Eins oder
der Anfang eines bekannten Kuerzels steckt. Dort sass der Fehler vom
08.09.2026 (`Conand1990` → Allianz `ONAND`).
"""
from __future__ import annotations

from scripts.karten_archiv import banner

# So wie `kuerzel_sammeln` es aus dem Lauf ueber `karte_kern` baut.
BEKANNTE = {banner._falten(t): t for t in
            ("AR1S", "CYKA", "GUNZ", "KISS", "KURL", "NOGE", "NRLN", "OWUB",
             "RPTC", "WAH", "XP33", "ZOMG")}

# (Rohtext, Kuerzel, Name) — Kuerzel und Name mit dem Verzeichnis.
FAELLE = [
    # Die schliessende Klammer als Buchstabe, Satzzeichen oder Luecke
    ("[CYKAJRYKITA6", "CYKA", "RYKITA6"),
    ("[CYKAJJOHNO", "CYKA", "JOHNO"),            # nur das erste J ist die Klammer
    ("[CYKATVasex", "CYKA", "Vasex"),
    ("[NOGE Rostig", "NOGE", "Rostig"),
    ("[NOGEJklausi2", "NOGE", "klausi2"),        # vorher Allianz NOGEJK, Name ausi2
    ("[kissiViszek", "KISS", "Viszek"),
    ("[kiSS Jekyll89", "KISS", "Jekyll89"),      # Luecke vor J: J gehoert zum Namen
    ("[NRLN/Fnideq", "NRLN", "Fnideq"),
    ("[XP33/|vkДıem0n|", "XP33", "vkДıem0n"),
    ("[ZOMG Melthanos", "ZOMG", "Melthanos"),    # vorher ZOMGME / thanos
    # Die schliessende ganz verloren — nur mit Verzeichnis zu trennen
    ("[NRLNVovan chick", "NRLN", "Vovan chick"),
    ("[GunZYounesD6", "GUNZ", "YounesD6"),
    # Die oeffnende als Zwilling, verdoppelt oder mit Flaggenrest davor
    ("IKISSIZLIL 22", "KISS", "ZLIL 22"),
    ("ICYKAJШOI", "CYKA", "ШOI"),
    ("IXP33]Puwe", "XP33", "Puwe"),
    ("UC [ZOMG]Roi Cumo", "ZOMG", "Roi Cumo"),
    ("I(AA [XP33] Nico4382", "XP33", "Nico4382"),
    ("-[NOGE]xPaxl", "NOGE", "xPaxl"),
    ("RPTC|paco 411", "RPTC", "paco 411"),
    # Drei Zeichen gibt es auch
    ("[Wah]Dreimaster", "WAH", "Dreimaster"),
    ("[WahlDr field", "WAH", "Dr field"),
    ("[Wah Thorbjårn", "WAH", "Thorbjårn"),
    # Zwillinge im Kuerzel selbst: dieselbe Allianz, eine Schreibweise
    ("[ARIS LifeF6", "AR1S", "LifeF6"),
    ("[0wub]xOTCx", "OWUB", "xOTCx"),
    ("[ХР3ЗІХАZАПНЕ", "XP33", "ХАZАПНЕ"),
    # Am Bildrand angeschnitten: der Rest faellt weg, Allianz nur wenn eindeutig
    ("MG] LOLOVAR", "ZOMG", "LOLOVAR"),
    ("3]Vegito Rose", None, "Vegito Rose"),
    ("[kiss]", "KISS", ""),
    # --- Nicht zerlegen ---
    ("Conand1990", None, "Conand1990"),
    ("Sniper1337", None, "Sniper1337"),
    ("Commander 1c6a31657", None, "Commander 1c6a31657"),
    ("Wahlberg", None, "Wahlberg"),              # kein [Wah], nur ein Name
    ("kissing Bee", None, "kissing Bee"),
    ("|Naru your Sunshine", None, "Naru your Sunshine"),
    ("420Pau|420", None, "420Pau|420"),
    ("Pat Fenis 420", None, "Pat Fenis 420"),
]

# (Name, Allianz, erwartet) — der Rest, der nach dem Zusammenfuehren vorn haengt.
RESTE = [
    ("iSSITipsx", "KISS", "Tipsx"),
    ("LN/Polski Dzik", "NRLN", "Polski Dzik"),
    ("CYKATHi Im Poli", "CYKA", "Hi Im Poli"),
    ("Sapphy", "XP33", "Sapphy"),
    ("SSIlvia", "WAH", "SSIlvia"),               # anderes Kuerzel, nichts abziehen
]


def pruefen() -> int:
    fehler = 0
    for roh, tag, name in FAELLE:
        ist = banner.name_aus_roh(roh, BEKANNTE)
        if ist != (tag, name):
            fehler += 1
            print(f"  {roh!r:28} soll {(tag, name)!r:34} ist {ist!r}")
    for name, tag, soll in RESTE:
        ist = banner.kuerzelrest_abziehen(name, tag)
        if ist != soll:
            fehler += 1
            print(f"  {name!r:28} ({tag}) soll {soll!r} ist {ist!r}")
    gesamt = len(FAELLE) + len(RESTE)
    print(f"Kuerzel und Name richtig: {gesamt - fehler} / {gesamt}")
    return fehler


def main() -> int:
    if pruefen():
        print("FEHLER")
        return 1
    print("In Ordnung.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
