"""Dienst: die vorgeschlagene Verteilung in Last War einstellen.

    .venv/bin/python -m scripts.ws_service.einstellen                 # nur zeigen
    .venv/bin/python -m scripts.ws_service.einstellen --schreiben --max 2
    .venv/bin/python -m scripts.ws_service.einstellen --schreiben --team B
    .venv/bin/python -m scripts.ws_service.einstellen --plan plan.json

**Ohne `--schreiben` wird nichts angetippt.** Der Dienst laeuft dann komplett
durch und sagt, worauf er tippen wuerde — dieselbe Vorgabe wie beim Lesedienst,
aus demselben Grund: ein Fehlgriff waere die Aufstellung einer ganzen Woche.
`--max N` deckelt zusaetzlich die Zahl der Tipps, damit sich der erste Lauf mit
zwei Schritten ansehen laesst.

## Die eine Regel, an der alles haengt

**Getippt wird erst, wenn der Bildschirm nach dem Scrollen ausgewertet ist.**
Ben hat sie am 16.09.2026 so gesetzt, und sie ist der Grund, warum dieser Dienst
ueberhaupt vollautomatisch sein darf: solange nur auf eine Zeile getippt wird,
die *in genau diesem Bild* gelesen und zugeordnet wurde, kann der Tipp nicht
danebengehen, auch wenn die Liste zwischendurch gesprungen ist.

Umgesetzt ist sie, indem der Dienst **keinen eigenen Durchlauf baut**, sondern
sich als `leser` in `roster.durchlauf` einhaengt. Der ruft den Leser fuer jede
vollstaendig sichtbare Zeile auf — unmittelbar nach dem Bildschirmfoto und vor
jeder Aktion; genau diese Reihenfolge steht dort seit dem 09.09.2026
ausdruecklich als Regel („Zuerst lesen, was in diesem Bild steht"). Damit erbt
der Dienst zugleich das Scrollen, das Aufklappen der Rang-Gruppen und die
Gegenproben, statt sie ein zweites Mal zu formulieren.

## Was einen Tipp erlaubt

Vier Bedingungen, alle vier aus demselben Bild:

1. **Das Blatt ist bestaetigt.** Welche Einsatztruppe offen ist, sagt die
   Kampfzeit des Blattes (wie in `run.py`). Ist sie nicht lesbar, wird gar nicht
   getippt — auf dem falschen Blatt getippt hiesse, jemanden ins falsche Team zu
   setzen.
2. **Die Zeile ist sicher zugeordnet**, und zwar mit **zwei unabhaengigen
   Belegen**: der Name ueber `match.eine_zeile` (dieselbe Formel wie im Bericht)
   **und** die Heldenkraft daneben, die hoechstens `KRAFT_MAX_ABWEICHUNG` vom
   Stand im Werkzeug abweicht. Im Bericht kostet eine falsche Zuordnung eine
   Zeile; hier kostet sie einem echten Spieler seinen Platz.
3. **Der Zieltopf hat Platz** — nach den Zaehlern ueber der Liste, frisch aus
   diesem Bild. Sind sie nicht lesbar, wird nicht getippt.
4. **Der Tipp gilt einem Feld dieses Blattes.** Ein fremdes Abzeichen (`B`
   waehrend Blatt A offen ist) wird nie angefasst.

## Und danach

Nach **jedem** Tipp ein neues Bild und zwei Gegenproben: die Zeile selbst (steht
noch derselbe Name da, und ist das Feld jetzt so, wie es sein soll?) und die
Zaehler ueber der Liste (genau ±1 im angetippten Topf). Passt eines nicht, bricht
der Lauf sofort ab — weiterzumachen hiesse, auf einem Bildschirm zu tippen, den
man nicht mehr versteht.

## Warum mehrere Durchlaeufe — und warum einer davon parken darf

Alle vier Toepfe sind voll; ein Zug in einen vollen Topf geht nicht. Ein
Durchlauf in Listenreihenfolge erledigt deshalb von selbst erst die
Ausschluesse und danach, was dadurch Platz gefunden hat; der Rest kommt im
naechsten Durchlauf.

**Ein Wechsel innerhalb eines Blattes wird dabei am Stueck gemacht** — erst
raeumen, dann setzen, und nur, wenn der Zieltopf vorher Platz hat. Sonst stuende
jemand am Ende eines abgebrochenen Laufs ganz ohne Platz da, obwohl er vorher
einen hatte.

Genau daran bleibt aber der **Ringtausch** haengen: `A → AE` und `AE → A`, beide
Toepfe randvoll. Keiner der beiden kann anfangen, und ohne Anfang bewegt sich
nichts mehr. Dieselbe Sackgasse stand am 16.09.2026 in der Schrittfolge fuer die
Hand (`zuteilungSchritte`), und sie hat dieselbe Loesung: **einen abmelden, der
im naechsten Durchgang wiederkommt.** Erlaubt ist das erst, wenn ein ganzer
Durchgang nichts mehr bewegt hat (`parken`) — solange es noch normale Zuege gibt,
ist das Parken unnoetiges Risiko.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from . import match, navigate, roster, tool
from .device import Geraet, GeraetFehler
from .navigate import AnmeldungGeschlossen, NavigationFehler

BERICHTE = Path.home() / ".local" / "state" / "warsync" / "ws_einstellen"
WURZEL = Path(__file__).resolve().parents[2]

# Mitte des Einteilungsfeldes, gemessen von der Unterkante des Zeit-Balkens.
# `roster.zeile_lesen` misst das Badge-Signal ueber y+40 … y+230 — der Tipp
# gehoert in die Mitte dieses Streifens.
KLICK_DY = 135
# Wie weit eine Zeile zwischen zwei Bildern verrutschen darf, damit sie noch als
# dieselbe gilt. Die Liste scrollt beim Tippen nicht; ein paar Pixel Atmung
# haben die Balkenkanten trotzdem.
NACHBAR_DY = 25
# Zweiter, vom Namen unabhaengiger Beleg. Der Anmelde-Scan pflegt die
# Heldenkraft seit dem 15.09.2026 mit, der Wert im Werkzeug ist also frisch.
KRAFT_MAX_ABWEICHUNG = 0.05


class EinstellFehler(RuntimeError):
    """Der Bildschirm sagt etwas anderes als erwartet — sofort aufhoeren."""


class Genug(RuntimeError):
    """`--max` erreicht. Kein Fehler, nur das Ende dieses Laufs."""


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ── Der Plan ──────────────────────────────────────────────────────────────
def plan_holen(tag: str, datei: Path | None, log=_log) -> dict:
    """Der Vorschlag — aus der Logik des Werkzeugs, nicht aus einer zweiten Fassung.

    `scripts/zuteilung_plan.mjs` oeffnet die gebaute App headless und drueckt
    den Knopf des Reiters „🧮 Verteilung". Die Rechnung hier in Python
    nachzubauen waere eine zweite Fassung derselben Entscheidung — sie liefe
    frueher oder spaeter anders als der Reiter, und dann stellte der Dienst
    etwas anderes ein, als auf dem Bildschirm steht.
    """
    if datei:
        return json.loads(datei.read_text())
    log("Vorschlag aus dem Werkzeug holen (scripts/zuteilung_plan.mjs) ...")
    roh = subprocess.run(["node", "scripts/zuteilung_plan.mjs", tag],
                         cwd=WURZEL, capture_output=True, text=True)
    if roh.returncode != 0:
        raise RuntimeError(f"zuteilung_plan.mjs fehlgeschlagen:\n{roh.stderr.strip()}")
    return json.loads(roh.stdout)


# ── Was auf einer Zeile steht, und was dort stehen soll ───────────────────
def ist_wert(z: dict, blatt: str) -> str:
    """`'A'` · `'AE'` · `'frei'` · `'fremd'` · `'unklar'` — aus dem Bild.

    `'frei'` heisst „angemeldet, aber ohne Platz" — auf diesem Blatt ist beides
    Feld leer. `'fremd'` ist das Abzeichen des anderen Teams; daran wird nicht
    getippt. `'unklar'` ist ein belegtes Feld, dessen Buchstabe sich nicht
    entscheiden liess — auch dort nicht, denn wer nicht weiss, wessen Platz das
    ist, darf ihn nicht raeumen.
    """
    if z["platz"] == "ohne":
        return "frei"
    abz = z.get("team_abzeichen")
    if abz is None:
        return "unklar"
    if abz != blatt:
        return "fremd"
    return blatt if z["platz"] == "gesetzt" else blatt + "E"


def schritte_fuer(ist: str, soll: str, blatt: str) -> list[tuple[str, str]]:
    """Welche Felder in welcher Reihenfolge anzutippen sind: [(rolle, danach)].

    `rolle` ist `'gesetzt'` oder `'ersatz'` (die beiden Felder rechts in der
    Zeile), `danach` der Zustand, den `roster.zeile_lesen` anschliessend melden
    muss. Ein Wechsel innerhalb eines Blattes braucht zwei Tipps — erst raeumen,
    dann setzen; ein Feld laesst sich nicht direkt ins andere schieben.
    """
    e = blatt + "E"
    if ist in ("fremd", "unklar"):
        return []
    feld = {blatt: "gesetzt", e: "ersatz"}
    if soll not in (blatt, e):
        # Ausschluss (`AC`/`BC`) oder Wechsel auf das andere Blatt: hier wird
        # nur abgemeldet, gesetzt wird er drueben.
        return [(feld[ist], "ohne")] if ist in feld else []
    if ist == soll:
        return []
    ziel, danach = feld[soll], ("gesetzt" if soll == blatt else "ersatz")
    if ist == "frei":
        return [(ziel, danach)]
    return [(feld[ist], "ohne"), (ziel, danach)]


# ── Der Leser, der tippt ──────────────────────────────────────────────────
class Einsteller:
    """`leser` fuer `roster.durchlauf`: erst lesen, dann — vielleicht — tippen."""

    def __init__(self, soll: dict, blatt: str, kader: list[dict], *,
                 schreiben: bool, max_klicks: int, schon_geklickt: int = 0,
                 parken: bool = False, log=_log):
        self.soll = soll
        self.blatt = blatt
        self.tabelle = match.namenstabelle(kader)
        self.kraft_tool = {p["name"]: (p.get("hero_power") or 0) / 1e6 for p in kader}
        self.schreiben = schreiben
        self.max_klicks = max_klicks
        # Darf in diesem Durchgang **einer** nur abgemeldet werden, um einen
        # Ringtausch aufzubrechen? Siehe Modul-Doku.
        self.parken = parken
        self.geparkt: list[str] = []
        self.log = log
        self.zaehler: dict = {}
        self._bild = None        # aus welchem Bild die Zaehler stammen
        self.klicks = schon_geklickt
        self.getan: list[dict] = []
        self.gesehen: dict[str, str] = {}      # Spieler → Zustand am Ende
        self.uebersprungen: list[str] = []

    # -- Zuordnung: zwei unabhaengige Belege --------------------------------
    def _spieler(self, z: dict) -> str | None:
        urteil = match.eine_zeile(z, self.tabelle)
        name = urteil["spieler"]
        if not name:
            return None
        tool_kraft = self.kraft_tool.get(name) or 0
        kraft = z.get("kraft") or 0
        if not tool_kraft or not kraft:
            self.uebersprungen.append(f"{name}: kein Kraftbeleg")
            return None
        if abs(tool_kraft - kraft) / tool_kraft > KRAFT_MAX_ABWEICHUNG:
            self.uebersprungen.append(
                f"{name}: Kraft {kraft} im Bild gegen {tool_kraft:.1f} im Werkzeug")
            return None
        return name

    def __call__(self, g: Geraet, bild, y_kopf_ende: int) -> dict:
        # Die Zaehler gehoeren zu **diesem** Bild und werden mit ihm neu
        # gelesen. Nach einem Tipp stehen sie schon frischer da (aus dem
        # Kontrollbild in `_tippen`) — dann bleiben die stehen, denn dieses
        # Bild ist ja aelter als der Tipp.
        if bild is not self._bild:
            self._bild = bild
            self.zaehler = roster.dialog_zaehler(g, bild)
        z = roster.zeile_lesen(g, bild, y_kopf_ende)
        if z.get("kraft") is None:
            return z                      # `durchlauf` verwirft sie ohnehin
        name = self._spieler(z)
        z["spieler"] = name
        if not name:
            return z
        ist = ist_wert(z, self.blatt)
        self.gesehen[name] = ist
        soll = self.soll.get(name)
        if soll is None:
            return z                      # kein Auftrag fuer ihn — nicht anfassen
        schritte = schritte_fuer(ist, soll, self.blatt)
        if not schritte:
            return z
        # Der Zieltopf muss **vor** dem ersten Tipp Platz haben. Sonst raeumte
        # der erste Tipp jemanden aus seinem Feld, den der zweite nicht
        # unterbringen kann — und er stuende am Ende ganz ohne Platz da.
        ziel_rolle, danach = schritte[-1]
        if danach != "ohne" and not self._platz_da(ziel_rolle):
            if not (self.parken and schritte[0][1] == "ohne"):
                self.log(f"    {name}: {ist} → {soll} später ({ziel_rolle} ist voll)")
                return z
            # Ringtausch aufbrechen: nur raeumen. Er steht danach ohne Platz da
            # und wird im naechsten Durchgang gesetzt — der Platz, den er
            # freimacht, laesst die Kette anlaufen.
            schritte = schritte[:1]
            self.parken = False
            self.geparkt.append(name)
            self.log(f"    {name}: macht Platz ({ist} → frei), kommt im naechsten "
                     f"Durchgang auf {soll}")
        if not self.schreiben:
            self.log(f"    WÜRDE {name}: {ist} → {soll} "
                     f"({', '.join(r for r, _ in schritte)})")
            self.getan.append({"spieler": name, "von": ist, "nach": soll, "trocken": True})
            return z
        for rolle, erwartet in schritte:
            z = self._tippen(g, y_kopf_ende, rolle, erwartet, z, name)
        self.getan.append({"spieler": name, "von": ist, "nach": soll})
        self.gesehen[name] = ist_wert(z, self.blatt)
        self.log(f"    {name}: {ist} → {self.gesehen[name]} (Ziel {soll}) ✓")
        return z

    def _platz_da(self, rolle: str) -> bool:
        z = self.zaehler
        if not z or z.get(rolle) is None or z.get(rolle + "_max") is None:
            return False                  # unlesbare Zaehler heissen: nicht tippen
        return z[rolle] < z[rolle + "_max"]

    def _tippen(self, g: Geraet, y: int, rolle: str, erwartet: str,
                z_vorher: dict, name: str) -> dict:
        if self.klicks >= self.max_klicks:
            raise Genug(f"{self.max_klicks} Tipps erreicht.")
        vorher = dict(self.zaehler)
        g.tippen(g.cfg["badge_x"][rolle], y + KLICK_DY, pause=1.6)
        self.klicks += 1

        bild = g.bild()
        if not navigate.liste_offen(g, bild):
            raise EinstellFehler(
                f"Nach dem Tipp auf {name} ({rolle}) ist die Teilnehmerliste nicht "
                "mehr offen — vermutlich ging ein Dialog auf.")
        y_neu = self._zeile_wiederfinden(g, bild, y, name)
        z = roster.zeile_lesen(g, bild, y_neu)
        if match.norm(z["name_ocr"]) != match.norm(z_vorher["name_ocr"]):
            raise EinstellFehler(
                f"An der Stelle von {name} steht jetzt {z['name_ocr']!r} — die Liste "
                "ist verrutscht.")
        if z["platz"] != erwartet:
            raise EinstellFehler(
                f"{name}: Feld {rolle} sollte nach dem Tipp {erwartet!r} sein, "
                f"gelesen wurde {z['platz']!r} ({z['badge_signal']}).")
        self._zaehler_pruefen(g, bild, vorher, rolle, erwartet, name)
        return z

    def _zeile_wiederfinden(self, g: Geraet, bild, y: int, name: str) -> int:
        koepfe = [y1 for _, y1, _ in roster.zeitkoepfe(g, bild)
                  if abs(y1 - y) <= NACHBAR_DY]
        if not koepfe:
            raise EinstellFehler(
                f"Die Zeile von {name} ist nach dem Tipp nicht mehr an ihrer Stelle "
                f"(y={y}).")
        return min(koepfe, key=lambda k: abs(k - y))

    def _zaehler_pruefen(self, g: Geraet, bild, vorher: dict, rolle: str,
                         erwartet: str, name: str) -> None:
        nachher = roster.dialog_zaehler(g, bild)
        if not nachher:
            raise EinstellFehler(
                f"Nach dem Tipp auf {name} sind die Zaehler ueber der Liste nicht "
                "lesbar — ohne sie ist der naechste Tipp nicht zu verantworten.")
        self.zaehler = nachher
        if not vorher:
            return
        erwartet_um = -1 if erwartet == "ohne" else +1
        for feld in ("gesetzt", "ersatz"):
            soll = vorher.get(feld, 0) + (erwartet_um if feld == rolle else 0)
            if nachher.get(feld) != soll:
                raise EinstellFehler(
                    f"{name}: Zaehler {feld} sollte {soll} sein, das Spiel sagt "
                    f"{nachher.get(feld)} (vorher {vorher.get(feld)}).")


# ── Ein Durchlauf ueber ein Blatt ─────────────────────────────────────────
def _blatt_bestimmen(bz: str | None, ws_time: dict, team: str) -> str:
    """Welche Einsatztruppe offen war — an der Kampfzeit, nicht am Wunsch.

    Dieselbe Rechnung wie die Gegenprobe in `run.py`, **mit einer Ausnahme**:
    hier faellt der direkte Vergleich `z == bz` weg. Er stand dort, weil eine
    verglichene Zeile in der Praxis mal die europaeische, mal die
    Serverzeit-Schreibweise trifft — als reine Berichtszeile ist ein falscher
    Treffer dort ein falsch beschrifteter Bericht.
    Hier ist es das Sicherheitstor vor jedem Tipp, und am 16.09.2026 hat er live
    zugeschlagen: `18:00` (Serverzeit von Team B) wurde als `13:00` gelesen —
    dieselbe dokumentierte OCR-Verwechslung wie bei den Balkenzeiten in der
    Anmeldeliste —, und `13:00` ist zufaellig **woertlich** Team As europaeische
    Zeit. Mit dem direkten Vergleich waere das als „Blatt A bestaetigt"
    durchgegangen, obwohl B (oder A, in der Umkehrung) offen war: bei
    angefordertem Team A und tatsaechlich offenem B haette der Dienst auf das
    falsche Team getippt und es fuer richtig gehalten. Ohne den direkten
    Vergleich bleibt in genau diesem Fall kein Treffer uebrig, und der Dienst
    bricht ab, statt zu raten.

    **`bz` kommt von `zur_teilnehmerliste()`, nicht aus einem neuen Foto.** Die
    Funktion oeffnet am Ende den Teilnehmer-Dialog, und der deckt genau die
    Stelle ab, an der die Kampfzeit steht — ein danach gemachtes Foto liest dort
    immer `None`. `zur_teilnehmerliste()` liest die Zeit deshalb selbst, bevor
    sie den Dialog oeffnet, und gibt sie zurueck; `run.py` macht es genauso.
    """
    treffer = [t.upper() for t, z in ws_time.items()
               if bz and roster.eu_zu_server(z) == bz]
    if len(treffer) != 1:
        raise EinstellFehler(
            f"Kampfzeit des Blattes ist {bz!r} — dazu passt nicht genau ein Team "
            f"in Serverzeit (Zeiten laut Werkzeug: {ws_time}). Es wird nichts getippt.")
    if treffer[0] != team.upper():
        raise EinstellFehler(
            f"Offen ist Blatt {treffer[0]}, gewollt war {team.upper()}.")
    return treffer[0]


def blatt_bearbeiten(g: Geraet, team: str, soll: dict, kader: list[dict],
                     ws_time: dict, *, schreiben: bool, max_klicks: int,
                     durchgaenge: int, bilder_ordner: Path | None,
                     log=_log) -> dict:
    randdaten = navigate.zur_teilnehmerliste(g, team=team, log=log)
    blatt = _blatt_bestimmen(randdaten.get("blatt_zeit"), ws_time, team)
    log(f"Blatt {blatt} ist offen und bestaetigt.")

    getan, uebersprungen, gesehen, klicks = [], [], {}, 0
    parken = False
    for runde in range(1, durchgaenge + 1):
        log(f"— Durchgang {runde} ueber Blatt {blatt}"
            + (" (einer darf Platz machen)" if parken else "") + " —")
        e = Einsteller(soll, blatt, kader, schreiben=schreiben, parken=parken,
                       max_klicks=max_klicks, schon_geklickt=klicks, log=log)
        ordner = None
        if bilder_ordner:
            ordner = bilder_ordner / f"{blatt}_{runde}"
            ordner.mkdir(parents=True, exist_ok=True)
        try:
            roh = roster.durchlauf(g, log=log, leser=e,
                                   bilder_ordner=str(ordner) if ordner else None)
            log(f"  {len(roh['zeilen'])} Zeilen gesehen, {len(e.getan)} Aenderungen.")
        except Genug as fertig:
            log(f"  {fertig}")
            getan += e.getan
            gesehen.update(e.gesehen)
            klicks = e.klicks
            break
        getan += e.getan
        uebersprungen += e.uebersprungen
        gesehen.update(e.gesehen)
        klicks = e.klicks
        if not e.getan:
            if parken:
                log("  Es bewegt sich nichts mehr — auch nicht mit Platzmachen.")
                break
            # Erst jetzt einen parken lassen: solange normale Zuege moeglich
            # waren, war das Parken unnoetiges Risiko.
            log("  Nichts mehr direkt moeglich — naechster Durchgang darf einen parken.")
            parken = True
        else:
            parken = False
        # Neu aufmachen statt zurueckscrollen: der naechste Durchgang soll oben
        # anfangen, und die Liste nach oben zu ziehen ist genau der Weg, der
        # haengt (siehe `ws-scroll-haenger`).
        navigate.dialog_schliessen(g)
        navigate.teilnehmer_dialog_oeffnen(g, log=log)

    navigate.dialog_schliessen(g)
    # Was am Ende noch nicht stimmt — ausdruecklich, statt es zu verschlucken.
    offen = []
    for name, wert in gesehen.items():
        ziel = soll.get(name)
        if ziel is None:
            continue
        if wert != ziel and (ziel in (blatt, blatt + "E")
                             or wert in (blatt, blatt + "E")):
            offen.append(f"{name}: steht auf {wert}, soll {ziel}")
    # **„nicht gesehen" ist nicht „erledigt".** Wer auf diesem Blatt einen Platz
    # bekommen soll und in keinem Bild auftauchte, fehlt — sei es, weil die
    # Liste haengengeblieben ist oder weil er sich abgemeldet hat.
    for name, ziel in soll.items():
        if ziel in (blatt, blatt + "E") and name not in gesehen:
            offen.append(f"{name}: soll {ziel}, stand aber in keiner gelesenen Zeile")
    return {"blatt": blatt, "getan": getan, "offen": offen,
            "uebersprungen": uebersprungen}


def lauf(g: Geraet, teams: list[str], plan: dict, *, schreiben: bool,
         max_klicks: int, durchgaenge: int, bilder: bool) -> int:
    aid = tool.allianz_id(g.cfg["alliance_tag"])
    kader = tool.kader(aid)
    stand = tool.planungsstand(aid)
    ws_time = stand.get("wsTime") or {"A": "13:00", "B": "22:00"}
    soll = plan["soll"]
    _log(f"Plan vom {plan.get('erzeugt', '?')} fuer Event {plan.get('eventDate', '?')}: "
         f"{len(soll)} Spieler.")
    if not schreiben:
        _log("TROCKENLAUF — es wird nichts angetippt. Mit --schreiben ernst machen.")

    ordner = None
    if bilder:
        ordner = BERICHTE / datetime.now().strftime("%Y%m%d_%H%M%S")
        ordner.mkdir(parents=True, exist_ok=True)
        _log(f"Belegbilder: {ordner}")

    g.starten(log=_log)
    berichte = []
    for team in teams:
        berichte.append(blatt_bearbeiten(
            g, team, soll, kader, ws_time, schreiben=schreiben,
            max_klicks=max_klicks, durchgaenge=durchgaenge,
            bilder_ordner=ordner, log=_log))

    print()
    fehlt = 0
    for b in berichte:
        _log(f"Blatt {b['blatt']}: {len(b['getan'])} Aenderungen.")
        for g_ in b["getan"]:
            print(f"    {g_['spieler']}: {g_['von']} → {g_['nach']}"
                  + ("  (trocken)" if g_.get("trocken") else ""))
        for u in sorted(set(b["uebersprungen"])):
            print(f"    übersprungen — {u}")
        for o in b["offen"]:
            print(f"    OFFEN — {o}")
        fehlt += len(b["offen"])
    if ordner:
        (ordner / "bericht.json").write_text(
            json.dumps({"plan": plan, "berichte": berichte}, ensure_ascii=False, indent=2))
    if fehlt:
        _log(f"{fehlt} Zuordnungen stehen noch offen — erneut laufen lassen oder "
             "von Hand nachziehen.")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--schreiben", action="store_true",
                   help="wirklich tippen (Vorgabe: nur zeigen)")
    p.add_argument("--max", type=int, default=200, help="hoechstens so viele Tipps")
    p.add_argument("--team", choices=["A", "B", "a", "b"],
                   help="nur dieses Blatt (Vorgabe: beide)")
    p.add_argument("--durchgaenge", type=int, default=5,
                   help="wie oft je Blatt durch die Liste (Vorgabe 5). Jeder\n                        Durchgang ist ein volles Scrollen — das kostet Zeit,\n                        deshalb so wenige wie moeglich und so viele wie noetig:\n                        ein Ringtausch braucht vier (siehe pruefe_einstellen).")
    p.add_argument("--plan", type=Path, help="fertiges Plan-JSON statt neu rechnen")
    p.add_argument("--bilder", action="store_true", help="Belegbilder ablegen")
    a = p.parse_args(argv)

    teams = [a.team.upper()] if a.team else ["A", "B"]
    try:
        g = Geraet()
        plan = plan_holen(g.cfg["alliance_tag"], a.plan)
        return lauf(g, teams, plan, schreiben=a.schreiben, max_klicks=a.max,
                    durchgaenge=a.durchgaenge, bilder=a.bilder)
    except Genug as e:
        _log(str(e))
        return 0
    except AnmeldungGeschlossen as e:
        _log(f"Anmeldung geschlossen: {e}")
        return 2
    except (EinstellFehler, NavigationFehler, GeraetFehler, roster.ScanFehler) as e:
        _log(f"ABBRUCH: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
