---
thema: VS-Duell — Gegnerwahl, Wochenplan und die Punkte je Tag
code: src/ui/vs.js · src/core/vstage.js · src/ui/vstage.js · scripts/vs_service/ · Sicht lwa_allianz_liste · md/AllianceDuelVS.md
verwandt: lw-atlas, planungsstand-anwesenheit, ws-dienst-anmeldung, bluestacks-steuerung
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

## Die Punkte je Tag (seit 17.09.2026)

Das Ziel ist ein **Tagesziel**, und die Wochensumme beantwortet die Frage deshalb nicht:
43,2 Mio in der Woche können sechs ordentliche Tage sein oder zwei starke und vier leere.
Weil jeder Duelltag eine eigene Aufgabe hat (Montag Radar, Mittwoch Technologie …), ist
genau das die Auskunft — wer mittwochs nie liefert, hat ein Forschungsproblem und kein
Fleißproblem. `VS_TAGESZIEL` (7,2 Mio) steht deshalb in `src/core/config.js` vorn und
`VS_TARGET` ist daraus abgeleitet, nicht umgekehrt.

Tabellen: `vs_tage` (Spieler × Tag × Punkte) und `vs_tage_lauf` (was ein Lauf an dem Tag
gesehen hat), beide in `TENANT_TABLES`, Migration `db/2026-09-17_vs_tage.sql`. Angezeigt
unter „VS-Duell" → „📅 Tage" mit zwei Ansichten: das Wochenraster mit den Punkten selbst
und die Zählung **je Wochentag** über den ganzen Zeitraum.

**Drei Zustände, nicht zwei.** Ein Spieler ohne Eintrag hat entweder nichts geholt oder
ist nicht gelesen worden. Die Rangliste im Spiel endet bei **100 Zeilen**, und XP33 hat
genau 100 aktive Mitglieder — bei voller Liste sagt ein Fehlen also nichts. Nur wenn der
Lauf das Listenende erreicht hat **und** die Liste nicht voll war, ist „nicht angetreten"
belegt; dafür steht `vs_tage_lauf.gelesen` und `.vollstaendig` daneben. Ohne diese Zeile
würde die Auswertung Abwesende als Nuller behaupten.

**Der laufende Tag zählt nicht mit.** Wer heute um 10 Uhr 2 Mio hat, hat das Tagesziel
nicht verfehlt — er ist noch dabei. Maßgeblich ist die Serverzeit (vier Stunden zurück).
Die Punkte stehen trotzdem da, die Spalte ist mit „läuft" beschriftet.

Getestet in `tests/vs_tage.spec.js`, gegengeprüft: ohne die Ausnahme für den laufenden Tag
und mit „Fehlender gilt immer als Null" wird je genau der zuständige Test rot.

## Der Dienst, der sie liest

`scripts/vs_service/run.py` — Basis → Allianzduell → „Rang" → „Tagesrang" → Haken
**„Deine Allianz"** → je Tagesreiter die Liste durchscrollen.

```
.venv/bin/python -u -m scripts.vs_service.run              # lesen, Bericht
.venv/bin/python -u -m scripts.vs_service.run --schreiben  # und eintragen
.venv/bin/python -m scripts.vs_service.run --ordner <pfad> # aus Bildern neu rechnen
```

**Ein Lauf für die ganze Woche, spätestens Sonntag.** Die Reiter decken Mo–Sa ab und
werden Sonntag um 24:00 zurückgesetzt; eine vergangene Woche ist im Spiel nicht mehr
sichtbar. Ein täglicher Dienst ist dafür nicht nötig — ein versäumter Sonntag kostet
dagegen die ganze Woche.

**Diese Liste hängt nicht.** Gemessen am 17.09.2026 mit `pruefe_scroll.py`: 25 von 25
Rastungen haben gegriffen, Median 452 px bei 1290 px Fensterhöhe. Der Scroll-Hänger, an
dem der Wüstensturm-Dienst seit Wochen klemmt (`bluestacks-steuerung.md`), tritt hier
nicht auf. Jede Zeile wird rund dreimal gesehen.

**Der Rang ist der Schlüssel — aber die gelesene Ziffer ist es nicht.** Zusammengeführt
wird über den **Punktwert**: über 164 Rohzeilen war er in *allen* 50 Zeilen einstimmig,
während Namen zwischen drei Lesungen schwankten (`JG ASTRID OG` / `3G ASTRID 9G`) und
zweistellige Ränge die erste Ziffer verloren (29 und 44 kamen beide als `4` an). Der Rang
wird deshalb aus der Punktreihenfolge abgeleitet — absteigend sortiert ist die Bauart der
Liste — und die gelesene Ziffer dient nur als Gegenprobe: passen ≥ 85 % und trifft die
höchste Ziffer die Zeilenzahl, war die Liste vollständig.

Drei Dinge, die je einen halben Tag gekostet haben:

- **Die Spaltenüberschrift ist keine Zeile.** „Rang · Kommandant · Punkte" steht fest bei
  y≈506, und „Kommandant" liegt mitten in der Namensspalte. Mit einem Lesefenster ab
  y=480 wurde sie als Zeile gelesen, bekam die Punktzahl der ersten echten Zeile
  angehängt — und verschob jeden Rang darunter um eins.
- **Die eigene grüne Zeile bewegt sich nicht mit.** Sie hängt unten fest. Reichte das
  Messfenster der Vorlagensuche in sie hinein, bestand die Vorlage zur Hälfte aus
  unbeweglichem Bild, die Güte fiel unter die Schwelle und jeder Schritt galt als
  Stillstand. Gelesen wird bis y=1880, **gemessen** nur bis y=1840.
- **Beim Zurückscrollen taugt der untere Streifen nicht.** Er rutscht dabei aus dem Bild.
  `nach_oben` las das „nicht wiedererkannt" als „bin oben" und brach nach dem ersten
  Schritt ab; der Lauf las danach das Ende der *vorigen* Liste und hielt es für einen
  vollständigen Tag. `versatz(…, rueckwaerts=True)` nimmt deshalb den oberen Streifen.

**Die Schrittweite ist gemessen, nicht gewählt** (17.09.2026). Über drei volle Tage,
indem aus den gespeicherten Bildern nur jedes n-te genommen wurde — das ist exakt
dasselbe wie n-fach weiter zu scrollen:

| Schrittweite | Schritte/Tag | gefundene Zeilen | Gegenprobe |
|---|---|---|---|
| 452 px · 1,8 Zeilen | 57 | 99 / 100 | geht auf |
| **904 px · 3,6 Zeilen** | **29** | **99 / 100** | **geht auf** |
| 1356 px · 5,4 Zeilen | 19 | 93 / 94 | fällt durch |
| 1808 px · 7,1 Zeilen | 15 | 71 / 72 | fällt durch |

**Fünf Zeilen je Schritt verlieren sechs Spieler**, an allen drei Tagen gleich. Das ist
Geometrie und keine Einstellungsfrage: ins Fenster passen 5,1 Zeilen, die oberste und
unterste sind angeschnitten und liefern keine Punktzahl — vollständig lesbar sind je Bild
rund **vier**. Wer weiter springt, überspringt im Schnitt eine Zeile. Eingestellt sind
deshalb 904 px, und zwar als **zwei Rastungen in einer Geste** (`punkte` 24 statt 12, je
41 px) statt als eine größere: 41 px je Punkt ist das, was BlueStacks' Mausrad selbst
erzeugt.

**Ein Tag wird ersetzt, nicht ergänzt.** Die Tagesliste ist eine Momentaufnahme des
ganzen Tages; ein zweiter Lauf ist die bessere Fassung derselben Auskunft. Würde nur
zusammengeführt, blieben die Zeilen eines misslungenen Laufs für immer daneben stehen —
und sie sähen aus wie richtige.

**Zustände werden über Farbe gelesen, nicht über Text:** der Haken „Deine Allianz" am
Grünanteil (0,19 gesetzt gegen 0,00 leer), der gewählte Tagesreiter am Weißanteil
(0,83–0,88 gegen höchstens 0,08, auch auf dem Bild mit dem Aufleuchten nach dem Tippen).

## Umbenennungen fallen hier zuerst auf

Die Tagesliste ist der schärfste Kaderabgleich, den das Werkzeug hat: sie zeigt **alle**
Mitglieder mit Punkten, und die Allianz hat genau 100 Plätze. Am 17.09.2026 stand
`bonrow` in der Liste und in keinem Kader — und genau ein Kadername (`notCraidenAnymore`)
tauchte in keiner Liste auf. Am Dienstag und Mittwoch war die Liste mit **100 Zeilen
voll**, 99 zuzuordnen: für einen 101. Spieler ist kein Platz, also sind die beiden
dieselbe Person. Derselbe Mensch hieß davor schon `CraideN` (siehe `lw-atlas.md`).

Der Abgleich dafür ist eine Abfrage:

```sql
with aktiv as (select p.name from ws_players p join alliances a on a.id=p.alliance_id
               where a.tag='XP33' and p.active)
select name from aktiv where name not in (select player_name from vs_tage);
```

**`apdRename` fasste dabei nicht alle Tabellen an.** Die Liste im Quelltext stammte aus
einer Zeit mit fünf Tabellen; `ws_priority`, `ws_aussetzen` und `vs_tage` kamen später
dazu und standen nicht drin. Eine Umbenennung ließ dort Waisen zurück — C-Zähler,
Aussetzen-Marke und Tagespunkte hingen an einem Namen, den es nicht mehr gibt, und das
fällt erst Wochen später auf. Wer eine Tabelle mit `player_name` anlegt, trägt sie dort
nach; die vollständige Liste liefert
`select table_name from information_schema.columns where column_name='player_name'`.

## Sessions

- `docs/sessions/2026-09-13-41c351f9.md` — Wochenplan erstellt, Samstagsregeln ergänzt
- `docs/sessions/2026-09-12-73a19aae.md` — Gegner-Reiter mit Koordinaten, SDWE-Kader
