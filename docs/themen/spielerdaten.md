---
thema: Spielerdaten — Stärke-Verlauf, T1-Typ, Heldenkraft, Avatare, Umbenennen, Importe
code: src/ui/profil.js, src/ui/allianz.js, src/core/players.js · Tabellen ws_players, ws_player_history
verwandt: anmeldung-rotation-ersatz, mehrere-allianzen-rollen, lw-atlas, ws-dienst-anmeldung
---

# Spielerdaten

## Stärke-Verlauf

Jede Eintragung einer Stärke schreibt über `savePlayerHistory` **eine neue Zeile** in
`ws_player_history` (Zeitstempel `recorded_at` setzt die Datenbank) und aktualisiert
`ws_players.t1_updated_at` für die Veraltet-Anzeige. Überschrieben wird nichts — nur die
Korrektur eines Verlaufs-Eintrags (`APP.historyEditId`) patcht eine bestehende Zeile.

**Eine Zeile ist ein Schnappschuss aller bekannten Werte:** Felder, die gerade nicht
eingetragen wurden, übernimmt `savePlayerHistory` aus dem aktuellen Spielerstand. Deshalb
steht die Heldenkraft auch in Zeilen, in denen nur T1 geändert wurde.

Gezeichnet über `renderHistoryChart(name, modus)` mit zwei Modi (`HIST_MODI`), sichtbar in
Profil, Spieler-Overlay und Allianz-Detail:

| Modus | Felder | Achse |
|---|---|---|
| `truppen` | T1–T4 (stehen in Mio in der DB) | ab 0 |
| `helden` | `hero_power` (absolut, /1e6) | um die Werte herum |

Drei Dinge, die nicht wegoptimiert werden dürfen:

- **Getrennte Diagramme.** Truppen liegen bei 20–30 Mio, Helden bei 150–200 Mio. Auf einer
  Achse wären die Truppenlinien platt.
- **Die Helden-Achse beginnt nicht bei null.** Die Heldenkraft wächst um wenige Prozent im
  Monat — ab null wäre jede Entwicklung eine waagerechte Linie. Damit der Ausschnitt nicht
  täuscht, ist die Achse durchgehend beschriftet und `histDelta` nennt Zuwachs und Prozent
  im Klartext.
- **Jede Linie läuft nur über ihre eigenen Datenpunkte.** Vorher lief sie über alle
  Einträge — ein Eintrag ohne diesen Wert riss die Linie auf null herunter.

**Verlauf vollständig laden.** `loadData` holt `ws_player_history` über `sbGetAll` in
Blöcken; ein festes `limit=500` schnitt vorher still ab (Details in
`datenbank-backup.md`).

Heldenkraft wird in Mio eingetragen (`171,0`), absolut gespeichert (`171000000`) — im
Profil (`manHP`) und im Allianz-Detail (`apd-hp`, `canAccess('profile_edit')`). Im Profil
genügt die Heldenkraft allein; sie steht im Spiel auf einem anderen Bildschirm als die
Truppenstärke.

## T1-Typ: Tank, Air oder Missile

Die T1-Stärke allein sagt nicht, womit jemand marschiert — und für die Aufstellung ist
genau das die zweite Hälfte der Auskunft: 48 Mio Tank und 48 Mio Air gehören an
verschiedene Gebäude. `ws_players.t1_type` hält `'T'`/`'A'`/`'M'` (Migration
`db/2026-09-02_ws_players_t1_type.sql`), `T1_TYP` in `src/core/players.js` bildet den Code
auf Beschriftung, Symbol und Farbe ab.

Eingetragen an denselben drei Stellen wie die Stärken, jeweils neben T1: Profil
(`manT1Type`), Allianz-Detail (`apd-t1-type`), „Neuen Spieler anlegen" (`new-pl-t1type`).
Alle drei rendern **dasselbe** `t1TypSelect()` — getrennte Listen liefen sonst irgendwann
auseinander.

- **Kein Vorgabewert.** `NULL` heißt „unbekannt" und wird nirgends geraten. Ein Vorgabewert
  wäre eine Behauptung über einen Spieler, den nie jemand gefragt hat.
- **Ein leeres Auswahlfeld löscht.** Anders als bei Zahlenfeldern, wo leer „nicht angefasst"
  heißt, ist das Feld beim Rendern vorbelegt — die Auswahl von „– unbekannt" ist eine
  Entscheidung und muss durchgehen. Verglichen wird gegen den bisherigen Stand, nicht
  gegen `''`.
- **Der Typ ist kein Verlaufswert.** `savePlayerHistory` baut seine Zeile aus einer festen
  Feldliste; ein reiner Typwechsel legt keinen Verlaufs-Eintrag an. Eine Truppengattung ist
  eine Eigenschaft, keine Messreihe.
- **Ein reiner Typwechsel muss speicherbar sein.** `saveStrength` und `apdSaveManual`
  brechen sonst mit „Bitte mindestens einen Wert eingeben" ab.

Tank/Air/Missile bleiben auch auf Deutsch stehen — so heißen sie im Spiel. Übersetzt sind
nur „T1-Typ" und „– unbekannt". Getestet in `tests/t1_typ.spec.js`.

**Verteilung in XP33 (14.09.2026): 56 Tank, 19 Air, 8 Missile, 16 ohne Eintrag.** Diese
Zahl klemmt an zwei Stellen — beim Mischen der Typen je Gebäude und bei den
Codename-Bossen (Code 64 an Di/Fr trifft nur acht Leute).

## Importe

**62 XP33-Spieler am 02.09.2026** aus der Anmelde-Tabelle der Allianz (Google Sheet
`14Cs0OVv…`, acht Blätter von 31Jul bis 28Aug, als `db/2026-09-02_xp33_t1_import.sql`).
Der Typ war über alle Blätter widerspruchsfrei. Zwei Regeln, die beim nächsten Import
wieder gelten:

- **Namen nur normalisiert vergleichen** — ohne Leerzeichen, ohne Diakritika,
  kleingeschrieben. Roh verglichen fehlten 38 von 135 Namen; normalisiert waren es drei,
  und alle drei waren Zeichenverwechslungen (`lIBlackJackll` ↔ `IIBlackJackII`,
  `Vicky 1301` ↔ `Vicky13012`, `anyanakamura1` ↔ `ayanakamura1`).
- **Eine ältere Quelle überschreibt keinen neueren Messwert.** Cocojamb und Meister28 waren
  am 29.08. gemessen und blieben stehen. `t1_updated_at` bekam das Datum der **Quelle**
  (28.08.), nicht das des Imports — sonst behauptete die Veraltet-Anzeige eine Frische, die
  diese Zahlen nicht haben.

**AR1S-Rankings (20.08.2026):** `AR1S-Rankings.xlsx` als CSV exportiert und importiert —
94 Spieler aktualisiert, zwei neu, 96 Verlaufszeilen. Der Import beruhte auf den höheren
Werten der Excel-Datei gegenüber der Datenbank. Ränge und Rechte wurden **nicht**
automatisch angepasst.

**Heldenkraft-Massenupdate (06.09.2026):** `update_hero_power.py` hat 87 von 108
XP33-Spielern auf die aktuelle Gesamtkraft gebracht, 0 unplausible Sprünge (>50 %). Fünf
Spieler scheiterten zunächst an fehlendem URL-Encoding (`urllib.parse.quote`).

Seit 15.09.2026 pflegt der Anmelde-Scan die Heldenkraft nebenbei mit — siehe
`ws-dienst-anmeldung.md`.

## Basis-Level, Geschlecht, Avatare

Am 31.07.2026 wurden 99 Basis-Level-Werte und Geschlechtsinformationen aus Screenshots
extrahiert; zwei neue Spalten `ws_players.level` und `ws_players.gender` (mit
CHECK-Constraint). Avatare werden als gerundete Quadrate angezeigt, passend zur Größe und
Rahmenverzierung.

## Umbenennen

Im Spieler-Edit-Dialog gibt es ein **Spielername**-Feld mit **✎ Umbenennen**. Der Name
wird in `ws_players`, `ws_player_history`, `ws_participation`, `vs_entries` und im lokalen
WS-State (Lineup, Anmeldung, Gebäude-Zuweisung) konsistent aktualisiert.

**Umbenennungen sind der Grund, warum der Name kein Schlüssel ist.** Beim ersten
Kaderabgleich gegen LW Atlas war die **Hälfte** der vermeintlichen Abgänge eine
Umbenennung mit Sonderzeichen (`CraideN` → `notCraidenAnymore`, `SINNER` → `ꜱɪɴɴᴇʀ`,
`ERZAN` → `ΞRζλη`). In der Ergebnis-Mail stehen umbenannte Spieler unter dem Namen, der
zum Kampf galt — dafür gibt es `--alias ALT=NEU`.

`ws_players` hat **keine** `player_uid`-Spalte. Solange das so ist, bleibt jeder
automatische Kaderabgleich Schätzung.

## Kaderabgleich gegen den Server (23.09.2026)

**Belegt wird über die `player_uid`, und zwar zwischen zwei Ständen derselben Quelle.**
Ein einzelner Atlas-Lauf sagt nur, wer *heute* da ist; erst der Vergleich eines alten
Mitglieder-Abzugs (`~/.local/state/warsync/lwatlas/members_XP33.json`, 12.09.) mit dem
frischen Lauf trennt Umbenennung von Abgang. Von vier Umbenennungen waren **drei** ohne
Uid nicht zu erkennen — `小木瓜lemon` → `lemon小木瓜` dreht nur die Reihenfolge und
überlebt keine Namensnormalisierung, `senasinasona` → `skyluna` und
`notCraidenAnymore` → `bonrow` haben kein gemeinsames Zeichen. Umgekehrt sahen
`Ðeprecated` (124,9 M) neben `Martoxen` (121,8 M) und `ZoeNox` (93,4 M) neben `bestbrudi`
(87,5 M) wie Umbenennungen aus und waren keine: dieselben Uids standen am 12.09. in
**kiSS** und **GunZ**.

**Ein Abgang ist erst belegt, wenn man weiß, wo der Mensch jetzt steht.** Der frische
Lauf fand `Martoxen` als R1 in **ZOMG** und `bestbrudi` in **AR1S** — `Bonfooyage` und
`lKaizerl` stehen auf #1668 überhaupt nicht mehr. Das ist die Auskunft, die die
Namenssuche im Spiel nicht geben kann.

**Ein Atlas-Lauf trägt sein eigenes Scandatum — „soeben geholt" heißt nicht „soeben
gesehen".** `lwa_spieler.updated_at` sagt, wann *wir* abgefragt haben;
`lwa_allianzen.gescannt_at` (das `lastUpdatedAt` der API), wann *LW Atlas* den Server
gesehen hat. Am 23.09.2026 lagen dazwischen **13 Stunden**: abgerufen um 07:55, gescannt
am 22.09. um 18:49 — und damit knapp **sechs Stunden älter** als die Namenssuche im Spiel
aus derselben Nacht.

Genau daran ist ein Abgleich gescheitert, und zwar in die teurere Richtung: `bonrow` fand
die Suche im Spiel nicht, er wurde stillgelegt, und der Atlas-Lauf am Morgen führte ihn
noch als Mitglied. Daraus wurde „die Suche hat ihn übersehen" — falsch. Er war zum
Scanzeitpunkt noch da und ist danach gegangen; im Spiel gibt es ihn nicht mehr. Die
Reihenfolge der Quellen ist damit umgekehrt zur Reihenfolge des Abrufs.

**Wer zwei Quellen gegeneinander hält, vergleicht ihre Scanzeiten, nicht ihre
Abrufzeiten.** Und die einzige Quelle, die den Jetzt-Zustand kennt, ist die
Mitgliederliste **im Spiel**. Der Atlas ist der bessere Beleg für *Umbenennungen* (er
trägt die `player_uid`) und für die Frage, *wohin* jemand gewechselt ist — nicht für die
Frage, ob jemand in dieser Minute noch dabei ist.

**Ein Rangwechsel versteckt sich hinter einer gleich großen Rang-Gruppe.** `Tony mont ana`
war im Werkzeug R3 und im Spiel R4; die Kopfzahlen stimmten trotzdem, weil die
Namensdifferenz null war. Gefunden nur über einen ausdrücklichen Vergleich Rang gegen
Rang. Derselbe Fall erklärte auch die vermeintliche Lücke „ein R3-Mitglied zu viel" — das
wirklich fehlende Mitglied hieß `I54I` und stand erst im Lauf vom 23.09. da.

**Kraft aus dem Atlas ist nicht Heldenkraft.** `power` ist die Gesamtkraft des Kontos; über
acht Spieler gemessen liegen zwischen ihr und `hero_power` 191 bis 234 Mio, ohne festes
Verhältnis. Ein neuer Spieler bekommt deshalb `hero_power` NULL und den Wert beim nächsten
Anmelde-Scan, statt eine gerechnete Zahl.

**Zwei Namensunterschiede sind Absicht und bleiben stehen:** `Ben_the_men` (im Spiel
`Ben the men`) ist der Anmeldename, und `H A N A N` steht im Spiel mit vier Leerzeichen.
Beide fängt die normalisierte Namensprüfung ab.

**Wer am Kader per SQL arbeitet, muss drei Stellen bedienen** — deshalb steht in
`apdRename` der Kommentar, dass die Tabellenliste vollständig zu halten ist:

1. die 13 Tabellen mit `player_name` (Abfrage steht im Kommentar in `apdRename`),
2. `ws_players` selbst,
3. **den geteilten Planungsstand.** In `ws` und `cs` stehen Namen sowohl als Listenelement
   (`lineupA.z2`, `csPlanA`) als auch als Objektschlüssel (`teamAssign`, `bldAssign`,
   `bldAssignPh2`). Ein rekursiver Durchlauf über beide Formen ist die einzige Fassung,
   die nichts übersieht; `savedAt` gehört dabei hochgesetzt, sonst gewinnt ein offener
   Browser-Tab mit seinem älteren Stand zurück.

Dabei fiel auf, dass `apdRename` die später dazugekommenen `ws_abmeldung` und
`ws_player_heroes` nicht anfasste — dieselbe Falle wie bei `ws_priority`, `ws_aussetzen`
und `vs_tage`.

## Passwörter

Als Hash gespeichert (`password_hash` in `ws_players`), nicht zurücklesbar. Ein vergessenes
Passwort kann der Super-Admin neu setzen.

## Was in der Allianzliste steht

T1–T3 sind aus der Mitgliederliste entfernt; angezeigt wird nur die Gesamtkraft der Helden
(20.08.2026). Zusätzlich gibt es Sortier-Knöpfe **📈 ∅ Wachstum** sowie **📈 T1** bis
**📈 T4** — absteigend nach Wachstumsrate der jeweiligen Truppe.

## Helden-Besetzung je Truppe (seit 20.09.2026)

Welcher Held (Name) in welchem der 5 Plätze einer der vier Truppen (T1–T4) steht.
`ws_player_heroes` (Migration `db/2026-09-20_ws_player_heroes.sql`, in `TENANT_TABLES`,
Primärschlüssel `alliance_id,player_name,truppe,slot`) trägt `held` und einen mitgeführten
`typ` (T/A/M) — geschrieben aus dem serverweiten Katalog `lw_helden`
(`db/2026-09-20_lw_helden.sql`, **nicht** in `TENANT_TABLES`: ein Held heißt in jeder
Allianz gleich, eine Kopie je Allianz liefe nur auseinander).

**Der Heldenname lässt sich aus dem Truppen-Screenshot nicht automatisch lesen.** Anders
als bei T1–T4 (vier Zahlen, ein VLM-Aufruf reicht) zeigt der Bildschirm pro Truppe nur
Portraits ohne Text — der Typ (Tank/Air/Missile) steht zwar als Icon neben „Lv.XXX" und
ist damit leicht zu lesen, der Name dahinter nicht. Eine Portrait-Referenzbibliothek wäre
nötig (Last War hat 31 Season-6-Helden) und fremde Bilddatenbanken sind kaum zu bekommen
(Fandom-Wiki/Google blocken). Eingabe ist deshalb bewusst **Handarbeit**: `heldSelect()`
(`src/core/helden.js`) baut ein Auswahlfeld je Platz aus dem Katalog, im Profil unter
„🦸 Helden-Besetzung" (`src/ui/profil.js`).

**Der Original-Screenshot verschwindet aus dem Anhang-Zwischenspeicher**, bevor eine
Auswertung fertig ist — nach rund 30–45 Minuten war er weg, ein Pixelvergleich danach
nicht mehr möglich. Ersatz war die **Helden-Sammelübersicht** (Bildschirm mit allen
eigenen Helden, je einem Truppen-Abzeichen 1–4 oben rechts): bessere Quelle als der
Truppen-Bildschirm selbst, weil sie eindeutig 5 Helden je Truppe zeigt statt einer aus der
Erinnerung rekonstruierten Gruppierung. Eine lokale HTML-Seite
(`.tmp/helden_zuordnung/`, Wegwerf-Server auf Port 8850, siehe `PORTS.md`) zeigte
zugeschnittene Portraits mit Dropdown zur Namenszuordnung durchs Handy — **Kopieren aus
dem Textfeld scheiterte am Handy-Browser**, gelöst über einen Knopf, der das Ergebnis per
`POST /submit` direkt in eine Datei schreibt statt über die Zwischenablage zu gehen.

**Cross-Check bestätigte die Zuordnung, ohne dass er geplant war:** die Typ-Zählung aus
den Icons des (später verschwundenen) Original-Screenshots deckte sich in allen vier
Truppen exakt mit der Typ-Zählung aus den benannten Helden (z. B. Truppe 3: „3× Missile,
2× Tank" aus beiden Quellen unabhängig).

Automatische Typ-Erkennung übers Icon (Vorbild: Team-Abzeichen-Templates in
`scripts/ws_service/roster.py`) ist **bewusst vertagt**, nicht gebaut — ohne einen frischen
echten Truppen-Screenshot zum Kalibrieren wäre das ungetestete Behauptung statt Messung.

Getestet in `tests/helden_besetzung.spec.js`.

## Sessions

- `docs/sessions/2026-05-06-9255a5bd.md` — Umbenennen, Wachstums-Sortierung (146 Turns)
- `docs/sessions/2026-07-31-8141347a.md` — Level, Geschlecht, Avatare
- `docs/sessions/2026-08-20-ae0aafc4.md` — AR1S-Rankings-Import
- `docs/sessions/2026-08-20-c21928d1.md` — T1–T3 ausgeblendet
- `docs/sessions/2026-08-11-0b1baaa7.md` — Helden-Verlauf als eigenes Diagramm
- `docs/sessions/2026-09-02-04461291.md` — T1-Typ-Integration, 62 Spieler importiert
- `docs/sessions/2026-09-06-9ecfa6fb.md` — Heldenkraft für 87 Spieler
- `docs/sessions/2026-09-08-c132e9fc.md` — OCR-Analyse für Truppenstärke aktiviert
