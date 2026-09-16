---
thema: VS-Duell — Gegnerwahl im Werkzeug und der Wochenplan
code: src/ui/vs.js · Sicht lwa_allianz_liste · md/AllianceDuelVS.md
verwandt: lw-atlas, planungsstand-anwesenheit
---

# VS-Duell

## Der Gegner wird gewählt, nicht einprogrammiert

Seit 13.09.2026. Unter „VS-Duell" → „🎯" stehen zwei Auswahlfelder: erst der Server, dann
die Allianz. Vorher standen `VS_GEGNER_SERVER`/`VS_GEGNER_TAG` hart in `src/ui/vs.js`, und
jeder Gegnerwechsel — also jede Woche — war eine Code-Änderung samt Build.

**Der eingestellte Gegner gehört der Allianz, das Stöbern dem Gerät.** Wer der Gegner der
Woche ist, ist eine gemeinsame Auskunft und liegt deshalb im geteilten Planungsstand
(`ws_planner_state`, Schlüssel `vs`, in `PLANNER_KEYS`); setzen darf ihn nur
`canAccess('ws')`. Daneben darf jeder frei in fremden Servern und Allianzen blättern, ohne
die gemeinsame Wahl zu verstellen — dieser Blick lebt bewusst nur im Modul (`_vsBlick`) und
**nicht** im `localStorage`: ein vergessener Blick auf eine fremde Allianz stünde sonst
wochenlang da und sähe aus wie der Gegner. Ein Neuladen führt zurück auf das Eingestellte.

**Ist nichts eingestellt, steht dort kein Vorgabewert** — ein geratener Gegner wäre eine
Behauptung, die niemand aufgestellt hat. Der Reiter heißt dann „🎯 Gegner".

**Die Auswahlliste kommt aus der Sicht `lwa_allianz_liste`**, nicht aus `lwa_allianzen` —
Begründung und Quotenfalle stehen in `lw-atlas.md`. Nachzutragen ist nur das
Kontingent-teure Stück:
`scripts/lwatlas/sync.py --server 1655 --nur-allianz cult --schreiben`.

Getestet in `tests/vs_gegner.spec.js`. Der Test trägt **kein** Kürzel fest ein — der
Gegner wechselt wöchentlich, ein verdrahtetes `SDWE` wäre jeden Montag rot, ohne dass etwas
kaputt ist. Geprüft wird stattdessen, dass die Abfrage dem folgt, was die Karte über sich
behauptet, dass ein Blick nichts schreibt und dass ohne `canAccess('ws')` kein Setzen-Knopf
erscheint.

**Zur Bedienung:** der Knopf heißt „🎯 <TAG>", nicht „VS", und sitzt als vierter Reiter
neben „📊 Woche" / „🏆 Gesamt" / „📷 Hochladen" *innerhalb* des VS-Bereichs. Die
Standardansicht beim Öffnen ist „📊 Woche" — und die zeigt „Noch keine Daten", solange
diese Woche keine VS-Screenshots hochgeladen wurden. Das ist normal.

## Der Wochenplan

Steht vollständig, samt offizieller Punktequellen je Tag und Quellen, in
`md/AllianceDuelVS.md`. Ziel: **7,2 Mio Punkte pro Tag**.

**Sonntag (Reset):** Bis Montagmorgen 40 Radaraufgaben fertig angesammelt haben.
Sonntagabend alle Truppen zum Farmen raus, fertig **vor** dem Reset.

**Montag — Radar-Training**
- Rekrutierungs-Tickets synchron zur laufenden Wettrüsten-Kategorie verbrauchen
  (Faustregel: täglich 30 im Wettrüsten, Rest sparen)
- Helden-EXP nur bis zum Auffüllen der 7,2 Mio nutzen, Rest sparen — bei verfügbarem
  Drohnen-Upgrade dieses stattdessen nehmen

**Dienstag — Basis-Ausbau**
- Verpackte Gebäude (Baupakete) unter der Woche nur öffnen, wenn im Wettrüsten akut
  gebraucht — sonst bis heute sparen und synchron zur passenden Phase auspacken

**Mittwoch — Technologie-Zeitalter**
- Forschung nur mit Ehrenmedaillen (Tapferkeitsabzeichen) starten
- Alle Drohnen-Truhen öffnen
- Danach Beschleuniger einsetzen, bis 7,2 Mio erreicht sind

**Donnerstag — Helden-Training**
- Helden-Scherben verwenden, bis 7,2 Mio erreicht sind
- Helden-EXP sparen, nur in Push-Wochen einsetzen

**Freitag — Totale Mobilisierung**
- (die ganze Woche über) täglich etwas Ausbildungs-Beschleuniger fürs Wettrüsten nutzen,
  dabei Einheiten **niedriger als Level 10** ausbilden
- Am Freitag alle Einheiten aufs höchste Level hochstufen
- Gorilla nur bei Bedarf upgraden, sonst für Push-Wochen sparen

**Samstag — Enemy Buster**
- **Keine Angriffe auf stärkere VS-Gegner-Spieler** — der Gegner bekommt sonst mehr Punkte
  als man selbst
- **Kein Verteidigen** von Allianzmitgliedern gegen Spieler der VS-Gegner-Allianz
- Verabredung in Minen: gemeinsam mit Schild gefahrlos Punkte machen

## Sessions

- `docs/sessions/2026-09-13-41c351f9.md` — Wochenplan erstellt, Samstagsregeln ergänzt
- `docs/sessions/2026-09-12-73a19aae.md` — Gegner-Reiter mit Koordinaten, SDWE-Kader
