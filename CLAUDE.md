# WarSync Stats — Workflow-Regeln

Diese Regeln gelten für jede Session in diesem Repo. Bei Verstoß bricht der Pre-Push-Hook automatisch ab.

## Aufbau: Module unter `src/`, gebaut nach `dist/`

`index.html` ist bewusst leer (14 Zeilen) — nur Kopfdaten, `<div id="app">`, das Stylesheet
und `<script type="module" src="dist/main.js">`. **Dort wird nichts einprogrammiert.**

```
src/core/    Logik ohne DOM-Ausgabe: config, api, auth, state, i18n, helpers,
             players, hive, png, tenant, alliance  →  das Wiederverwendbare
src/ui/      je Bereich eine Datei: ws, cs, vs, allianz, admin, hive, karte, …
src/app/     shell, render, init, globals
src/main.js  Einstiegspunkt
src/styles.css
```

**Nach jeder Änderung an `src/` bauen:** `npm run build` (esbuild, ~10 ms). Ohne den
Build ändert sich live nichts — `dist/main.js` ist das, was ausgeliefert wird, und
liegt deshalb mit im Git. `npm run watch` baut bei jedem Speichern.

**`index.html` wird beim Bauen gestempelt.** `scripts/stamp_assets.mjs` hängt an
`dist/main.js` und `src/styles.css` den Inhalts-Hash an (`?v=91ba0045`) und läuft
automatisch hinter `npm run build`. Ohne das blieb ein Gerät nach einem Deploy auf
dem alten Bundle hängen — GitHub Pages liefert dieselbe URL, der Browser holt sie
nicht neu. Am 27.08.2026 kam daher beim Anlegen eines Spielers
`null value in column "alliance_id"`: der zwischengespeicherte Bundle stammte von
vor dem Multi-Allianz-Umbau. Die geänderte `index.html` gehört mit in den Commit;
`npm run watch` stempelt nicht (im Entwicklungs-Browser hilft „Cache deaktivieren").

**`src/app/globals.js` ist erzeugt, nicht handgepflegt.** Die Inline-Handler im
gerenderten HTML (`onclick="nav('home')"`) rufen über den globalen Namensraum auf, den
es nach dem Bundeln nicht mehr gibt. Die Datei legt genau die dort benutzten Namen
zurück auf `window`. **Wer eine neue Funktion aus einem `onclick` heraus aufruft, muss
sie dort ergänzen** — sonst kommt erst beim Klick „is not a function".

Ein Symbol gehört genau einem Modul. Zwei Modulvariablen (`_vsResultData`,
`_karteBgPulled`) wurden beim Umbau dorthin verschoben, wo sie beschrieben werden:
ES-Module lassen Zuweisungen an Importe nicht zu, das bricht sonst den Build.

`scripts/split_modules.py` hat die Aufteilung einmalig aus der alten einteiligen
`index.html` erzeugt. Es ist Beleg, kein Werkzeug für den Alltag — die Quelle ist
jetzt `src/`.

## Nur auf `main` arbeiten

- `main` ist die einzige aktive Branch und liegt 1:1 auf GitHub Pages live.
- `master` ist eingefroren als Backup eines früheren WIP-Stands. **Nicht mehr darauf arbeiten oder hin-mergen.**
- Falls Feature-Branch nötig: `git checkout -b feature/<name> origin/main`. Niemals von `master`.

## Standard-Ablauf bei jeder Änderung

```
git checkout main
git pull --rebase origin main      # Remote-Commits zuerst einholen
# … ändern …
git add <files>
git commit -m "..."
git push origin main               # Pre-Push-Hook prüft erneut Synchronität
```

Der Pre-Push-Hook (`scripts/git-hooks/pre-push`, aktiviert via `git config core.hooksPath scripts/git-hooks`) verweigert den Push, sobald `origin/main` Commits hat, die lokal fehlen — verhindert das Szenario, wo Live-Stand und lokaler Stand auseinanderdriften.

## Bei Permission-Denied vom Hook

Push wurde abgewiesen → es gibt Remote-Commits, die lokal fehlen.

```
git pull --rebase origin main
# Konflikte lösen falls nötig
git push origin main
```

## Sprachen (DE/EN)

Die Oberfläche wird weiterhin **auf Deutsch geschrieben**. Englisch entsteht durch eine
Anzeigeschicht in `index.html` (Block `I18N`): nach jedem Rendern laufen Textknoten und die
Attribute `placeholder`/`title`/`aria-label` durch `I18N_EN` (feste Strings) bzw. `I18N_EN_RE`
(Muster für Texte mit eingesetzten Werten). Bei `LANG==='de'` startet der Observer nicht.

**Bei neuen UI-Texten:** deutschen String wie gewohnt schreiben, danach die englische
Entsprechung in `I18N_EN` ergänzen. Fehlt sie, bleibt der Text auf Englisch deutsch stehen —
die App bricht nicht. Was fehlt, zeigt in der Browser-Konsole `i18nMissing()`.

Zwei Fallen:
- **Reihenfolge in `I18N_EN_RE`** — die Muster werden verkettet angewandt, spezifische Regeln
  müssen vor generischen stehen, sonst frisst die generische weg, worauf die spezifische zielt.
- **`TEXTAREA` wird nicht übersetzt.** Dort stehen die Allianz-Nachrichten (Mail-Export,
  Strategie-Briefing, Allianz-Text), die im Spiel gepostet werden. Sonst speichert ein
  englischer Nutzer beim Bearbeiten eine englische Ansage für die ganze Allianz.
- **Canvas ist kein DOM** — Beschriftungen in den PNG-Exporten brauchen einen expliziten
  `trs()`-Aufruf.

Zahlen und Datum folgen über `LOC()` mit (`de-DE` ↔ `en-GB`), nicht `'de-DE'` hart schreiben.

**Ausnahme: das Schluchtsturm-Übersichtsbild (`csMapSvg`) ist immer englisch**, auch bei
deutscher Oberfläche. Es wird als PNG in der Allianz gepostet, und im Spiel heißen die
Gebäude englisch — auch auf dem Hintergrundbild `assets/cs_map_bg.png`. Dafür gibt es
`trEN()`: dieselbe Übersetzung wie `trs()`, nur ohne die `LANG`-Abfrage. Neue Texte in
diesem SVG deshalb über `trEN()` führen und keine deutschen Wörter fest einsetzen
(auch nicht in zusammengesetzten Strings wie `'ab '+zeit`).

Der i18n-Observer hilft dort nicht: `I18N_SKIP` enthält `SVG`, SVG-Texte laufen also
grundsätzlich nicht durch die Anzeigeschicht.

## Was nie tun

- **Nicht** direkt im GitHub-UI Dateien ändern (würde Hook nicht durchlaufen).
- **Nicht** Branch-Protection deaktivieren.
- **Nicht** mit `--force` pushen außer in echten Notfällen, und dann nur nach klarer Absprache.
- **Nicht** auf `master` arbeiten oder von `master` rebasen.

## Daten-Layer

App schreibt/liest gegen den lokalen Postgres im Docker-Container `supabase-db` über Tailscale Funnel `https://mac-studio.taild5562c.ts.net:8443/rest/v1/`. Das ist seit dem Cutover die einzige produktive Datenbank.

### Mehrere Allianzen (seit 25.08.2026)

Es gibt nicht mehr *die* Allianz, sondern mehrere nebeneinander: `alliances`
(`tag`, `name`, `server`, `active`). Jede Zeile in einer Mandanten-Tabelle trägt eine
`alliance_id` — **NOT NULL, ohne Default**. Ein vergessenes `alliance_id` soll laut
scheitern statt still in der falschen Allianz zu landen.

Die Trennung sitzt an **einer** Stelle: `src/core/api.js`. Jede Anfrage an eine Tabelle
aus `TENANT_TABLES` (`src/core/tenant.js`) bekommt die aktuelle Allianz automatisch —
GET/PATCH/DELETE als Filter in der URL, POST/UPSERT als Spalte im Datensatz.

**Nicht an den Aufrufstellen filtern.** Der Filter steht bewusst nicht in den rund
sechzig `sbGet`/`sbPatch`-Aufrufen: eine vergessene Stelle wäre still — sie lieferte
die Daten der anderen Allianz mit oder überschriebe sie, ohne Fehlermeldung. Deshalb
gibt es auch **keine rohen `fetch(SB+'/rest/v1/…')` mehr**; wer einen braucht, nimmt
`sbPost`/`sbPostRet`/`sbPatchRet` mit `{prefer:…}`. Bewusst über alle Allianzen hinweg
arbeitet nur, wer `{scoped:false}` setzt (Anmeldung, Tabelle `alliances`); eine
bestimmte fremde Allianz adressiert `{alliance:id}` (Spieler kopieren).

Kommt eine Tabelle dazu, gehört sie in `TENANT_TABLES` — sonst ist sie über alle
Allianzen hinweg sichtbar.

**Eindeutigkeit gilt je Allianz.** `ws_players.name`, `ws_events(event_date,team)`,
`zug_rides.ride_date`, `vs_weeks.week_start`, `ws_rankings`, `ws_player_coords` und der
Primärschlüssel von `ws_planner_state` haben die `alliance_id` im Index. Nur so kann
derselbe Mensch in zwei Allianzen stehen. Tabellen, die über einen Fremdschlüssel schon
an einer Allianz hängen (`ws_participation` → `ws_events`, `ws_poll_votes` → `ws_polls`,
`vs_entries` → `vs_weeks`), bleiben unangetastet. **`on_conflict` muss die Spalte
mitführen** — `'alliance_id,key'`, `'alliance_id,ride_date'`, `'alliance_id,event_date,team'`.

**localStorage trägt die Allianz im Schlüssel** (`lsKey()` in `src/core/tenant.js`):
`warsync_ws_state@<uuid>`, ebenso Schluchtsturm und Kartenbild. Ohne Suffix zeigte ein
Wechsel der Ansicht die Aufstellung der vorigen Allianz — der lokale Puffer wäre ein
Leck zwischen zwei Mandanten.

Migrationen: `db/2026-08-25_multi_alliance.sql`, `db/2026-08-25_xp33_setup.sql`.

### Rollen

| Stufe | Spalte | Darf |
|---|---|---|
| Super-Admin | `ws_players.super_admin` | alles, über alle Allianzen · umschalten, anlegen, stilllegen, Spieler kopieren |
| Allianz-Admin | `ws_players.alliance_admin` | alles **innerhalb seiner** Allianz, Admin-Panel eingeschlossen |
| R1–R5 | `ws_players.role` | wie bisher |

Der Super-Admin stand früher als Name im Quelltext (`name==='Ben_the_men'`). Das trägt
nicht mehr, sobald derselbe Name in zwei Allianzen steht — jetzt ist es eine Spalte.

`canAccess('alliances')` ist die einzige Prüfung, die dem Super-Admin vorbehalten
bleibt; alles andere gilt für beide Verwalterstufen. `adminSetPerm` vergibt nur
`ws_admin`, `profile_edit`, `alliance_admin` — **`super_admin` wird nicht aus einer
einzelnen Allianz heraus vergeben**, sondern in der Datenbank.

Drei Dinge, die nicht wegoptimiert werden dürfen:

- **Beim Wechsel fällt der ganze Mandanten-Zustand zurück** (`resetTenantState()` in
  `src/core/state.js`, ausgelöst von `switchAlliance`). Eine stehengebliebene
  Aufstellung würde beim nächsten Speichern in die neue Allianz geschrieben.
- **`plannerPush` merkt sich die Allianz beim Einplanen, nicht beim Ausführen.** Der
  Push ist um 900 ms entprellt; wer in der Zwischenzeit umschaltet, überschriebe sonst
  die fremde Aufstellung. Drei Schichten sichern das: `plannerCancelPending()` beim
  Wechsel, der Vergleich `AID()!==aid` im Timer und das mitgegebene `{alliance:aid}`.
- **Die Anmeldung sucht über alle Allianzen und fragt bei Mehrdeutigkeit nach.**
  Derselbe Name mit demselben Passwort in zwei Allianzen führt zur Auswahl, nicht zum
  Raten — sonst arbeitete jemand in der falschen Allianz, ohne es zu merken. Der
  Super-Admin ist davon ausgenommen; er kann ohnehin umschalten. Die Reihenfolge der
  Kandidaten ist nach Allianz-Tag festgelegt, nicht der Laune der Datenbank überlassen.

Getestet in `tests/allianzen.spec.js`. Der wichtigste Test ist der erste: er hört bei
einem vollen Durchlauf jede Anfrage mit und verlangt, dass keine Mandanten-Tabelle ohne
Allianz angefasst wird.

### Geteilter Planungsstand

Aufstellung (WS + CS), Gebäude-Zuordnung, Kartenbild und Label-Positionen liegen in
`ws_planner_state` (`key` → `data` jsonb). Keys: `ws`, `cs`, `karte`, `karte_bg`.
Vorher lag das nur im `localStorage`, deshalb sah die Aufstellung auf jedem Gerät anders aus.

Regeln beim Laden (`plannerResolve`):
- Die DB gewinnt. Der lokale Stand nur dann, wenn sein `savedAt` neuer ist **und** der
  Nutzer schreiben darf — das ist der Offline-Fall.
- Ein **leerer** Stand verdrängt nie automatisch einen gefüllten. Sonst hätte das Gerät
  gewonnen, das zufällig zuerst lädt.
- Bewusstes Leeren (Aufstellung zurücksetzen, Wochen-Reset) läuft über `saveWSState` →
  `plannerPush` und geht immer durch.

Schreiben darf nur `canAccess('ws')` / `canAccess('cs')` — der Check sitzt im Client, die
Tabelle selbst steht wie alle anderen offen. `updated_at` setzt ein Trigger in der DB,
nicht der Client; verglichen wird ausschließlich das `savedAt` im Payload.

`karte_bg` (Base64-Bild) wird **nicht** beim Seitenaufruf geladen, sondern erst beim
Öffnen der Aufstellungs-Karte.

**Kartenbild ist zweistufig.** In `karte_bg` steht der Standard für die ganze Allianz.
„🔄 Eigenes Bild" speichert nur in den `localStorage` dieses Geräts und setzt das Flag
`ws_karte_bg_own` — solange es gesetzt ist, ignoriert das Gerät den Standard. „↺ Standardbild"
löscht das Flag, „🌐 Als Standard für alle" (nur `canAccess('ws')`) schreibt das aktuelle Bild
als neuen Standard. Ein Upload allein ändert für andere also nichts.

**Anzeige und PNG-Export sind entkoppelt.** `renderTags` skaliert die Schilder mit der
angezeigten Kartenbreite (Faktor 0.0175 ≈ 11px bei 632px), aber mit Untergrenze 9px —
maßstabsgetreu wären es am Handy 5.9px und damit unlesbar. `buildKarteCanvas` zeichnet
deshalb **nicht** aus dem DOM, sondern aus `pos`/`getGroups()` mit demselben Faktor auf
die Canvas-Breite. Ergebnis: das PNG ist auf jedem Gerät bitgleich, die Vorschau am Handy
zeigt die Schilder etwas größer als das Bild.

Wer das wieder über `getBoundingClientRect()` löst, holt sich den alten Fehler zurück:
der Export skalierte mit `naturalWidth / Anzeigebreite` und fiel am Handy doppelt so
groß aus wie am Mac.

### Wer ist gerade angemeldet (seit 31.08.2026)

Im Admin-Bereich steht ganz oben die Karte „🟢 Gerade angemeldet". Die Anmeldung
lebt ausschließlich im Browser-Tab (`APP.user`, ein Neuladen führt zurück auf die
Anmeldeseite) — es gibt keine Sitzung auf dem Server, die man fragen könnte. Wer
da ist, meldet sich deshalb selbst: jeder angemeldete Tab schreibt im Minutentakt
eine Zeile in `ws_presence` fort (`src/core/presence.js`, Migration
`db/2026-08-31_ws_presence.sql`).

Vier Dinge, die zusammengehören:

- **Zeitstempel statt Flag.** Wer den Tab zumacht, meldet sich nicht ab. Ein Feld
  `online` stünde danach bis in alle Ewigkeit auf „an"; `last_seen` verfällt von
  selbst. Als anwesend gilt, wer sich in den letzten drei Minuten gemeldet hat
  (`PRESENCE_ONLINE_MS`), alle anderen stehen unter „Zuletzt gesehen".
- **Nur der sichtbare Tab schlägt.** Ein Tab im Hintergrund heißt nicht, dass
  jemand am Gerät sitzt. Ein weggelegtes Handy fällt so nach drei Minuten aus der
  oberen Liste — die ehrlichere Auskunft.
- **Je Gerät eine Zeile.** Der Schlüssel ist `(alliance_id, player_name,
  device_id)`; die `device_id` liegt als zufällige ID im `localStorage`
  (bewusst **ohne** `lsKey()`-Suffix, sie gehört dem Browser und nicht der
  Allianz). Ohne sie überschrieben sich Handy und Laptop desselben Menschen. Die
  Anzeige fasst sie wieder zu einer Zeile zusammen: „Ben · iPhone · Mac".
- **`first_seen` wird bei jedem Schlag mitgeschickt.** Ließe man das Feld weg,
  bliebe der Wert der vorigen Sitzung stehen und die Karte behauptete
  „angemeldet seit gestern 09:00" für jemanden, der eben erst kam.

Beim Wechsel der Allianz löscht `presenceBeat` erst die Zeile in der alten —
sonst stünde man dort noch minutenlang, obwohl man längst woanders schaut. Beim
Abmelden räumt `presenceRemove` die Zeile weg, **bevor** `APP.user` auf `null`
geht; danach wüsste sie nicht mehr, wessen Zeile gemeint ist.

Die Karte frischt sich alle 30 Sekunden selbst auf (`presenceRefreshCard`
schreibt nur in `#adm-presence-body`) und **nicht** über `renderPage()`: das
würde jedes Mal wegwerfen, was der Admin gerade in „Neuen Spieler anlegen" oder
ins Passwortfeld getippt hat.

Getestet in `tests/anwesenheit.spec.js`.

### Startzeiten: europäisch und Serverzeit

Geplant wird nach europäischer Zeit, im Spiel wird nach Serverzeit angesagt — die
liegt **vier Stunden zurück** (`SERVER_DIFF_H` in `src/core/helpers.js`). Deshalb
steht in Aufstellung, Mail und in jedem Bild **beides** nebeneinander; dafür gibt es
`serverZeit('16:00')` → `'12:00'` und `zeitLang('16:00')` → `'16:00 EU · 12:00 Server'`.

Uhrzeiten werden als `'HH:MM'` geführt, nicht als `Date`: gemeint ist die Zeit im
Spiel, nicht die des Geräts — sonst zöge die Sommerzeit sie mit.

| Event | Mögliche Zeiten | Vorgabe |
|---|---|---|
| Wüstensturm | 13:00 · 22:00 · 03:00 (`WS_ZEITEN`) | A 13:00 · B 22:00 |
| Schluchtsturm | 16:00 · 03:00 (`CS_ZEITEN`) | beide 16:00 |

Die Zeit hängt **am Team**, nicht am Event: A und B können gleich oder verschieden
liegen. Umgestellt wird über `wsZeitPicker` / `csZeitPicker` (Aufstellung, beim
Schluchtsturm zusätzlich in der Anmeldung).

Gespeichert wird im geteilten Planungsstand (`ws` → `wsTime`, `cs` → `csTime`), damit
alle Geräte dieselbe Zeit sehen. **Der Wüstensturm zieht zusätzlich das Event nach:**
`setWsZeit` schreibt `ws_events.time_slot` des kommenden Freitags mit. Vergangene
Events bleiben unberührt — dort gilt, wann tatsächlich gespielt wurde. Ein Wochen-Reset
lässt die Zeiten stehen.

### Ersatzspieler (beide Events)

Pro Team 20 Hauptplätze plus bis zu 10 Ersatzplätze (`WS_MAX_GESETZT` /
`WS_MAX_ERSATZ` bzw. `CS_MAX_GESETZT` / `CS_MAX_ERSATZ`). Welche Rolle jemand darin
bekommt, teilt `computeRoster()` in `src/core/rotation.js` in vier Gruppen auf:
**fest** (die stärksten `fixedCount`), **Rotation-Haupt** (füllt auf 20 auf),
**Ersatz**, **Warteliste**.

**Beide Events führen dieselben fünf Werte** (`REG_WERTE` in `src/core/rotation.js`),
`teamAssign` wie `csTeamAssign`:

| Wert | Bedeutung | Grenze |
|---|---|---|
| `'A'` · `'B'` | gesetzt, steht in der Aufstellung | 20 je Team |
| `'AE'` · `'BE'` | als Ersatz eingeplant, bekommt kein Gebäude | 10 je Team |
| `'C'` | angemeldet, aber keiner der 30 Plätze | unbegrenzt |

Die Anmeldung hat dafür fünf Knöpfe je Zeile (`A`·`AE`·`B`·`BE`·`C`), alle über
dasselbe `setTeamAssign` / `csSetTeamAssign` — jeder schreibt seinen Wert, ein
zweiter Klick auf den aktiven meldet ab. `teamOf()` beantwortet jede Frage nach dem
Team (`csTeamOf` ist nur noch der alte Name dafür); `'C'` hat keins und liefert
`null`. Die Ersatz-Markierung geht **vor** der Rotation aus dem Rennen — eine Ansage
darf nicht daran scheitern, dass jemand stark ist oder lange aussetzen musste.

**Die Grenze auf 20 + 10 sitzt in `regPlatzPruefen`, nicht an den Knöpfen.** Ohne sie
stünden 39 Anmeldungen auf „gesetzt" und es wäre hinterher nicht mehr zu erkennen,
wer den Platz tatsächlich hat — genau das soll die Rotation entscheiden können. Ein
voller Knopf wird ausgegraut, der Klick darauf bringt zusätzlich eine Meldung.
`'C'` ist bewusst **nicht** begrenzt: es ist der Auffangwert für alle Übrigen, und
davon kann es beliebig viele geben.

**Ersatzspieler stehen nicht in der Aufstellung** — sie bekommen kein Gebäude
(`csPool()` = fest + Rotation-Haupt) und stehen als Namensliste in der Aufstellung
sowie als `SUBS`-Zeile im Übersichtsbild.

Drei Dinge dürfen dabei nicht wegoptimiert werden:

- **Beim Laden dürfen `'AE'`/`'BE'`/`'C'` nicht zurückgebogen werden.** Genau das tat
  `loadWSState` eine Zeit lang mit `'AE'`→`'A'`; heute wäre es das stille Löschen
  einer Entscheidung. Beide Loader prüfen jetzt gegen `REG_WERTE`, unbekannte Werte
  fliegen raus. Die Prüfung darf **nicht** über `teamOf()` laufen — `'C'` hat kein
  Team und verschwände dabei lautlos.
- **Der Pool sortiert erst nach Gruppe, dann nach Stärke** (`wsPoolSort` / `csPoolSort`).
  Sonst nimmt ein starker Ersatzspieler einem gemeldeten die Schlüsselrolle weg —
  Silo im Wüstensturm, Assassine im Schluchtsturm.
- **Beim Anlegen einer Teilnahme-Zeile muss `substitute` mitgeschrieben werden**
  (`ddSave`, `saveResult2`). `reliability()` rechnet über genau diese Spalte: ein
  nicht gebrauchter Ersatzspieler ist kein Absager und gehört nicht in den Nenner.
  Bei fixiertem Kader stammt das Kennzeichen aus dem Kader, nicht aus der aktuellen
  Einteilung.

Getestet in `tests/ersatz_zeiten.spec.js` und `tests/prioliste.spec.js`.

### Prioliste: wer beim nächsten Mal vorgezogen wird

39 Anmeldungen auf 30 Plätze. Die neun Übriggebliebenen bekommen `'C'`; damit es
nicht Woche für Woche dieselben trifft, führt jede Allianz einen Zähler in
`ws_priority` (Migrationen `db/2026-09-01_ws_priority.sql` und
`db/2026-09-02_ws_priority_gemeinsam.sql`, Logik in `src/core/prio.js`, Reiter
„⭐ Prio" vor der Anmeldung in `src/ui/prio.js` — er hängt in **beiden** Events):

| Beim Anmeldeschluss | Zähler |
|---|---|
| stand auf `'C'` | +1 |
| hatte einen der 30 Plätze | −1, nie unter 0 |
| war gar nicht angemeldet | unverändert — die Prio gilt nächste Woche weiter |

Angezeigt wird nur, wer über 0 steht. Wer immer eingeteilt wird, kommt gar nicht
erst in die Liste.

**Ein Zähler, beide Events.** Wüstensturm und Schluchtsturm zahlen auf dieselbe
Zahl ein: wer sich in derselben Woche für beide meldet und beide Male auf `'C'`
landet, hat zweimal zugeschaut und steht mit einer 2 da. Mit getrennten Zählern
stünde er zweimal mit einer 1 in zwei Listen, und beide sähen harmlos aus — genau
die Auskunft, die man nicht will. Derselbe Reiter hängt deshalb in beiden Events und
zeigt beide Male dieselbe Liste; die Spalte „Diese Woche" nennt seinen Stand in
jedem der beiden (`WS C · CS A`).

**Die Liste schlägt vor, sie teilt nicht ein.** Sie ändert weder Rotation noch
Aufstellung — sie steht als ⭐-Marke neben dem Namen in beiden Anmeldungen und als
sortierte Tabelle im eigenen Reiter. Das war ausdrücklich so gewollt: die Einteilung
nach dem Anmeldeschluss um 04:00 soll niemand mehr automatisch umbauen.

Vier Dinge, die zusammengehören:

- **Eigene Tabelle statt Auswertung von `ws_participation`.** Ein `'C'`-Spieler
  gehört zu keinem Team und damit zu keinem Event — es gibt keine Zeile, an die man
  ihn hängen könnte. Er bekommt deshalb bewusst **keine** Teilnahme-Zeile; sein
  Nichteinsatz steht allein im Zähler. Nebeneffekt, der so gewollt ist: er zählt in
  `reliability()` nicht als Absager.
- **Verrechnet wird erst, wenn der Kader steht und neu geladen ist**
  (`wsPrioVerrechnen` / `csPrioVerrechnen`). Vorher liefert `wsRosterGroups()` die
  Live-Vorschau statt des fixierten Kaders, und der Zähler hinge davon ab, wer gerade
  in der Anmeldung schiebt.
- **Zwei Stempel halten das idempotent**, `last_ws_date` und `last_cs_date`. Zwei
  Geräte, die gleichzeitig laden, oder ein zweites Schließen derselben Woche zählen
  nicht doppelt. Getrennt sein **müssen** sie, weil beide Anmeldeschlüsse auf
  denselben Tag fallen können — mit einer gemeinsamen Datumsspalte blockierte der
  eine den anderen, und der zweite Event zählte gar nicht. Dazu holt
  `prioVerrechnen` die Tabelle **vor** dem Rechnen frisch — gegen einen veralteten
  lokalen Stand wäre der Stempel blind. Bewusst ohne `catch`: mit einer leeren Liste
  weiterzurechnen hieße, jeden gewachsenen Zähler auf 1 zurückzusetzen. Der Preis: eine
  nach dem Schließen geänderte `'C'`-Liste wird nicht nachgetragen — dafür gibt es
  die `+`/`−`-Stepper im Reiter, und die fassen die Stempel **nicht** an.
- **Für einen Zähler, der auf 0 bleibt, wird keine Zeile angelegt.** Sonst stünde die
  halbe Allianz mit einer Null in der Tabelle.

**Zwei Zahlen, zwei Fragen.** `counter` ist die Warteschlange und fällt beim
nächsten Einsatz wieder; `c_total` (Migration `db/2026-09-03_ws_priority_gesamt.sql`)
zählt **nur hoch**. Wer abwechselnd spielt und aussetzt, steht bei `counter`
dauernd bei 0 oder 1 — dass es über Monate immer dieselben trifft, sieht man erst
an der Gesamtsumme. Die `+`/`−`-Stepper fassen `c_total` nicht an: sie rücken
jemanden in der Warteschlange, sie schreiben die Vergangenheit nicht um.

### Wie oft war wer eingeteilt

Neben den beiden C-Zählern steht die **Einsatz-Bilanz**: wie oft jemand gesetzt
(`'A'`/`'B'`) und wie oft als Ersatz (`'AE'`/`'BE'`) im Kader stand — **je Event
getrennt**, weil Wüstensturm und Schluchtsturm zwei Verpflichtungen sind. A und B
werden zusammengefasst: welches der beiden Teams jemand spielt, sagt über die
Belastung nichts aus und wechselt ohnehin wöchentlich.

**Abgeleitet, nicht gezählt.** `einsatzBilanzAlle()` in `src/core/rotation.js` liest
`ws_participation` (`substitute`, `waitlisted`) mit `ws_events.mode` in *einem*
Durchlauf über alle Zeilen. Eine abgeleitete Zahl kann nicht auseinanderlaufen und
gilt rückwirkend für alle Events, die schon in der Datenbank stehen. Für `'C'` geht
das nicht — dort gibt es keine Teilnahme-Zeile, deshalb ist `c_total` gespeichert.

Der eine Durchlauf ist Absicht: pro Spieler zu suchen wäre bei vierstellig vielen
Teilnahme-Zeilen und vierzig Spielern in jeder Tabellenzeile spürbar. Aufrufer
holen die Bilanz deshalb **einmal** und greifen dann in das Ergebnis (`wsAnmeldung`,
`bilanzKarte`).

Sichtbar an drei Stellen: als Tabelle „Einsatz-Bilanz" unter der Warteschlange (alle
aktiven Spieler), als Block „Einteilung" im Spielerprofil-Overlay, und als Zeile
„Bisher WS 5/1 · CS 2/0 · C 3" in der Wüstensturm-Anmeldung. Die Zeile trägt
bewusst **kein** `<strong>` in der Mitte: jedes Element zerschneidet den Textknoten,
und die Anzeigeschicht übersetzt je Knoten — auf Englisch stünde die Zeile sonst
halb deutsch da.

`ws_priority` gehört in `TENANT_TABLES`; `on_conflict` führt
`'alliance_id,player_name'` — eine Zeile je Spieler, `mode` gibt es nicht mehr.
`prioVerrechnen({mode})` entscheidet damit nur noch, welcher der beiden Stempel
gesetzt wird. Getestet in `tests/prioliste.spec.js`.

### Kartenhälfte, Spawnzonen und Einstellungsvarianten (Schluchtsturm)

Die Auto-Verteilung belegte bis dahin immer alle zwölf Gebäude. Das passt für
**Ordnungshüter** — eine Allianz allein gegen zwei, die die ganze Karte abdecken
muss. Für **Morgenbringer** stimmt es nicht: das sind zwei Allianzen, die sich die
Karte teilen, und wer alles beplant, plant die Hälfte für jemand anderen mit.

Drei Einstellungen unter „⚙ Erweitert", alle **je Team**:

| Einstellung | Werte | wirkt |
|---|---|---|
| Bespielte Kartenhälfte | `ganz` · `links` · `rechts` (`CS_SEITEN`) | sperrt die Gebäude der anderen Hälfte |
| Gebäude an den Spawnzonen | `aus` · `eigen` · `gegner` (`CS_SPAWN_REGEL`) | sperrt die Gebäude vor einer Spawnzone |
| Einstellungsvariante | frei benannt, max. `CS_PRESET_MAX` | speichert und lädt beides samt Sollstärken |

**Die Spawn-Regel gibt es in beide Richtungen, und das ist Absicht.** Vor jeder
Spawnzone stehen dauernd Spieler, die auf ihren Teleport-Cooldown warten. Am
*eigenen* Spawn heißt das, dass die Gebäude nebenbei mitgenommen werden — es muss
niemand fest hin. Am *gegnerischen* heißt es das Gegenteil: was man dort nimmt, ist
sofort wieder weg. Welche Lesart gilt, entscheidet der Nutzer, nicht der Code.
Welche Gebäude gemeint sind, steht ausgeschrieben in `CS_SPAWN_BLD` — Datenzentren
vor dem Nord-Spawn (Ordnungshüter), Probenlager vor den Süd-Spawns (Morgenbringer).

Vier Dinge, die nicht wegoptimiert werden dürfen:

- **`csEffSlots` füllt die frei gewordenen Plätze wieder auf.** Sperrt man eine
  Hälfte, bleiben sonst genau die Spieler ohne Gebäude stehen, die vorher drüben
  standen. Aufgefüllt wird reihum über die verbliebenen Startgebäude, wie schon in
  `csAutoAssign`. Die eingestellte Sollstärke bleibt daneben unverändert stehen und
  gilt wieder, sobald die Sperre fällt.
- **`csKapazitaet` warnt, wenn es nicht aufgeht.** „Nur links" plus „eigenen Spawn
  aussparen" lässt bei Morgenbringern nur Energieturm und Datenzentrum I übrig: bei
  `CS_MAXCAP` 5 sind das 10 Plätze plus 5 Assassinen für 20 Spieler. Ohne die
  Warnung fielen fünf still in „nicht zugewiesen".
- **Energieturm und Labor gehören zu jeder Hälfte** (`CS_MITTE`). Beide stehen in
  `CS_ANCHOR` auf `x:194`, also auf der Mittelachse; ihr `side` dort ist nur ein
  Tiebreak fürs SVG-Layout und taugt nicht als Aussage. Wer stattdessen `side`
  abfragt, verliert bei „nur rechts" den Energieturm — das wertvollste Dauergebäude.
- **`csPresetLoad` stempelt die Slots auf die Fraktion des Zielteams.** Sonst rechnet
  `csGetSlots` die geladenen Zahlen beim nächsten Zugriff auf die Vorgaben zurück,
  weil `f` und `m` noch aus der gespeicherten Variante stammen — die Variante wäre
  sofort wieder weg.

**Eine Variante gehört zu einer Fraktion, nicht zu einem Team.** Welches Team welche
Fraktion spielt, wechselt wöchentlich; der Zuschnitt hängt dagegen fest an der
Fraktion, weil die Karte asymmetrisch ist. Daraus folgen drei Dinge:

- **Eindeutig ist `(name, faction)`, nicht der Name** (`csPresetFind`). „XP33-Aufstellung
  alt" gibt es sinnvollerweise für beide Fraktionen; ein reiner Namensvergleich träfe
  beim Überschreiben die falsche.
- **Die Auswahlliste gruppiert nach Fraktion**, die des Teams zuerst. Die fremden
  bleiben sichtbar — verstecken hieße, jemand sucht eine Variante, die da ist.
- **Laden über die Fraktionsgrenze fragt nach.** Erlaubt, aber fast immer ein
  Versehen: die Sollstärken sind um den anderen Spawn herum gebaut.

Das `label` eines `<optgroup>` ist ein Attribut und kein Textknoten — der
i18n-Observer fasst es nicht an. Der Fraktionsname dort läuft deshalb ausdrücklich
über `trs()`.

Varianten liegen im `cs`-Payload von `ws_planner_state` (`csPresets`), nicht unter
einem eigenen Key — damit teilen sie Speichern, Auflösen und Mandantentrennung mit
dem übrigen Schluchtsturm-Stand. Sie speichern die Aufstellung selbst nicht; die
entsteht beim nächsten Auto-Verteilen neu.

Getestet in `tests/schluchtsturm_varianten.spec.js`.

### Anmeldeschluss und fixierter Kader (Wüstensturm)

**Donnerstag 04:00 Ortszeit** ist Anmeldeschluss für den Wüstensturm am Freitag. Ab
dann steht der Kader fest: die eingeteilten Spieler stehen als `ws_participation`-Zeilen
(`registered=true`, `played=false`) am Freitags-Event und ändern sich nicht mehr,
egal wer danach noch an der Aufstellung schiebt.

Der Schnitt läuft **im Browser beim Laden** (`wsRosterCheck` aus `loadData`), nicht als
Serverdienst — er passiert also beim ersten Seitenaufruf nach 04:00. Nur mit
`canAccess('ws')`.

Drei Regeln, die nicht wegoptimiert werden dürfen:

- **Erst sperren, dann schreiben.** Die Sperre ist ein bedingter PATCH auf
  `ws_events.roster_locked_at` mit Filter `roster_locked_at=is.null`. Laden zwei Geräte
  gleichzeitig, bekommt genau eines eine Zeile zurück. Andersherum würden beide den
  Kader schreiben und erst danach merken, dass sie zu spät sind.
- **Ein leerer Kader wird nie fixiert.** Sonst sperrt ausgerechnet das Gerät, das die
  Einteilung noch nicht geladen hat, das Event mit null Spielern zu — dieselbe Falle
  wie beim Planungsstand.
- **Scheitert das Schreiben, wird die Sperre zurückgenommen.** Sonst stünde das Event
  als fixiert da, ohne Kader, und niemand käme mehr heran.

**Die Ergebnis-Wege dürfen den Kader nicht überschreiben.** `saveResult2` hat früher
alle Teilnahme-Zeilen des Events gelöscht und neu geschrieben, wobei `registered` aus
der *aktuellen* Aufstellung abgeleitet wurde — wer nach dem Anmeldeschluss aus der
Aufstellung flog, galt rückwirkend als nie angemeldet. Jetzt werden bestehende Zeilen
aktualisiert statt ersetzt, und bei fixiertem Kader bleibt `registered` unangetastet.
Wer nicht im Kader steht, aber Punkte hat, wird mit `registered=false` angelegt.
`ddPlayerTableHtml` füllt bei fixiertem Kader ebenfalls nicht mehr aus `getLineup()` auf.

`ws_events` hat einen Unique-Index auf `(event_date, team)`, `ws_participation` einen auf
`(event_id, player_name)`. Ohne die kamen Dubletten: `ensureWeeklyEvents` prüft nur den
lokal geladenen Stand, weshalb am 31.07. sieben Event-Paare für denselben Freitag
entstanden. Migration: `db/2026-08-07_ws_event_unique.sql`.

**Nach Schema-Änderungen `NOTIFY pgrst, 'reload schema';`** — sonst kennt PostgREST die
neue Spalte nicht und die App bekommt sie schlicht nicht geliefert.

### Stärke-Verlauf (Truppen und Helden)

Jede Eintragung einer Stärke schreibt über `savePlayerHistory` **eine neue Zeile**
in `ws_player_history` (Zeitstempel `recorded_at` setzt die Datenbank) und
aktualisiert nebenbei `ws_players.t1_updated_at` für die Veraltet-Anzeige.
Überschrieben wird nichts — nur die Korrektur eines Verlaufs-Eintrags
(`APP.historyEditId`) patcht eine bestehende Zeile.

Eine Zeile ist ein **Schnappschuss aller bekannten Werte**: Felder, die gerade
nicht eingetragen wurden, übernimmt `savePlayerHistory` aus dem aktuellen
Spielerstand. Deshalb steht die Heldenkraft auch in Zeilen, in denen nur T1
geändert wurde.

Gezeichnet wird über `renderHistoryChart(name, modus)` mit zwei Modi
(`HIST_MODI` in `src/ui/profil.js`), sichtbar in Profil, Spieler-Overlay und
Allianz-Detail:

| Modus | Felder | Achse |
|---|---|---|
| `truppen` | T1–T4 (stehen in Mio in der DB) | ab 0 |
| `helden` | `hero_power` (absolut, /1e6) | um die Werte herum |

Drei Dinge, die nicht wegoptimiert werden dürfen:

- **Getrennte Diagramme.** Truppen liegen bei 20–30 Mio, Helden bei 150–200 Mio.
  Auf einer Achse wären die Truppenlinien platt.
- **Die Helden-Achse beginnt nicht bei null.** Die Heldenkraft wächst um wenige
  Prozent im Monat — ab null wäre jede Entwicklung eine waagerechte Linie. Damit
  der Ausschnitt nicht täuscht, ist die Achse durchgehend beschriftet und
  `histDelta` nennt Zuwachs und Prozent im Klartext.
- **Jede Linie läuft nur über ihre eigenen Datenpunkte.** Vorher lief sie über
  alle Einträge — ein Eintrag ohne diesen Wert riss die Linie auf null herunter.

Eingetragen wird die Heldenkraft in Mio (`171,0`), gespeichert absolut
(`171000000`) — im Profil (`manHP`, jeder für sich) und im Allianz-Detail
(`apd-hp`, `canAccess('profile_edit')`). Im Profil genügt die Heldenkraft allein;
sie steht im Spiel auf einem anderen Bildschirm als die Truppenstärke.

**Verlauf vollständig laden.** `loadData` holt `ws_player_history` über
`sbGetAll` in Blöcken. Ein festes `limit=500` stand vorher da und schnitt still
ab, sobald die Tabelle darüber wuchs (am 11.08.2026 waren es 557 Zeilen) — die
ältesten Einträge fehlten in jedem Diagramm, ohne Fehlermeldung. PostgREST
deckelt zusätzlich bei 1000 Zeilen je Antwort (`PGRST_DB_MAX_ROWS`), ein größeres
`limit` allein hilft also nicht.

### T1-Typ: Tank, Air oder Missile

Die T1-Stärke allein sagt nicht, womit jemand marschiert — und für die Aufstellung
ist genau das die zweite Hälfte der Auskunft: 48 Mio Tank und 48 Mio Air gehören an
verschiedene Gebäude. `ws_players.t1_type` hält den Kurzcode `'T'`/`'A'`/`'M'`
(Migration `db/2026-09-02_ws_players_t1_type.sql`), `T1_TYP` in `src/core/players.js`
bildet ihn auf Beschriftung, Symbol und Farbe ab.

Eingetragen wird er an denselben drei Stellen wie die Stärken, jeweils direkt neben
T1: Profil (`manT1Type`), Allianz-Detail (`apd-t1-type`) und „Neuen Spieler anlegen"
(`new-pl-t1type`). Alle drei rendern **dasselbe** `t1TypSelect()` — getrennte Listen
liefen sonst irgendwann auseinander.

Vier Dinge, die zusammengehören:

- **Kein Vorgabewert.** `NULL` heißt „unbekannt" und wird nirgends geraten; wo nichts
  steht, steht auch in der Oberfläche nichts. Ein Vorgabewert wäre eine Behauptung
  über einen Spieler, den nie jemand gefragt hat.
- **Ein leeres Auswahlfeld löscht.** Anders als bei den Zahlenfeldern, wo leer
  „nicht angefasst" heißt, ist das Feld beim Rendern vorbelegt — die Auswahl von
  „– unbekannt" ist deshalb eine Entscheidung und muss durchgehen. Verglichen wird
  gegen den bisherigen Stand, nicht gegen `''`.
- **Der Typ ist kein Verlaufswert.** `savePlayerHistory` baut seine Zeile aus einer
  festen Feldliste; `t1_type` landet dadurch nur in `ws_players`, und ein reiner
  Typwechsel legt keinen Verlaufs-Eintrag an. Eine Truppengattung ist eine
  Eigenschaft, keine Messreihe — im Diagramm hätte sie keine Achse.
- **Ein reiner Typwechsel muss speicherbar sein.** `saveStrength` und
  `apdSaveManual` brechen sonst mit „Bitte mindestens einen Wert eingeben" ab,
  weil die vier Zahlenfelder unverändert sind.

Tank/Air/Missile bleiben auch auf Deutsch stehen — so heißen sie im Spiel, wie die
Gebäude im Schluchtsturm. Übersetzt sind nur „T1-Typ" und „– unbekannt".

Getestet in `tests/t1_typ.spec.js`.

**Woher die Werte kamen.** 62 XP33-Spieler wurden am 02.09.2026 aus der
Anmelde-Tabelle der Allianz übernommen (Google Sheet `14Cs0OVv…`, acht Blätter von
31Jul bis 28Aug, Import als `db/2026-09-02_xp33_t1_import.sql`). Der Typ war über
alle Blätter widerspruchsfrei. Zwei Regeln beim Abgleich, die beim nächsten Import
wieder gelten:

- **Namen nur normalisiert vergleichen** — ohne Leerzeichen, ohne Diakritika,
  kleingeschrieben. Roh verglichen fehlten 38 von 135 Namen; normalisiert waren es
  drei, und alle drei waren Zeichenverwechslungen (`lIBlackJackll` ↔
  `IIBlackJackII`, `Vicky 1301` ↔ `Vicky13012`, `anyanakamura1` ↔ `ayanakamura1`).
- **Eine ältere Quelle überschreibt keinen neueren Messwert.** Cocojamb und
  Meister28 waren am 29.08. gemessen und blieben stehen. `t1_updated_at` bekam das
  Datum der Quelle (28.08.), nicht das des Imports — sonst behauptete die
  Veraltet-Anzeige eine Frische, die diese Zahlen nicht haben.

### Vision-Server (OCR)

Die Ergebnis-OCR ist gebaut: „🔍 Analysieren" im aufgeklappten Event (`ddAnalyze`) schickt
die Screenshots an `/analyze-ws` und ordnet die erkannten Namen per Fuzzy-Match der
Aufstellung zu. Es gibt außerdem `/analyze-vs`, `/analyze-strength` und `/analyze`.

`scripts/vision_server.py` läuft auf **Port 8444** (`PORT`-Umgebungsvariable) und bindet
nur auf `127.0.0.1` — von außen kommt man ausschließlich über Tailscale heran.

Freigaben (beide seit 07.08.2026 aktiv):
- `https://mac-studio.taild5562c.ts.net:10000` — **Funnel, öffentlich**. Entspricht dem
  Default im Code, deshalb braucht die App keine Einstellung. Vorher lag hinter dem
  Port nichts, daher kam beim Hochladen der Kampfergebnisse „❌ Failed to fetch".
  Funnel lässt nur 443, 8443 und 10000 zu; 443/8443 gehören PostgREST.
- `https://mac-studio.taild5562c.ts.net:5447` — tailnet only, als Rückfalloption.

**Der Server hat keine Anmeldung.** Der Login der App schützt ihn nicht: er sitzt im
Browser-Code, der Funnel ist ein eigener Endpunkt daneben. Wer den Hostnamen kennt,
kann `POST /analyze-ws` direkt schicken und damit fremde Bilder durch das lokale Ollama
jagen. Abschalten notfalls mit `tailscale funnel --https=10000 off`.

**Die Vision-Modelle halluzinieren.** Ein leeres 1×1-Pixel liefert erfundene Spieler mit
Punktzahlen statt einer leeren Antwort — die erkannten Werte sind ein Vorschlag zum
Gegenlesen, keine Quelle.

Netzwerkfehler laufen über `visionErr()` und bekommen den Zusatz „Ist der Vision-Server
erreichbar?" — sonst steht dort nur „Failed to fetch".

`handleSSUp` (Screenshot der *Anmeldeliste*) ist weiterhin nur ein Platzhalter.

### Backup

Stündlicher lokaler Dump nach `~/Backups/warsync-db/` via `scripts/backup_local_db.sh`
(LaunchAgent `com.onemann.warsync-backup`), inkl. Schema. Aufbewahrung: 7 Tage stündlich,
180 Tage täglich, Monatserster dauerhaft. Restore-Anleitung: `~/Backups/warsync-db/README.md`.

`scripts/verify_db_backup.sh` spielt das jüngste Backup in eine Wegwerf-DB zurück und
vergleicht alle Zeilenzahlen — läuft wöchentlich (`com.onemann.warsync-backup-verify`),
kann jederzeit von Hand gestartet werden.

Kontrolle: letzter `[OK]` in `~/.local/state/warsync/backup.log` sollte < 1 h alt sein.

**Cloud-Supabase ist tot.** Der frühere Hot-Standby-Sync (`sync_local_to_cloud.sh`,
LaunchAgent `com.onemann.warsync-sync`) scheiterte seit 06.05.2026 bei jedem Lauf
(`tenant/user postgres.ktdzxhyuvukontcxghte not found`) und ist seit 31.07.2026
abgeschaltet (Plist als `.disabled` geparkt). Es gibt keinen Rollback auf die Cloud mehr.

Bei DB-Änderungen von Hand: `docker exec` braucht **`-i`**, sonst kommt das SQL nie am
`psql` an und der Befehl läuft ohne Wirkung durch.
