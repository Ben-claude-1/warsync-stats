"""Eichung einer herausgezoomten Stufe — an den Bannerreihen, nicht an Sprüngen.

    .venv/bin/python -u -m scripts.karten_archiv.eichen_reihen --stufe wisch
    .venv/bin/python -u -m scripts.karten_archiv.eichen_reihen --stufe wisch --schreiben

`eichen.py` misst den Massstab, indem es dieselbe Basis ueber einen Sprung
verfolgt. Auf einer herausgezoomten Stufe geht das **nicht**: der Sprung setzt den
Zoom zurueck, die zweite Aufnahme entstuende also auf einer anderen Stufe. Und die
Namen sind dort schlechter lesbar, ein OCR-gestuetzter Weg waere unzuverlaessig.

Deshalb drei Messungen, die sich gegenseitig pruefen:

1. **Zoomfaktor aus dem Bildvergleich.** Vor und nach der Geste steht die Kamera
   an derselben Stelle; die beiden Bilder unterscheiden sich also nur im
   Massstab. Ein Vorlagenabgleich ueber viele Faktoren findet ihn — rein
   geometrisch, ohne ein einziges gelesenes Wort. Er liefert nebenbei, ob die
   Geste die Kamera verschoben hat.
2. **Bannerversatz aus dem Anker.** Nach einem Sprung auf die Koordinate einer
   gemessenen Basis steht diese in der Kameramitte; die Pixellage ihres Banners
   ist damit der Versatz — kein Fit, keine Schaetzung.
3. **Y-Modell aus den Reihenabstaenden.** Basen stehen 3 Welteinheiten
   auseinander. Das genuegt fuer das projektive Modell (`ymodell.py`), und es
   braucht dafuer **keine** bekannten Koordinaten — die Stern-Wahrheiten bleiben
   als unabhaengige Gegenprobe uebrig.

Der Anker muss eine ueber den Stern-Dialog **gemessene** Basis sein. Auf eine
gerechnete Koordinate zu eichen hiesse, den eigenen Fehler zur Wahrheit zu
erklaeren.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from scripts.ws_service.device import Geraet
from scripts.karten_archiv import banner, foto, position, sprung, ymodell, zoom
from scripts.karten_archiv.eichen import WAHRHEITEN
from scripts.karten_archiv.run import CFG

MITTE = 1280
AUS = Path.home() / ".local/state/warsync/kartenarchiv/eichung"


def zoomfaktor(vor: np.ndarray, nach: np.ndarray, cfg: dict,
               kante: int = 800, von: float = 0.45, bis: float = 0.95,
               schritt: float = 0.004) -> tuple[float, float, float, float]:
    """(Faktor, Versatz X, Versatz Y, Guete) zwischen zwei Aufnahmen derselben Stelle.

    Die Vorlage kommt aus der Bildmitte — dort ist die perspektivische Verzerrung
    am kleinsten, und ein Massstabsvergleich ueber das ganze Bild waere durch die
    Neigung ohnehin nicht durch **einen** Faktor zu beschreiben.

    Der gefundene Versatz ist die Kontrolle, ob die Zoomgeste die Kamera
    mitgenommen hat: eine Pinch-Geste um die Bildmitte soll sie stehen lassen.
    Tut sie es nicht, waere jede darauf aufbauende Eichung um diesen Betrag falsch.
    """
    a = cv2.cvtColor(vor, cv2.COLOR_RGB2GRAY)
    b = cv2.cvtColor(nach, cv2.COLOR_RGB2GRAY)
    h = kante // 2
    vorlage_gross = a[MITTE - h:MITTE + h, MITTE - h:MITTE + h]
    x0, y0, x1, y1 = cfg["karte"]
    suche = b[y0:y1, x0:x1]

    bestes = (0.0, 0.0, 0.0, -1.0)
    for f in np.arange(von, bis + 1e-9, schritt):
        k = int(round(kante * f))
        if k < 40 or k >= min(suche.shape):
            continue
        v = cv2.resize(vorlage_gross, (k, k), interpolation=cv2.INTER_AREA)
        karte = cv2.matchTemplate(suche, v, cv2.TM_CCOEFF_NORMED)
        _, guete, _, ort = cv2.minMaxLoc(karte)
        if guete > bestes[3]:
            # Mittelpunkt der getroffenen Stelle im Vollbild
            mx, my = x0 + ort[0] + k / 2, y0 + ort[1] + k / 2
            bestes = (float(f), float(mx - MITTE), float(my - MITTE), float(guete))
    return bestes


def spalten_massstab(orte, cfg: dict, raster: int = 3) -> tuple[float, list[float]] | None:
    """skala_x unabhaengig vom Zoomfaktor — aus den Abstaenden der Bannerspalten.

    Der Weg ueber den Zoomfaktor rechnet den Massstab der Sprung-Stufe hoch und
    erbt damit deren Fehler. Die Spalten stehen dagegen wie die Reihen im
    3-Einheiten-Raster und messen direkt auf dieser Stufe.

    **Vorher muss die Neigung heraus.** Weiter unten im Bild ist alles groesser,
    auch waagerecht; ohne die Korrektur (1 + c*u) streuten die Spaltenabstaende
    um zehn Prozent und der Median waere Zufall.

    Der Rasterabstand ist als Vielfaches mehrdeutig — zwei Spalten koennen 3 oder
    6 Einheiten auseinander liegen. Aufgeloest wird das ueber den Zoomfaktor als
    Groessenordnung: gewaehlt wird das Vielfache, das dazu passt. Das ist keine
    Zirkelschluss, sondern eine Grobsortierung — die beiden Kandidaten liegen um
    den Faktor zwei auseinander.
    """
    if len(orte) < 4:
        return None
    m = cfg.get("y_modell")
    norm = []
    for cx, cy, _, _ in orte:
        u = -ymodell.welt_y(cy, 0.0, cfg)
        tiefe = 1 + m["c"] * u if m else 1.0
        norm.append((cx - MITTE - cfg.get("versatz_x", 0)) * tiefe)
    spalten = ymodell.reihen(norm, cfg["skala_x"])
    if len(spalten) < 2:
        return None
    abst = np.diff(spalten)
    # Jeder Abstand ist ein Vielfaches von raster*skala_x; auf das naechste
    # ganzzahlige Vielfache zurueckgerechnet, sind alle vergleichbar.
    grob = cfg["skala_x"] * raster
    einzeln = [float(d / max(1, round(d / grob))) / raster for d in abst]
    return float(np.median(einzeln)), [round(float(d), 1) for d in abst]


def reihen_sammeln(g, cfg: dict, scfg: dict, bild, anker, versaetze) -> list[float]:
    """Bannerreihen ueber mehrere Kamerapositionen einsammeln — als (d, u)-Paare.

    Eine einzelne Aufnahme zeigt nur so viele Rasterzeilen, wie die Kachel hoch
    ist: auf der Sprung-Stufe sind das vier bis fuenf. Drei Parameter aus vier
    Punkten zu schaetzen ist keine Messung, sondern eine Interpolation — der
    Restfehler waere per Konstruktion klein und sagte nichts.

    Verschiebt man die Kamera um bekannte Betraege nach oben und unten, sieht man
    **dieselben** Zeilen an anderen Pixelhoehen. Damit wachsen die Stuetzstellen
    mit jedem Sprung, ohne dass eine Zeile mehrfach zaehlt: gepoolt wird nach
    Welt-Y, nicht nach Pixellage.

    Zugeordnet wird ueber das **lineare** Modell. Das ist erlaubt, weil sein
    Fehler mit rund 0,7 Welteinheiten deutlich unter dem halben Rasterabstand
    von 1,5 liegt — er reicht, um die richtige Zeile zu treffen, aber nicht, um
    ihre Lage zu bestimmen. Genau dafuer ist der Fit da.
    """
    paare: list[tuple[float, float]] = []
    for dy in versaetze:
        y = anker[1] + dy
        sprung.springen(g, cfg, anker[0], y, bild)
        roh = sprung.dialog_sicherstellen(g, cfg, False, bild)
        zoom.nach_sprung(g, scfg)
        if scfg.get("raus_gesten"):
            roh = bild()
        orte = banner.finde(roh, scfg)
        zeilen = ymodell.reihen([o[1] for o in orte], scfg["skala_y"])
        for cy in zeilen:
            d = ymodell.d_von_pixel(cy, scfg)
            welt = round((y - d / scfg["skala_y"]) / 3) * 3      # lineare Zuordnung
            paare.append((d, float(y - welt)))
        print(f"   Y {y:4d} ({dy:+d}): {len(orte)} Banner, {len(zeilen)} Reihen",
              flush=True)
    return paare


def _anker_suchen(roh: np.ndarray, im: Image.Image, cfg: dict, name: str,
                  erwartet: tuple[float, float]) -> tuple[float, float] | None:
    """Das Banner der Ankerbasis: erst per Name, sonst das mittelnaechste.

    Der Name ist der sichere Weg — bei dicht stehenden Basen ist die naechste
    nicht zwingend die gemeinte. Auf herausgezoomten Stufen liest die OCR aber
    schlecht; scheitert sie, gilt ausnahmsweise die Naehe, und das wird
    ausdruecklich gemeldet statt stillschweigend angenommen.
    """
    orte = banner.finde(roh, cfg)
    if not orte:
        return None
    kurz = name.lower().replace(" ", "")[:6]
    nach_naehe = sorted(orte, key=lambda o: (o[0] - erwartet[0]) ** 2
                                          + (o[1] - erwartet[1]) ** 2)
    for cx, cy, w, h in nach_naehe[:4]:
        if kurz in banner.lesen(im, cx, cy, w, h).lower().replace(" ", ""):
            print(f"   Anker ueber den Namen bestaetigt.")
            return cx, cy
    cx, cy, _, _ = nach_naehe[0]
    weg = ((cx - erwartet[0]) ** 2 + (cy - erwartet[1]) ** 2) ** 0.5
    print(f"   ⚠ {name!r} nicht gelesen — genommen wird das mittelnaechste Banner "
          f"({weg:.0f} px von der erwarteten Stelle).")
    return (cx, cy) if weg < 120 else None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--stufe", default="wisch")
    p.add_argument("--anker", nargs=2, type=int, default=[481, 557], metavar=("X", "Y"))
    p.add_argument("--name", default="Little Kong")
    p.add_argument("--schreiben", action="store_true")
    p.add_argument("--erzwingen", action="store_true",
                   help="auch schreiben, wenn der neue Massstab stark vom "
                        "bisherigen abweicht")
    p.add_argument("--y-spruenge", nargs="*", type=int, default=[-6, -3, 3, 6],
                   dest="y_spruenge",
                   help="zusaetzliche Kamerapositionen (Y-Versatz zum Anker), aus "
                        "denen Bannerreihen fuer das Y-Modell eingesammelt werden. "
                        "Leer lassen, um nur aus der Ankeraufnahme zu fitten — dann "
                        "hat der Fit aber kaum mehr Punkte als Parameter.")
    a = p.parse_args()

    if tuple(a.anker) != WAHRHEITEN.get(a.name):
        print(f"{a.name!r} steht unter {tuple(a.anker)} nicht als gemessene Wahrheit — "
              f"die Eichung haenge dann an einem gerechneten Wert.")
        return 1

    scfg = zoom.stufe(CFG, a.stufe)
    if not scfg.get("raus_gesten"):
        # Ohne Herauszoom-Geste ist diese Stufe die, auf der der Sprung ohnehin
        # landet — und die ist in eichen.py ueber verfolgte Basen gemessen, also
        # besser als alles, was hier herauskommen kann. Am 07.09.2026 lief dieses
        # Skript versehentlich darauf: der Zoomfaktor-Vergleich verglich ein Bild
        # mit sich selbst und lief in den Rand seines Suchbereichs (0.95 statt
        # 1.00), womit jede Groesse um 5 % schrumpfte; die Spaltenmessung ergab
        # danach 211 statt 199 px je Einheit. Eine gute Eichung wurde so durch
        # eine schlechtere ersetzt, ohne dass etwas gemeldet wurde.
        print(f"Stufe {a.stufe!r} hat keine Herauszoom-Geste — dafuer ist dieses "
              f"Skript nicht da. Der Massstab der Sprung-Stufe wird mit "
              f"'eichen.py' gemessen (dieselbe Basis ueber zwei Spruenge "
              f"verfolgt); hier gibt es nichts zu gewinnen.")
        return 1

    g = Geraet()
    g.starten()

    def bild():
        return foto.bild(g)

    zoom.stufe_einstellen(g, CFG, bild)
    stand = bild()
    if not zoom.lupe_da(stand, CFG):
        print("Kein Lupe-Knopf — Detailmodus noetig.")
        return 1

    # ── 1) Anker anfahren, Aufnahme auf der Sprung-Stufe ──────────────────
    print(f"→ Sprung auf {a.anker[0]}/{a.anker[1]} ({a.name})", flush=True)
    sprung.springen(g, CFG, a.anker[0], a.anker[1], bild, bekannt=stand)
    vor = sprung.dialog_sicherstellen(g, CFG, False, bild)

    # ── 2) Herauszoomen und Zoomfaktor messen ────────────────────────────
    print(f"→ {scfg.get('raus_gesten', 0)} Herauszoom-Geste(n) fuer Stufe "
          f"{a.stufe!r}", flush=True)
    zoom.nach_sprung(g, scfg)
    nach = bild()
    f, vx, vy, guete = zoomfaktor(vor, nach, CFG)
    print(f"   Zoomfaktor {f:.3f}  (Guete {guete:.2f}, Kameraversatz durch die "
          f"Geste {vx:+.0f}/{vy:+.0f} px)", flush=True)
    if guete < 0.35:
        print("   ⚠ Bildvergleich unsicher — Faktor nicht belastbar.")
    if abs(vx) > 25 or abs(vy) > 25:
        print("   ⚠ Die Zoomgeste hat die Kamera mitgenommen. Alles Folgende waere "
              "um diesen Betrag falsch geeicht.")
        return 1

    # Beide Aufnahmen bleiben liegen: eine Eichung, die man nicht am selben
    # Material nachrechnen kann, ist keine — und Geraetezeit kostet das nicht.
    AUS.mkdir(parents=True, exist_ok=True)
    Image.fromarray(vor).save(AUS / f"{a.stufe}_vor.png")
    Image.fromarray(nach).save(AUS / f"{a.stufe}_nach.png")
    (AUS / f"{a.stufe}.json").write_text(json.dumps(
        {"anker": a.anker, "name": a.name, "zoomfaktor": round(f, 4)},
        indent=2, ensure_ascii=False))
    print(f"   Aufnahmen liegen unter {AUS}", flush=True)

    hoch = {"skala_x": CFG["skala_x"] * f, "skala_y": CFG["skala_y"] * f,
            "banner_versatz": CFG["banner_versatz"] * f,
            "banner_breite": CFG["banner_breite"] * f,
            "banner_hoehe": CFG["banner_hoehe"] * f}
    mcfg = dict(scfg, **{k: (int(round(v)) if k.startswith("banner") else round(v, 1))
                         for k, v in hoch.items()})

    # ── 3) Bannerversatz am Anker ────────────────────────────────────────
    im = Image.fromarray(nach)
    ort = _anker_suchen(nach, im, mcfg, a.name,
                        (MITTE, MITTE + mcfg["banner_versatz"]))
    if ort is None:
        print("   Anker im herausgezoomten Bild nicht gefunden — Eichung abgebrochen.")
        return 1
    ox, oy = ort[0] - MITTE, ort[1] - MITTE
    print(f"   Anker sitzt bei ({ort[0]:.0f}, {ort[1]:.0f})  →  Versatz X {ox:+.0f} px, "
          f"Y {oy:+.0f} px (hochgerechnet waren {mcfg['banner_versatz']:.0f})",
          flush=True)
    mcfg["versatz_x"], mcfg["banner_versatz"] = round(ox), round(oy)

    # ── 4) Y-Modell aus den Reihenabstaenden ─────────────────────────────
    orte = banner.finde(nach, mcfg)
    print(f"\n→ {len(orte)} Banner im HUD-freien Bereich", flush=True)
    zeilen = ymodell.reihen([o[1] for o in orte], mcfg["skala_y"])
    print(f"   {len(zeilen)} Bannerreihen: "
          + ", ".join(f"{z:.0f}" for z in zeilen), flush=True)
    if len(zeilen) >= 2:
        abst = np.diff(zeilen)
        print(f"   Abstaende: " + ", ".join(f"{d:.0f}" for d in abst)
              + f"  px  (bei einem Faktor waeren sie alle gleich)", flush=True)
    modell = ymodell.fit(zeilen, mcfg)
    if a.y_spruenge:
        print(f"\n→ Reihen ueber {len(a.y_spruenge)} zusaetzliche Kamerapositionen "
              f"einsammeln", flush=True)
        paare = reihen_sammeln(g, CFG, mcfg, bild, a.anker, a.y_spruenge)
        gepoolt = ymodell.fit_paare(paare, mcfg)
        if gepoolt is None:
            print("   ⚠ Zu wenige Punkte — es bleibt beim Fit aus einer Aufnahme.")
        elif gepoolt["fehler_welt_max"] > 0.35:
            # Mehr Stuetzstellen heisst nicht besser. Die Zuordnung Zeile→Welt-Y
            # laeuft ueber das lineare Modell; wo eine Aufnahme nur drei Reihen
            # hergibt oder zwei Banner zu einer verschmelzen, greift sie daneben
            # und der Fit wird schlechter als der aus einer sauberen Aufnahme.
            print(f"   ⚠ Gepoolter Fit ist schlechter (Rasterfehler "
                  f"{gepoolt['fehler_welt_max']} E) — verworfen, es bleibt beim "
                  f"Fit aus der Ankeraufnahme.")
        else:
            print(f"   {gepoolt['punkte']} Punkte ueber {gepoolt['spanne_welt']} "
                  f"Welteinheiten: a={gepoolt['a']} c={gepoolt['c']}, "
                  f"Rest {gepoolt['rest_px']} px", flush=True)
            print(f"   Fehler gegen das Raster: projektiv max "
                  f"{gepoolt['fehler_welt_max']} E, linear max "
                  f"{gepoolt['linear_fehler_max']} E", flush=True)
            modell = gepoolt
    if modell is None:
        print("   ⚠ Zu wenige Reihen fuer ein Modell — Kamera in einen dichten "
              "Hive stellen.")
    else:
        print(f"\n   Modell a={modell['a']} c={modell['c']}  aus "
              f"{modell.get('zeilen') or modell.get('punkte')} Stuetzstellen, "
              f"Restfehler {modell['rest_px']} px", flush=True)
        print(f"   Fehler gegen das Raster: projektiv max {modell['fehler_welt_max']} E, "
              f"linear max {modell['linear_fehler_max']} E", flush=True)
        mcfg["y_modell"] = {"a": modell["a"], "c": modell["c"]}
        mcfg["skala_y"] = modell["a"]

    # ── 4b) skala_x unabhaengig gegenpruefen ─────────────────────────────
    sp = spalten_massstab(orte, mcfg)
    if sp is None:
        print("   (zu wenige Banner fuer eine Spaltenmessung — skala_x bleibt "
              "aus dem Zoomfaktor hochgerechnet)")
    else:
        sx_raster, abstaende = sp
        weicht = abs(sx_raster - mcfg["skala_x"]) / mcfg["skala_x"]
        print(f"\n→ skala_x: {mcfg['skala_x']:.1f} aus dem Zoomfaktor, "
              f"{sx_raster:.1f} aus den Spaltenabstaenden "
              f"({', '.join(f'{d:.0f}' for d in abstaende)} px)  "
              f"— Unterschied {weicht*100:.1f} %", flush=True)
        if weicht > 0.03:
            print("   ⚠ Die beiden Wege sind sich nicht einig. Genommen wird die "
                  "Spaltenmessung: sie misst auf dieser Stufe, statt den Massstab "
                  "der Sprung-Stufe hochzurechnen.")
        mcfg["skala_x"] = round(sx_raster, 1)

    # ── 5) Unabhaengige Gegenprobe an den Stern-Wahrheiten ───────────────
    print(f"\n{'Basis':18s} {'gemessen':>12s} {'gerechnet':>16s} {'Abweichung':>11s}")
    print("-" * 62)
    getroffen = 0
    for cx, cy, w, h in orte:
        gelesen = banner.lesen(im, cx, cy, w, h).lower().replace(" ", "")
        for wahr, (wx, wy) in WAHRHEITEN.items():
            if len(gelesen) >= 4 and wahr.lower().replace(" ", "")[:5] in gelesen:
                rx, ry = banner.welt(cx, cy, a.anker[0], a.anker[1], mcfg)
                print(f"{wahr:18s} {f'{wx}/{wy}':>12s} {f'{rx:.2f}/{ry:.2f}':>16s}"
                      f" {abs(rx-wx)+abs(ry-wy):10.2f}")
                getroffen += 1
                break
    if not getroffen:
        print("(keine Wahrheit erkannt — auf dieser Stufe liest die OCR schlecht; "
              "die Eichung selbst haengt nicht daran)")

    # ── 6) Position gegenpruefen: steht die Kamera noch am Anker? ────────
    pos = position.lesen(g, CFG, bild, erwartet=tuple(a.anker), toleranz=3)
    print(f"\nKameraposition laut Dialog: {pos if pos else 'nicht lesbar/unplausibel'} "
          f"(erwartet {a.anker[0]}/{a.anker[1]})")

    # ── 7) Schreiben ─────────────────────────────────────────────────────
    schluessel = ("skala_x", "skala_y", "versatz_x", "banner_versatz",
                  "banner_breite", "banner_hoehe", "y_modell")
    ergebnis = {k: mcfg[k] for k in schluessel if k in mcfg}
    ergebnis["zoomfaktor"] = round(f, 3)
    print("\n" + json.dumps(ergebnis, indent=2, ensure_ascii=False))
    if a.schreiben:
        pfad = Path(__file__).resolve().parent / "config.json"
        alt = json.loads(pfad.read_text())
        bisher = alt["stufen"][a.stufe].get("skala_x")
        if bisher and abs(ergebnis["skala_x"] - bisher) / bisher > 0.08 and not a.erzwingen:
            # Eine Eichung darf eine bestehende nicht still ersetzen. Weicht sie
            # stark ab, ist eher die neue Messung schiefgegangen als der Massstab
            # ueber Nacht ein anderer geworden.
            print(f"\nNICHT geschrieben: skala_x {ergebnis['skala_x']} weicht um "
                  f"{abs(ergebnis['skala_x']-bisher)/bisher*100:.0f} % vom "
                  f"bisherigen Wert {bisher} ab. Erst nachsehen, warum — mit "
                  f"--erzwingen laesst es sich uebergehen.")
            return 1
        alt["stufen"][a.stufe].update(ergebnis)
        pfad.write_text(json.dumps(alt, indent=2, ensure_ascii=False) + "\n")
        print(f"config.json: Stufe {a.stufe!r} aktualisiert.")
    else:
        print("(nur Bericht — mit --schreiben uebernehmen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
