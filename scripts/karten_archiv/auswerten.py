"""Auswertung ueber dem Archiv — ohne Geraet, ohne BlueStacks, ohne Sperre.

    .venv/bin/python -m scripts.karten_archiv.auswerten --name pilot
    .venv/bin/python -m scripts.karten_archiv.auswerten --name pilot --neu

Das ist der eigentliche Zweck des Archivs: die Erkennung darf beliebig oft und
beliebig lange laufen, auch waehrend das Spiel fuer den WS-Dienst gebraucht wird.
`--neu` liest die gespeicherten Bilder noch einmal — damit laesst sich eine
verbesserte Erkennung an genau demselben Material messen, statt sie an einem
frischen Bildschirmfoto zu erraten.

**Das Modell kommt aus dem Manifest**, nicht aus der aktuellen `config.json`:
wird der Massstab spaeter nachgeeicht, bleiben alte Archive richtig lesbar.

Zusammengefasst wird ueber die Weltkoordinate. An den Kachelraendern sieht man
dieselbe Basis in zwei Kacheln; taeten wir das nicht, stuende sie zweimal in der
Liste. Der Abgleich ist zugleich eine Selbstpruefung: liefern beide Kacheln
verschiedene Koordinaten fuer dieselbe Basis, stimmt der Massstab nicht.
"""
from __future__ import annotations

import argparse
import difflib
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image

from scripts.karten_archiv import banner
from scripts.karten_archiv.archiv import WURZEL
from scripts.ws_service import match
from scripts.ws_service.tool import _anfrage, allianz_id

# Ab hier lohnt der Blick: darunter ist der Kadertreffer Zufall (siehe
# `basen_bauen`). Gemessen am Archiv `karte_nah`: von 28 Treffern der
# `match`-Schwelle 0.62 blieb bei 0.75 eine Handvoll uebrig, und nur die
# waren beim Nachsehen plausibel.
BERICHT_MIN = 0.75


def laden(name: str, neu: bool) -> tuple[dict, list[dict]]:
    pfad = WURZEL / name
    manifest = json.loads((pfad / "manifest.json").read_text())
    cfg = dict(manifest["modell"], karte=manifest["zuschnitt"])
    zeilen = []
    for js in sorted((pfad / "kacheln").glob("*.json")):
        satz = json.loads(js.read_text())
        kx, ky = satz["kamera"]
        if neu or "banner" not in satz:
            im = Image.open(js.with_suffix(".png")).convert("RGB")
            gefunden = banner.auswerten(im, kx, ky, cfg,
                                        versatz_px=tuple(manifest["zuschnitt"][:2]))
        else:
            gefunden = satz["banner"]
        for b in gefunden:
            zeilen.append({**b, "kachel": [kx, ky]})
    return manifest, zeilen


def basen_bauen(zeilen: list[dict], server: str, quelle: str) -> list[dict]:
    """Bannerfunde zu Zeilen fuer `karte_basen`.

    **Zusammengefasst wird ueber den Ort, nicht ueber den Namen.** An den
    Kachelraendern steht dieselbe Basis in zwei Kacheln; ueber den Namen
    zusammenzufassen wuerde daran scheitern, dass die Erkennung ihn zweimal
    verschieden liest — und aus einer Basis zwei machen. Der Ort ist dagegen
    beide Male derselbe: gerundet auf ganze Einheiten ist er der Schluessel.

    **Der Ort allein reicht aber nicht ganz.** Die gerechnete Weltkoordinate
    streut um einen halben Punkt; faellt sie in zwei Kacheln links und rechts
    der Rundungsgrenze, wird aus einer Basis doch wieder zwei — am Archiv
    `karte_nah` traf das 9 % aller Zeilen (`Recklinghausen` neben
    `Reckiighausen`, `Le Daron` neben `Le Darons`). Deshalb laeuft danach
    `_nachbarn_falten`: Nachbarfelder mit **aehnlichem Namen** sind dieselbe
    Basis. Der Name entscheidet hier, weil auf zwei benachbarten Feldern sehr
    wohl zwei verschiedene Basen stehen koennen — der Ort allein wuerde sie
    verschmelzen.

    **`name` ist, was auf der Karte stand — nicht, wer es sein koennte.** Bis
    zum 08.09.2026 wurde der gelesene Name hier durch den Kadernamen ersetzt,
    wenn `match.zuordnen` einen fand. Das ist der richtige Griff fuer den
    WS-Dienst, wo eine Liste von Kadermitgliedern gegen den Kader gehalten wird
    — hier ist es der falsche: gegen 279 Kadernamen laufen **1934** Namen der
    ganzen Welt, von denen fast keiner im Kader steht. Bei Schwelle 0,62 traf es
    28 und davon war genau *einer* unstrittig. Aus `Gabrypoonte` wurde viermal
    `HARRY POTTER`, aus `FirefighterPL` `LittleFighter`, aus `Oberst Fabi`
    `bestbrudi` — gut gelesene, fremde Spieler, deren Name in der Spalte
    verschwand, nach der gesucht wird. Der Kaderabgleich bleibt als **Bericht**
    im Lauf stehen; geschrieben wird er nicht.
    """
    je_ort: dict[tuple[int, int], dict] = {}
    for z in zeilen:
        name = (z.get("name_ocr") or "").strip()
        if len(name) < 2:
            continue                      # ein Balken ohne lesbaren Text sagt nichts
        ort = (round(z["x"]), round(z["y"]))
        satz = {"server": server, "x": ort[0], "y": ort[1],
                "name": name,
                "name_roh": z.get("name_roh") or name,
                "allianz": z.get("allianz"),
                "level": z.get("level"),
                "quelle": quelle}
        alt = je_ort.get(ort)
        if alt is None:
            je_ort[ort] = satz
            continue
        # Bei zwei Lesungen desselben Ortes gewinnt die **laengere**: eine Basis
        # am Kachelrand laeuft in der einen Kachel aus dem Bild und steht in der
        # Nachbarkachel ganz da, und das Abgeschnittene ist immer das kuerzere.
        if len(satz["name"]) > len(alt["name"]):
            satz["level"] = satz["level"] if satz["level"] is not None else alt["level"]
            satz["allianz"] = satz["allianz"] or alt["allianz"]
            je_ort[ort] = satz
        else:
            # Stufe und Kuerzel haengen nicht am Namen: das Schild ist mal
            # angeschnitten, mal nicht. Ein Fund ohne sie loescht keinen mit.
            alt["level"] = alt["level"] if alt["level"] is not None else satz["level"]
            alt["allianz"] = alt["allianz"] or satz["allianz"]
    return _marken_aussortieren(_nachbarn_falten(je_ort))


NACHBAR_MIN = 0.60      # so aehnlich muessen zwei Namen sein, um dieselbe Basis zu sein
MARKE_MIN_ORTE = 4      # ab so vielen Orten ist derselbe Name keine Basis mehr
MARKE_MIN_SPANNE = 40   # ... sofern sie so weit auseinanderliegen


def _marken_aussortieren(basen: list[dict]) -> list[dict]:
    """Beschriftungen aussortieren, die keine Basen sind.

    Der Bannerfinder liefert nicht nur Spielerschilder, sondern auch die
    Allianz-Banner ueber den Gebieten und die Namen von Kartenobjekten. Sie als
    Basen zu fuehren blaeht die Liste auf und stoert die Namenssuche: `Wal` (von
    „Walhalla") stand 63-mal in der Tabelle, `Nortn German` 52-mal, `KISS OF WA`
    21-mal, dazu `Lv. 4` und `Schatz des Sandwurms`.

    **Der Prüfstein ist die Spielregel, nicht die Optik.** Im Spiel hat ein
    Spieler genau *eine* Basis. Ein Name, der an vier weit auseinanderliegenden
    Orten steht, kann deshalb kein Spielername sein — egal wie sauber er gelesen
    wurde. Zwei frühere Anläufe scheiterten daran, dass sie am Bild ansetzten:
    die Schrifthoehe trennt Banner und Spielernamen nicht (0,40–0,64 gegen
    0,60–1,09 Bannerhoehen), und das Stufenschild taugt nicht als Beweis — es
    fehlt bei jeder fuenften echten Basis.

    Die **Spanne** muss mit, sonst faellt eine Basis, die durch einen Lesefehler
    zufaellig denselben Namen wie ihre Nachbarn traegt. Drei Orte reichen
    ausdruecklich nicht: dort sind es meist zwei verschiedene Spieler, deren
    Namen die Erkennung gleich gelesen hat (`Betty Beep`, `Gabrypoonte`).
    """
    je_name: dict[str, list[dict]] = {}
    for b in basen:
        je_name.setdefault(b["name"].lower(), []).append(b)
    raus = set()
    for gruppe in je_name.values():
        if len(gruppe) < MARKE_MIN_ORTE:
            continue
        spanne = max(max(a["x"] - b["x"], a["y"] - b["y"])
                     for a in gruppe for b in gruppe)
        if spanne >= MARKE_MIN_SPANNE:
            raus.update(id(b) for b in gruppe)
    if raus:
        print(f"{len(raus)} Zeilen als Beschriftung aussortiert "
              f"(derselbe Name an {MARKE_MIN_ORTE}+ weit entfernten Orten)")
    return [b for b in basen if id(b) not in raus]


def _besser(a: dict, b: dict) -> dict:
    """Von zwei Lesungen derselben Basis die vollstaendigere, um die andere ergaenzt."""
    gewinner, verlierer = (a, b) if len(a["name"]) >= len(b["name"]) else (b, a)
    if gewinner["level"] is None:
        gewinner["level"] = verlierer["level"]
    if not gewinner["allianz"]:
        gewinner["allianz"] = verlierer["allianz"]
    return gewinner


def _nachbarn_falten(je_ort: dict[tuple[int, int], dict]) -> list[dict]:
    """Benachbarte Felder mit aehnlichem Namen zu einer Basis zusammenziehen.

    Verglichen wird nur nach rechts und nach unten — jedes Paar kommt so genau
    einmal vor. Gefaltet wird ueber eine Union-Find-Struktur, damit auch eine
    Kette (drei Felder in Folge) zu *einer* Basis wird und nicht zu zwei.
    """
    from scripts.ws_service.match import norm

    eltern: dict[tuple[int, int], tuple[int, int]] = {o: o for o in je_ort}

    def wurzel(o):
        while eltern[o] != o:
            eltern[o] = eltern[eltern[o]]
            o = eltern[o]
        return o

    for (x, y), satz in je_ort.items():
        for dx, dy in ((1, 0), (0, 1), (1, 1), (1, -1)):
            nachbar = je_ort.get((x + dx, y + dy))
            if nachbar is None:
                continue
            a, b = norm(satz["name"]), norm(nachbar["name"])
            if not a or not b:
                continue
            if (a in b or b in a
                    or difflib.SequenceMatcher(None, a, b).ratio() >= NACHBAR_MIN):
                ra, rb = wurzel((x, y)), wurzel((x + dx, y + dy))
                if ra != rb:
                    eltern[rb] = ra

    gefaltet: dict[tuple[int, int], dict] = {}
    for ort, satz in je_ort.items():
        r = wurzel(ort)
        gefaltet[r] = _besser(gefaltet[r], satz) if r in gefaltet else satz
    return list(gefaltet.values())


def basen_schreiben(basen: list[dict]) -> int:
    """Upsert nach `karte_basen`, in Bloecken.

    `on_conflict=server,x,y`: ein Feld traegt genau eine Basis, ein neuer Scan
    ueberschreibt den alten Stand. Wer umzieht, hinterlaesst seinen Platz dem
    Naechsten — genau das soll die Tabelle abbilden.

    In Bloecken, weil eine abgescannte Karte fuenfstellig viele Zeilen hat und
    ein einzelner Rumpf dieser Groesse an der Gegenseite scheitert.
    """
    geschrieben = 0
    for i in range(0, len(basen), 500):
        teil = [dict(b, updated_at="now()") for b in basen[i:i + 500]]
        for b in teil:
            b.pop("updated_at")           # setzt die Datenbank selbst
        _anfrage("karte_basen?on_conflict=server,x,y", "POST", teil,
                 prefer="resolution=merge-duplicates,return=minimal")
        geschrieben += len(teil)
        print(f"  {geschrieben}/{len(basen)} geschrieben", flush=True)
    return geschrieben


def zusammenfassen(treffer: dict) -> dict:
    """Dieselbe Basis aus mehreren Kacheln zu einer Zeile."""
    je_name = defaultdict(list)
    for name, t in treffer.items():
        je_name[name].append(t)
    aus = {}
    for name, ts in je_name.items():
        xs = [t["x"] for t in ts]
        ys = [t["y"] for t in ts]
        aus[name] = {"x": round(sum(xs) / len(xs)), "y": round(sum(ys) / len(ys)),
                     "kacheln": len(ts),
                     "streuung": round(max(max(xs) - min(xs), max(ys) - min(ys)), 2)}
    return aus


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="pilot")
    p.add_argument("--neu", action="store_true", help="Bilder neu erkennen statt Kachel-JSON")
    p.add_argument("--tag", default="XP33")
    p.add_argument("--schreiben", action="store_true",
                   help="gefundene Basen nach karte_basen schreiben (Server-weit, "
                        "nicht je Allianz — die Weltkarte gehoert dem Server)")
    a = p.parse_args()

    manifest, zeilen = laden(a.name, a.neu)
    print(f"Archiv {a.name}: {len({tuple(z['kachel']) for z in zeilen})} Kacheln mit "
          f"Bannern, {len(zeilen)} Bannerfunde")
    gelesen = [z for z in zeilen if len(z.get("name_ocr", "")) >= 3]
    print(f"davon {len(gelesen)} mit lesbarem Text\n")

    aid = allianz_id(a.tag)
    kader = _anfrage(f"ws_players?select=name,hero_power&alliance_id=eq.{aid}&limit=1000")
    erg = match.zuordnen(gelesen, kader)

    # Nur als **Bericht**, und nur die nahen Treffer. Die Schwelle 0.62 aus
    # `match` ist fuer eine Kaderliste gegen den Kader gedacht; hier laufen die
    # Namen der ganzen Welt dagegen, und darunter ist fast alles Zufall.
    nah = {n: t for n, t in erg["treffer"].items()
           if difflib.SequenceMatcher(None, match.norm(t.get("name_ocr", "")),
                                      match.norm(n)).ratio() >= BERICHT_MIN}
    zusammen = zusammenfassen(nah)

    print(f"{'Vermutlich Kader':24s} {'X':>5s} {'Y':>5s} {'Kacheln':>8s} {'Streuung':>9s}")
    print("-" * 56)
    for name, t in sorted(zusammen.items(), key=lambda kv: (-kv[1]["y"], kv[1]["x"])):
        print(f"{name:24s} {t['x']:5d} {t['y']:5d} {t['kacheln']:8d} {t['streuung']:9.2f}")
    print(f"\n{len(zusammen)} Basen sehen nach einem Kaderspieler aus "
          f"(Aehnlichkeit >= {BERICHT_MIN:.2f}) — ein Hinweis, keine Zuordnung. "
          f"In die Tabelle geht der gelesene Name.")

    mehrfach = [t for t in zusammen.values() if t["kacheln"] > 1]
    if mehrfach:
        schlimm = max(t["streuung"] for t in mehrfach)
        print(f"\nSelbstpruefung: {len(mehrfach)} Basen in mehreren Kacheln gesehen, "
              f"groesste Abweichung {schlimm:.2f} Welteinheiten "
              f"({'in Ordnung' if schlimm < 0.5 else 'zu gross — Massstab pruefen'})")

    if a.schreiben:
        # Der Server, nicht die Allianz: die Weltkarte gehoert allen Allianzen
        # darauf gemeinsam. Er kommt aus der Allianz-Zeile, damit hier keine
        # zweite Wahrheit ueber die Serverkennung entsteht.
        zeile = _anfrage(f"alliances?select=server&id=eq.{aid}")
        server = (zeile or [{}])[0].get("server")
        if not server:
            print(f"\nAllianz {a.tag} hat keinen Server hinterlegt — ohne ihn "
                  f"waere nicht zu sagen, zu welcher Karte die Basen gehoeren.")
            return 1
        # Geschrieben wird aus **allen** gelesenen Bannern, nicht nur aus den
        # Kadertreffern: die fremden Allianzen sind der groessere und fuer eine
        # Karte interessantere Teil.
        basen = basen_bauen(gelesen, server, a.name)
        print(f"\n{len(basen)} Basen (ueber den Ort zusammengefasst) → karte_basen "
              f"auf Server {server}")
        basen_schreiben(basen)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
