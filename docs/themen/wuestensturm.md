---
thema: Wüstensturm — Aufstellung, Gebäude, Assassinen, Anmeldeschluss
code: src/ui/ws.js, src/ui/buildings.js, src/ui/vs.js, src/ui/karte.js, src/ui/wsmap.js, src/core/state.js, src/core/rotation.js
verwandt: anmeldung-rotation-ersatz, schluchtsturm, ws-dienst-anmeldung, ws-dienst-ergebnis, png-export-karten
---

# Wüstensturm

## Rahmen

Freitags, zwei Teams (A und B) mit je 20 Hauptplätzen plus bis zu 10 Ersatzplätzen.
Mögliche Zeiten 13:00 · 22:00 · 03:00 (`WS_ZEITEN`), Vorgabe A 13:00 · B 22:00. Die Zeit
hängt **am Team**, nicht am Event. Serverzeit liegt vier Stunden zurück
(`SERVER_DIFF_H`), deshalb steht in Aufstellung, Mail und jedem Bild **beides** —
`zeitLang('16:00')` → `'16:00 EU · 12:00 Server'`.

Uhrzeiten werden als `'HH:MM'` geführt, nicht als `Date`: gemeint ist die Zeit im Spiel,
nicht die des Geräts — sonst zöge die Sommerzeit sie mit.

`setWsZeit` schreibt zusätzlich `ws_events.time_slot` des kommenden Freitags mit.
Vergangene Events bleiben unberührt — dort gilt, wann tatsächlich gespielt wurde. Ein
Wochen-Reset lässt die Zeiten stehen.

## Anmeldeschluss und fixierter Kader

**Donnerstag 04:00 Ortszeit.** Ab dann steht der Kader fest: die eingeteilten Spieler
stehen als `ws_participation`-Zeilen (`registered=true`, `played=false`) am
Freitags-Event und ändern sich nicht mehr, egal wer danach an der Aufstellung schiebt.

Der Schnitt läuft **im Browser beim Laden** (`wsRosterCheck` aus `loadData`), nicht als
Serverdienst — also beim ersten Seitenaufruf nach 04:00, nur mit `canAccess('ws')`.

Drei Regeln, die nicht wegoptimiert werden dürfen:

- **Erst sperren, dann schreiben.** Die Sperre ist ein bedingter PATCH auf
  `ws_events.roster_locked_at` mit Filter `roster_locked_at=is.null`. Laden zwei Geräte
  gleichzeitig, bekommt genau eines eine Zeile zurück. Andersherum würden beide den Kader
  schreiben und erst danach merken, dass sie zu spät sind.
- **Ein leerer Kader wird nie fixiert.** Sonst sperrt ausgerechnet das Gerät, das die
  Einteilung noch nicht geladen hat, das Event mit null Spielern zu.
- **Scheitert das Schreiben, wird die Sperre zurückgenommen.** Sonst stünde das Event als
  fixiert da, ohne Kader, und niemand käme mehr heran.

**Die Ergebnis-Wege dürfen den Kader nicht überschreiben.** `saveResult2` hat früher alle
Teilnahme-Zeilen gelöscht und neu geschrieben, wobei `registered` aus der *aktuellen*
Aufstellung abgeleitet wurde — wer nach dem Anmeldeschluss aus der Aufstellung flog, galt
rückwirkend als nie angemeldet. Jetzt werden Zeilen aktualisiert statt ersetzt, und bei
fixiertem Kader bleibt `registered` unangetastet. `ddPlayerTableHtml` füllt bei fixiertem
Kader ebenfalls nicht mehr aus `getLineup()` auf.

`ws_events` hat einen Unique-Index auf `(event_date, team)`, `ws_participation` einen auf
`(event_id, player_name)`. Ohne die kamen Dubletten: `ensureWeeklyEvents` prüft nur den
lokal geladenen Stand, weshalb am 31.07. sieben Event-Paare für denselben Freitag
entstanden (Migration `db/2026-08-07_ws_event_unique.sql`).

## Assassinen halten kein Gebäude

Bis zur Öffnung des Silos um Min 10:00 bewegen sich die Assassinen frei und nullen Gegner
— sie haben **keine feste Zuordnung**. Vorher standen sie als Stärkste vorn im Pool und
bekamen von `autoAssign` denselben Phase-1-Gebäudeplatz wie alle anderen; die Ansage
behauptete damit eine Stellung, die im Spiel niemand hält, und das Gebäude galt als
besetzt, obwohl niemand dort blieb.

Der Schnitt sitzt in `autoAssign` (`src/ui/buildings.js`): die Slot-Folge `slotSeqE` wird
erst **hinter** den Assassinen abgezählt (`bldPool = ph1.slice(assN)`). Die wichtigsten
Gebäude gehen damit an Arsenal und Söldner, die sie ab Min 10 räumen — `z5Count` zählt
deshalb nur noch diese beiden.

- **Assassine und Gebäude schließen sich aus.** Wer im Rollen-Slot `ass` landet, verliert
  `bldAssign`/`bldAssignPh2`; wer von dort auf ein Gebäude gezogen wird, ist keiner mehr
  und wird Zonen-Spieler (`moveChip` führt `ass` bewusst nicht mehr in `_actualRole`).
- **Sie stehen unter der Karte, nicht darauf** — wie der Ersatz. In Phase 1 fehlen sie in
  jeder Zone, deshalb tragen der Streifen unter dem Kartenbild (`renderWSMapSvg`), der
  Kasten unter den Zonen-Karten (`wsZoneCards`), die Canvas-Karte (`_buildWSCardsCanvas`)
  und der Block `⚔ ASSASSINEN` in der Mail sie nach. Ohne das fehlten die stärksten
  Spieler im geposteten Phase-1-Bild vollständig.
- **Die Höhe des Streifens muss vor dem ersten Strich feststehen** (`assH`) — im SVG geht
  sie in die viewBox.
- **In Phase 2 ändert sich nichts** — ab Min 10:00 stehen sie in der Z5-Spalte am Silo,
  der Streifen entfällt.

Getestet in `tests/ws_assassinen.spec.js` (12 Fälle, inkl. Gegenprobe, dass Arsenal und
Söldner sehr wohl ein Gebäude halten).

## Gebäude-Reihenfolge und Slots: eine Vorgabe, nicht drei

Die Reihenfolge in „📋 Gebäude-Strategie" entscheidet, welches Gebäude die stärksten
Spieler bekommt — `autoAssign` zählt die Slot-Folge in genau dieser Reihenfolge ab. Sie
stand als Literal an **drei** Stellen (`src/core/state.js`, `moveBldPrio`,
`renderStrategyCard`); drei Kopien laufen auseinander, und dann zeigt die Karte eine
andere Reihenfolge, als das Verschieben zugrunde legt. Heute nur noch
`BLD_ORDER_DEFAULT` / `bldSlotsDefault()` in `src/core/state.js`.

Vorgabe seit 03.09.2026 ist der Stand, den XP33 eingestellt hatte: **Silo zuerst** (80/s,
ab Min 10 das wertvollste Einzelgebäude), dann die beiden Ölraffinerien, dann die
Lazarette; Arsenal und Söldnerfabrik hinten und mit `0` Slots, weil Assassinen und
Sammler Phase 2 abdecken. Team B hält die Ölraffinerien mit vier statt zwei Plätzen — die
Slots sind Kapazität, kein Sollwert, und die Asymmetrie ist gewollt.

- **Kopieren, nicht durchreichen.** `changeBldSlot` schreibt mit `bs[key]=…` direkt in das
  Objekt, das `getBldSlots` liefert. Käme dort die Vorgabe selbst heraus, veränderte ein
  Klick auf `+` den Standard für beide Teams und jede weitere Allianz. Deshalb
  `Object.freeze` auf der Liste und eine **Funktion** für die Slots.
- **„↺ Standard" setzt nur die Reihenfolge zurück**, nicht Slots, Aufstellung oder
  Einteilung. Fragt vorher nach (zwölf Gebäude von Hand zu sortieren ist Arbeit), bei
  gültigem Standard ausgegraut. Der Wochen-Reset (`resetWSAnmeldung`) fasst die
  Reihenfolge weiterhin **nicht** an — die andere Allianz hat ihre eigene.
- **Ein gekürzter Stand zählt als keiner.** `bldOrder()` nimmt einen gespeicherten Wert
  erst ab zwölf Einträgen; sonst verschwänden Gebäude aus der Karte, ohne dass sie jemand
  entfernt hätte.

Die Rückfrage läuft über den `trs()`-Umweg um `window.confirm`, und die Anzeigeschicht
faltet jeden Zeilenumbruch zu einem Leerzeichen — der Schlüssel in `I18N_EN` darf deshalb
**kein** `\n` enthalten. Getestet in `tests/ws_gebaeude_standard.spec.js`.

## Gemischte T1-Typen je Gebäude

Seit 14.09.2026. „When making the teams for each building, try to have mix types — avoid
only tanks." (Cocojamb). Ein Gebäude, an dem nur Tanks stehen, fällt gegen den passenden
Konter geschlossen um. `autoAssign` verteilte bis dahin stur Index für Index und kannte
`t1_type` gar nicht.

**Umsortiert wird nur innerhalb einer Runde der Slot-Folge** (`typenMischen` in
`src/core/rotation.js`). Die Folge ist reihum gebaut: erst bekommt jedes Gebäude seinen
ersten Platz, dann jedes seinen zweiten. Wer in derselben Runde steht, ist gleich stark
eingestuft — sie untereinander zu tauschen ändert die Stärke-Leiter nicht. Über
Rundengrenzen hinweg zu tauschen hieße, einen Schwächeren auf ein wichtigeres Gebäude zu
setzen; das ist eine andere Entscheidung.

**Ein T/A/M-Trio je Gebäude geht rechnerisch nicht auf.** XP33 hatte am 14.09.2026 **56
Tanks, 19 Air und 8 Missile** (16 ohne Eintrag). Ziel ist deshalb nicht „überall alle
drei", sondern „den seltenen Typ dorthin, wo er noch fehlt". Über einen echten
Verteilungslauf kam kein einziges sortenreines Gebäude heraus.

**Unbekannter Typ zählt als halb vertreten** — besser als eine Dopplung, schlechter als
ein Typ, der dem Gebäude noch ganz fehlt. Sonst zöge ein Spieler ohne Eintrag jede Runde
den Platz, der einem bekannten Typ mehr nützt.

Getestet in `tests/ws_typen_mischen.spec.js`, gegengeprüft (mit der alten Zuteilung rot).

## Das Desaster vom 06.08.2026 — warum jeder eingeteilt wird

Team A fehlten 3 Spieler mit 285,0 Mio Heldenkraft, Team B 10 mit 966,8 Mio, zusammen
über 1,25 Mrd. Daraus wurde die Entscheidung: **alle werden eingeteilt, samt Ersatz**,
damit jeder die Chance auf die besten Belohnungen hat. Die Gegenleistung ist
Verlässlichkeit — wer zu oft fehlt, bleibt zeitweise draußen. Aus dieser Logik stammen
`reliability()`, die Prioliste und das Aussetzen nach einem Fehlen.

Nebenbei ein harter Rahmen: **Allianz-Mails sind auf 500 Zeichen begrenzt.** Ein Text mit
exakt 500 ist auf Kante — zählt das Spiel Zeilenumbrüche als `\r\n`, wird abgeschnitten.
495 ist die sichere Obergrenze.

## Aufstellung nach Regel prüfen, nicht nach Vorschlag

Bei der Optimierung am 09.09.2026 war die **Reihenfolge der Klicks zwingend**, weil A und
AE abwechselnd voll sind — die Züge greifen ineinander, und eine übersprungene Zeile
blockiert die nächste. Geprüft wurde anschließend gegen die Regel selbst, nicht gegen den
eigenen Vorschlag: die stärksten 15 haben einen festen Platz, niemand ohne Platz war noch
nie dabei, kein Prio-Spieler ohne Platz, alle fünf Rotationsplätze an ⭐1-Spieler.

## Sessions

- `docs/sessions/2026-08-06-b98154ee.md` — das Desaster, 500-Zeichen-Grenze
- `docs/sessions/2026-08-30-40195abc.md` — Rotation, `src/core/rotation.js`
- `docs/sessions/2026-09-02-bd644b96.md` — Assassinen ohne Gebäude
- `docs/sessions/2026-09-09-204ac42c.md` — Aufstellung Team A/B regelkonform machen
- `docs/sessions/2026-05-06-9255a5bd.md` — Umbenennen, Wachstums-Sortierung (146 Turns)
