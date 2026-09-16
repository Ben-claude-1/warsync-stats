---
thema: Zuteilung — der Reiter „🧮 Verteilung": wer diesmal zuschaut
code: src/core/zuteilung.js, src/ui/zuteilung.js, tests/zuteilung.spec.js
migration: db/2026-09-16_ws_players_ersatz_wunsch.sql
stand: gebaut und gepusht (Stand 16.09.2026)
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

1. **Wer beim letzten Mal gefehlt hat, setzt aus** (⛔-Marke aus `ws_aussetzen`).
2. **Ein Stern schützt** — wer viel bringt, schaut nicht zu.
3. **Danach der Leistungsindex**; eine Prio-Marke zählt wie **ein halber Index**.
4. **Bei Gleichstand die Stärke.**

Verglichen wird **lexikografisch** (`schutz()` liefert `[stern, wert, kraft]`), damit die
Reihenfolge der Kriterien dieselbe ist wie in der Regelliste — und nicht in einer
gewichteten Summe verschwindet, die niemand mehr nachrechnen kann.

**Ein fehlender Index heißt „nicht gemessen", nicht „schlecht"** — er zählt als
Durchschnitt (1,0). Sonst flöge jeder Neuzugang zuerst.

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

## Der Vorschlag lebt nur im Modul

Nicht im Planungsstand. Er ist eine Rechnung auf Knopfdruck, keine gemeinsame Auskunft der
Allianz — läge er in `ws_planner_state`, stünde eine alte Berechnung wochenlang neben der
echten Einteilung und sähe aus wie sie. Ein Neuladen wirft ihn weg, und das ist richtig
so: die Grundlage (Anmeldung, Prio, Sterne) ändert sich stündlich.

Dieselbe Begründung wie beim VS-Gegner-Blick (`_vsBlick`, siehe `vs-duell.md`).

## Getestet

`tests/zuteilung.spec.js` — 41 Spieler, damit **beide** Listen überlaufen. Geprüft wird
nicht die Optik, sondern die vier Aussagen, an denen der Vorschlag hängt: dass die Plätze
aufgehen, dass die Regeln in der richtigen Reihenfolge greifen, dass ein Ersatz-Wunsch die
Rangfolge schlägt — und dass die Schrittliste **nie einen vollen Topf überläuft**, also im
Spiel überhaupt bedienbar ist.

## Sessions

- `docs/sessions/2026-09-16-7f0c9d2c.md` — Anmeldeseite, Gruppen
- `docs/sessions/2026-09-09-204ac42c.md` — die Hand-Optimierung, aus der das Thema kommt
- Commit `f1f9cc3` — „Aufstellungsvorschlag headless aus der Logik des Werkzeugs"
