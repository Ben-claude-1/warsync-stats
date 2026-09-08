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
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image

from scripts.karten_archiv import banner
from scripts.karten_archiv.archiv import WURZEL
from scripts.ws_service import match
from scripts.ws_service.tool import _anfrage, allianz_id


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


def basen_bauen(zeilen: list[dict], zuordnung: dict, server: str,
                quelle: str) -> list[dict]:
    """Bannerfunde zu Zeilen fuer `karte_basen`.

    **Zusammengefasst wird ueber den Ort, nicht ueber den Namen.** An den
    Kachelraendern steht dieselbe Basis in zwei Kacheln; ueber den Namen
    zusammenzufassen wuerde daran scheitern, dass die Erkennung ihn zweimal
    verschieden liest — und aus einer Basis zwei machen. Der Ort ist dagegen
    beide Male derselbe: gerundet auf ganze Einheiten ist er der Schluessel.

    `zuordnung` bildet den Rohnamen auf den Kadernamen ab, soweit der Abgleich
    einen gefunden hat. Wer nicht im Kader steht — die fremden Allianzen, also
    der groessere Teil der Karte — behaelt den gelesenen Namen. Beides steht
    nebeneinander in der Tabelle, `name` und `name_roh`.
    """
    je_ort: dict[tuple[int, int], dict] = {}
    for z in zeilen:
        name = (z.get("name_ocr") or "").strip()
        if len(name) < 2:
            continue                      # ein Balken ohne lesbaren Text sagt nichts
        ort = (round(z["x"]), round(z["y"]))
        satz = {"server": server, "x": ort[0], "y": ort[1],
                "name": zuordnung.get(name, name),
                "name_roh": z.get("name_roh") or name,
                "allianz": z.get("allianz"),
                "level": z.get("level"),
                "quelle": quelle}
        alt = je_ort.get(ort)
        # Bei zwei Funden am selben Ort gewinnt der zugeordnete: er ist gegen den
        # Kader geprueft, der andere ist bloss gelesen.
        if alt is None or (satz["name"] in zuordnung.values()
                           and alt["name"] not in zuordnung.values()):
            je_ort[ort] = satz
    return list(je_ort.values())


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
    zusammen = zusammenfassen(erg["treffer"])

    print(f"{'Spieler':24s} {'X':>5s} {'Y':>5s} {'Kacheln':>8s} {'Streuung':>9s}")
    print("-" * 56)
    for name, t in sorted(zusammen.items(), key=lambda kv: (-kv[1]["y"], kv[1]["x"])):
        print(f"{name:24s} {t['x']:5d} {t['y']:5d} {t['kacheln']:8d} {t['streuung']:9.2f}")
    print(f"\n{len(zusammen)} Spieler des Kaders zugeordnet")

    offen = [o for o in erg["offen"] if len(o.get("name_ocr", "")) >= 3]
    if offen:
        print(f"\n{len(offen)} gelesene Banner ohne Kadertreffer "
              f"(fremde Allianzen oder Lesefehler):")
        for o in offen[:20]:
            print(f"  {o['name_ocr'][:26]!r:30s} X:{o['x']:.1f} Y:{o['y']:.1f}")
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
        # Karte interessantere Teil. Der Kaderabgleich verbessert nur den Namen.
        zuordnung = {t["name_ocr"]: name for name, t in erg["treffer"].items()
                     if t.get("name_ocr")}
        basen = basen_bauen(gelesen, zuordnung, server, a.name)
        print(f"\n{len(basen)} Basen (ueber den Ort zusammengefasst) → karte_basen "
              f"auf Server {server}")
        basen_schreiben(basen)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
