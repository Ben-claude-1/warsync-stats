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
import difflib
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from . import match, navigate, roster, suchlauf, tool
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
# Wie oft der Zaehler nach einem Tipp angesehen wird, bevor eine Abweichung
# gilt. **Das lockert das Tor nicht** — eine echte Abweichung steht in jedem
# Blick da, eine verlesene Ziffer nur in einem. Am 30.09.2026 hat genau das
# einen Lauf nach drei Zuegen weggeworfen: dieselbe Stelle las vor dem Tipp
# `3` und danach `14`, waehrend im Spiel `4/20` stand — der Blick fiel in die
# Animation nach dem Tipp. Derselbe Griff wie bei `warte_auf_titel` in
# `navigate.py`: mehrmals hinsehen, statt aus einem Bild zu urteilen.
ZAEHLER_BLICKE = 3
ZAEHLER_PAUSE = 1.2
# Wie oft ein Name nachgeschlagen wird, bevor er als „keine belegte Zeile"
# gilt. Die Suche kann daneben gehen, weil der Name nicht im Feld ankam —
# das ist mit Wiederholen zu heilen, nicht mit Nachdenken.
SUCH_VERSUCHE = 3


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
        self.zaehler = zaehler_nachpruefen(g, bild, vorher, rolle, erwartet,
                                           name, log=self.log)


def zaehler_nachpruefen(g: Geraet, bild, vorher: dict, rolle: str,
                        erwartet: str, name: str, *, log=_log) -> dict:
    """Nach dem Tipp muss sich genau der angetippte Topf um ±1 bewegt haben.

    **Eine Kontrolle fuer beide Wege** — den Durchlauf durch die Liste und den
    ueber das Suchfeld. Zwei Fassungen derselben Sicherung liefen frueher oder
    spaeter auseinander, und dann haette einer der beiden Wege eine Luecke, von
    der niemand weiss.

    **Angesehen wird bis zu `ZAEHLER_BLICKE`-mal**, und das ist kein
    aufgeweichtes Tor: eine echte Abweichung steht in jedem Blick da, eine
    verlesene Ziffer nur in einem. Der erste Blick nimmt das Bild, das der
    Aufrufer ohnehin hat; jeder weitere ein frisches, nach einer Pause — denn
    der Fehler entsteht *in* der Animation nach dem Tipp und ist mit Warten
    weg, nicht mit Rechnen.
    """
    erwartet_um = -1 if erwartet == "ohne" else +1
    soll = ({f: vorher.get(f, 0) + (erwartet_um if f == rolle else 0)
             for f in ("gesetzt", "ersatz")} if vorher else None)

    gelesen = None
    for blick in range(ZAEHLER_BLICKE):
        if blick:
            time.sleep(ZAEHLER_PAUSE)
            bild = g.bild()
        nachher = roster.dialog_zaehler(g, bild)
        if not nachher:
            gelesen = None
            continue
        if soll is None:                       # erster Tipp, kein Vorher
            return nachher
        if all(nachher.get(f) == s for f, s in soll.items()):
            if blick:
                log(f"    Zaehler stimmt im {blick + 1}. Blick ({name}) — "
                    f"die erste Lesung war {gelesen}.")
            return nachher
        gelesen = {f: nachher.get(f) for f in soll}

    if gelesen is None:
        raise EinstellFehler(
            f"Nach dem Tipp auf {name} sind die Zaehler ueber der Liste nicht "
            f"lesbar ({ZAEHLER_BLICKE} Blicke) — ohne sie ist der naechste "
            "Tipp nicht zu verantworten.")
    raise EinstellFehler(
        f"{name}: Zaehler sollten {soll} sein, das Spiel sagt {gelesen} "
        f"(vorher {({f: vorher.get(f) for f in soll})}) — in "
        f"{ZAEHLER_BLICKE} Blicken unveraendert.")


# ── Ein Durchlauf ueber ein Blatt ─────────────────────────────────────────
def _blatt_bestimmen(bz: str | None, ws_time: dict, team: str,
                     basis: str | None = "server") -> str:
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

    **Verglichen wird in der Zeit, die dasteht** (seit 30.09.2026). Ueber der
    Kampfzeile steht „Serverzeit" oder „Lokale Zeit", mit einem Umschalter
    daneben — und ein Tipp darauf genuegt: an dem Tag stand dort ploetzlich
    `22:00 ~ 22:30` (europaeisch) statt `18:00 ~ 18:30`, und das Tor brach ab,
    weil es ausschliesslich in Serverzeit verglich. Die Beschriftung
    mitzulesen loest nebenbei die Zweideutigkeit, um die es im Absatz darueber
    geht: wer weiss, welche Zeit dasteht, muss `13:00` nicht mehr zwischen
    „Team A europaeisch" und „Fehllesung von 18:00" auseinanderhalten.
    Unbekannte Zeitbasis heisst abbrechen, nicht annehmen.
    """
    if basis not in ("server", "lokal"):
        raise EinstellFehler(
            "Ueber der Kampfzeile steht weder 'Serverzeit' noch 'Lokale Zeit' "
            "— ohne sie ist nicht zu sagen, welches Blatt offen ist. "
            "Es wird nichts getippt.")
    umrechnen = roster.eu_zu_server if basis == "server" else (lambda z: z)
    treffer = [t.upper() for t, z in ws_time.items()
               if bz and umrechnen(z) == bz]
    if len(treffer) != 1:
        raise EinstellFehler(
            f"Kampfzeit des Blattes ist {bz!r} ({basis}) — dazu passt nicht genau "
            f"ein Team (Zeiten laut Werkzeug: {ws_time}). Es wird nichts getippt.")
    if treffer[0] != team.upper():
        raise EinstellFehler(
            f"Offen ist Blatt {treffer[0]}, gewollt war {team.upper()}.")
    return treffer[0]


def blatt_bearbeiten(g: Geraet, team: str, soll: dict, kader: list[dict],
                     ws_time: dict, *, schreiben: bool, max_klicks: int,
                     durchgaenge: int, bilder_ordner: Path | None,
                     log=_log) -> dict:
    randdaten = navigate.zur_teilnehmerliste(g, team=team, log=log)
    blatt = _blatt_bestimmen(randdaten.get("blatt_zeit"), ws_time, team,
                             randdaten.get("zeitbasis"))
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


# ── Der Weg ueber das Suchfeld ────────────────────────────────────────────
# Ben, 30.09.2026: **„du sollst nicht durch die Liste scrollen, sondern die
# Namen eingeben und dann das Team zuweisen. Erst komplett Team A, danach
# Team B."**
#
# Das ist derselbe Griff, mit dem `suchlauf.py` seit dem 23.09.2026 am
# Scroll-Haenger vorbeikommt: ein Name ins Feld „Mitglieder suchen", und
# darunter steht **seine eine Zeile** — ohne einen einzigen Wisch. Fuer das
# Einstellen wiegt das noch schwerer als fuers Lesen, denn hier kostet jeder
# abgebrochene Durchlauf nicht eine Zeile im Bericht, sondern einen halb
# eingestellten Kader.
#
# Drei Dinge fallen damit weg, die den Durchlauf teuer machen: das Aufklappen
# der Rang-Gruppen, die sechs stehenden Bilder am Listenende, und die Frage,
# ob die Liste zwischen Lesen und Tippen verrutscht ist. Was **bleibt**, ist
# die Reihenfolge: alle vier Toepfe sind voll, ein Zug in einen vollen Topf
# geht nicht. Deshalb wird die Schrittfolge des Plans abgearbeitet und nicht
# die Namensliste — `zuteilungSchritte` hat sie genau so gelegt, dass nach
# jedem einzelnen Schritt jeder Zaehler innerhalb seiner Grenze bleibt.
def _eingabezeile_schliessen(g: Geraet, log=_log) -> None:
    """Die Tastaturzeile wegnehmen, **bevor** auf ein Feld getippt wird.

    Sobald „Mitglieder suchen" einmal angetippt wurde, blendet das Spiel unten
    eine eigene Eingabezeile ein — und **der erste Tipp danach schliesst sie,
    statt das zu treffen, worauf er zeigt.** Am 30.09.2026 hat das den ersten
    Lauf ueber das Suchfeld sofort gestoppt: `Neiluj13` wurde gesucht, das
    Ersatz-Feld angetippt, und danach stand die Zeile unveraendert auf `ohne`.
    Derselbe Tipp ein zweites Mal sass sofort (`ersatz`, Abzeichen `A`,
    Zaehler 0 → 1).

    `suchlauf.py` ist das nie aufgefallen — es macht nur Bilder und tippt
    nichts. Den Tipp einfach zu wiederholen waere der falsche Schluss: waere
    die Zeile schon offen gewesen, saesse der erste und der zweite naehme die
    Zuweisung wieder zurueck.

    **Geschlossen wird mit ENTER, nicht mit BACK** (gemessen 30.09.2026).
    BACK nimmt nicht nur die Tastatur weg, es **loescht die Suche gleich mit**:
    danach steht im Feld wieder „Mitglieder suchen" und unter ihm die
    ungefilterte Liste. Genau das war der Fehler, der wie ein Suchproblem
    aussah und keines war — gesucht wurde richtig, aber angekreuzt haette der
    Lauf die **oberste Zeile der ganzen Liste**. Dieselbe Probe Griff fuer
    Griff:

    | Griff | Eingabezeile | Suchfeld | erste Zeile |
    |---|---|---|---|
    | BACK | zu | leer | `IIBlackJackll` 179,5 M — ein Fremder |
    | ENTER | zu | `Cocojamb` | `Cocojamb` 123,2 M |

    Dass trotzdem niemand falsch gesetzt wurde, verdankt sich allein dem
    Beleg-Zwang eine Ebene hoeher: die fremde Zeile fiel durch Namens- und
    Kraftvergleich. Sichtbar war davon nur „keine belegte Zeile" — 28-mal
    hintereinander und immer mit demselben fremden Namen.
    """
    if not suchlauf.eingabezeile_offen(g):
        return
    g.taste(66)                                  # ENTER — laesst die Suche stehen
    time.sleep(1.0)
    if suchlauf.eingabezeile_offen(g):
        log("     Eingabezeile bleibt offen — ein Tipp ginge daran verloren.")
        raise EinstellFehler(
            "Die Eingabezeile laesst sich nicht schliessen; ein Tipp auf das "
            "Feld wuerde nur sie wegnehmen.")
    if not navigate.liste_offen(g):
        raise EinstellFehler(
            "Nach dem Schliessen der Eingabezeile ist die Teilnehmerliste nicht "
            "mehr offen.")


def _zeile_suchen(g: Geraet, getippt: str, log=_log) -> tuple[int, dict] | None:
    """Den Namen eintippen, die Tastatur wegnehmen und die eine Zeile lesen.

    **Nach dem Schliessen wird das Feld noch einmal gelesen.** Die Tastatur
    wegzunehmen darf die Suche nicht mitnehmen — tut sie es doch, steht unter
    dem Feld die ungefilterte Liste, und ihre oberste Zeile gehoert irgendwem.
    Der Beleg-Zwang faengt das zwar ab, aber erst nach drei vollen Suchlaeufen
    und mit der Meldung „keine belegte Zeile", die auf das falsche Problem
    zeigt. Hier steht stattdessen, was tatsaechlich fehlt.
    """
    if not suchlauf.name_eingeben(g, getippt):
        return None
    _eingabezeile_schliessen(g, log=log)
    bild = g.bild()
    feld = suchlauf.feld_text(g, bild)
    if suchlauf.feld_traegt(getippt, feld) is False:
        log(f"     Suche ist beim Schliessen der Tastatur verlorengegangen "
            f"(Feld {feld!r}) — die Liste steht ungefiltert da.")
        return None
    koepfe = roster.zeitkoepfe(g, bild) or roster.zeilenkoepfe(g, bild)
    if not koepfe:
        return None
    y0, y1, farbe = koepfe[0]
    z = roster.zeile_lesen(g, bild, y1)
    z["farbe"] = farbe
    return y1, z


def _belege_zaehlen(getippt: str, z: dict, p: dict) -> tuple[bool, bool]:
    """(Name stimmt, Heldenkraft stimmt) — die zwei unabhaengigen Belege."""
    name_ok = bool(z.get("name_ocr")) and difflib.SequenceMatcher(
        None, match.norm(getippt), match.norm(z["name_ocr"])
    ).ratio() >= suchlauf.NAME_BESTAETIGT
    hp, kraft = p.get("hero_power"), z.get("kraft")
    kraft_ok = bool(hp and kraft
                    and abs(kraft * 1e6 - hp) / hp <= KRAFT_MAX_ABWEICHUNG)
    return name_ok, kraft_ok


def blatt_ueber_suche(g: Geraet, team: str, plan: dict, kader: list[dict],
                      ws_time: dict, *, schreiben: bool, max_klicks: int,
                      schon_geklickt: int = 0, log=_log) -> dict:
    """Ein Blatt vollstaendig einstellen, Name fuer Name ueber das Suchfeld.

    **Getippt wird nur, was in genau diesem Bild gelesen und belegt wurde** —
    dieselbe Regel wie beim Durchlauf, hier sogar leichter einzuhalten: nach
    dem Suchen steht genau eine Zeile da.

    Belegt heisst weiterhin **zwei unabhaengige Nachweise**, und beide werden
    verlangt, wo beide zu haben sind: der Name in der Zeile und die
    Heldenkraft daneben. Fehlt einer *systematisch*, genuegt der andere — ein
    Teil des Kaders ist in Schriften geschrieben, die die Erkennung nicht
    kennt (`ΧΑΣΑΠΗΣ`, `ꜱɪɴɴᴇʀ`), und bei einem frisch angelegten Spieler steht
    im Werkzeug noch keine Kraft. Beide zu fordern hiesse, genau die zu
    ueberspringen; keinen zu fordern hiesse, dem Suchfeld blind zu glauben.
    Und ihm blind zu glauben geht nicht: `input text` kommt mal sofort an und
    mal gar nicht, dann steht im Bild die Zeile des **vorigen** Namens.
    """
    soll = plan["soll"]
    nach_name = {p["name"]: p for p in kader}

    randdaten = navigate.zur_teilnehmerliste(g, team=team, log=log)
    blatt = _blatt_bestimmen(randdaten.get("blatt_zeit"), ws_time, team,
                             randdaten.get("zeitbasis"))
    log(f"Blatt {blatt} ist offen und bestaetigt.")

    zaehler = roster.dialog_zaehler(g, g.bild())
    if not zaehler:
        raise EinstellFehler(
            "Die Zaehler ueber der Liste sind nicht lesbar — ohne sie ist kein "
            "Tipp zu verantworten.")
    log(f"  Eingeteilt laut Spiel: {zaehler['gesetzt']}/{zaehler['gesetzt_max']} "
        f"gesetzt, {zaehler['ersatz']}/{zaehler['ersatz_max']} Ersatz")

    # **Nachgeschlagen wird jeder, den der Plan auf dieses Blatt stellt — nicht
    # nur, wer in der Schrittliste steht.** Die Schritte sind der Unterschied
    # zwischen dem Stand *im Werkzeug* und dem Ziel; wessen Wert im Werkzeug
    # schon stimmte, kommt darin gar nicht vor. Im **Spiel** kann er trotzdem
    # fehlen, und dann fehlt er still: am 30.09.2026 blieb Blatt A deshalb auf
    # 9/10 Ersatz stehen — `Ben_the_men` hatte sich im Browser selbst auf die
    # Bank gesetzt, der Plan sah keinen Schritt mehr vor, und im Spiel stand er
    # nirgends. Ein Lauf, der den Spielstand liest, muss ihn auch ansehen.
    #
    # Die **Reihenfolge** bleibt die der Schritte: `zuteilungSchritte` hat sie
    # so gelegt, dass nach jedem einzelnen Zug jeder Topf innerhalb seiner
    # Grenze bleibt. Die Nachzuegler haengen hinten an — sie stehen laut Plan
    # ohnehin schon richtig, koennen also keinen Topf sprengen.
    namen = []
    for s in plan["schritte"]:
        if s["blatt"] == blatt and s["name"] not in namen:
            namen.append(s["name"])
    ohne_schritt = [n for n, w in soll.items()
                    if w and w[0] == blatt and w not in (blatt + "C",)
                    and n not in namen]

    # **Auch wer laut Plan _keinen_ Platz hat, gehoert nachgeschlagen** — und
    # zwar zuerst. Dieselbe Begruendung wie eine Zeile hoeher, nur andersherum:
    # die Schritte sind der Unterschied zum Stand im *Werkzeug*; steht dort der
    # Ausschluss schon drin, gibt es keinen Schritt mehr, und im **Spiel** sitzt
    # er trotzdem noch auf seinem Platz. Am 01.10.2026 war das `ΧΑΣΑΠΗΣ`: sein
    # `BC` stand im Werkzeug, seine Bank-Zeile im Spiel — und weil niemand sie
    # raeumte, blieben `FLY1984` und `ALPEROKÇELİK` in vollen Toepfen haengen.
    # Ein Lauf, der den Spielstand liest, muss auch die ansehen, die gehen.
    #
    # **Zuerst**, weil nur sie Platz schaffen: ein Feld zu raeumen kann keinen
    # Topf ueberlaufen lassen, ein Zug hinein sehr wohl. Das spart die
    # Ringtausch-Durchgaenge, die es sonst braucht.
    raus_namen = sorted(n for n, w in soll.items()
                        if w == blatt + "C" and n not in namen)
    namen = raus_namen + namen + sorted(ohne_schritt)
    log(f"— Blatt {blatt}: {len(namen)} Namen nachzuschlagen —"
        + (f" (davon {len(raus_namen)} ohne Platz: "
           f"{', '.join(raus_namen)})" if raus_namen else "")
        + (f" (davon {len(ohne_schritt)} ohne Schritt: "
           f"{', '.join(sorted(ohne_schritt))})" if ohne_schritt else ""))

    getan, uebersprungen, offen = [], [], []
    klicks = schon_geklickt
    for i, name in enumerate(namen, 1):
        p = nach_name.get(name)
        if not p:
            uebersprungen.append(f"{name}: nicht im Kader")
            continue
        ziel = soll.get(name)
        getippt = match.suchname(name)
        log(f"[{i}/{len(namen)}] {name!r} → {ziel}"
            + (f" (im Spiel {getippt!r})" if getippt != name else ""))

        # **Zweiter Anlauf, wenn die Zeile nicht seine ist.** Der haeufigste
        # Grund ist, dass der Name gar nicht erst im Feld ankam — und dagegen
        # hilft nur, ihn noch einmal zu tippen. Ohne das blieb am 30.09.2026
        # 28-mal hintereinander dieselbe fremde Zeile stehen.
        fund = z = None
        for versuch in range(1, SUCH_VERSUCHE + 1):
            fund = _zeile_suchen(g, getippt, log=log)
            if not fund:
                continue
            y, z = fund
            name_ok, kraft_ok = _belege_zaehlen(getippt, z, p)
            if name_ok or kraft_ok:
                break
            log(f"     Zeile gehoert {z.get('name_ocr')!r} ({z.get('kraft')}M) — "
                f"noch einmal suchen ({versuch}/{SUCH_VERSUCHE}).")
            fund = None
        if not fund:
            offen.append(
                f"{name}: keine belegte Zeile in {SUCH_VERSUCHE} Versuchen"
                + (f" (zuletzt {z.get('name_ocr')!r}, {z.get('kraft')}M)" if z else ""))
            log("     ⚠ keine belegte Zeile — es wird nicht getippt")
            continue
        y, z = fund

        ist = ist_wert(z, blatt)
        folge = schritte_fuer(ist, ziel, blatt)
        if not folge:
            log(f"     steht schon richtig ({ist})")
            continue

        # **Die Kapazitaet gilt fuer die ganze Folge und wird deshalb _vorher_
        # geprueft.** Ein Wechsel innerhalb eines Blattes sind zwei Tipps —
        # erst raeumen, dann setzen. Solange die Pruefung nur im Schleifenrumpf
        # stand, lief der erste Tipp ungeprueft durch und der zweite brach im
        # vollen Topf ab: der Spieler stand danach **ganz ohne Platz** da, und
        # der Lauf meldete das als „Topf voll", nicht als Schaden. Am
        # 01.10.2026 traf es `ComicToaster` (`AE` → `A` bei 20/20 gesetzt) —
        # Blatt A stand danach auf 9/10 Ersatz. Die Doku verspricht ausdruecklich
        # das Gegenteil: ein Wechsel wird am Stueck gemacht, sonst steht nach
        # einem Abbruch jemand ohne Platz da.
        ziel_rolle = next((r for r, d in folge if d != "ohne"), None)
        if ziel_rolle and zaehler.get(ziel_rolle, 0) >= zaehler.get(ziel_rolle + "_max", 0):
            offen.append(f"{name}: {ziel_rolle} ist voll "
                         f"({zaehler.get(ziel_rolle)}/{zaehler.get(ziel_rolle + '_max')})")
            log(f"     Topf {ziel_rolle} ist voll — der ganze Wechsel entfaellt")
            continue

        for rolle, danach in folge:
            if klicks >= max_klicks:
                raise Genug(f"{max_klicks} Tipps erreicht.")
            if danach != "ohne" and zaehler.get(rolle, 0) >= zaehler.get(rolle + "_max", 0):
                offen.append(f"{name}: {rolle} ist voll "
                             f"({zaehler.get(rolle)}/{zaehler.get(rolle + '_max')})")
                log(f"     Topf {rolle} ist voll — nicht getippt")
                break
            if not schreiben:
                log(f"     (trocken) wuerde {rolle} antippen → {danach}")
                getan.append({"spieler": name, "von": ist, "nach": ziel,
                              "trocken": True})
                continue

            vorher = dict(zaehler)
            g.tippen(g.cfg["badge_x"][rolle], y + KLICK_DY, pause=1.6)
            klicks += 1
            bild = g.bild()
            z2 = roster.zeile_lesen(g, bild, y)
            if z2["platz"] != danach:
                raise EinstellFehler(
                    f"{name}: Feld {rolle} sollte nach dem Tipp {danach!r} sein, "
                    f"gelesen wurde {z2['platz']!r} ({z2['badge_signal']}).")
            zaehler = zaehler_nachpruefen(g, bild, vorher, rolle, danach,
                                          name, log=log)
        else:
            if schreiben:
                getan.append({"spieler": name, "von": ist, "nach": ziel})
                log(f"     {ist} → {ziel} ✓  "
                    f"({zaehler['gesetzt']}/{zaehler['gesetzt_max']} gesetzt, "
                    f"{zaehler['ersatz']}/{zaehler['ersatz_max']} Ersatz)")

    navigate.dialog_schliessen(g)
    return {"blatt": blatt, "getan": getan, "offen": offen,
            "uebersprungen": uebersprungen, "klicks": klicks,
            "zaehler": zaehler}


def lauf(g: Geraet, teams: list[str], plan: dict, *, schreiben: bool,
         max_klicks: int, durchgaenge: int, bilder: bool,
         ueber_suche: bool = True) -> int:
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
    # **Erst komplett Team A, danach Team B** (Vorgabe Ben, 30.09.2026) —
    # `teams` steht in dieser Reihenfolge, und jedes Blatt wird fertig
    # gemacht, bevor das naechste geoeffnet wird.
    geklickt = 0
    for team in teams:
        if ueber_suche:
            b = blatt_ueber_suche(
                g, team, plan, kader, ws_time, schreiben=schreiben,
                max_klicks=max_klicks, schon_geklickt=geklickt, log=_log)
            geklickt = b.get("klicks", geklickt)
        else:
            b = blatt_bearbeiten(
                g, team, soll, kader, ws_time, schreiben=schreiben,
                max_klicks=max_klicks, durchgaenge=durchgaenge,
                bilder_ordner=ordner, log=_log)
        berichte.append(b)

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
    p.add_argument("--scrollen", action="store_true",
                   help="den alten Weg nehmen: durch die Liste scrollen statt "
                        "jeden Namen ins Suchfeld zu tippen. Vorgabe ist das "
                        "Suchfeld — es geht am Scroll-Haenger vorbei.")
    a = p.parse_args(argv)

    teams = [a.team.upper()] if a.team else ["A", "B"]
    try:
        g = Geraet()
        plan = plan_holen(g.cfg["alliance_tag"], a.plan)
        return lauf(g, teams, plan, schreiben=a.schreiben, max_klicks=a.max,
                    durchgaenge=a.durchgaenge, bilder=a.bilder,
                    ueber_suche=not a.scrollen)
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
