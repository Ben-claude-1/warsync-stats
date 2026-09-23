"""Die VS-Tagespunkte aus Last War lesen — ein Lauf fuer die ganze Woche.

Der Weg: Basis → Allianzduell → „Rang" → „Tagesrang" → Haken „Deine Allianz" →
je Wochentag die Liste durchscrollen. Heraus kommen Rang, Name und Punkte je
Spieler und Tag, zugeordnet zum Kader.

    .venv/bin/python -u -m scripts.vs_service.run                 # lesen, Bericht
    .venv/bin/python -u -m scripts.vs_service.run --schreiben     # und eintragen
    .venv/bin/python -u -m scripts.vs_service.run --tage Mo,Di    # nur diese Tage
    .venv/bin/python -m scripts.vs_service.run --ordner <pfad>    # aus Bildern neu rechnen

**Warum die ganze Woche auf einmal.** Die Tagesreiter decken Mo bis Sa der
laufenden Duellwoche ab und werden Sonntag um 24:00 Uhr zurueckgesetzt (so
steht es im Spiel). Was bis dahin nicht gelesen ist, ist weg — es gibt keine
Sicht auf eine vergangene Woche. Ein taeglicher Dienst ist deshalb nicht noetig,
ein Lauf spaetestens am Sonntag aber Pflicht.

**Ohne `--schreiben` passiert nichts.** Der Lauf dauert je Tag ein paar Minuten;
die Bilder bleiben liegen, `--ordner` rechnet aus ihnen neu, ohne das Spiel noch
einmal abzufahren.

**Geschrieben wird, was gefunden wurde** — auch wenn die Gegenprobe nicht
aufgeht. Der Tag wird dann als `vollstaendig=false` vermerkt und beim naechsten
Lauf erneut gelesen. Verweigert wird nur, was den vorhandenen Stand
verschlechtern wuerde; `--erzwingen` uebergeht auch das.

Ablage: ~/.local/state/warsync/vs_service/<zeit>/<Tag>/
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import cv2

from scripts.ws_service import match
from scripts.ws_service.device import CONFIG as WS_CONFIG, Geraet, GeraetFehler

from . import lauf as lauf_mod
from . import liste, tool
from .navigate import TAGE, NavigationFehler, filter_setzen, tag_waehlen, zum_rang

CFG_PFAD = Path(__file__).with_name("config.json")
STAND = Path.home() / ".local/state/warsync/vs_service"

# Die Geste ist gemessen: 25 von 25 Rastungen haben gegriffen, Median 452 px
# (17.09.2026). Trotzdem gilt dieselbe Vorsicht wie beim Wuestensturm-Dienst —
# ein zu frueher Abbruch sieht hinterher aus wie ein vollstaendiger Lauf.
STILLSTAND = 3
MAX_SCHRITTE = 90
# Die Liste im Spiel endet bei 100 Zeilen (Ben, 17.09.2026) — genau die
# Mitgliederzahl einer vollen Allianz.
LISTEN_GRENZE = tool.LISTEN_GRENZE
# Serverzeit liegt vier Stunden hinter der europaeischen (SERVER_DIFF_H in
# src/core/helpers.js). Welcher Duelltag gerade laeuft, haengt an ihr.
SERVER_DIFF_H = 4


def _log(msg: str = "") -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}" if msg else "", flush=True)


def konfig() -> dict:
    """Die eigene Konfiguration ueber der des WS-Dienstes.

    Die allgemeinen Teile (Basis-Knopf, Ansicht-Fenster, Paketname) stehen dort
    und werden von `ws_service.navigate` gebraucht; hier stehen nur die
    VS-eigenen Koordinaten. Zwei Kopien derselben Werte liefen auseinander.
    """
    return {**WS_CONFIG, **json.loads(CFG_PFAD.read_text())}


def duellwoche(heute: datetime | None = None) -> tuple[date, str]:
    """(Montag der laufenden Duellwoche, heutiger Tagesreiter) nach Serverzeit."""
    jetzt = (heute or datetime.now()) - timedelta(hours=SERVER_DIFF_H)
    montag = (jetzt - timedelta(days=jetzt.weekday())).date()
    # Sonntag gibt es als Reiter nicht — dort ist die Woche bereits gelaufen.
    return montag, TAGE[jetzt.weekday()] if jetzt.weekday() < 6 else "Sa"


def datum_von(montag: date, tag: str) -> date:
    return montag + timedelta(days=TAGE.index(tag))


# ── Ein Tag ──────────────────────────────────────────────────────────────
def nach_oben(g: Geraet, log=print) -> None:
    """Zurueck an den Anfang der Liste, bevor gelesen wird."""
    vorher = g.bild()
    for _ in range(MAX_SCHRITTE):
        g.rad_schritt(rueckwaerts=True)
        nachher = g.bild()
        px, _guete = liste.versatz(vorher, nachher, rueckwaerts=True)
        vorher = nachher
        if px is None or px < liste.STILL_PX:
            return
    log("  WARNUNG: komme nicht an den Listenanfang zurueck.")


def tag_lesen(g: Geraet, tag: str, ordner: Path, log=print) -> dict:
    """Einen Wochentag durchscrollen und alle Zeilen einsammeln."""
    ordner.mkdir(parents=True, exist_ok=True)
    tag_waehlen(g, tag, log=log)
    # Der Filter haelt nicht ueber das Schliessen der Liste hinweg — nach jedem
    # Tageswechsel noch einmal nachsehen, sonst stehen die Gegner mit drin.
    filter_setzen(g, log=log)
    nach_oben(g, log=log)

    roh: list[dict] = []
    stillstaende = 0
    vorher = None
    schritt = 0
    eigene = None
    ende_erreicht = False
    while schritt < MAX_SCHRITTE:
        bild = g.bild()
        cv2.imwrite(str(ordner / f"bild_{schritt:03d}.png"),
                    cv2.cvtColor(bild, cv2.COLOR_RGB2BGR))
        neue = liste.zeilen_im_bild(bild)
        roh += neue
        if eigene is None:
            eigene = liste.eigene_zeile(bild)
        if vorher is not None:
            px, _g = liste.versatz(vorher, bild)
            if px is None or px < liste.STILL_PX:
                stillstaende += 1
                if stillstaende >= STILLSTAND:
                    log(f"  Listenende nach {schritt} Schritten.")
                    ende_erreicht = True
                    break
            else:
                stillstaende = 0
        vorher = bild
        g.rad_schritt(variante=min(stillstaende, 4))
        schritt += 1
    else:
        log(f"  WARNUNG: Abbruch nach {MAX_SCHRITTE} Schritten ohne Listenende.")

    erg = lauf_mod.zusammenfuehren(roh)
    erg["tag"] = tag
    erg["schritte"] = schritt
    erg["eigene_zeile"] = eigene
    erg["ende_erreicht"] = ende_erreicht
    # Neben die Bilder, damit `--ordner` spaeter nicht raten muss, ob der Lauf
    # damals bis ans Ende kam. Daran haengt, ob ein Fehlender als „nicht
    # angetreten" gilt — das ist zu viel Behauptung fuer eine Annahme.
    (ordner / "lauf.json").write_text(json.dumps(
        {"ende_erreicht": ende_erreicht, "schritte": schritt,
         "zeit": datetime.now().isoformat(timespec="seconds")}, indent=1))
    return erg


def zuordnen(erg: dict, kader: list[dict]) -> dict:
    """Die gelesenen Namen an den Kader binden — unsicheres wird gemeldet, nicht geraten.

    Jede Lesart einer Zeile tritt an, nicht nur die haeufigste: dieselbe Zeile
    kommt in drei Bildern als `JG ASTRID OG`, `3G ASTRID 9G` und
    `JG ASTRID JG` an, und welche davon den Kadernamen trifft, ist keine Frage
    der Haeufigkeit.
    """
    tabelle = match.namenstabelle(kader)
    treffer, offen = [], []
    vergeben: set[str] = set()
    # Die sichersten zuerst — sonst nimmt eine wacklige Zeile den Namen weg,
    # den eine eindeutige gleich braucht.
    bewertet = []
    for z in erg["zeilen"]:
        beste = {"spieler": None, "aehnlichkeit": 0.0, "grund": "kein Name gelesen"}
        for variante in z["name_varianten"] or [z["name"]]:
            u = match.eine_zeile({"name_ocr": variante}, tabelle)
            if u["aehnlichkeit"] > beste["aehnlichkeit"]:
                beste = {**u, "lesart": variante}
        bewertet.append((beste["aehnlichkeit"], z, beste))
    for _s, z, u in sorted(bewertet, key=lambda x: -x[0]):
        if u["spieler"] and u["spieler"] not in vergeben:
            vergeben.add(u["spieler"])
            treffer.append({"name": u["spieler"], "pts": z["punkte"], "rang": z["rang"],
                            "gelesen": z["name"], "aehnlichkeit": u["aehnlichkeit"]})
        else:
            grund = u["grund"] or f"{u['spieler']!r} ist schon vergeben"
            offen.append({"gelesen": z["name"], "pts": z["punkte"], "rang": z["rang"],
                          "grund": grund})
    treffer.sort(key=lambda t: t["rang"])
    offen.sort(key=lambda t: t["rang"])
    return {"treffer": treffer, "offen": offen}


# ── Bericht ──────────────────────────────────────────────────────────────
def bericht_zeigen(erg: dict, zu: dict, datum: date, kader: list[dict],
                   ziel: int, log=print) -> None:
    zeilen = erg["zeilen"]
    ok, meldungen = lauf_mod.gegenprobe(erg)
    log()
    log(f"── {erg['tag']} · {datum} " + "─" * 40)
    log(f"  {erg['rohzeilen']} Rohzeilen → {len(zeilen)} Zeilen "
        f"({erg['einstimmig']} einstimmig gelesen)")
    for m in meldungen:
        log(f"  {m}")
    if erg["rang_abweichungen"]:
        log(f"  Rangziffern, die nicht zur Reihenfolge passen "
            f"(die Reihenfolge gilt): "
            + ", ".join(f"{a['name']} Stelle {a['stelle']}, gelesen {a['gelesen']}"
                        for a in erg["rang_abweichungen"]))
    log(f"  Zugeordnet {len(zu['treffer'])}, offen {len(zu['offen'])}")
    for o in zu["offen"]:
        log(f"    offen: Rang {o['rang']:>3} {o['gelesen']!r} "
            f"{o['pts']:,} — {o['grund']}".replace(",", "."))

    unter = [t for t in zu["treffer"] if t["pts"] < ziel]
    log(f"  Unter dem Tagesziel ({ziel:,}): {len(unter)} von {len(zu['treffer'])}"
        .replace(",", "."))

    aktiv = {p["name"] for p in kader if p.get("active")}
    fehlend = sorted(aktiv - {t["name"] for t in zu["treffer"]})
    if fehlend:
        # **Drei Gruende, warum jemand fehlen kann — und nur einer heisst „nichts
        # getan".** Die Liste endet bei 100 Zeilen; ist sie voll, steht der
        # Fehlende vielleicht darunter. Und wenn der Lauf das Listenende gar
        # nicht erreicht hat, sagt die Zeilenzahl ueberhaupt nichts. Nur wenn
        # der Lauf durchgelaufen *und* die Liste nicht voll ist, ist „nicht
        # angetreten" belegt.
        if not erg.get("ende_erreicht"):
            log(f"  {len(fehlend)} Kadermitglieder fehlen — der Lauf hat das "
                f"Listenende aber nicht erreicht. Ueber sie sagt er nichts.")
        elif len(zeilen) >= LISTEN_GRENZE:
            log(f"  {len(fehlend)} Kadermitglieder fehlen in der Liste — sie ist mit "
                f"{len(zeilen)} Zeilen aber voll. Ueber sie sagt der Lauf nichts.")
        else:
            log(f"  {len(fehlend)} Kadermitglieder fehlen in der Liste, und die ist mit "
                f"{len(zeilen)} Zeilen nicht voll — sie sind an dem Tag nicht angetreten:")
            log(f"    {', '.join(fehlend)}")
    if erg.get("eigene_zeile"):
        e = erg["eigene_zeile"]
        log(f"  Eigene Zeile (gruen, festgepinnt): Rang {e['platz']} "
            f"{e['name']} {e['punkte']:,}".replace(",", "."))
    log(f"  Gegenprobe: {'geht auf' if ok else 'GEHT NICHT AUF'}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tage", help="z.B. Mo,Di,Mi — Vorgabe: alle bis heute")
    ap.add_argument("--schreiben", action="store_true", help="ins Werkzeug eintragen")
    ap.add_argument("--erzwingen", action="store_true",
                    help="auch schreiben, wenn der Stand dadurch schlechter wird")
    ap.add_argument("--ordner", help="nicht scannen, sondern aus diesen Bildern rechnen")
    ap.add_argument("--ziel", type=int, default=7_200_000, help="Tagesziel in Punkten")
    ap.add_argument("--nur-fehlende", action="store_true",
                    help="abgeschlossene Tage ueberspringen, die schon vollstaendig gelesen sind")
    args = ap.parse_args()

    cfg = konfig()
    montag, heute_tag = duellwoche()
    tage = ([t.strip() for t in args.tage.split(",")] if args.tage
            else list(TAGE[:TAGE.index(heute_tag) + 1]))
    for t in tage:
        if t not in TAGE:
            print(f"'{t}' ist kein Tagesreiter ({', '.join(TAGE)}).")
            return 2

    aid = tool.allianz_id(cfg["alliance_tag"])
    kader = tool.kader(aid)

    # Was zu diesen Tagen schon in der Datenbank steht — gebraucht an zwei
    # Stellen: `--nur-fehlende` ueberspringt damit, was fertig ist, und der
    # Schreibteil weiter unten verhindert damit, dass ein schlechterer Lauf
    # einen besseren ueberschreibt.
    bestand = tool.laeufe_lesen(aid, montag, datum_von(montag, "Sa"))

    if args.nur_fehlende:
        # **Ein abgeschlossener Tag aendert sich nicht mehr.** Ohne diesen
        # Schalter faehrt ein naechtlicher Lauf jedes Mal die ganze Woche ab —
        # am Samstag sechs Tage fuer fuenf, die seit Tagen feststehen. Der
        # laufende Tag wird immer neu gelesen, denn er ist noch nicht fertig.
        heute_datum = datum_von(montag, heute_tag)
        vorher = list(tage)
        tage = [t for t in tage
                if datum_von(montag, t) >= heute_datum
                or not (bestand.get(str(datum_von(montag, t))) or {}).get("vollstaendig")]
        uebersprungen = [t for t in vorher if t not in tage]
        if uebersprungen:
            _log(f"Uebersprungen (schon vollstaendig gelesen): {', '.join(uebersprungen)}")
        if not tage:
            _log("Nichts zu tun — alle abgeschlossenen Tage stehen bereits.")
            return 0
    _log(f"Allianz {cfg['alliance_tag']}, {len(kader)} Spieler im Kader "
         f"({sum(1 for p in kader if p.get('active'))} aktiv)")
    _log(f"Duellwoche ab Montag {montag}, heute ist {heute_tag} (Serverzeit)")
    _log(f"Tage: {', '.join(tage)}")

    if args.ordner:
        wurzel = Path(args.ordner)
        g = None
    else:
        wurzel = STAND / f"{datetime.now():%Y%m%d_%H%M%S}"
        wurzel.mkdir(parents=True, exist_ok=True)
        try:
            g = Geraet(cfg)
            g.starten(log=_log)
            zum_rang(g, log=_log)
        except (GeraetFehler, NavigationFehler) as e:
            _log(f"ABBRUCH: {e}")
            return 2
    _log(f"Ablage: {wurzel}")

    alles = {}
    for tag in tage:
        datum = datum_von(montag, tag)
        ordner = wurzel / tag
        try:
            if g is None:
                roh = []
                for p in sorted(ordner.glob("bild_*.png")):
                    roh += liste.zeilen_im_bild(
                        cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB))
                erg = lauf_mod.zusammenfuehren(roh)
                erg["tag"], erg["schritte"], erg["eigene_zeile"] = tag, 0, None
                # Ob der damalige Lauf bis ans Listenende kam, steht neben den
                # Bildern. Fehlt die Notiz, wird nichts behauptet.
                notiz = ordner / "lauf.json"
                erg["ende_erreicht"] = bool(
                    json.loads(notiz.read_text()).get("ende_erreicht")
                    if notiz.exists() else False)
            else:
                _log(f"Tag {tag} ({datum}) lesen ...")
                erg = tag_lesen(g, tag, ordner, log=_log)
        except NavigationFehler as e:
            _log(f"  {tag}: ABBRUCH — {e}")
            continue

        zu = zuordnen(erg, kader)
        bericht_zeigen(erg, zu, datum, kader, args.ziel, log=_log)
        ok, _m = lauf_mod.gegenprobe(erg)
        vollstaendig = bool(ok and erg.get("ende_erreicht"))
        alles[tag] = {"datum": str(datum), "gegenprobe": ok,
                      "vollstaendig": vollstaendig,
                      "zeilen": erg["zeilen"], "treffer": zu["treffer"],
                      "offen": zu["offen"], "schritte": erg["schritte"]}

        if args.schreiben:
            # Geschrieben wird, was gefunden wurde — verweigert nur, was den
            # vorhandenen Stand verschlechtert. Begruendung bei
            # `lauf.schreiben_erlaubt`.
            alt = bestand.get(str(datum)) or {}
            besser = lauf_mod.schreiben_erlaubt(vollstaendig, len(erg["zeilen"]), alt)
            if not besser and not args.erzwingen:
                _log(f"  {tag}: NICHT geschrieben — es steht bereits ein besserer "
                     f"Stand da ({alt.get('gelesen')} Zeilen, vollstaendig "
                     f"{alt.get('vollstaendig')}) gegen {len(erg['zeilen'])} aus "
                     f"diesem Lauf. Mit --erzwingen trotzdem.")
            else:
                lauf_zeile = tool.schreibe_tag(aid, datum, zu["treffer"],
                                              vollstaendig=vollstaendig,
                                              gelesen=len(erg["zeilen"]))
                bestand[str(datum)] = lauf_zeile
                _log(f"  {tag}: {len(zu['treffer'])} Zeilen eingetragen "
                     f"(gelesen {lauf_zeile['gelesen']}, "
                     f"vollstaendig {lauf_zeile['vollstaendig']})")
                if not vollstaendig:
                    _log(f"       Der Tag bleibt als unvollstaendig vermerkt und "
                         f"wird beim naechsten Lauf erneut gelesen.")

    (wurzel / "bericht.json").write_text(
        json.dumps({"montag": str(montag), "tage": alles}, indent=1, ensure_ascii=False))
    _log()
    _log(f"Bericht: {wurzel / 'bericht.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
