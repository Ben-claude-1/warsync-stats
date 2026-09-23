---
thema: Zuteilung — der Reiter „🧮 Verteilung": wer diesmal zuschaut
code: src/core/zuteilung.js, src/ui/zuteilung.js, src/core/abmeldung.js, tests/zuteilung.spec.js, scripts/zuteilung_plan.mjs, scripts/ws_service/einstellen.py
migration: db/2026-09-16_ws_players_ersatz_wunsch.sql, db/2026-09-18_ws_abmeldung.sql
stand: gebaut (Stand 18.09.2026)
verwandt: anmeldung-rotation-ersatz, wuestensturm, ws-dienst-anmeldung
---

# Zuteilung — wer diesmal zuschaut

## Die Frage, die der Reiter beantwortet

Bis zum Anmeldeschluss am Donnerstag 04:00 darf jeder Spieler noch zwischen
`A`/`AE`/`B`/`BE`/`AC`/`BC` verschoben werden. Am 16.09.2026 standen **31 Leute für 30
A-Plätze und 39 für 30 B-Plätze** — entschieden werden muss also nicht die Aufstellung,
sondern wer zuschaut. Der Reiter steht zwischen Anmeldung und Aufstellung, weil er genau
dazwischen gehört.

## Zwei Grundsätze

**Die gemeldete Zeit ist die Nebenbedingung, nicht der Wunsch des Planers.** Wer sich für
13:00 gemeldet hat, steht in der A-Liste; das Kürzel trägt sie mit (`AC` heißt „für A
gemeldet, kein Platz"). Zwischen den Teams zu schieben hieße, jemanden auf eine Zeit
einzuteilen, für die er sich nicht gemeldet hat — möglich, aber eine Wette darauf, dass er
erscheint. Deshalb wird je Zeit getrennt gerechnet, und die Zahl der Ausschlüsse ergibt
sich daraus von selbst.

**`AE`/`BE` ist kein Ausschluss.** Im Wüstensturm spielen alle 30 gleichzeitig; der Ersatz
bekommt nur kein Gebäude. Wer wirklich zuschaut, steht auf `AC`/`BC`.

**Wer sich für beide Zeiten gemeldet hat, geht dorthin, wo Plätze fehlen.** Das ist der
einzige Hebel, mit dem sich die beiden Listen überhaupt ausgleichen lassen, ohne jemanden
auf eine fremde Zeit zu setzen. Diese Auskunft liefert der Anmelde-Scan
(`match.beide_zeiten`, siehe `ws-dienst-anmeldung.md`).

## Die Rangfolge (`AUSSCHLUSS_REGELN`)

1. **Wer sich vorher abgemeldet hat, wird nicht eingeplant** — und ist entschuldigt.
2. **Die stärksten `fixCount` je Team haben einen festen Platz** und schauen nie zu.
3. **Wer beim letzten Mal gefehlt hat, setzt aus** (⛔-Marke aus `ws_aussetzen`).
4. **Ein Stern schützt** — wer viel bringt, schaut nicht zu.
5. **Danach der Leistungsindex**; eine Prio-Marke zählt wie **ein halber Index**.
6. **Bei Gleichstand die Stärke.**

Verglichen wird **lexikografisch** (`schutz()` liefert `[stern, wert, kraft]`), damit die
Reihenfolge der Kriterien dieselbe ist wie in der Regelliste — und nicht in einer
gewichteten Summe verschwindet, die niemand mehr nachrechnen kann.

**Ein fehlender Index heißt „nicht gemessen", nicht „schlecht"** — er zählt als
Durchschnitt (1,0). Sonst flöge jeder Neuzugang zuerst.

## Feste Plätze: der Regler steht im Kopf des Reiters (seit 18.09.2026)

Die Zahl gab es vorher schon — `alliances.ws_fixed_count`, Default **15**, bedient unter
„Aufstellung → ⚙ Erweitert". Sie wirkte aber nur auf `computeRoster()`, also darauf, wer
innerhalb der 20 Hauptplätze „fest" statt „Rotation" ist. **Der Verteilungs-Reiter kannte
sie gar nicht.** Ben wollte sie dort einstellen können; ein Regler, der auf seinem eigenen
Reiter nichts bewirkt, wäre die schlechtere Hälfte der Antwort gewesen.

Seither reicht `ui/zuteilung.js` sie als `fixCount` in `zuteilungVorschlag` hinein — core
darf nicht auf ui zugreifen, deshalb hereingereicht und nicht importiert. **Eine Fassung
der Schreiblogik**: beide Stepper rufen `changeWsFixedCount` auf, wie schon bei der
Gebäude-Reihenfolge, die einmal an drei Stellen stand.

Ein fester Platz wirkt an vier Stellen, und jede davon ist eine eigene Entscheidung:

- **Er schlägt die ⛔-Marke** (Entscheidung Ben, 18.09.2026). Wer die Mannschaft trägt,
  wird nicht wegen eines einzelnen Fehlens aus dem wichtigsten Event der Woche genommen.
  Das dreht die bisherige Reihenfolge um.
- **Er ist kein Wackelkandidat.** `grenze.drin` lässt ihn aus: er ist eine Einstellung für
  die ganze Woche, kein Name, den man gegen einen anderen tauscht.
- **Der Stern-Vortritt geht an ihm vorbei.** Bei `fixCount = 20` bestünden die Gesetzten
  sonst ganz aus Festen, und der Schwächste von ihnen flöge auf die Bank — der Regler
  hieße dann nicht mehr „fest".
- **Der Ersatz-Wunsch schlägt ihn trotzdem.** Dort steht jemand freiwillig, und er spielt
  ja mit, nur ohne Gebäude.

**Die Abbruchbremse im Überhang braucht eine Rückfallzeile.** Ist niemand ohne festen
Platz mehr übrig, muss trotzdem einer gehen — sonst liefe die Schleife endlos, sobald
jemand `fixCount` über die Zahl der Plätze hinaus stellte. Sie ist kein toter Code,
sondern die Antwort auf eine Eingabe, die der Regler zulässt.

## Die Vorab-Abmeldung — die Gegenseite dazu (seit 18.09.2026)

Ohne sie hieße „fest gesetzt" auch **„darf folgenlos fehlen"**. Ben hat sie deshalb im
selben Atemzug verlangt: „man muss auch angeben können, dass sich der Spieler im Voraus
gemeldet hat, dass er fehlen wird. Damit er dann beim nächsten Mal nicht aussetzen muss."

`ws_abmeldung` (Migration `db/2026-09-18_ws_abmeldung.sql`, Logik `src/core/abmeldung.js`),
gesetzt mit 🚫 im Reiter — dort fällt die Entscheidung. **Eine eigene Tabelle**, weil die
Aussage einem künftigen Event gilt und dessen Teilnahme-Zeilen erst beim Anmeldeschluss
entstehen; dieselbe Begründung wie bei `ws_aussetzen` und `ws_priority`.

Drei Wirkungen, alle aus derselben Zeile:

- **Der Vorschlag plant ihn nicht ein**, vor jeder anderen Regel und auch vor dem
  Fixplatz. **Er verbraucht dabei keinen** — sonst bekäme der Nächststärkste keinen.
- **Die Prio-Marke bleibt aus.** `wsPrioVerrechnen` lässt ihn aus `ohnePlatz` heraus: die
  Marke gleicht aus, dass jemand spielen *wollte* und nicht durfte. Wer gesagt hat, dass
  er nicht kann, hat nichts verpasst.
- **`ws_participation.excused = true` beim Einfrieren** (`wsFreezeTeam`). **Daran hängt
  die eigentliche Zusage**: `scripts/ws_service/eintragen.py` schreibt für Entschuldigte
  keine `ws_aussetzen`-Zeile. Der Vorschlag nimmt ihn zwar ohnehin aus dem Kader —
  eingeteilt wird aber im Spiel, und ob das jemand umgesetzt hat, weiß das Werkzeug nicht.

**In der Anmeldeliste teilt sich die Marke den Rasterplatz der ⛔-Marke.** Zwei Gründe:
beide sagen dasselbe („spielt diesmal nicht") und schließen sich aus — und die Breiten in
`MARKEN_SLOTS` sind **gemessen** (342 px gegen 339 px am Handy), eine siebte Spalte liefe
rechts aus der Zeile. Deshalb heißt sie **„🚫 Abwesend" und nicht „Abgemeldet"**: gemessen
**85,4 px** gegen die 86 px des Slots, also 0,6 px Reserve. Ein Zeichen mehr wäre
übergelaufen — wer den Text ändert, muss hier nachmessen.

## Warum die Prio-Marke kein Freibrief ist

`ZUT_PRIO_BONUS = 0.5`. Am 16.09.2026 stand die Regel einmal als **harter Schutz** da —
und dann flog `ZEUS XS` (133 Mio, Index 0,74) heraus, während `Little Kong` (101 Mio,
Index 0,19) blieb. Die Fairness-Regel hätte die Mannschaft geschwächt, statt sie zu drehen.

Ein halber Index zieht jemanden **an der Grenze** heraus, nicht jemanden, der weit unten
steht: 0,19 + 0,5 bleibt unter 0,74, aber 0,33 + 0,5 liegt darüber.

## Der Ersatz-Wunsch

`ws_players.ersatz_wunsch` (Migration `db/2026-09-16_ws_players_ersatz_wunsch.sql`):
„stell mich auf die Bank, mir ist es nicht so wichtig zu spielen". Longrow hat das am
16.09.2026 gesagt.

**Als Name im Quelltext wäre es in einem Monat eine Zeile, die niemand mehr erklären kann**
— dieselbe Falle wie beim Super-Admin, der früher als `name==='Ben_the_men'` im Code stand.
Deshalb eine Spalte.

Der Wunsch **geht vor die Rangfolge**: wer ihn setzt, landet im Ersatz, auch wenn seine
Kraft für die 20 reichen würde. Er ist eine Aussage des Spielers, keine Schätzung über ihn
— und **kein** Ausschluss.

## Ein Stern rückt nur am Rand vor

Ab `ZUT_STERN_INDEX = 1.5` rückt ein Stern an der Grenze der 20 noch vor. 1,5 ist kein
runder Zufall: der Median liegt bei 1,0, und wer die Hälfte darüber liegt, hat das über
mehrere Events gezeigt — darunter wäre es Tagesform gegen 10 Mio Heldenkraft Unterschied.

Getauscht wird **nur gegen den Schwächsten der 20**, und nur wenn der weder Stern trägt
noch den besseren Index hat. Ohne diese Enge verdrängte ein 116-Mio-Stern einen
132-Mio-Spieler.

## An der Schnittkante: wer am billigsten zu tauschen ist

Die Rangfolge trifft eine Entscheidung, aber zwischen dem Letzten drinnen und dem Ersten
draußen liegen oft **Hundertstel** — und genau dort kostet ein Tausch von Hand fast nichts.
Der Kasten „⇅ An der Schnittkante" stellt je Team beide Seiten nebeneinander
(`ZUT_GRENZE_N = 3`): links die Schwächsten, die spielen, rechts die Stärksten, die
zuschauen, mit dem Vergleichswert daneben. Ein Tausch ist dann genau ein Name von links
gegen einen von rechts.

Am 16.09.2026 sah das so aus:

| Team | drin (schwächste) | draußen (stärkste) |
|---|---|---|
| A | Snailnuts 0,33 · ʚɞ ASTRID ʚɞ 0,45 · Orcozio WP 0,48 | Stalker24601 0,23 |
| B | Xredenxos 0,62 · Little Kong 0,69 · Skirata33 0,72 | Maggo1979 0,55 · Vegito Rose 0,38 · KiLLuminaTi 0,28 |

**Wer eine ⛔-Marke trägt, steht dort nicht.** Aussetzen nach einem Fehlen ist eine Regel,
die die Allianz sich gegeben hat — die steht nicht zur Abwägung, sonst wäre sie keine
Regel.

**Der Wert steht am Spieler, nicht in zwei Formeln.** `wertVon()` rechnet ihn einmal
(`Index + Prio-Bonus`), `schutz()` sortiert damit, die Anzeige zeigt dieselbe Zahl. Sonst
stünde in der Oberfläche etwas anderes, als die Sortierung gerechnet hat.

**Die Kante wird einmal gerechnet.** Sie stand hier kurz zweimal — einmal zum Markieren,
einmal für die Karte. Die Gegenprobe zum Test lief prompt ins Leere: die eine Fassung war
kaputt, die andere heil, und der Test sah nur die heile. Dieselbe Falle wie bei der
Gebäude-Reihenfolge, die an drei Stellen stand.

## Frühere C-Runden zählen mit (seit 16.09.2026)

`ZUT_PRIO_BONUS` hängt an `ws_priority.counter` — der **Warteschlange**. Sie fällt auf 0
zurück, sobald jemand wieder gespielt hat; wer abwechselnd spielt und zuschaut, bekam
deshalb nie einen Bonus, obwohl es ihn über Monate immer wieder trifft. Genau dafür gibt
es `c_total` (siehe `anmeldung-rotation-ersatz.md`).

`ZUT_GESAMT_BONUS = 0.2` je vergangener Runde, **gedeckelt** bei `ZUT_GESAMT_MAX = 0.6`.
Der Deckel steht aus demselben Grund da wie die Begrenzung der Prio-Marke: eine Summe ohne
Grenze schlägt irgendwann jeden Leistungsunterschied, und dann schwächt die Fairness-Regel
die Mannschaft, statt sie zu drehen (der ZEUS-XS-Fall).

**Gemessen ist der Effekt heute klein — weil die Datenlage es ist.** Am 16.09.2026 steht
`c_total` bei **allen 33** Spielern auf genau 1; der Zähler läuft erst seit zwei
Anmeldeschlüssen (04.09. und 11.09.). Ein flacher Bonus für alle verschiebt die Reihenfolge
kaum: sichtbar wurde **ein** Tausch — `Stalker24601` (0,23 + 0,2 = 0,43) kommt rein,
`Snailnuts` (0,33, noch nie zugeschaut) geht raus. Über Monate wird die Spalte zum
eigentlichen Signal.

**Für `Carmen0804` reicht es nicht, und das ist die ehrliche Auskunft.** Ben wollte sie am
16.09.2026 ausdrücklich spielen lassen; sie steht bei `counter` 0, `c_total` 1 und Index
**0,11** — dem schlechtesten des ganzen Kaders. Der Bonus hebt sie auf 0,31, aber alle an
der Kante haben denselben Bonus bekommen. Wer sie hineinnehmen will, muss von Hand
tauschen: der billigste Partner ist `Xredenxos` (0,62), und der Tausch kostet 0,31 Punkte.

## Die Schrittliste: alle vier Töpfe sind voll

`zuteilungSchritte`. Solange 20 gesetzt + 10 Ersatz je Team belegt sind, nimmt Last War
**keinen** Wechsel an — es muss immer erst einer heraus. Die Funktion legt die Züge deshalb
so, dass nach **jedem einzelnen Schritt** jeder Zähler innerhalb seiner Grenze bleibt
(`ZUT_CAP`), und gruppiert sie nach Blatt, damit nicht zwanzigmal umgeschaltet werden muss.

**Ein Wechsel über die Teamgrenze zerfällt in zwei Schritte:** auf dem einen Blatt
abmelden, auf dem anderen setzen. Anders ist er nicht zu bedienen. Dasselbe Problem stand
schon am 09.09.2026 in der Hand-Optimierung: die Reihenfolge der Klicks war zwingend, weil
A und AE abwechselnd voll sind, und eine übersprungene Zeile blockierte die nächste.

## Der Dienst stellt es im Spiel ein (seit 16.09.2026)

`scripts/ws_service/einstellen.py`. Vollautomatisch — unter **einer** Bedingung, die
Ben gesetzt hat:

> „Ein Klick darf aber erst stattfinden, wenn du nach einem scroll den Screen
> ausgewertet hast."

Genau das ist der Grund, warum der Dienst **keinen eigenen Durchlauf baut**, sondern
sich als `leser` in `roster.durchlauf` einhängt. Der ruft seinen Leser für jede
vollständig sichtbare Zeile auf — unmittelbar nach dem Bildschirmfoto und vor jeder
Aktion; diese Reihenfolge steht dort seit dem 09.09.2026 ausdrücklich als Regel
(„Zuerst lesen, was in diesem Bild steht"). Mitgeerbt sind damit das Scrollen, das
Aufklappen der Rang-Gruppen und die Gegenproben, statt sie ein zweites Mal zu
formulieren.

```
.venv/bin/python -m scripts.ws_service.einstellen                 # nur zeigen
.venv/bin/python -m scripts.ws_service.einstellen --schreiben --max 2
```

**Vier Bedingungen erlauben einen Tipp**, alle vier aus demselben Bild: das Blatt ist
über seine Kampfzeit bestätigt (wie in `run.py`), die Zeile ist sicher zugeordnet, der
Zieltopf hat laut den Zählern über der Liste Platz, und das Feld gehört diesem Blatt
(ein fremdes `B`-Abzeichen wird nie angefasst).

**Die Zuordnung braucht zwei unabhängige Belege**: den Namen über `match.eine_zeile` —
dieselbe Formel wie im Bericht, dafür aus `zuordnen` herausgelöst — **und** die
Heldenkraft daneben, höchstens 5 % vom Stand im Werkzeug entfernt. Im Bericht kostet
eine falsche Zuordnung eine Zeile; hier kostet sie einem echten Spieler seinen Platz.

**Nach jedem Tipp zwei Gegenproben**: die Zeile selbst (steht noch derselbe Name da,
ist das Feld jetzt wie gewollt?) und die Zähler über der Liste (genau ±1 im angetippten
Topf). Passt eines nicht, bricht der Lauf sofort ab.

**Die Schrittfolge des Reiters wird nicht abgespielt.** Sie ist für die Hand gemacht und
hängt an einem Ist-Stand von vorhin. Der Dienst kennt nur das Ziel (`soll`) und den
Bildschirm — und läuft mehrfach durch die Liste, weil ein Zug in einen vollen Topf nicht
geht: die Ausschlüsse machen im ersten Durchgang Platz, der Rest folgt im nächsten.

**Der Ringtausch braucht denselben Aufbrecher wie die Schrittliste.** `A → AE` *und*
`AE → A` bei 20/20 und 10/10: kein Zug kann anfangen. Ein Wechsel innerhalb eines
Blattes wird am Stück gemacht (sonst stünde jemand nach einem Abbruch ganz ohne Platz
da) — und genau deshalb steckt der Ring. Erst wenn ein ganzer Durchgang nichts mehr
bewegt, darf **einer** nur abgemeldet werden und kommt im nächsten Durchgang wieder.
Gemessen in `pruefe_einstellen.py`: der kleinste Ringfall braucht vier produktive
Durchgänge, ein volles umgedrehtes Blatt drei.

**Die Blattbestätigung darf nur die Serverzeit vergleichen, nicht die europäische
wörtlich.** Am Gerätetest vom 16.09.2026 kam genau der dokumentierte Fehler aus
`ws-dienst-anmeldung.md` hoch: `18:00` (Serverzeit von Team B) wurde als `13:00`
gelesen — und `13:00` ist zufällig **wörtlich** Team As europäische Zeit. Die
Prüfung hatte anfangs denselben doppelten Vergleich wie die Gegenprobe in
`run.py` (`z == bz` zusätzlich zu `eu_zu_server(z) == bz`), und der wörtliche
Vergleich hätte das als „Blatt A bestätigt" durchgehen lassen — bei angefordertem
Team A und tatsächlich offenem B (die Umkehrung des beobachteten Falls) hätte der
Dienst auf das falsche Team getippt und es für richtig gehalten. In `run.py`
kostet derselbe Fehler nur eine falsche Zeile im Bericht; hier ist es das
Sicherheitstor vor jedem Tipp. Seither vergleicht `einstellen.py` ausschließlich
über die Serverzeit-Umrechnung — ohne einen passenden Treffer bricht der Lauf
ab, statt zu raten.

**Der Plan kommt aus dem Werkzeug, nicht aus Python.** `scripts/zuteilung_plan.mjs`
öffnet die gebaute App headless und drückt den Knopf des Reiters; der fertige Vorschlag
hängt dafür an `APP.zutVorschlag`. Die Rechnung in Python nachzubauen wäre eine zweite
Fassung derselben Entscheidung — sie liefe früher oder später anders als der Reiter, und
dann stellte der Dienst etwas anderes ein, als Ben auf dem Bildschirm sieht.

**Was bleibt: der Scroll-Hänger.** Der Dienst erbt ihn mit `roster.durchlauf` (siehe
`ws-dienst-anmeldung.md`) — und braucht das Scrollen jetzt mehrfach statt einmal. Ohne
`--schreiben` passiert nichts; `--max N` deckelt die Tipps.

## Der Vorschlag lebt nur im Modul

Nicht im Planungsstand. Er ist eine Rechnung auf Knopfdruck, keine gemeinsame Auskunft der
Allianz — läge er in `ws_planner_state`, stünde eine alte Berechnung wochenlang neben der
echten Einteilung und sähe aus wie sie. Ein Neuladen wirft ihn weg, und das ist richtig
so: die Grundlage (Anmeldung, Prio, Sterne) ändert sich stündlich.

Dieselbe Begründung wie beim VS-Gegner-Blick (`_vsBlick`, siehe `vs-duell.md`).

## Getestet

`tests/zuteilung.spec.js` — 41 Spieler, damit **beide** Listen überlaufen. Geprüft wird
nicht die Optik, sondern die Aussagen, an denen der Vorschlag hängt: dass die Plätze
aufgehen, dass die Regeln in der richtigen Reihenfolge greifen, dass ein Ersatz-Wunsch die
Rangfolge schlägt — und dass die Schrittliste **nie einen vollen Topf überläuft**, also im
Spiel überhaupt bedienbar ist.

Die ⛔-Prüfung misst seit dem 18.09.2026 **beide** Seiten in einem Test: `P20` (kein
Fixplatz) fliegt, `P02` (Fixplatz) bleibt und trägt die Marke sichtbar weiter. Nur eine
Hälfte zu prüfen hieße, die ausdrücklich getroffene Umkehrung zum Nebeneffekt verkommen zu
lassen. Daneben steht die Gegenprobe mit `fixedCount: 0` — ohne sie wäre nicht belegt, dass
der Regler überhaupt etwas tut.

**Beide neuen Tests sind gegengeprüft** (18.09.2026): mit der alten Logik — `abgemeldet`
ignoriert, `aussetzen` ohne die `!m.fest`-Bedingung — werden sie rot.

In `tests/anmeldung_raster.spec.js` steht jetzt je ein Spieler mit ⛔ und mit 🚫 in
derselben Liste, damit beide Badges gegen dasselbe Spaltenbudget gemessen werden. Der
Testaufbau prüft ausdrücklich, dass die Marken **da sind**: ohne sie hätte er ein Raster
aus leeren Zellen gemessen und wäre immer grün — und das feste Datum `2026-09-18` im
Fixtext hätte genau das nach einer Woche stillschweigend bewirkt. Es rechnet deshalb jetzt
den kommenden Freitag aus.

## Sessions

- `docs/sessions/2026-09-16-7f0c9d2c.md` — Anmeldeseite, Gruppen
- `docs/sessions/2026-09-09-204ac42c.md` — die Hand-Optimierung, aus der das Thema kommt
- Commit `f1f9cc3` — „Aufstellungsvorschlag headless aus der Logik des Werkzeugs"
