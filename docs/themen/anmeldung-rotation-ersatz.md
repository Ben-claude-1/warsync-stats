---
thema: Anmeldeliste, Rotation, Ersatz, Prioliste, Einsatz-Bilanz, Leistungsindex
code: src/ui/anmeldung.js, src/ui/prio.js, src/core/rotation.js, src/core/prio.js, src/core/leistung.js, src/core/aussetzen.js
tabellen: ws_priority, ws_participation, ws_aussetzen, ws_players.stern
verwandt: wuestensturm, schluchtsturm, ws-dienst-ergebnis, i18n-de-en
---

# Die Anmeldeliste und alles, was daneben steht

## Eine Zeile für beide Events

Wüstensturm und Schluchtsturm hatten zwei verschiedene Listen — CS eine schmale Zeile, WS
einen Block mit T1–T4, Wachstums-Prognose, Ø-Punkten und Anwesenheit seit Mai. Entschieden
wird an dieser Stelle aber in beiden Events dasselbe: **wer spielt.** Beide rendern
deshalb dieselbe Zeile aus `src/ui/anmeldung.js` (`anmeldeZeile`, `anmeldeBlock`);
getrennte Listen liefen sonst wieder auseinander.

Was verschieden bleibt, steckt in `ctx`: Team-Farben (WS blau/orange, CS grün/blau), die
Grenzen und der Name der Funktion hinter den Knöpfen (`setTeamAssign` bzw.
`csSetTeamAssign`).

**Sortiert wird nach der Gesamtkraft der Helden** (`nachHeldenkraft`), nicht mehr nach
`byRankThenHero`. Der Rang schob vorher die R5/R4 nach oben, unabhängig davon, was sie
mitbringen; beim Einteilen zählt die Stärke, nicht die Allianz-Position. `byRankThenHero`
gilt weiter dort, wo es um die Allianz selbst geht (Mitgliederliste, Allianz-Detail).

**Heldenkraft und T1 stehen nebeneinander.** Die eine Zahl sagt nichts über die andere:
171 Mio Heldenkraft bei 30 Mio T1 ist ein anderer Spieler als umgekehrt. Der Umschalter
„Verteilung nach" (T1 ↔ Heldenkraft) steuert nur noch das Auto-Verteilen.

Weggefallen sind im Wüstensturm T2–T4 samt Prognose, die Ø-Punkte, „Seit 08.05", das
Rang-Abzeichen und der ✕-Knopf; abgemeldet wird mit einem zweiten Klick auf den aktiven
Knopf. `regStats()` hing allein an dieser Zeile und ist mit ihr weg.

## Die fünf Werte

`REG_WERTE` in `src/core/rotation.js`, `teamAssign` wie `csTeamAssign`:

| Wert | Bedeutung | Grenze |
|---|---|---|
| `'A'` · `'B'` | gesetzt, steht in der Aufstellung | 20 je Team |
| `'AE'` · `'BE'` | als Ersatz eingeplant, bekommt kein Gebäude | 10 je Team |
| `'C'` | angemeldet, aber keiner der 30 Plätze | unbegrenzt |

Fünf Knöpfe je Zeile, alle über dasselbe `setTeamAssign` / `csSetTeamAssign`. `teamOf()`
beantwortet jede Frage nach dem Team; `'C'` hat keins und liefert `null`. Die
Ersatz-Markierung geht **vor** der Rotation aus dem Rennen — eine Ansage darf nicht daran
scheitern, dass jemand stark ist oder lange aussetzen musste.

**Die Grenze auf 20 + 10 sitzt in `regPlatzPruefen`, nicht an den Knöpfen.** Ohne sie
stünden 39 Anmeldungen auf „gesetzt" und es wäre hinterher nicht mehr zu erkennen, wer den
Platz tatsächlich hat. Ein voller Knopf wird ausgegraut, der Klick bringt zusätzlich eine
Meldung. `'C'` ist bewusst **nicht** begrenzt.

**Beim Laden dürfen `'AE'`/`'BE'`/`'C'` nicht zurückgebogen werden.** Genau das tat
`loadWSState` eine Zeit lang mit `'AE'`→`'A'`; heute wäre es das stille Löschen einer
Entscheidung. Beide Loader prüfen gegen `REG_WERTE`. Die Prüfung darf **nicht** über
`teamOf()` laufen — `'C'` hat kein Team und verschwände lautlos.

## Rotation

`computeRoster()` teilt in vier Gruppen: **fest** (die stärksten `fixedCount`, Standard
15), **Rotation-Haupt** (füllt auf 20 auf), **Ersatz**, **Warteliste**. Die
Rotationskriterien in dieser Reihenfolge: Wartezeit seit letztem Einsatz → Einsatzquote →
Zuverlässigkeit → Stärke.

**Der Pool sortiert erst nach Gruppe, dann nach Stärke** (`wsPoolSort` / `csPoolSort`).
Sonst nimmt ein starker Ersatzspieler einem gemeldeten die Schlüsselrolle weg — Silo im
Wüstensturm, Assassine im Schluchtsturm.

**Beim Anlegen einer Teilnahme-Zeile muss `substitute` mitgeschrieben werden** (`ddSave`,
`saveResult2`). `reliability()` rechnet über genau diese Spalte: ein nicht gebrauchter
Ersatzspieler ist kein Absager und gehört nicht in den Nenner. Bei fixiertem Kader stammt
das Kennzeichen aus dem Kader, nicht aus der aktuellen Einteilung.

## Ersatzspieler stehen unter der Karte — in beiden Events

Im Schluchtsturm als `SUBS`-Zeile im Fahrplan des Übersichtsbilds, im Wüstensturm als
eigener Streifen unter der Aufstellungs-Karte (`renderErsatz` / `ersatzBand`). **Beides
zählt: die Anzeige im Fenster und das PNG** — das Bild ist das, was in der Allianz
gepostet wird, und wer nur die Anzeige ergänzt, lässt genau dort die Ersatzbank weg.

- **Der Streifen hängt unter dem Bild, nicht darauf.** Die Höhe der Canvas muss vor dem
  ersten Strich feststehen — ein späteres `c.height=…` löscht die Zeichenfläche wieder.
- **Gerechnet wird aus `wsErsatzListe()`, nicht aus dem DOM** — sonst hinge das PNG wieder
  an der Anzeigebreite.
- **Canvas ist kein DOM**: die Beschriftung läuft über `trs()`. Im HTML daneben steht sie
  deutsch; dafür muss die Regel in `I18N_EN_RE` **vor** dem allgemeinen `\bErsatz\b`
  stehen.

Getestet in `tests/ws_karte_ersatz.spec.js`, `tests/ersatz_zeiten.spec.js`.

## Prioliste: wer beim nächsten Mal vorgezogen wird

39 Anmeldungen auf 30 Plätze. Damit es nicht Woche für Woche dieselben trifft, führt jede
Allianz einen Zähler in `ws_priority` (Migrationen `db/2026-09-01_ws_priority.sql`,
`db/2026-09-02_ws_priority_gemeinsam.sql`, `db/2026-09-03_ws_priority_gesamt.sql`).

| Beim Anmeldeschluss | Zähler |
|---|---|
| stand auf `'C'` | +1 |
| hatte einen der 30 Plätze | −1, nie unter 0 |
| war gar nicht angemeldet | unverändert — die Prio gilt nächste Woche weiter |

Angezeigt wird nur, wer über 0 steht.

**Ein Zähler, beide Events.** Wer sich in derselben Woche für beide meldet und beide Male
auf `'C'` landet, hat zweimal zugeschaut und steht mit einer 2 da. Mit getrennten Zählern
stünde er zweimal mit einer 1 in zwei Listen, und beide sähen harmlos aus.

**Die Liste schlägt vor, sie teilt nicht ein.** Sie ändert weder Rotation noch Aufstellung
— sie steht als ⭐-Marke neben dem Namen und als sortierte Tabelle im eigenen Reiter. Das
war ausdrücklich so gewollt: die Einteilung nach dem Anmeldeschluss um 04:00 soll niemand
mehr automatisch umbauen.

Vier Dinge, die zusammengehören:

- **Eigene Tabelle statt Auswertung von `ws_participation`.** Ein `'C'`-Spieler gehört zu
  keinem Team und damit zu keinem Event — es gibt keine Zeile, an die man ihn hängen
  könnte. Er bekommt bewusst **keine** Teilnahme-Zeile; Nebeneffekt: er zählt in
  `reliability()` nicht als Absager.
- **Verrechnet wird erst, wenn der Kader steht und neu geladen ist.** Vorher liefert
  `wsRosterGroups()` die Live-Vorschau statt des fixierten Kaders.
- **Zwei Stempel halten das idempotent**, `last_ws_date` und `last_cs_date`. Getrennt sein
  **müssen** sie, weil beide Anmeldeschlüsse auf denselben Tag fallen können — mit einer
  gemeinsamen Spalte blockierte der eine den anderen. `prioVerrechnen` holt die Tabelle
  **vor** dem Rechnen frisch. Bewusst ohne `catch`: mit einer leeren Liste weiterzurechnen
  hieße, jeden gewachsenen Zähler auf 1 zurückzusetzen. Der Preis: eine nach dem Schließen
  geänderte `'C'`-Liste wird nicht nachgetragen — dafür gibt es die `+`/`−`-Stepper, und
  die fassen die Stempel **nicht** an.
- **Für einen Zähler, der auf 0 bleibt, wird keine Zeile angelegt.**

**Zwei Zahlen, zwei Fragen.** `counter` ist die Warteschlange und fällt beim nächsten
Einsatz; `c_total` zählt **nur hoch**. Wer abwechselnd spielt und aussetzt, steht bei
`counter` dauernd bei 0 oder 1 — dass es über Monate immer dieselben trifft, sieht man erst
an der Gesamtsumme. Die Stepper fassen `c_total` nicht an: sie rücken jemanden in der
Warteschlange, sie schreiben die Vergangenheit nicht um.

## Einsatz-Bilanz

Wie oft jemand gesetzt (`'A'`/`'B'`) und wie oft als Ersatz (`'AE'`/`'BE'`) im Kader stand
— **je Event getrennt**, weil WS und CS zwei Verpflichtungen sind. A und B werden
zusammengefasst: welches Team jemand spielt, sagt über die Belastung nichts aus.

**Abgeleitet, nicht gezählt.** `einsatzBilanzAlle()` liest `ws_participation`
(`substitute`, `waitlisted`) mit `ws_events.mode` in *einem* Durchlauf über alle Zeilen.
Eine abgeleitete Zahl kann nicht auseinanderlaufen und gilt rückwirkend für alle Events in
der Datenbank. Für `'C'` geht das nicht — dort gibt es keine Teilnahme-Zeile, deshalb ist
`c_total` gespeichert.

Der eine Durchlauf ist Absicht: pro Spieler zu suchen wäre bei vierstellig vielen Zeilen
und vierzig Spielern spürbar. Aufrufer holen die Bilanz **einmal**.

Sichtbar an drei Stellen: Tabelle „Einsatz-Bilanz" unter der Warteschlange, Block
„Einteilung" im Profil-Overlay, Zeile „Bisher WS 5/1 · CS 2/0 · C 3" in der
Wüstensturm-Anmeldung. Die Zeile trägt bewusst **kein** `<strong>` in der Mitte: jedes
Element zerschneidet den Textknoten, und die Anzeigeschicht übersetzt je Knoten.

`ws_priority` gehört in `TENANT_TABLES`; `on_conflict` führt `'alliance_id,player_name'`.
Getestet in `tests/prioliste.spec.js`.

## Leistungsindex: wer aus seinem Konto etwas macht

Seit 14.09.2026. Marke `📈 1,99` — Einzelpunkte im Verhältnis zum **Median seines
Events** (`src/core/leistung.js`). 1,0 ist Durchschnitt.

**Je Event normiert, weil die Rohzahl nichts aussagt.** Am 11.09.2026 holte dieselbe
Stammbesetzung 1,99 statt 2,25 Mio Punkte — ein Rückgang, der am Gegner lag. Ungerechnet
stünde nach einem schweren Event die ganze Mannschaft schlechter da.

**Median statt Mittelwert.** In jedem Event steht einer weit oben (9,08 Mio gegen einen
Median von 0,91); gegen den Mittelwert fiele die halbe Mannschaft künstlich unter 1,0.

**Dass der Index trägt, ist gemessen.** Über die Freitage 04. und 11.09. liegt die
Korrelation zwischen zwei Wochen bei **0,82**, und 22 von 32 Spielern landen beide Male auf
derselben Seite des Durchschnitts. Zum Anlass: am 11.09. waren 23 der 55 Eingesetzten neu,
und sie holten 0,79 Mio gegen 1,99 Mio der Rückkehrer — bei nur 17 % weniger Heldenkraft.
Pro Einheit Kontostärke also das Doppelte; Stärke erklärt höchstens ein Viertel des
Abstands.

**Der Index misst Kills — deshalb steht die Eroberer-Marke daneben.** Die Gesamtpunktzahl
einer Kampfergebnis-Mail besteht zu **99,8 %** aus Killpunkten (Legolio am 04.09.:
4.741.524 gesamt, davon 4.731.518 Kills). Eroberungspunkte laufen in einer rund 230-mal
kleineren Währung — der Beste kam auf 20.610 — und verschwinden darin. GeneralBlücher
stand mit 0,74 im unteren Drittel und war trotzdem in **beiden** Team-A-Events der beste
Eroberer. Eine Aufschlüsselung je Spieler gibt die Mail nicht her; was sie hergibt, sind
die vier Kategorie-Besten je Event. Die stehen als `🏰 2×` **neben** dem Index — beide
Zahlen in eine zu pressen hieße, ein Umrechnungsverhältnis zu erfinden, das niemand kennt.

## Die Handmarke ⭐

`ws_players.stern` (Migration `db/2026-09-14_ws_players_stern.sql`): „bringt viel",
gesetzt von Hand per Klick (`sternUmschalten`, nur `canAccess('ws')`). Sie ersetzt den
Index nicht, sie ergänzt ihn — was jemand an Spielverständnis, Absprache und Eroberung
mitbringt, sieht der Mensch und nicht die Punktzahl. Am 14.09.2026 nannte Cocojamb elf
Namen im Allianz-Chat; **sieben** standen auch im Index oben, **vier** nicht. Genau diese
vier wären ohne Handmarke durchgefallen. Die elf sind vorbelegt.

Der Klick schreibt **erst in die Anzeige, dann in die Datenbank**, und nimmt die Marke bei
einem Fehler zurück. Ungesetzt erscheint der Stern nur für den, der ihn setzen darf.

**Der leere Stern darf zurückhaltend sein, aber nicht unsichtbar.** Bei 12 px und 22 %
Deckkraft war er das: Ben hat die Marke nach dem Einbau nicht gefunden und für fehlend
gehalten, und die Suche nach der Ursache ging erst durch Spalte, PostgREST,
Bundle-Stempel und Live-Stand — alles in Ordnung, der Schalter war nur nicht zu sehen.
**Ein Bedienelement, das man suchen muss, existiert für den Nutzer nicht.** Seit
15.09.2026: 15 px und 45 %.

Nicht zu verwechseln mit `⭐ Prio 3`: die trägt immer eine Zahl und ist violett, die
Handmarke ist ein blanker goldener Stern.

Getestet in `tests/leistungsindex.spec.js`. Der wichtigste Test ist der dritte: der
schwächste Spieler des Feldes trägt die Eroberer-Marke — fiele sie weg, sähe er aus wie
ein Totalausfall.

## Der Name schrumpft nicht mehr als Letzter

Alles rechts vom Namen trug `flex-shrink:0`, nachgeben konnte deshalb nur der Name. Am
Handy blieben ihm gemessene **22 px von 339 px**, also zwei Zeichen — gekürzt wurde
ausgerechnet das, wonach man sucht. Sichtbar wurde es erst, als die Zeile voll wurde
(sechster Knopf, dazu die Marken vom 14.09.); auf dem Desktop war nie etwas abgeschnitten.

Alles rechts vom Namen steht deshalb in **einem** Block, der als Ganzes umbricht:
`flex:1 1 140px` für den Namen, `flex:0 0 auto` für den Block. Desktop: beides nebeneinander
in 546 px (235 px für den Namen). Handy: der Block rutscht darunter, der Name bekommt die
vollen 339 px.

- **Kein fester Sockel für den rechten Block.** Mit `flex:1 1 300px` wächst er über seinen
  Inhalt hinaus, und die Differenz ist Totraum hinter den Knöpfen — dem Namen blieben
  190 px statt 235.
- **Keine Medienabfrage.** Das Stylesheet hat keine, und eine geratene Gerätebreite wäre
  die falsche Größe.

Getestet in `tests/anmeldung_liste.spec.js` und `tests/anmeldung_namen.spec.js` — der
zweite misst in **beiden** Fenstergrößen.

## Die Marken stehen in einem festen Raster

Seit 16.09.2026. Sie standen als Flex-Kette: fehlte eine, rückte jede folgende nach links.
Dieselbe Angabe stand damit in keinen zwei Zeilen an derselben Stelle — die Liste war nur
zu lesen, indem man jede Zeile einzeln entzifferte. Jede der sechs Marken hat deshalb
ihren festen Platz (`MARKEN_SLOTS`).

- **Eine fehlende Marke braucht eine leere Zelle.** In einem Grid füllt das erste Kind
  Spalte 1. Ein `''` erzeugt **kein** Element, die nächste Marke rutschte also in dessen
  Spalte. `MARKEN_SLOTS.map(…||'<span></span>')` ist der ganze Kniff.
- **Das Raster steht auf einer eigenen Zeile.** Gemessen braucht es 342 px; in der
  Namensspalte stünden am Desktop 235 px zur Verfügung. Die sechs Knöpfe, Stärke und
  Zuverlässigkeit belegen allein 275 px der 572 px. Preis: 16 px höhere Zeile je Spieler.
- **Die Breiten sind gemessen, nicht geraten**, mit je einem Pixel Reserve: `🏰 12×` 42,8 ·
  `📈 12,99` 52,4 · `⛔ Aussetzen ✕` 85,7 · `⭐ Prio 12` 58,1 · `Warteliste` 59,3. Am Handy
  stehen nur **339 px** zur Verfügung; ein erster Anlauf mit großzügigen Werten kam auf
  358 px und lief rechts aus der Zeile.
- **Nur die letzte Spalte darf nachgeben** (`minmax(0,60px)`). Die Rolle steht am Ende, ihr
  Kürzen verschiebt keine Position, und von ihren vier Werten braucht nur `Warteliste` die
  volle Breite — das Badge trägt `text-overflow:ellipsis`.

Getestet in `tests/anmeldung_raster.spec.js`, gegengeprüft: ohne die leeren Zellen rot, und
zwar in der Zeile, der die vorderen Marken fehlen. Er misst die x-Position jeder Marke in
**jeder** Zeile gegen die erste. Die zweite Prüfung („passt in die Zeile") wäre allein
wertlos, die erste ohne sie ebenso: sechs Nullspalten stünden auch „überall gleich".

## Sessions

- `docs/sessions/2026-08-28-9cd3d5fb.md` — Datenmodell Anmeldung/Rotation/Warteliste
- `docs/sessions/2026-08-30-40195abc.md` — `rotation.js`, Migration
- `docs/sessions/2026-08-31-e65440b8.md` — A·AE·B·BE
- `docs/sessions/2026-09-01-4c5ac963.md` — Prioritätszähler, Reiter „⭐ Prio"
- `docs/sessions/2026-09-02-578476a9.md` — Ersatzliste unter der Karte
- `docs/sessions/2026-09-02-bd644b96.md` — beide Anmeldungen gleich, nach Kraft sortiert
- `docs/sessions/2026-09-15-7a7c7080.md` — Name schrumpft nicht mehr, Stern sichtbarer
