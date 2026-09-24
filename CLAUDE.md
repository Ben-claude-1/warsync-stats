# WarSync Stats — Workflow-Regeln

Diese Regeln gelten für jede Session in diesem Repo. Bei Verstoß bricht der Pre-Push-Hook automatisch ab.

## Wird ein Thema genannt: erst die Themen-Datei lesen

Zu jedem Thema dieses Projekts liegt **eine** Datei unter [`docs/themen/`](docs/themen/) —
Index mit Stichwörtern in [`docs/themen/README.md`](docs/themen/README.md). Sie bündelt aus
allen bisherigen Sessions, was zu dem Thema gilt: die Regeln, die Messungen dahinter, die
widerlegten Annahmen und die Sessions zum Nachlesen.

**Nennt Ben ein Thema (Schluchtsturm, Scroll-Hänger, Basen, LW Atlas, Prioliste, …), zuerst
die passende Datei öffnen — vor dem Suchen im Code.** Reicht sie nicht: per Grep in
[`SESSIONS.md`](SESSIONS.md) und dann den verlinkten Digest unter `docs/sessions/`.

Was dort neu gelernt wird, gehört auch dorthin zurück — die Themen-Datei ist die Stelle, an
der eine Erkenntnis die nächste Session erreicht.

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

### LW Atlas — die zweite Quelle für Karte, Spieler und Allianzen

`https://api.lwatlas.com` liefert dieselbe Auskunft, die unser Kartenscan mühsam
aus Bildern liest — nur aus den Spieldaten selbst. Namen in japanischer,
kyrillischer und chinesischer Schrift stehen dort richtig, wo die Texterkennung
`5 1 ZaoTail` statt `ザオタイ ZaoTai` liefert. Dahinter steht das Hobbyprojekt
einer Einzelperson, ohne Verbindung zum Spielehersteller.

**Der Schlüssel liegt außerhalb des Repos** in `~/.config/warsync/lwatlas.env`
(Rechte 600, Variable `LWATLAS_KEY`), zusätzlich im Tresor unter
`Last war developer`. Er wurde einmalig per E-Mail zugestellt und ist **nicht
wiederherstellbar** — die Website zeigt nur eine gekürzte Vorschau.

**Namensnennung ist Pflicht.** „Powered by LW Atlas" mit Rückverweis steht unter
der Basen-Seite; ohne sie kann der Schlüssel entzogen werden. Sie ist eine
unscheinbare Zeile und deshalb ausdrücklich in `tests/lwatlas.spec.js` verankert.
Untersagt sind außerdem Weiterverkauf, Massen-Weiterverbreitung und ein daraus
gebauter konkurrierender öffentlicher Kartendienst; interne Allianz-Nutzung ist
davon nicht betroffen.

**Das Kontingent ist die knappe Ressource, nicht die Zeit.** Die kostenlose Stufe
hat 10.000 Anfragen je 30 Tage und füllt sich erst zum Stichtag wieder auf — ein
leergelaufenes Kontingent legt auch den täglichen Kartenabruf lahm. `Zugang` in
`scripts/lwatlas/api.py` zählt `X-Quota-Remaining` bei jeder Antwort mit, bricht
ab, **bevor** `RESERVE` (500) unterschritten ist, warnt unter 25 % Rest und hält
mit 1,1 s Abstand die 60 Anfragen je Minute ein. Drei Sparmaßnahmen gehören
zusammen:

- **Mitgliederlisten nur für frische Allianzen.** Auf der Karte stehen auch
  Kürzel, deren letzte Basis im Dezember gesehen wurde — auf #1668 sind das 159
  gegen 79 lebende. Jede kostet eine Anfrage und liefert die Mitglieder einer
  Allianz, die es so nicht mehr gibt.
- **Antworten liegen bis zu `--cache-h` Stunden** unter
  `~/.local/state/warsync/lwatlas/cache`. Ein misslungener Schreibvorgang darf
  nicht noch einmal achtzig Anfragen kosten; genau das ist am 12.09.2026
  passiert, und der zweite Anlauf kostete dadurch null.
- **`--ohne-mitglieder`** holt nur die Karte: eine einzige Anfrage je Server.

**Cloudflare weist die Python-Kennung mit 403 ab**, bevor die API sie überhaupt
sieht. Ohne eigenen `User-Agent` sieht das wie eine gesperrte Route aus und
verleitet dazu, den umständlichen Map-Scan-Job zu bauen, den es dafür nicht
braucht.

Zwei Tabellen, beide **serverweit** wie `karte_basen` und deshalb nicht in
`TENANT_TABLES` (Migration `db/2026-09-12_lwatlas.sql`): `lwa_spieler` (alle
Spieler des Servers) und `lwa_allianzen`. Gefüllt von
`scripts/lwatlas/sync.py --server 1668 --schreiben`, gelesen über
`src/core/lwatlas.js`, angezeigt unter „Basen" (`src/ui/lwatlas.js`).

**Der Schlüssel ist `player_uid`, nicht der Name.** Wer sich umbenennt, bleibt
dieselbe Zeile. Das ist keine Feinheit: beim ersten Kaderabgleich am 12.09.2026
war die **Hälfte** der vermeintlichen Abgänge eine Umbenennung mit Sonderzeichen
— `CraideN` → `notCraidenAnymore`, `SINNER` → `ꜱɪɴɴᴇʀ` (Kapitälchen-Unicode),
`ERZAN` → `ΞRζλη` (griechische Zwillinge: Ξ=E, ζ=z, λ=A, η=n). Die letzten
beiden erwischt auch der Skelett-Abgleich aus `ergebnis.py` nicht. Belegt wurden
sie über den **Ort**: unter derselben Koordinate stand in `karte_basen` noch der
alte Name.

`ws_players` hat **keine** `player_uid`-Spalte. Solange das so ist, bleibt jeder
automatische Kaderabgleich Schätzung.

**Kraft sagt nichts über Gefahr.** kiSS stand am 12.09.2026 mit 20,8 Mrd Kraft
hinter XP33 (21,0 Mrd), hatte aber ein Drittel mehr Kills (557 gegen 433 Mio).
Deshalb steht in der Allianzliste beides nebeneinander und sortiert wird nach
Kills. Die Spalte „Zuletzt aktiv" ist die zweite Hälfte der Einschätzung: ein
starker Spieler, der seit zwei Wochen nicht da war, verteidigt seine Basis nicht.

`kurz()` in `src/ui/lwatlas.js` führt Trennzeichen **und** Einheit über `LOC()`
(„249,1 Mio" ↔ „249.1M"). Der i18n-Beobachter hilft dort nicht — er übersetzt
ganze Textknoten, keine Zahlenformate.

Getestet in `tests/lwatlas.spec.js`.

### Der VS-Gegner wird gewählt, nicht einprogrammiert (seit 13.09.2026)

Unter „VS-Duell" → „🎯" stehen zwei Auswahlfelder: erst der Server, dann die
Allianz. Vorher standen `VS_GEGNER_SERVER`/`VS_GEGNER_TAG` hart in
`src/ui/vs.js`, und jeder Gegnerwechsel — also jede Woche — war eine
Code-Änderung samt Build.

**Der eingestellte Gegner gehört der Allianz, das Stöbern dem Gerät.** Wer der
Gegner der Woche ist, ist eine gemeinsame Auskunft und liegt deshalb im
geteilten Planungsstand (`ws_planner_state`, Schlüssel `vs`, in `PLANNER_KEYS`);
setzen darf ihn nur `canAccess('ws')`. Daneben darf jeder frei in fremden
Servern und Allianzen blättern, ohne die gemeinsame Wahl zu verstellen — dieser
Blick lebt bewusst nur im Modul (`_vsBlick`) und **nicht** im `localStorage`:
ein vergessener Blick auf eine fremde Allianz stünde sonst wochenlang da und
sähe aus wie der Gegner. Ein Neuladen führt zurück auf das Eingestellte.

Ist nichts eingestellt, steht dort kein Vorgabewert — ein geratener Gegner wäre
eine Behauptung, die niemand aufgestellt hat. Der Reiter heißt dann „🎯 Gegner".

**Die Auswahlliste kommt aus der Sicht `lwa_allianz_liste`, nicht aus
`lwa_allianzen`** (Migration `db/2026-09-13_lwa_allianz_liste.sql`). In der
Tabelle steht nur, wessen Mitgliederliste jemand geholt hat, und die kostet eine
Anfrage am Kontingent je Allianz: auf dem frisch geholten #1655 war das **eine**
von 73. Eine Auswahl daraus sähe leer aus, obwohl der Kartenabruf alle Kürzel
längst kennt. Die Sicht gruppiert deshalb `lwa_spieler` nach `(server, allianz)`
— im Browser ginge das nicht, PostgREST kann kein DISTINCT und die Rohliste sind
fünfstellig viele Zeilen.

`power` und `kills` summieren dort nur über Spieler mit Mitgliederliste;
`mit_daten` sagt, auf wie vielen sie beruhen. Ist es 0, steht in der Auswahl
**„ohne Kraft/Kills"** und darunter der Befehl, der sie holt. Das ist die zweite
Hälfte der Auskunft: ohne den Hinweis sieht eine Allianz, deren Liste fehlt, aus
wie eine harmlose — dieselbe Falle wie „Stufe 0" gegen „nicht gelesen".

Nachzutragen ist damit nur noch das Kontingent-teure Stück:
`scripts/lwatlas/sync.py --server 1655 --nur-allianz cult --schreiben` holt
Karte plus **eine** Mitgliederliste (zwei Anfragen statt rund 110).

Getestet in `tests/vs_gegner.spec.js`. Der Test trägt **kein** Kürzel fest ein —
der Gegner wechselt wöchentlich, ein verdrahtetes `SDWE` wäre jeden Montag rot,
ohne dass etwas kaputt ist. Geprüft wird stattdessen, dass die Abfrage dem
folgt, was die Karte über sich behauptet, dass ein Blick nichts schreibt und
dass ohne `canAccess('ws')` kein Setzen-Knopf erscheint.

### VS: die Punkte je Tag, nicht je Woche (seit 17.09.2026)

Das Ziel ist ein **Tagesziel** — 7,2 Mio, je Tag eine eigene Aufgabe (Montag
Radar, Mittwoch Technologie …). Die Wochensumme beantwortet die Frage deshalb
nicht: 43,2 Mio können sechs ordentliche Tage sein oder zwei starke und vier
leere. `VS_TAGESZIEL` steht in `src/core/config.js` vorn, `VS_TARGET` ist daraus
abgeleitet.

Tabellen `vs_tage` und `vs_tage_lauf` (Migration `db/2026-09-17_vs_tage.sql`,
beide in `TENANT_TABLES`), Logik in `src/core/vstage.js`, Anzeige unter
„VS-Duell" → „📅 Tage" mit Wochenraster und der Zählung **je Wochentag**.

**Drei Zustände, nicht zwei.** Die Rangliste im Spiel endet bei **100 Zeilen**,
und XP33 hat genau 100 aktive Mitglieder. Ein Fehlender ist deshalb nur dann
belegt „nicht angetreten", wenn der Lauf das Listenende erreicht hat **und** die
Liste nicht voll war — beides steht in `vs_tage_lauf`. Sonst steht ein Strich,
keine Null. `nullZaehltAls()` entscheidet das an einer Stelle.

**Der laufende Tag zählt nicht mit.** Wer heute um 10 Uhr 2 Mio hat, ist noch
dabei. Maßgeblich ist die Serverzeit (vier Stunden zurück, `serverHeute()`); die
Punkte werden angezeigt, die Spalte heißt „läuft". Ohne diese Ausnahme stünde
jeden Tag die halbe Allianz auf der Mängelliste.

Getestet in `tests/vs_tage.spec.js`, gegengeprüft an beiden Stellen.

#### Der Dienst dahinter

`scripts/vs_service/run.py`: Basis → Allianzduell → „Rang" → „Tagesrang" → Haken
„Deine Allianz" → je Tagesreiter scrollen. **Ein Lauf holt die ganze Woche** —
die Reiter decken Mo–Sa ab und werden Sonntag um 24:00 zurückgesetzt; eine
vergangene Woche ist im Spiel nicht mehr zu sehen. Ein versäumter Sonntag kostet
sie ganz.

**Diese Liste hängt nicht** — 25 von 25 Rastungen griffen, Median 452 px
(`pruefe_scroll.py`, 17.09.2026). Der Scroll-Hänger des Wüstensturm-Dienstes
tritt hier nicht auf; jede Zeile wird rund dreimal gesehen.

**Zusammengeführt wird über den Punktwert.** Er war über 164 Rohzeilen in *allen*
50 Zeilen einstimmig, während Namen zwischen drei Lesungen schwankten und
zweistellige Ränge die erste Ziffer verloren (29 und 44 kamen beide als `4` an).
Der Rang wird aus der Punktreihenfolge abgeleitet, die gelesene Ziffer ist nur
Gegenprobe.

Fünf Fallen, jede einmal eingetreten:

- **Die Spaltenüberschrift ist keine Zeile.** „Kommandant" steht fest bei y≈506
  mitten in der Namensspalte; als Zeile gelesen bekam sie die Punktzahl der
  ersten echten Zeile und verschob jeden Rang darunter um eins.
- **Die eigene grüne Zeile bewegt sich nicht mit.** Reicht das Messfenster der
  Vorlagensuche in sie hinein, gilt jeder Schritt als Stillstand. Gelesen wird
  bis y=1880, gemessen nur bis y=1840.
- **Beim Zurückscrollen taugt der untere Streifen nicht** — er rutscht dabei aus
  dem Bild. `nach_oben` las das als „bin oben", brach nach einem Schritt ab, und
  der Lauf hielt das Ende der vorigen Liste für einen vollständigen Tag.
- **Der Haken „Deine Allianz" ist nicht dauerhaft.** Frisch geöffnet steht die
  Liste auf heute und ohne Filter. Er wird deshalb nach **jedem** Tageswechsel
  geprüft — ungefiltert stünden die Gegner mit drin.
- **Ein leerer OCR-Titel heißt „noch keine Auskunft", nicht „falscher
  Bildschirm".** Der Blick fiel mitten in die Animation. `warte_auf_titel`
  schaut mehrmals; verglichen wird ähnlich statt gleich (`allianzdull`).

**Ein Tag wird ersetzt, nicht ergänzt** (`tool.schreibe_tag` löscht erst). Sonst
blieben die Zeilen eines misslungenen Laufs daneben stehen und sähen aus wie
richtige.

**Geschrieben wird, was gefunden wurde** (seit 24.09.2026). Eine gescheiterte
Gegenprobe verwarf vorher den ganzen Tag — am 22.09.2026 waren das 96 richtig
gelesene Zeilen, weil beim Scrollen **eine** durchgefallen war. Der Tag steht
jetzt mit `vollstaendig=false` da, und daran hängen beide Sicherungen: die
Oberfläche zeigt für einen Fehlenden einen Strich statt einer Null, und
`--nur-fehlende` liest ihn beim nächsten Lauf erneut. Die Gegenprobe entscheidet
damit nur noch über `vollstaendig`. Verweigert wird allein, was den vorhandenen
Stand **verschlechtern** würde (`lauf.schreiben_erlaubt`, geprüft in
`scripts/vs_service/pruefe_schreibregel.py`) — sonst ersetzte ein halb gelesener
Lauf einen guten, und das fiele niemandem auf. `--erzwingen` heißt jetzt genau
das und nicht mehr „trotz Gegenprobe".

**Die Schrittweite ist gemessen: 904 px, nicht mehr.** Über drei volle Tage aus
den gespeicherten Bildern nachgerechnet (jedes n-te Bild = n-fache Schrittweite):
bei 904 px (3,6 Zeilen) wird jede Zeile gefunden, bei 1356 px (5,4 Zeilen) fehlen
**sechs Spieler** — an allen drei Tagen gleich. Ins Fenster passen 5,1 Zeilen,
oberste und unterste sind angeschnitten und liefern keine Punktzahl; vollständig
lesbar sind rund **vier**. Gefahren wird das als zwei Rastungen in einer Geste
(`punkte` 24 × 41 px), nicht als eine größere — 41 px je Punkt erzeugt BlueStacks'
Mausrad selbst.

**Periodisch laeuft er ueber den Hub** (seit 17.09.2026). Im Portal unter
„Routinen" steht die Gruppe **WarSync** mit der Routine „VS-Tagespunkte lesen"
(cron `0 5 * * *`). Dazwischen sitzt `scripts/routinen/starter.py` als eigener
Dienst (LaunchAgent `com.onemann.warsync-routinen`, `127.0.0.1:8793`): die
Routinen kennen als allgemeine Aktion nur `http`, und die bricht nach zehn
Sekunden ab — der Scan braucht zwanzig Minuten. Der Starter antwortet deshalb
sofort und loest den Lauf von sich ab. **Positivliste statt freiem Befehl**, nur
auf `127.0.0.1` gebunden. Ein fertiger Lauf wird in einem Faden abgeholt, sonst
bliebe er Zombie und der naechste Start bekaeme fuer immer eine 409.

**Die Tagesliste ist der schärfste Kaderabgleich, den es gibt.** Sie zeigt alle
Mitglieder, und die Allianz hat genau 100 Plätze. Am 17.09.2026 fiel so eine
Umbenennung auf: `bonrow` stand in der Liste und in keinem Kader, genau ein
Kadername (`notCraidenAnymore`, davor `CraideN`) in keiner Liste — bei voller
100er-Liste ist das ein Beweis, keine Vermutung. **`apdRename` fasste dabei nicht
alle Tabellen an**: `ws_priority`, `ws_aussetzen` und `vs_tage` fehlten in der
Liste und wären als Waisen zurückgeblieben.

### Basen der Weltkarte — die eine Tabelle, die dem Server gehört

`karte_basen` (Migration `db/2026-09-08_karte_basen.sql`) ist die **bewusste
Ausnahme** von der Regel oben: Sie steht nicht in `TENANT_TABLES`, und das ist
kein Versehen. Die Weltkarte gehört dem **Server**, nicht einer Allianz — auf ihr
stehen die Basen aller Allianzen, und die fremden sind der interessantere Teil.
AR1S und XP33 spielen beide auf #1668 und sehen dieselbe Karte. Mandantengetrennt
hieße: fünfstellig viele Zeilen doppelt, zwei Scans nötig, zwei Wahrheiten über
denselben Fleck Karte.

Der Zuschnitt ist deshalb `server`, und er ist Pflicht. Weil `api.js` hier nicht
einspringt, steht **jede** Abfrage in `src/core/basen.js` — dieselbe Begründung wie
beim Mandantenfilter: an einer Stelle kann man es nicht vergessen, an zwanzig
schon, und ein fehlender Server-Filter zeigte still die Karte einer fremden Welt.

**Der Schlüssel ist die Koordinate, nicht der Name.** Auf einem Feld steht genau
eine Basis; wer umzieht, hinterlässt seinen Platz einem anderen (`on_conflict=
server,x,y`). Über den Namen zusammenzufassen scheiterte daran, dass die
Texterkennung ihn in zwei Nachbarkacheln verschieden liest — aus einer Basis
würden zwei.

**Der Ort allein reicht aber nicht ganz.** Die gerechnete Weltkoordinate streut um
einen halben Punkt; fällt sie in zwei Kacheln links und rechts der Rundungsgrenze,
wird aus einer Basis doch wieder zwei — am Archiv `karte_nah` traf das 9 % aller
Zeilen (`Recklinghausen` neben `Reckiighausen`). `_nachbarn_falten` in
`auswerten.py` zieht Nachbarfelder mit **ähnlichem** Namen zusammen; der Name muss
dabei mitentscheiden, weil auf zwei benachbarten Feldern sehr wohl zwei
verschiedene Basen stehen können.

**`name` ist, was auf der Karte stand — nicht, wer es sein könnte.** Bis zum
08.09.2026 ersetzte `basen_bauen` den gelesenen Namen durch den Kadernamen, wenn
`match.zuordnen` einen fand. Für den WS-Dienst ist das der richtige Griff — dort
wird eine Liste von Kadermitgliedern gegen den Kader gehalten. Hier ist es der
falsche: gegen 279 Kadernamen laufen die **1934** Namen der ganzen Welt, von denen
fast keiner im Kader steht. Bei Schwelle 0,62 traf es 28, und davon war genau
*einer* unstrittig. Aus `Gabrypoonte` wurde viermal `HARRY POTTER`, aus
`FirefighterPL` `LittleFighter`, aus `Oberst Fabi` `bestbrudi` — gut gelesene,
fremde Spieler, deren Name ausgerechnet in der Spalte verschwand, nach der gesucht
wird. Der Kaderabgleich steht nur noch als **Bericht** im Lauf (ab Ähnlichkeit
`BERICHT_MIN`), geschrieben wird er nicht.

`name_roh` daneben ist der unveränderte OCR-Text samt Allianz-Klammer und
Flaggenresten. Er bleibt stehen, damit eine später verbesserte Erkennung an genau
demselben Material gemessen werden kann, statt neu scannen zu müssen — dieselbe
Haltung wie beim Kartenarchiv selbst. In der Oberfläche steht er klein unter dem
Namen, wenn beide auseinandergehen; ohne Namen steht er an dessen Stelle.

**Ohne lesbaren Namen, aber mit Stufe, ist es trotzdem eine Basis.** Bis zum
09.09.2026 verwarf `basen_bauen` jeden Fund unter drei Zeichen — und mit dem
Namen die richtig gerechnete Koordinate und die gelesene Stufe. Genau so fehlte
Bens eigene Basis (481/554, Stufe 33) vollständig, obwohl der Scan sie gefunden
hatte; die Karte hatte dort ein Loch, wo nachweislich eine Basis steht. Heute
steht sie mit `name` NULL da.

Die **Stufe ist dabei die Bedingung**, nicht Zierrat: von 73 namenlosen Funden in
`karte_kern` tragen 6 eine, die übrigen sind Kartenbeschriftungen und am
Kachelrand angeschnittene Schilder. Über beide Archive stehen so 21 Zeilen ohne
Namen in der Tabelle, bei 2294 Basen insgesamt. Ohne dieses Merkmal zu schreiben
hieße, die Beschriftungen als namenlose Basen in die Karte zu holen — und gegen
die hilft `_marken_aussortieren` dann nicht mehr, denn es urteilt über den Namen.

**Ein neuer Lauf räumt seine Karteileichen weg** (`_verwaiste_raeumen`). Der
Upsert löscht nichts: verschiebt sich eine Koordinate zwischen zwei Läufen um
eine Einheit — weil die Erkennung den Namen anders liest und das Falten anders
ausfällt —, bleibt die alte Zeile daneben stehen und sieht in der Suche wie ein
zweiter Spieler aus. Am 09.09.2026 waren das nach einem zweiten Lauf über
`karte_kern` 22 Zeilen auf 873 Basen und am Kartenrand 48 auf 1319. Aufgeräumt
wird **je Archiv** (`quelle`), nicht je Server: ein Archiv deckt sein Gebiet
vollständig ab, über den Server hinweg zu löschen nähme die Nachbararchive mit.

Gefüllt wird sie aus dem Kartenarchiv:
`python -m scripts.karten_archiv.auswerten --name karte_nah --schreiben`.

Angezeigt und durchsucht wird sie unter „Basen" (`src/ui/basen.js`). **Die Suche
läuft in der Datenbank, nicht im Browser** — eine abgescannte Karte hat
fünfstellig viele Basen. Ein Stern ist der Platzhalter (`Ben*men` findet
`Ben_the_men`), ohne Stern wird als Teilstring gesucht. Getippte `%` und `_`
werden maskiert: `_` steckt in echten Namen, und ungeschützt wäre es ein
„irgendein Zeichen". Getestet in `tests/basen_suche.spec.js`.

#### Was auf einem Namensschild steht, und wie es gelesen wird

Der Bannerfinder liefert die Stelle, `banner.schild_lesen` den Inhalt. Beides
gehört getrennt: `pruefe_banner.py` misst, **ob** ein Schild gefunden wird,
`pruefe_namen.py` misst, **was** darauf steht.

**Zwei Schwellen, nicht eine.** `SCHWELLE` (12,0) stammt aus der Zeit, als hinter
dem Finder noch nichts stand, das einen Fehlfund wieder aussortiert — und sie
kostete echte Basen: `Skirata33` kam auf 9,7 Punkte, `HY07` auf 10,5, beide
fehlten ganz auf der Karte.

Woran das lag, ist am Bild abzulesen und **kein Schriftproblem**: Skirata33 trägt
einen hellblauen Rahmen auf hellem Sand. Von den beiden Faktoren der Punktzahl
steht die Schriftenergie mit 36,7 gut da (Nachbar: 50,5), das **Kantenpaar**
bricht auf 16,2 ein (Nachbar: 49,4) — der Finder sucht ein *dunkles* Band, und
dort gibt es die Helligkeitsstufe schlicht nicht. Eine bessere Kantenmessung
hilft deshalb nicht; die zweite Schwelle schon. Gesucht wird deshalb bis `SCHWELLE_SCHWACH` (9,0)
hinunter; was zwischen beiden liegt, muss in `basen_bauen` **eine gelesene Stufe
oder ein Allianz-Kürzel** mitbringen. Das ist der Unterschied zwischen einer
Basis und einer Kartenbeschriftung: `Nord-Kanone`, `Lv. 70 Großer Sandwurm`,
`Vorbereitung` und die laufende Uhr `05:07` haben keins von beidem. Über
`karte_kern` gemessen: 23 echte Basen dazu, von 13 mitgekommenen Beschriftungen
blieb eine übrig.

Die Suche des Archivs setzt `pruefe_banner.py` deshalb als **zweite Zeile** mit:
sonst prüfte es eine Einstellung, die im Archiv gar nicht läuft (21 Funde,
20 / 21 getroffen bei der sicheren Schwelle · 22 Funde, 20 / 21 bei der
schwachen).

**Ein Bildmodell findet nicht mehr als der geometrische Finder.** Gegengeprüft am
09.09.2026 mit `deepseek-ocr:3b` im Grounding-Modus, das Textkästen mit
Koordinaten liefert — über drei Kacheln des Kerngebiets:

| Kachel | geometrisch 12,0 | geometrisch 9,0 | deepseek |
|---|---|---|---|
| `z011_k0003` (dicht) | 19 | 19 | 19, deckungsgleich |
| `z011_k0004` (`Skirata33`) | 18 | 20 | 20 — die beiden Extras sind Bergbaustützpunkt und `Lv.6` |
| `z011_k0002` (`HY07`) | 23 | 24 | 22 — der geometrische findet zwei mehr |

Kein einziges Namensschild, das nur das Modell sieht. Der Engpass lag also nicht
beim Finden, sondern bei der Schwelle und beim Lesen.

**Drei Stichproben, und jede weitere gibt es, weil die vorige einen Fall nicht
enthielt.** Die erste (24 Schilder aus `karte_nah`) stammt vom Kartenrand und
besteht ausschließlich aus *weißen* Namen. Sie war grün, während im Kerngebiet
**kein einziger** Name zu gebrauchen war — aufgefallen ist das Ben, nicht der
Prüfung. Deshalb kam am 09.09.2026 eine zweite über 18 Schilder der eigenen
Allianz dazu (`karte_kern`, blaue Namen, verzierte Rahmen, ein gesperrt
geschriebener Name). Auch die war grün, als **Bens eigene Basis** unlesbar
blieb: sie steht gelbgrün auf der Karte, und in beiden Stichproben kommt diese
Farbe nicht vor. Die dritte hält genau das fest (`Ben the men` gelbgrün,
`Puwe` hellblau im Goldrahmen) und dazu den Fall, an dem die Ziffernmodi
auseinandergingen (`ΧΑΣΑΠΗΣ`, Stufe 34 statt 36). Dessen Name ist griechisch und
mit dem lateinischen Zeichensatz nicht zu lesen — er zählt deshalb bei der Stufe
mit und beim Namen nicht.

| | vorher | jetzt |
|---|---|---|
| **Kartenrand, weiß** — genau richtig | 0 / 20 | 19 / 20 |
| brauchbar (≥ 0,75) | 6 / 20 | 19 / 20 |
| **Eigene Allianz, blau** — genau richtig | 0 / 16 | 15 / 16 |
| brauchbar (≥ 0,75) | 0 / 16 | 16 / 16 |
| **Gelbgrün und Goldrahmen** — genau richtig | 0 / 2 | 2 / 2 |
| Stufe der dritten Stichprobe | 2 / 3 | 3 / 3 |
| Stufe am Kartenrand | gar nicht | 19 / 21, keine falsche |
| Stufe im Kerngebiet | gar nicht | 14 / 18, keine falsche |
| erfundene Allianz-Kürzel | 2 | 0 |

Gescannt sind zwei Gebiete, jedes als eigenes Archiv — die Zeilennummerierung
beginnt je Lauf bei 0, ein gemeinsames Archiv überschriebe sich selbst. Beide
schreiben in dieselbe Tabelle.

| Archiv | Gebiet | Basen | mit Stufe | mit Allianz |
|---|---|---|---|---|
| `karte_nah` | Y 1–324 (Kartenrand) | 1399 | 87 % | 9 % |
| `karte_kern` | X 442–584, Y 400–594 | 886 | 80 % | 95 % |

Der Unterschied zwischen beiden ist kein Messfehler, sondern die Karte selbst: am
Rand siedeln die Allianzlosen in schmucklosen Basen, im Kern stehen die Allianzen
mit geschmückten.

**Gelesen wird mit der Texterkennung von macOS** (`vision_ocr.swift`,
`VNRecognizeTextRequest`) — und zwar auf dem **farbigen** Ausschnitt, nicht auf
der freigestellten Maske. Sie sieht den Grauverlauf der Schrift, den die Maske
gerade wegwirft: aus `LittieFighter` wird `LittleFighter`, aus `marjas2` wieder
`marjo42`.

**Sechs Erkennungen sind über dieselben 38 Wahrheiten gelaufen** (09.09.2026),
alle mit demselben Ausschnitt:

| Erkennung | genau | brauchbar |
|---|---|---|
| macOS Vision, Farbband | **33 / 38** | 37 |
| `deepseek-ocr:3b` (Ollama), großer Ausschnitt | 32 / 38 | 36 |
| `deepseek-ocr:3b`, Farbband | 31 / 38 | 36 |
| `qwen2.5vl:7b` (Ollama) | 29 / 38 | 32 |
| Tesseract auf dem Farbband | 27 / 38 | 35 |
| Tesseract auf der Maske (Ausgangsstand) | 24 / 38 | 36 |
| `llama3.2-vision:11b` | — | Ollama lehnt die Anfrage ab |

Eine Zeichenmehrheit über Vision + deepseek + qwen käme auf 35 / 38 — für einen
Namen mehr kostet sie das Sechzigfache an Rechenzeit (3 s statt 0,05 s je Schild)
und wurde deshalb verworfen. **`deepseek-ocr` braucht einen kurzen Befehl**
(`<image>\nFree OCR.`); auf eine ausführliche Anweisung antwortet es leer.

**Zwei mechanische Nachbesserungen holen die letzten zwei Namen** — von 34 auf
36 von 38:

- **Zwillinge** (`entzwillingen`): Vision greift regelmäßig zu kyrillischen und
  griechischen Doppelgängern lateinischer Zeichen — aus `[XP33]Mo By` wurde
  `ХРЗЗMo By`, aus `Commander 1c6a31657` wurde `1сба31657`. Am Bildschirm sieht
  das gleich aus, in der Suche ist es ein anderer Name. Ersetzt wird nur, wenn
  der Rest lateinisch ist; ein wirklich griechisch geschriebener Name
  (`ΧΑΣΑΠΗΣ`) besteht ganz aus fremden Zeichen und bleibt stehen.
- **Die vom Spiel vergebenen Namen** (`_erzeugten_namen_glaetten`):
  `Commander`/`Kommandant` plus Hexzahl und Serverkennung. Genau dort verwechselt
  jede Erkennung `1` mit `l`/`i`; hinter dem Wort können aber nur Hexziffern
  stehen, die Korrektur ist also begründet statt geraten.

`name_roh` bleibt davon unberührt — er ist der Beleg und wird nicht geglättet.

Die Maske bleibt trotzdem nötig: sie sagt, **wo** das Namensband liegt und welche
Farbe die Schrift hat. Tesseract bleibt der Rückfall, wenn Vision nichts liefert
oder es die Werkzeuge nicht gibt (kein macOS, kein Swift) — dort ist die
Erkennung schlechter, aber der Lauf bricht nicht ab. Das Werkzeug wird beim
ersten Gebrauch nach `~/.local/state/warsync/vision_ocr` gebaut und läuft als
**Dienst**: ein Einzelaufruf kostet 0,17 s, im Dienst sind es 0,05 s je Schild —
bei zweieinhalbtausend Schildern je Archiv der Unterschied zwischen sieben
Minuten und zwei. Die Ziffern des Stufenschilds liest weiterhin Tesseract mit
Ziffern-Whitelist.

**Ein Spielername hat keinen Balken.** Er steht als helle Schrift mit dunklem Saum
frei auf der Karte; nur Allianz- und Gebäudeschilder haben die dunkle Leiste, für
die `_kasten` gebaut ist. Genau daran scheiterte die alte Lesung: sie schnitt den
gemessenen Balken aus und schwellte ihn hart — bei einem freistehenden Namen war
das mal das halbe Wort, mal Wiese. `_schriftmaske` stellt stattdessen die Schrift
frei und wirft lange waagerechte Strukturen weg — Zäune und Zierrahmen sind hell
wie die Schrift, aber kein Buchstabenstrich ist eine Bannerbreite lang.

**Die Schriftfarbe wird gemessen, nicht festgelegt** (`_schriftfarbe`). An dieser
Stelle stand eine feste Sättigungsgrenze, und sie ist an *jeder* neuen Namensfarbe
gebrochen — beide Male erst dann, als jemandem ein Ausfall auffiel:

- `S < 70` ließ die **hellblauen** Namen der eigenen Allianz nicht durch (gemessen
  S um 96, H um 97): von rund tausend Glyphenpixeln kamen 128 an, aus
  `[XP33]S a p p h y` wurde `z£Ts`, und in der ganzen Kachel war kein Name zu
  gebrauchen.
- `S < 105` ließ die **gelbgrüne** Schrift von Bens eigener Basis nicht durch.
  Gelesen wurde `zr`; weil ein Fund ohne Namen damals ganz herausflog, fehlte die
  Basis in der Tabelle vollständig — mit richtiger Koordinate und richtig
  gelesener Stufe 33 daneben.

Deshalb entscheidet keine Konstante mehr, sondern das Bild: der erste Durchgang
findet mit einer **permissiven** Maske (nur Helligkeit) das Namensband, im Band
gewinnt die größte Farbgruppe, und der zweite Durchgang liest nur diese Farbe.
Das stellt sich auf jede Namensfarbe selbst ein und wirft nebenbei den Zierrahmen
weg: bei `Puwe` gewinnt über den ganzen Ausschnitt der Goldrahmen, im Band die
hellblaue Schrift.

**Beschriftungen sind in reiner Farbe gezeichnet, Namen nie** — das ersetzt, was
vorher die Sättigungsgrenze nebenbei besorgte. Über die Gruppe im Band gemessen:
Bergbaustützpunkt, Pyramide, Gerichtsplatz und Allianz-Banner liegen bei
S-Median 255, Spielernamen bei 113 bis 157. Ab `BESCHRIFTUNG_S` gilt der Fund
deshalb als Beschriftung und wird nicht gelesen.

**Die vier Ziffernmodi müssen sich einig sein.** Vorher gewann der erste, der
überhaupt eine plausible Zahl lieferte — und bei `ΧΑΣΑΠΗΣ` (458/557) war das der
falsche: psm 8 und 13 lasen `36`, psm 10 und 7 `34`, in der Tabelle stand 36. Der
Ziffernblock ist dort oben angeschnitten, die `4` verliert ihre Spitze. Das
Fenster zu vergrößern hilft nicht — bei 0,80 Bannerhöhen fällt der Kartenrand von
19 auf 8 von 21 richtigen Stufen, weil dann das Namensband mit im Block steht.
Uneinigkeit ist das ehrlichere Signal: wo die Modi auseinandergehen, ist die
Ziffer beschädigt, und `NULL` heißt „nicht gelesen".

**Die Stufe bekommt zwei Anläufe.** Sie hängt an der Unterkante des Namensbandes,
und das Farbband fällt gelegentlich enger aus als das permissive — bei
`Ghost Fighter X` so weit, dass das Hexagon aus dem Suchfenster fällt. Über
`karte_kern` gemessen kostete das 14 von 905 Stufen, keine davon falsch. Der
zweite Anlauf am permissiven Band holt sie zurück.

**Genommen wird der breiteste Schriftblock in Reichweite**, nicht der unter der
Fundstelle. Bei geschmückten Basen misst `_kasten` die Leiste des Zierrahmens, und
deren Mitte liegt neben dem Namen: bei `marjo42` landete sie auf einer
Vogelscheuche am Rahmenende, gelesen wurde `r`. Der Name ist dagegen immer der
längste zusammenhängende Text im Band. Die Reichweite von drei Bannerhöhen ist der
Schutz davor, den Nachbarn zu greifen — im dichten Kerngebiet stehen die Schilder
rund 390 px auseinander.

**Die Landesflagge gehört nicht zum Namen** — sie hing vorher an jedem zweiten
Namen als `L=`, `Ka` oder `f=`. Erkannt wird sie an der **Farbe**, nicht an der
Größe: eine Flagge ist bunt, Schrift ist es nie. Über 22 Schilder gemessen liegt
der Anteil gesättigter Pixel unter den hellen bei einer Flagge zwischen 0,20 und
0,84, bei Text zwischen 0,00 und 0,06 — dazwischen ist nichts. Vorher entschied
die Breite des letzten Stücks, und das ging zweimal daneben: bei den gesperrt
geschriebenen Namen (`S a p p h y`) steht jeder Buchstabe für sich und der letzte
flog als vermeintliche Flagge heraus, und bei `Mo By` verschwand das zweite Wort.

**Die Stufe wird jetzt gelesen** — aus dem Schild unter dem Namen, nicht aus dem
Banner. Sechs Dinge daran haben je einen falschen oder fehlenden Wert erzeugt,
bevor sie dastanden:

- **Geschlossen wird über die Ziffern hinweg.** Sie zerschneiden das Hexagon in
  zwei Lappen; ohne das Schließen misst man einen Lappen und liest die halbe Zahl.
- **Dünne Stege werden vorher weggeputzt.** Die Zierrahmen der geschmückten Basen
  — Geländer, Goldbögen, Blütenranken — laufen quer durch das Schild und
  verschmelzen mit ihm. Ein Öffnen mit senkrechtem Element trennt beides.
- **Waagerecht entscheidet die Fundstelle, senkrecht die Zoomstufe.** Die Breite
  des Schilds ist verlässlich, seine Höhe nicht: verschmilzt es mit dem Bauwerk
  darunter, füllt die Fläche das ganze Suchfenster (Höhe 56 statt 23). Wo es
  senkrecht sitzt, muss man aber nicht messen — die Unterkante steht 0,53
  Bannerhöhen unter dem Namensband (an 19 Schildern gemessen, Streuung 20–31 px
  um 25). Nur eine senkrecht plausible Fläche zählt mit ihrer eigenen Unterkante.
- **Ein angeschnittenes Schild gilt als ungelesen**, sonst wird aus 12 eine 2.
  Dazu die Gegenprobe „so viele Ziffern wie Klumpen".
- **Hell heißt auch hier nicht weiß — diesmal andersherum.** Beim Namen war die
  Maske zu eng (siehe oben), beim Schild war sie zu weit: `S < 60` ließ das helle
  Hintergrundbild hinter der Basis mit durch (Rüstung, Fell, Eis — alles blass und
  kaum gesättigt). Es berührt das Hexagon direkt, das Schließen verschmolz beides
  zu einem Klumpen, und der fiel durch die Breitenprüfung. `S < 40` hält die
  Verunreinigung unter der Schwelle, ohne das Hexagon selbst zu verlieren.
- **Angeschnitten wird an der Ziffer gemessen, nicht am Kastenrand.** Vorher zählte
  jeder dunkle Pixel am Rand als Schnitt — traf aber meist die Facettenkante des
  Hexagons oder eine dünne Zierlinie, die quer durch den ganzen Block läuft und
  links wie rechts den Rand berührt, ohne eine Ziffer zu sein. Ein kurzes
  waagerechtes Öffnen putzt sie weg; angeschnitten ist nur noch, wessen
  **Ziffernklumpen** selbst den Rand berührt.

Das ist der Unterschied zwischen Kartenrand und Kerngebiet: dort ist fast jede
Basis geschmückt, und die Stufe fiel deshalb auf 16 % gegen 78 % am Rand. Die
ersten vier Punkte hoben das Kerngebiet auf 40 %, die beiden letzten auf **80 %**
— der Rand stieg dabei von 78 auf 84 %. `NULL` heißt weiterhin „nicht gelesen",
nicht „Stufe 0" — die Oberfläche zeigt einen Strich.

**Gemessen wird gefaltet, nicht roh.** Am Kartenrand steht fast jede Basis in zwei
Kacheln; `_nachbarn_falten` nimmt die Stufe, die eine der beiden gelesen hat.
131 zusätzlich gelesene Rohschilder ergaben dort deshalb nur 80 Zeilen mehr — wer
den Nutzen einer Änderung an den Rohfunden abliest, überschätzt ihn.

**Ein Kürzel braucht eine Klammer, und es kommt darauf an, welche.** In `zerlegen`
durfte die öffnende Klammer fehlen und die Ziffer `1` als schließende gelten. Das
zerlegte jeden klammerlosen Namen mit einer Eins: `Conand1990` wurde zur Allianz
`ONAND` mit dem Namen `990`. Getroffen hat es fast nur die, um die es geht — **19
von 20** Basen am Kartenrand tragen überhaupt kein Kürzel, denn dort siedeln die
Allianzlosen. Heute gibt es zwei Regeln:

- **Mit öffnender Klammer** darf die schließende ein OCR-Zwilling sein (`1`, `l`,
  `I`, noch ein `[`). Vorn steht dann ein Zeichen, mit dem kein Spielername
  beginnt — das trägt die Unsicherheit. Die öffnende kommt oft doppelt (`[(`), im
  Kürzel stehen Leerzeichen (`[KU RL]`) und Zeichen-Zwillinge (`[C¥KA}`).
- **Ohne öffnende Klammer** — sie fällt am Bildrand weg (`ZOMG]Oli`) — muss die
  schließende eine *echte* sein. Ziffern und Buchstaben sind hier ausgeschlossen;
  genau dort saß der alte Fehler.

Das brachte die Klammerreste im Namen von 117 auf 15 Zeilen.

**Zwischen den Klammern stehen vier Zeichen, und die gehören nie zum Namen**
(seit 11.09.2026). Die schließende Klammer liest die Erkennung ebenso oft als
`J`, `/`, `T`, `i` oder Leerzeichen wie als `]` — in rund 150 Basen stand das
Kürzel danach im Namen (`[CYKAJRYKITA6`, `[NOGE Rostig`) oder fraß den
Namensanfang mit (`[NOGEJklausi2` → Allianz `NOGEJK`). Steht die öffnende
Klammer da, sind die nächsten **vier** Zeichen das Kürzel und das fünfte die
Klammer, egal als was sie ankam (`_TAG_VIER` in `banner.py`). Zwei Feinheiten:
nach einem Buchstaben-Zwilling folgt kein zweiter (`[CYKAJJOHNO` ist `JOHNO`),
und `i`/`j`/`T` sind nur vor Großbuchstabe oder Ziffer Klammer.

Drei Zeichen gibt es trotzdem — `[Wah]` steht über siebzigmal sauber gelesen da.
Deshalb baut `basen_bauen` aus dem ganzen Lauf ein **Verzeichnis der Kürzel**
(`kuerzel_sammeln`, ab drei Lesungen) und zerlegt jeden Rohtext damit noch
einmal. Das Verzeichnis trennt, was ohne Wissen nicht geht (`[NRLNVovan chick`,
`IKISSIZLIL 22`, `[WahlDr field`), und bringt Zwillinge auf eine Schreibweise
(`ARIS` → `AR1S`, `0WUB` → `OWUB`). Ohne öffnende Klammer braucht auch ein
bekanntes Kürzel ein Satzzeichen dahinter (`RPTC|paco 411`) — sonst verlöre ein
allianzloser `Wahlberg` seinen Anfang an `[Wah]`. Nach dem Zusammenführen zieht
`kuerzelrest_abziehen` ab, was vom Kürzel der längeren Lesung noch vorn hängt
(`iSSITipsx` neben `[kiSS]Tipsx`). Geprüft in `pruefe_kuerzel.py` an echten
Rohtexten, auch an denen, die **nicht** zerlegt werden dürfen.

**Beschriftungen sind keine Basen** (`_marken_aussortieren`). Der Bannerfinder
liefert auch die Allianz-Banner über den Gebieten und die Namen von
Kartenobjekten: `Wal` (von „Walhalla") stand 63-mal in der Tabelle, `Nortn German`
52-mal, `KISS OF WA` 21-mal, dazu `Lv. 4` und `Schatz des Sandwurms`. Der
Prüfstein ist die **Spielregel, nicht die Optik**: ein Spieler hat genau *eine*
Basis, also kann ein Name an vier weit auseinanderliegenden Orten kein
Spielername sein. Zwei frühere Anläufe scheiterten am Bild — die Schrifthöhe
trennt Banner und Spielernamen nicht (0,40–0,64 gegen 0,60–1,09 Bannerhöhen), und
das Stufenschild taugt nicht als Beweis, es fehlt bei jeder fünften echten Basis.
Drei Orte reichen ausdrücklich nicht: dort sind es meist zwei verschiedene
Spieler, deren Namen die Erkennung gleich gelesen hat.

Die Beschriftungen der Bergbaustützpunkte fallen schon vorher heraus — seit dem
09.09.2026 aber **ausdrücklich** und nicht mehr als Nebenwirkung einer festen
Sättigungsgrenze, die es nicht mehr gibt: `schild_lesen` verwirft, wessen
Schriftfarbe im Band rein ist (S-Median ab `BESCHRIFTUNG_S`).

Zwei Schilder der Stichprobe liest die Erkennung seitdem trotzdem: das
Allianz-Banner `[KURL] Kein Plan Allianz` und ein Gebäudeschild. Sie sind weiße
Schrift auf dunkler Leiste und damit optisch von einem Spielernamen nicht zu
unterscheiden — sie herauszuhalten ist Aufgabe der Spielregel oben, nicht der
Maske. `pruefe_namen.py` zeigt das als „Nicht-Spieler weg 1 / 3".

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

**Das Team-Schild folgt demselben Faktor** (0.02215 ≈ 14px bei 632px), in `renderTags`
wie in `buildKarteCanvas`. Es hing im Export an `cw/18` — bei 1206px Bildbreite 67px
statt 27px, gut zweieinhalbmal so groß wie im Fenster: im geposteten Bild lag es über
dem halben Kartenkopf, während die Vorschau ein kleines Schild zeigte. Größe, Polster,
Radius und der farbige Balken links stehen deshalb in denselben Verhältnissen zur
Schriftgröße wie im CSS. Getestet in `tests/ws_karte_label.spec.js` — gemessen wird die
Schrift, mit der die Canvas das Schild zeichnet, gegen die der Anzeige, hochgerechnet
auf die Bildbreite. Nur auf dem Desktop: am Handy zeigt die Anzeige das Schild bewusst
größer als der Maßstab hergibt (Untergrenze 11px), dort prüfte der Vergleich die
Ausnahme statt der Regel.

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

**Unter der Karte stehen sie in beiden Events.** Im Schluchtsturm als `SUBS`-Zeile
im Fahrplan des Übersichtsbilds, im Wüstensturm als eigener Streifen unter der
Aufstellungs-Karte (`renderErsatz` / `ersatzBand` in `src/ui/karte.js`). Beides
zählt: die Anzeige im Fenster **und** das PNG — das Bild ist das, was in der
Allianz gepostet wird, und wer nur die Anzeige ergänzt, lässt genau dort die
Ersatzbank weg. Drei Dinge dabei:

- **Der Streifen hängt unter dem Bild, nicht darauf.** Die Höhe der Canvas muss
  deshalb vor dem ersten Strich feststehen — ein späteres `c.height=…` löscht die
  Zeichenfläche wieder. `ersatzBand` rechnet das Maß, gezeichnet wird erst danach.
- **Gerechnet wird aus `wsErsatzListe()`, nicht aus dem DOM** — dieselbe Regel wie
  bei den Namensschildern, sonst hinge das PNG wieder an der Anzeigebreite.
- **Canvas ist kein DOM**: die Beschriftung läuft über `trs()`. Im HTML daneben
  steht sie deutsch und wird von der Anzeigeschicht übersetzt — dafür muss die
  Regel in `I18N_EN_RE` **vor** dem allgemeinen `\bErsatz\b` stehen, sonst
  übersetzt die generische nur das erste Wort und lässt den Rest deutsch stehen.

Getestet in `tests/ws_karte_ersatz.spec.js`.

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

### Leistungsindex: wer aus seinem Konto etwas macht (seit 14.09.2026)

Neben der Einsatz-Bilanz steht in der Anmeldeliste eine Marke `📈 1,99`: die
Einzelpunkte eines Spielers im Verhältnis zum **Median seines Events**
(`src/core/leistung.js`, angezeigt in `anmeldeZeile`). 1,0 ist Durchschnitt.

**Je Event normiert, weil die Rohzahl nichts aussagt.** Am 11.09.2026 holte
dieselbe Stammbesetzung 1,99 statt 2,25 Mio Punkte — ein Rückgang, der am
Gegner lag und nicht an ihr. Ungerechnet stünde nach einem schweren Event die
ganze Mannschaft schlechter da.

**Median statt Mittelwert.** In jedem Event steht einer weit oben (9,08 Mio
gegen einen Median von 0,91); gegen den Mittelwert gerechnet fiele die halbe
Mannschaft künstlich unter 1,0.

**Dass der Index trägt, ist gemessen, nicht behauptet.** Über die beiden
Freitage vom 04. und 11.09. liegt seine Korrelation zwischen zwei Wochen bei
**0,82**, und 22 von 32 Spielern landen beide Male auf derselben Seite des
Durchschnitts. Zum Anlass: am 11.09. waren 23 der 55 Eingesetzten neu, und sie
holten 0,79 Mio gegen 1,99 Mio der Rückkehrer — bei nur 17 % weniger
Heldenkraft. Pro Einheit Kontostärke also das Doppelte, und Stärke erklärt
höchstens ein Viertel des Abstands.

**Der Index misst Kills — deshalb steht die Eroberer-Marke daneben.** Die
Gesamtpunktzahl einer Kampfergebnis-Mail besteht zu **99,8 %** aus Killpunkten
(Legolio am 04.09.: 4.741.524 gesamt, davon 4.731.518 Kills). Eroberungspunkte
laufen in einer rund 230-mal kleineren Währung — der Beste kam auf 20.610 — und
verschwinden darin. GeneralBlücher stand mit 0,74 im unteren Drittel und war
trotzdem in **beiden** Team-A-Events der beste Eroberer. Eine Aufschlüsselung je
Spieler gibt die Mail nicht her; was sie hergibt, sind die vier Kategorie-Besten
je Event. Die stehen deshalb als `🏰 2×` **neben** dem Index statt in ihm: beide
Zahlen in eine zu pressen hieße, ein Umrechnungsverhältnis zu erfinden, das
niemand kennt.

Gelesen wird der MVP-Block von `mvp_lesen` in `scripts/ws_service/ergebnis.py`,
geschrieben werden `mvp_overall`/`mvp_kills`/`mvp_conquest`/`mvp_collect` in
`ws_events` (die Spalten gab es schon; gefüllt war nur `mvp_overall`, und zwar
aus Platz 1 der Rangliste statt aus dem Block). Drei Fallen stecken darin:

- **Erst paaren, dann zuordnen.** Rechts neben der Beschriftung steht auch das
  Bild des Spielers, und dessen Aufschrift (`GENERAL`, `BLÜCHER`) liegt der
  Zeile näher als der Name. Ein Eintrag ist nur, was einen **Wert direkt unter
  sich in derselben Spalte** hat.
- **Der Name steht über seiner Beschriftung**, nie darunter — bei einzeiliger
  39 px, bei zweizeiliger 102 px. Symmetrisch gegriffen holte die
  Eroberungszeile den Sammel-Besten, der 86 px darunter steht.
- **Verglichen wird auf dem Buchstabenkern.** `ʚɞASTRIDʚɞ` steht im Kader, im
  MVP-Block kam `ASTRID 1") |` an: gegen den vollen Namen 0,71 Ähnlichkeit und
  damit zu wenig, auf den Kern gebracht 0,92. Die Schwelle zu senken wäre der
  schlechtere Weg — sie muss fremde Namen weiter auseinanderhalten.

Ein Bericht von vor dem 14.09.2026 kennt den Block nicht; `bericht_laden` liest
ihn dann aus den **gespeicherten Belegbildern** nach (`mvp_aus_bildern`). Genau
dafür liegen sie da: eine später dazugekommene Auswertung soll an demselben
Material nachgeholt werden, statt das Spiel erneut abzufahren.

**Daneben steht die Handmarke ⭐** (`ws_players.stern`, Migration
`db/2026-09-14_ws_players_stern.sql`): „bringt viel", gesetzt von Hand per Klick
in der Anmeldeliste (`sternUmschalten`, nur `canAccess('ws')`). Sie ersetzt den
Index nicht, sie ergänzt ihn — was jemand an Spielverständnis, Absprache und
Eroberung mitbringt, sieht der Mensch und nicht die Punktzahl. Am 14.09.2026
nannte Cocojamb elf Namen im Allianz-Chat; **sieben** davon standen auch im Index
oben, **vier** nicht. Genau diese vier wären ohne Handmarke durchgefallen. Die
elf sind vorbelegt.

Der Klick schreibt **erst in die Anzeige, dann in die Datenbank**, und nimmt die
Marke bei einem Fehler zurück. Andersherum hinge sie bei jedem Umschalten am
Netz. Ungesetzt erscheint der Stern nur für den, der ihn setzen darf — sonst
stünde bei neunundneunzig Spielern ein leerer Stern herum, den die meisten gar
nicht anklicken können.

**Der leere Stern darf zurückhaltend sein, aber nicht unsichtbar.** Bei 12 px und
22 % Deckkraft war er das: Ben hat die Marke nach dem Einbau nicht gefunden und
für fehlend gehalten, und die Suche nach der Ursache ging erst durch Spalte,
PostgREST, Bundle-Stempel und Live-Stand — alles in Ordnung, der Schalter war
nur nicht zu sehen. Ein Bedienelement, das man suchen muss, existiert für den
Nutzer nicht. Seit dem 15.09.2026 sind es 15 px und 45 %; verwechseln lässt er
sich trotzdem nicht, denn der gesetzte ist gefüllt und golden, der ungesetzte
eine blasse Kontur.

Nicht zu verwechseln mit `⭐ Prio 3` aus der Prioliste: die trägt immer eine Zahl
und ist violett, die Handmarke ist ein blanker goldener Stern.

Getestet in `tests/leistungsindex.spec.js`. Der wichtigste Test ist der dritte:
der schwächste Spieler des Feldes trägt die Eroberer-Marke — fiele sie weg,
sähe er aus wie ein Totalausfall.

### Gemischte T1-Typen je Gebäude (seit 14.09.2026)

„When making the teams for each building, try to have mix types — avoid only
tanks." (Cocojamb, 14.09.2026). Ein Gebäude, an dem nur Tanks stehen, fällt
gegen den passenden Konter geschlossen um. `autoAssign` verteilte bis dahin
stur Index für Index gegen die Slot-Folge und kannte `t1_type` gar nicht.

**Umsortiert wird nur innerhalb einer Runde der Slot-Folge** (`typenMischen` in
`src/core/rotation.js`). Die Folge ist reihum gebaut: erst bekommt jedes Gebäude
seinen ersten Platz, dann jedes seinen zweiten. Wer in derselben Runde steht, ist
damit gleich stark eingestuft — sie untereinander zu tauschen ändert die
Stärke-Leiter nicht, sondern nur, an welches Gebäude jemand geht. Über
Rundengrenzen hinweg zu tauschen hieße dagegen, einen Schwächeren auf ein
wichtigeres Gebäude zu setzen; das ist eine andere Entscheidung und nicht diese.

**Ein T/A/M-Trio je Gebäude geht rechnerisch nicht auf.** XP33 hatte am
14.09.2026 **56 Tanks, 19 Air und 8 Missile** (16 ohne Eintrag) — die knappen
Typen reichen nicht für jedes Gebäude. Das Ziel ist deshalb nicht „überall alle
drei", sondern „den seltenen Typ dorthin, wo er noch fehlt". Über einen echten
Verteilungslauf gemessen kam dabei kein einziges sortenreines Gebäude heraus.

**Unbekannter Typ zählt als halb vertreten** — besser als eine Dopplung,
schlechter als ein Typ, der dem Gebäude noch ganz fehlt. Sonst zöge ein Spieler
ohne Eintrag jede Runde den Platz, der einem bekannten Typ mehr nützt.

Die Zonen-Zugehörigkeit und der Phase-2-Wechsel hängen weiterhin am Gebäude bzw.
an der Stärke-Reihenfolge und sind davon unberührt: die Menge der Gebäude-Plätze
ist dieselbe, nur die Paarung Spieler↔Gebäude ändert sich.

**Der Schluchtsturm folgt derselben Logik** (`csAutoAssign`): auch dort trifft
eine Reihum-Folge Index für Index auf die nach Stärke sortierten Spieler. Ein
Unterschied zählt: die Folge besteht dort aus **drei** Gruppen — Energieturm,
Datenzentren, Probenlager —, und die werden **getrennt** gemischt. Über die
Grenze hinweg zu tauschen verschöbe jemanden zwischen „dort stehen die Starken"
und „dort stehen die Schwächsten", und genau das ist die Stärke-Leiter aus dem
Abschnitt weiter unten. Der Energieturm hat als einzelnes Gebäude nichts zu
tauschen; er bleibt reine Stärke.

Getestet in `tests/ws_typen_mischen.spec.js` und
`tests/schluchtsturm_verteilung.spec.js` — beide Tests sind gegengeprüft: mit der
alten Zuteilung werden sie rot, mit der neuen grün. Im Schluchtsturm prüft ein
zweiter Test ausdrücklich, dass kein Spieler die Gruppengrenze überspringt.

### Die Anmeldeliste: eine Zeile für beide Events

Wüstensturm und Schluchtsturm hatten zwei verschiedene Listen. Der Schluchtsturm
eine schmale Zeile, der Wüstensturm einen Block mit T1–T4, Wachstums-Prognose,
Ø-Punkten und Anwesenheit seit Mai. Entschieden wird an dieser Stelle aber in
beiden Events dasselbe — wer spielt. Beide rendern deshalb **dieselbe** Zeile aus
`src/ui/anmeldung.js` (`anmeldeZeile`, `anmeldeBlock`); getrennte Listen liefen
sonst wieder auseinander, wie schon bei den Auswahlfeldern für den T1-Typ.

Was verschieden bleibt, steckt in `ctx` und wird von der jeweiligen Ansicht
gefüllt: Team-Farben (WS blau/orange, CS grün/blau), die Grenzen und der Name der
Funktion hinter den Knöpfen (`setTeamAssign` bzw. `csSetTeamAssign`). Das sind die
Stellen, an denen sich die Events wirklich unterscheiden — alles andere ist
Anzeige und gehört ins gemeinsame Modul.

**Sortiert wird nach der Gesamtkraft der Helden** (`nachHeldenkraft`), nicht mehr
nach `byRankThenHero`. Der Rang stand vorher davor und schob die R5/R4 nach oben,
unabhängig davon, was sie mitbringen; beim Einteilen zählt die Stärke, nicht die
Allianz-Position. `byRankThenHero` gilt weiter dort, wo es um die Allianz selbst
geht (Mitgliederliste, Allianz-Detail).

**Heldenkraft und T1 stehen nebeneinander.** Die eine Zahl sagt nichts über die
andere: 171 Mio Heldenkraft bei 30 Mio T1 ist ein anderer Spieler als umgekehrt,
und welche der beiden zählt, hängt am Event und an der Rolle. Der Umschalter
„Verteilung nach" (T1 ↔ Heldenkraft) steuert deshalb nur noch das Auto-Verteilen,
nicht mehr, was in der Liste steht.

Mitgegangen ist die Zeile „Bisher WS 5/1 · CS 2/0 · C 3" — sie stand vorher nur im
Wüstensturm und hängt jetzt in beiden Listen unter dem Namen. Weggefallen sind im
Wüstensturm T2–T4 samt Prognose, die Ø-Punkte, „Seit 08.05", das Rang-Abzeichen
und der ✕-Knopf; abgemeldet wird wie im Schluchtsturm mit einem zweiten Klick auf
den aktiven Knopf. `regStats()` hing allein an dieser Zeile und ist mit ihr weg.

**Der Name schrumpft nicht mehr als Letzter.** Alles rechts von ihm — Stern,
Eroberer-, Leistungs-, Aussetzen-, Prio- und Rollenmarke, Stärke, Zuverlässigkeit
und die sechs Knöpfe — trug `flex-shrink:0`, nachgeben konnte deshalb nur der
Name. Am Handy blieben ihm gemessene **22 px von 339 px**, also zwei Zeichen;
gekürzt wurde ausgerechnet das, wonach man in der Liste sucht. Sichtbar wurde es
erst, als die Zeile voll wurde (sechster Knopf mit `AC`/`BC`, dazu die Marken vom
14.09.2026) — auf dem Desktop war nie etwas abgeschnitten.

Alles rechts vom Namen steht deshalb in **einem** Block, und der bricht als Ganzes
um: `flex:1 1 140px` für den Namen, `flex:0 0 auto` für den Block. Auf dem Desktop
passt beides nebeneinander in die 546 px des Fensters (eine Zeile wie bisher,
235 px für den Namen), am Handy nicht — dort rutscht der Block darunter und der
Name bekommt die vollen 339 px. Zwei Dinge dabei:

- **Kein fester Sockel für den rechten Block.** Mit `flex:1 1 300px` wächst er auf
  dem Desktop über seinen Inhalt hinaus, und die Differenz ist Totraum hinter den
  Knöpfen: dem Namen blieben 190 px statt 235. Der Umbruch am Handy hing nie am
  Sockel, sondern daran, dass der Block als Ganzes umbricht.
- **Keine Medienabfrage.** Das Stylesheet hat keine, und eine geratene
  Gerätebreite wäre die falsche Größe — gerechnet wird mit dem Platz, der
  tatsächlich da ist.

Getestet in `tests/anmeldung_liste.spec.js` und `tests/anmeldung_namen.spec.js` —
der zweite misst in **beiden** Fenstergrößen, ob der Name in den Platz passt, den
er bekommt. Nur auf dem Desktop zu prüfen wäre blind gewesen.

**Die Marken stehen in einem festen Raster** (seit 16.09.2026). Sie standen als
Flex-Kette nebeneinander: fehlte eine, rückte jede folgende nach links. Dieselbe
Angabe stand damit in keinen zwei Zeilen an derselben Stelle — die Liste war nur
zu lesen, indem man jede Zeile einzeln entzifferte, statt eine Spalte
hinunterzusehen. Jede der sechs Marken hat deshalb ihren festen Platz
(`MARKEN_SLOTS` in `src/ui/anmeldung.js`), und fehlt sie, bleibt der Platz leer.

Vier Dinge, die zusammengehören:

- **Eine fehlende Marke braucht eine leere Zelle.** In einem Grid füllt das erste
  Kind Spalte 1, das zweite Spalte 2. Ein `''` erzeugt **kein** Element, die
  nächste Marke rutschte also in dessen Spalte — genau der Fehler, der behoben
  werden soll. `MARKEN_SLOTS.map(…||'<span></span>')` ist der ganze Kniff, und
  die Gegenprobe im Test hängt an dieser einen Stelle.
- **Das Raster steht auf einer eigenen Zeile.** Gemessen braucht es 342 px; in
  der Namensspalte stünden am Desktop 235 px zur Verfügung, in der bisherigen
  Kette neben Stärke, Zuverlässigkeit und sechs Knöpfen rund 110 px. Ein starres
  Raster **und** einzeilig schließen sich damit aus — die sechs Knöpfe, Stärke
  und Zuverlässigkeit belegen allein 275 px der 572 px. Der Preis ist eine um
  16 px höhere Zeile je Spieler.
- **Die Breiten sind gemessen, nicht geraten**, mit je einem Pixel Reserve:
  `🏰 12×` 42,8 · `📈 12,99` 52,4 · `⛔ Aussetzen ✕` 85,7 · `⭐ Prio 12` 58,1 ·
  `Warteliste` 59,3. Am Handy stehen dem Raster nur **339 px** zur Verfügung; ein
  erster Anlauf mit großzügigen Werten und 6 px Abstand kam auf 358 px und lief
  rechts aus der Zeile. Wer eine Marke um ein Zeichen verlängert, muss hier
  nachmessen.
- **Nur die letzte Spalte darf nachgeben** (`minmax(0,60px)`). 342 px gegen
  339 px geht um drei Pixel nicht auf, und die Rolle ist die richtige Stelle
  dafür: Sie steht am Ende, ihr Kürzen verschiebt also keine Position, und von
  ihren vier Werten braucht nur `Warteliste` die volle Breite. Das Badge trägt
  deshalb `text-overflow:ellipsis` — ohne das liefe es über den Zeilenrand.

Getestet in `tests/anmeldung_raster.spec.js`, und der Test ist gegengeprüft: ohne
die leeren Zellen wird er rot, und zwar in der Zeile, der die vorderen Marken
fehlen. Er misst die x-Position jeder Marke in **jeder** Zeile gegen die erste —
das ist das, was der Nutzer sieht. Die zweite Prüfung („passt in die Zeile") wäre
allein wertlos, die erste ohne sie ebenso: sechs Nullspalten stünden auch
„überall gleich".

### Der Reiter „🧮 Verteilung": wer diesmal zuschaut (seit 16.09.2026)

Zwischen Anmeldung und Aufstellung, und genau dazwischen gehört er: die
Anmeldung sagt, wer will, die Aufstellung, wer wo steht — hier wird entschieden,
**wer keinen der 60 Plätze bekommt**. Logik in `src/core/zuteilung.js`, Anzeige
in `src/ui/zuteilung.js`, ein Knopf rechnet.

**Die gemeldete Zeit ist die Nebenbedingung, nicht der Wunsch des Planers.** Wer
sich für 13:00 gemeldet hat, steht in der A-Liste — das Kürzel trägt sie mit
(`AC` heißt „für A gemeldet, kein Platz"). Daraus folgt die eigentliche
Auskunft, und sie war vorher nirgends sichtbar: am 16.09.2026 standen **31
Leute für 30 A-Plätze und 39 für 30 B-Plätze**. Team A ist strukturell leer,
Team B überfüllt; die Ausschluss-Entscheidung ist fast vollständig eine
Entscheidung über Team B. Jemanden hinüberzuschieben hieße, ihn auf eine Zeit
einzuteilen, für die er sich nicht gemeldet hat — möglich (`Puwe` steht so da),
aber eine Wette darauf, dass er erscheint.

**`AE`/`BE` ist kein Ausschluss.** Im Wüstensturm spielen alle 30 gleichzeitig;
der Ersatz bekommt nur kein Gebäude. Wer wirklich zuschaut, steht auf `AC`/`BC`
— und nur diese Liste ist die Entscheidung.

Die Regeln greifen in dieser Reihenfolge (`AUSSCHLUSS_REGELN`):

1. **Wer sich vorher abgemeldet hat, wird nicht eingeplant** — und ist
   entschuldigt (siehe unten).
2. **Die stärksten `fixCount` je Team haben einen festen Platz** und schauen nie
   zu — auch nicht nach einem Fehlen.
3. **Wer gefehlt hat, setzt aus** — die ⛔-Marke, die die Allianz sich selbst
   gegeben hat. Am 16.09. waren das fünf, und sie lösten Team A allein auf.
4. **Ein Stern schützt.**
5. **Danach der Leistungsindex**, und eine **Prio-Marke wiegt einen halben
   Index** (`ZUT_PRIO_BONUS`).
6. Bei Gleichstand die Stärke.

**Die Zahl der festen Plätze steht im Kopf des Reiters** (seit 18.09.2026).
`alliances.ws_fixed_count` (Default 15) gab es schon, bedient unter „Aufstellung
→ ⚙ Erweitert" — sie wirkte aber nur auf `computeRoster()` und war dem
Verteilungs-Reiter unbekannt. Jetzt reicht `ui/zuteilung.js` sie als `fixCount`
hinein (core darf nicht auf ui zugreifen), und beide Stepper rufen dieselbe
`changeWsFixedCount` auf — zwei Bedienstellen, **eine** Fassung der Logik.
Ein fester Platz ist außerdem kein Wackelkandidat an der Schnittkante und wird
vom Stern-Vortritt nicht verdrängt; der **Ersatz-Wunsch** schlägt ihn dagegen
weiterhin, denn dort steht jemand freiwillig und spielt ja mit.
Die Rückfallzeile im Überhang (»sind alle fest, muss trotzdem einer gehen«) ist
kein toter Code: ohne sie liefe die Schleife endlos, sobald jemand `fixCount`
über die Zahl der Plätze hinaus stellte.

**Dass der Fixplatz die ⛔-Marke schlägt, ist nur zusammen mit der
Vorab-Abmeldung richtig.** Sonst hieße „fest gesetzt" auch „darf folgenlos
fehlen". `ws_abmeldung` (Migration `db/2026-09-18_ws_abmeldung.sql`, Logik
`src/core/abmeldung.js`, gesetzt mit 🚫 im Reiter) ist die Aussage „ich kann
diesen Freitag nicht" — eine eigene Tabelle, weil sie einem **künftigen** Event
gilt und dessen Teilnahme-Zeilen erst beim Anmeldeschluss entstehen. Drei
Wirkungen aus derselben Zeile: der Vorschlag plant ihn nicht ein (und **sein
Fixplatz verfällt nicht** — sonst bekäme der Nächststärkste keinen), die
Prio-Marke bleibt aus (`wsPrioVerrechnen` lässt ihn aus `ohnePlatz` heraus — sie
gleicht aus, dass jemand spielen *wollte*), und `wsFreezeTeam` schreibt
`ws_participation.excused = true`. **Daran hängt die eigentliche Zusage:**
`eintragen.py` schreibt für Entschuldigte keine `ws_aussetzen`-Zeile.

In der Anmeldeliste teilt sich die Marke den **Rasterplatz der ⛔-Marke** — beide
sagen dasselbe und schließen sich aus, und die Breiten in `MARKEN_SLOTS` sind
gemessen. Sie heißt deshalb **„🚫 Abwesend" und nicht „Abgemeldet"**: gemessen
85,4 px gegen 86 px Budget. Ein Zeichen mehr wäre rechts aus der Zeile gelaufen.

**Die Prio darf nicht absolut schützen** — das ist die Zeile, die beim ersten
Lauf falsch stand. Als harte Sperre flog `ZEUS XS` heraus (133 Mio, Index 0,74),
während `Little Kong` blieb (101 Mio, Index 0,19): eine Fairness-Regel, die die
Mannschaft schwächt statt sie zu drehen. Ein halber Index zieht jemanden an der
Grenze heraus, nicht jemanden, der weit unten steht — 0,19 + 0,5 bleibt unter
0,74, 0,33 + 0,5 liegt darüber.

**Ein Stern rückt nur am Rand der 20 vor, nicht mitten hinein** (`ZUT_STERN_INDEX`
1,5). Getauscht wird gegen den **schwächsten** der 20, und nur wenn der weder
Stern trägt noch den besseren Index hat. Ohne diese Enge verdrängte ein
116-Mio-Stern einen 132-Mio-Spieler, weil dessen Index zufällig niedriger war.

**Der Ersatz-Wunsch ist eine Aussage des Spielers, keine Schätzung über ihn**
(`ws_players.ersatz_wunsch`, Migration `db/2026-09-16_ws_players_ersatz_wunsch.sql`).
Longrow hat am 16.09.2026 gesagt, ihm sei es nicht so wichtig zu spielen; als
Name im Quelltext wäre das in einem Monat eine Zeile, die niemand mehr erklären
kann — dieselbe Falle wie beim Super-Admin. Er schlägt die Rangfolge: wer ihn
setzt, landet im Ersatz, auch wenn seine Kraft für die 20 reichte. Umgeschaltet
wird er im Reiter über 🪑, wie der Stern erst in der Anzeige, dann in der DB.

**Der Kasten „⇅ An der Schnittkante" zeigt, wo ein Tausch billig ist** (`ZUT_GRENZE_N`,
seit 16.09.2026): je Team links die drei Schwächsten, die spielen, rechts die drei
Stärksten, die zuschauen — mit dem Vergleichswert daneben. Zwischen ihnen liegen oft
Hundertstel, und nur dort lohnt es, von Hand zu tauschen. Wer eine ⛔-Marke trägt, steht
dort **nicht**: Aussetzen nach einem Fehlen ist eine Regel, keine Abwägung. Die Kante wird
**einmal** gerechnet und dann markiert *und* ausgegeben — zweimal formuliert lief die
Gegenprobe zum Test ins Leere, weil nur eine der beiden Fassungen kaputt war.

**Frühere C-Runden zählen mit** (`ZUT_GESAMT_BONUS` 0,2 je Runde, gedeckelt bei
`ZUT_GESAMT_MAX` 0,6). Die Prio-Marke fällt auf 0 zurück, sobald jemand wieder gespielt
hat — wer abwechselnd spielt und zuschaut, bekam deshalb nie einen Bonus, obwohl es ihn
über Monate immer wieder trifft. Der Deckel steht aus demselben Grund da wie die Begrenzung
der Prio-Marke: eine Summe ohne Grenze schlägt irgendwann jeden Leistungsunterschied.

**Der Effekt ist heute klein, und das ist kein Fehler der Regel, sondern der Datenlage:**
`c_total` steht am 16.09.2026 bei **allen 33** Spielern auf genau 1 — der Zähler läuft
erst seit zwei Anmeldeschlüssen. Ein flacher Bonus für alle ändert die Reihenfolge kaum;
sichtbar wurde genau ein Tausch (Stalker24601 rein, Snailnuts raus, Team A). Über Monate
wird die Spalte zum eigentlichen Signal — deshalb steht sie jetzt drin.

**Die Reihenfolge der Schritte ist der halbe Wert des Reiters.** Alle vier Töpfe
sind voll (20 + 10 je Team) — solange das so ist, nimmt Last War **keinen**
Wechsel an. `zuteilungSchritte` legt die Züge deshalb so, dass nach jedem
einzelnen Schritt jeder Zähler innerhalb seiner Grenze bleibt, und gruppiert sie
nach Blatt: sonst schaltet man zwanzigmal um. Ein Wechsel über die Teamgrenze
zerfällt in zwei Schritte — auf dem einen Blatt abmelden, auf dem anderen
setzen; anders ist er nicht zu bedienen. Hinter jedem Schritt stehen die vier
Zähler, wie sie danach im Spiel stehen müssen; das ist die Kontrolle, ob man
sich vertippt hat.

Zwei Fehler steckten darin, und beide fielen nur auf, weil die Ansicht die
**übrig gebliebenen Züge ausdrücklich meldet**, statt sie zu verschlucken:

- **Die Abbruchbremse rechnete mit der schrumpfenden Restliste.** Sie stand als
  `offen.length * 4 + 8` in der Schleifenbedingung, und `offen` wird mit jedem
  Zug kürzer: bei 39 Zügen war die Grenze nach 33 Schritten auf 32 gefallen und
  die Folge brach ab, während drei Züge offenstanden — Team B blieb auf 19/20.
  Die Grenze steht jetzt **vor** der Schleife fest.
- **Ein Ringtausch muss aufgebrochen werden.** Stehen nur noch Züge offen, deren
  Ziel voll ist (`A → AE` *und* `AE → A` bei 20/20 und 10/10), blockieren sie
  sich gegenseitig und kein Anfang ist möglich. Im Spiel löst man das, indem man
  einen abmeldet: sein Platz wird frei, die Kette läuft, und am Ende wird er
  wieder gesetzt. Das kostet einen Schritt mehr und steht in der Liste als
  „macht Platz, kommt unten wieder" — bewusst anders beschriftet als das
  Abmelden für einen Teamwechsel, sonst sucht man ihn auf dem falschen Blatt.

**Geschrieben wird nichts.** Eingeteilt wird im Spiel, das Werkzeug bekommt den
neuen Stand beim nächsten Scan. Ein Knopf „übernehmen" erzeugte genau die
Verwechslung, gegen die der Reiter gebaut ist: im Tool stünde die
Wunsch-Aufstellung, im Spiel die echte. Aus demselben Grund lebt der Vorschlag
nur im Modul und **nicht** im Planungsstand — eine gespeicherte alte Rechnung
sähe eine Woche später aus wie die Einteilung.

**Was der Reiter nicht wissen kann:** wer sich seit dem letzten Scan abgemeldet
hat, steht noch in `teamAssign` und nimmt einen Platz weg (am 16.09. zwei).
Ebenso kennt er die „beide Zeiten"-Auskunft nur für die ohne Platz (`ABC`) —
für Eingeteilte steht im Werkzeug nur das Team, nicht die gemeldete Zeit. Beides
steht als Hinweis im Kopf des Reiters, statt es zu verschweigen.

Getestet in `tests/zuteilung.spec.js`. Zwei der Tests sind gegengeprüft: ohne
den Ersatz-Wunsch und mit der Prio als hartem Schutz werden sie rot. Der
Ausschnitt dafür muss **nach unten begrenzt** werden — ohne die Grenze steht die
ganze Schrittliste mit im Text, und dort kommt jeder Name vor; ein Test darauf
ist immer grün.

### Assassinen halten kein Gebäude (Wüstensturm)

Bis zur Öffnung des Silos um Min 10:00 bewegen sich die Assassinen frei und nullen
Gegner — sie haben **keine feste Zuordnung**. Vorher standen sie als Stärkste vorn
im Pool und bekamen von `autoAssign` denselben Phase-1-Gebäudeplatz wie alle
anderen; die Ansage behauptete damit eine Stellung, die im Spiel niemand hält, und
das Gebäude galt als besetzt, obwohl niemand dort blieb.

Der Schnitt sitzt in `autoAssign` (`src/ui/buildings.js`): die Slot-Folge `slotSeqE`
wird erst **hinter** den Assassinen abgezählt (`bldPool = ph1.slice(assN)`). Die
wichtigsten Gebäude gehen damit an Arsenal und Söldner, die sie ab Min 10 räumen —
`z5Count` zählt deshalb nur noch diese beiden, denn wer kein Gebäude hatte, räumt
auch keins.

Vier Dinge, die zusammengehören:

- **Assassine und Gebäude schließen sich aus.** Wer im Rollen-Slot `ass` landet,
  verliert `bldAssign`/`bldAssignPh2`; wer von dort auf ein Gebäude gezogen wird,
  ist keiner mehr und wird Zonen-Spieler (`moveChip` in `src/ui/vs.js` führt `ass`
  bewusst nicht mehr in `_actualRole`). Beides zugleich wäre genau der Zustand, den
  es nicht geben darf.
- **Sie stehen unter der Karte, nicht darauf** — wie der Ersatz. In Phase 1 fehlen
  sie in jeder Zone, deshalb tragen der Streifen unter dem Kartenbild
  (`renderWSMapSvg`), der Kasten unter den Zonen-Karten (`wsZoneCards`), die
  Canvas-Karte (`_buildWSCardsCanvas` in `src/core/png.js`) und der Block
  `⚔ ASSASSINEN` in der Mail sie nach. Ohne das fehlten die stärksten Spieler im
  geposteten Phase-1-Bild vollständig.
- **Die Höhe des Streifens muss vor dem ersten Strich feststehen** (`assH`) — im
  SVG geht sie in die viewBox, dieselbe Regel wie beim Ersatz-Band.
- **In Phase 2 ändert sich nichts.** Ab Min 10:00 stehen die Assassinen wie gehabt
  in der Z5-Spalte am Silo; der Streifen darunter entfällt dort.

Getestet in `tests/ws_assassinen.spec.js`.

### Gebäude-Reihenfolge und Slots: eine Vorgabe, nicht drei

Die Reihenfolge in der Karte „📋 Gebäude-Strategie" entscheidet, welches Gebäude
die stärksten Spieler bekommt — `autoAssign` zählt die Slot-Folge in genau dieser
Reihenfolge ab. Sie stand als Literal an **drei** Stellen: `src/core/state.js`
sowie `moveBldPrio` und `renderStrategyCard` in `src/ui/buildings.js`. Drei Kopien
laufen auseinander, sobald jemand nur eine anfasst, und dann zeigt die Karte eine
andere Reihenfolge, als das Verschieben zugrunde legt. Sie steht deshalb nur noch
in `BLD_ORDER_DEFAULT` / `bldSlotsDefault()` in `src/core/state.js`.

Vorgabe seit dem 03.09.2026 ist der Stand, den XP33 eingestellt hatte: **Silo
zuerst** (80/s, ab Min 10 das wertvollste Einzelgebäude), dann die beiden
Ölraffinerien, dann die Lazarette; Arsenal und Söldnerfabrik hinten und mit `0`
Slots, weil Assassinen und Sammler Phase 2 abdecken. Team B hält die
Ölraffinerien mit vier statt zwei Plätzen — die Slots sind Kapazität, kein
Sollwert, und die Asymmetrie ist gewollt.

Drei Dinge, die zusammengehören:

- **Kopieren, nicht durchreichen.** `changeBldSlot` schreibt mit `bs[key]=…`
  direkt in das Objekt, das `getBldSlots` liefert. Käme dort die Vorgabe selbst
  heraus, veränderte ein Klick auf `+` den Standard für beide Teams und jede
  weitere Allianz — nach dem ersten Klick wäre der Standard nicht mehr der
  Standard. Deshalb `Object.freeze` auf der Liste und eine **Funktion** für die
  Slots, die jedes Mal ein frisches Objekt baut.
- **„↺ Standard" setzt nur die Reihenfolge zurück**, nicht Slots, Aufstellung
  oder Einteilung. Der Knopf sitzt in der Strategie-Karte direkt über den ▲▼ und
  fragt vorher nach: zwölf Gebäude von Hand zu sortieren ist Arbeit, und ein
  Fehlgriff wäre sie los. Bei bereits gültigem Standard ist er ausgegraut.
  Der Wochen-Reset (`resetWSAnmeldung`) fasst die Reihenfolge weiterhin **nicht**
  an — die andere Allianz hat ihre eigene und würde sie sonst beim Wochenwechsel
  verlieren.
- **Ein gekürzter Stand zählt als keiner.** `bldOrder()` nimmt einen gespeicherten
  Wert erst ab zwölf Einträgen; sonst verschwänden die fehlenden Gebäude aus der
  Karte, ohne dass jemand sie entfernt hätte.

Die Rückfrage läuft über den `trs()`-Umweg um `window.confirm`, und die
Anzeigeschicht faltet dabei jeden Zeilenumbruch zu einem Leerzeichen — der
Schlüssel in `I18N_EN` darf deshalb **kein** `\n` enthalten, sonst greift er nie.

Getestet in `tests/ws_gebaeude_standard.spec.js`.

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

### Die Stärke-Leiter der Auto-Verteilung (Schluchtsturm)

`csAutoAssign` verteilt in **einer** Reihenfolge, und die ist die Stärke:

1. die Stärksten werden **Assassinen** (Ziel Hochsicherheitslabor, kein Startgebäude),
2. dann der **Energieturm** (`CS_TURM`) — er wird voll besetzt, bevor ein
   Datenzentrum überhaupt jemanden bekommt,
3. dann gleichmäßig die **Datenzentren** (`CS_DZ`), reihum über beide,
4. **zuletzt die Probenlager** (`CS_LAGER`). Mit 15/s bringen sie am wenigsten ein
   und werden nicht umkämpft; dort stehen die Schwächsten richtig.

**Der Energieturm ist eine eigene Stufe, kein Teil der Gruppe „vorne"** (seit
16.09.2026). Er bringt mit 50/s mehr als beide Datenzentren zusammen (je 20/s)
und wird am härtesten umkämpft. Reihum über alle drei verteilt bekam er nur
jeden dritten Spieler — bei den Ordnungshütern die Ränge 6, 9, 12, 15 und 18 —
und stand damit mit derselben Mannschaft da wie ein halb so wertvolles
Datenzentrum. Heute sind es die Ränge 6 bis 10.

Zwei Fassungen davor lief Schritt 2 reihum über **alle sieben** Startgebäude. Die
Probenlager bekamen dadurch Spieler aus der Mitte des Feldes, und die beiden
Schwächsten standen am Energieturm und am Datenzentrum.

Vier Dinge, die zusammengehören:

- **Sortiert wird ausdrücklich nach `csPower`, nicht nach der Pool-Reihenfolge.**
  Der Pool ist `fest` (die Stärksten) plus `rotationHaupt`, und letztere stehen in
  der Reihenfolge, wer am längsten aussetzen musste. Wer überhaupt mitspielt, ist
  eine Frage der Fairness — welche Rolle er bekommt, eine der Stärke. Bei der
  Vorgabe (15 Fixplätze, 5 Assassinen) ändert die Sortierung nichts; erst wer die
  Fixplatz-Zahl unter die Zahl der Assassinen senkt, hätte sonst einen
  Rotations-Spieler statt des Stärksten im Labor. Welche Kennzahl gilt, entscheidet
  der Umschalter „Verteilung nach" (T1 ↔ Heldenkraft).
- **Reihum bleibt es innerhalb jeder Gruppe.** Kein Probenlager steht leer,
  solange ein anderes zwei Mann hat, und die Datenzentren gehen nie um mehr als
  einen Mann auseinander.
- **Ein vorgesehenes Gebäude bleibt trotzdem nie leer.** Reicht die Leiter nicht
  bis unten, stopft die Reparatur die Lücke mit dem **schwächsten** Platz eines
  überversorgten Gebäudes. Bei elf Angemeldeten (5 Assassinen, 6 übrig, drei
  Gebäude à 5 Plätzen) verschlänge der volle Energieturm sonst fast alles und
  das zweite Datenzentrum stünde mit 0/s da — teurer als der eine Platz, den der
  Turm dafür abgibt. Die Spitze bleibt am Turm (Ränge 6–9), die Lücken decken
  die Ränge 10 und 11. Danach wird die Folge **stabil nach Gruppe** sortiert;
  ohne das stünde der eingesetzte Platz mitten im Block des Turms und ein
  Schwächerer bekäme das wertvollere Gebäude.
- **Reicht der Kader nicht für alle Plätze, fehlen sie zuerst im Probenlager.**
  Das ist die billigste Lücke, und `csKapazitaet()` meldet sie ohnehin.

**Der T1-Typ mischt nur, wo es eine Wahl gibt.** `typenMischen` läuft je Gruppe
(siehe unten); der Energieturm ist eine Gruppe aus *einem* Gebäude, dort steht
die Spitze des Feldes und es gibt nichts zu tauschen. Gemischt wird zwischen den
beiden Datenzentren und zwischen den Probenlagern. Ein sortenreiner Energieturm
ist damit möglich — ihn aufzubrechen hieße, einen Schwächeren an das wertvollste
Startgebäude zu setzen, und das ist die Entscheidung, die dieser Abschnitt
gerade andersherum trifft.

Getestet in `tests/schluchtsturm_verteilung.spec.js`. Beide neuen Prüfungen sind
gegengeprüft: mit der alten, gemeinsamen Gruppe werden sie rot.

### Die Gebäude-Karten im Übersichtsbild enden am Kartenrand

Unter dem Bild steht der Kasten „WECHSEL-FAHRPLAN", und er wird **nach** den
Gebäude-Karten gezeichnet. Eine Karte, die unter den Kartenrand rutscht, wird
also von ihm zugedeckt — nicht umgekehrt. Sichtbar war das an den untersten
Namen: sie standen im Kasten und waren weiß auf weiß.

Getroffen ist immer die **letzte Karte einer Spalte**, und zwar systematisch:
Probenlager I und II stehen in `CS_ANCHOR` beide auf `y:398` (III und IV
ebenso). Das zweite wird deshalb bei jeder Aufstellung unter das erste
geschoben und sammelt allen Versatz der Spalte ein.

`layout()` in `src/ui/cs.js` schiebt die Spalte deshalb nach dem Setzen von oben
noch einmal **von unten nach oben** zurecht: jede Karte gibt die Grenze für die
darüber vor. Der frühere Lauf war wirkungslos — er rückte zuerst die unterste
Karte an ihren *noch unverschobenen* Vorgänger heran (also um 0) und erst
danach den Vorgänger. Der gewonnene Platz kam bei der untersten nie an.

Passt eine Spalte auch dicht gepackt nicht mehr in die Karte, bleibt der
Überstand stehen: Karten übereinanderzuschieben wäre nicht besser.

Getestet in `tests/cs_karte_rand.spec.js` — gemessen wird an dem, was der Nutzer
sieht: kein Text einer Karte darf unter der Oberkante des Fahrplan-Kastens
liegen.

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

### Dienst: Anmeldung aus dem Spiel übernehmen

`scripts/ws_service/` liest die Wüstensturm-Anmeldung direkt aus Last War (über
BlueStacks und ADB) und schreibt sie als `teamAssign` in den Planungsstand. Damit
entfällt das Abtippen der Liste, an dem vorher jede Woche eine halbe Stunde hing.

```
.venv/bin/python -m scripts.ws_service.run              # nur lesen, Bericht
.venv/bin/python -m scripts.ws_service.run --schreiben  # und ins Tool übernehmen
.venv/bin/python -m scripts.ws_service.run --pruefen    # zeigt, was im Bild erkannt wird
```

Der Weg: Hauptkarte → Events → Reiter „Wüstensturm" → „Teilnehmer auswählen" →
die Liste durchscrollen. Berichte und Sicherungen liegen unter
`~/.local/state/warsync/ws_service/`.

**Jeder Lauf legt Beweisbilder ab** (seit 24.09.2026, `belege.py`): je Spieler der
Streifen, aus dem sein Wert gelesen wurde — Zeit-Balken mit Uhrzeit, Name,
Heldenkraft, beide Badge-Felder —, abgelegt als `<Spielername>.png` samt
`index.json` und `uebersicht.html`. Damit ist eine Rückfrage („ich war doch
angemeldet") zu beantworten, statt eine Zahl behaupten zu müssen.

Geschnitten wird **in** `roster.durchlauf`, also aus demselben Bild und im selben
Augenblick wie die Lesung: ein später nachgestellter Screenshot wäre kein Beleg,
weil R4 und R5 die Zuordnung jederzeit umstellen dürfen. Je **Balkenfarbe** ein
Ausschnitt, nicht je gesehener Zeile — dieselbe Zeile viermal sieht viermal gleich
aus, zwei Farben sind dagegen zwei Aussagen (Doppelmelder). Die Belege laufen immer
mit, nicht auf Wunsch: ein Schalter hieße, dass sie ausgerechnet bei dem Lauf
fehlen, nach dem jemand fragt.

**Der Scroll-Lauf kann „nicht angemeldet" nicht belegen** — er ankert am
Zeit-Balken und sieht nur die Angemeldeten. Dafür gibt es
`scripts/ws_service/suchlauf.py` (seit 24.09.2026 im Repo, vorher ein Skript im
State-Ordner, das seine Bilder überschrieb): er schlägt jeden Kadernamen einzeln im
Suchfeld nach und sieht die Zeile in beiden Fällen. Geschrieben wird dort
**ersetzend** und nur über den ganzen Kader.

Gemessen in `scripts/ws_service/pruefe_belege.py` — 40 von 40 Tafeln zeigen die
richtige Zeile, gegengeprüft mit `--gegenprobe` (Schnitt um 320 px verschoben:
17 falsch). Details in [`docs/themen/ws-dienst-anmeldung.md`](docs/themen/ws-dienst-anmeldung.md).

**Was eine Zeile bedeutet.** Wer sich angemeldet hat, trägt über seiner Zeile
einen farbigen Balken mit der gewählten Uhrzeit; wer nicht, hat keinen. Rechts
stehen zwei Felder — links „gesetzt", rechts „Ersatz", genau unter den Zählern
👤x und 👤↺ der Kopfzeile. Daraus folgen die fünf Werte: Badge links = `A`/`B`,
Badge rechts = `AE`/`BE`, Balken ohne Badge = `C`, **kein Balken = gar nicht
angemeldet**. Für den Letzten wird nichts geschrieben — auch kein leerer Wert.
Ein `null` wäre eine Aussage, die niemand getroffen hat.

**Im Badge steht der Buchstabe des Teams, und der schlägt den Balken** (seit
16.09.2026, `roster.team_abzeichen`). Vorher kam das Team aus der Farbe des
Balkens über der Zeile. Über die 220 Bilder eines von Hand gescrollten
Mitschnitts gemessen (`pruefe_team_abzeichen.py`): **219 von 219** belegten
Feldern gelesen, 212 wie der Balken, 7 dagegen — und die sieben haben zwei
verschiedene Ursachen:

- **Wer sich für beide Zeiten meldet, hat zwei Balken.** Dieselbe Zeile
  (`ZephyrusXI`, 150,8M) stand in `bild_009` unter einem grünen „09:00 ~ 09:30"
  und in `bild_010` unter einem orangen „18:00 ~ 18:30"; das Abzeichen war
  beide Male ein `A`. Das ist **kein Fehler und kein Flackern der Anzeige**: die
  Anmeldung erlaubt beide Uhrzeiten, und die Liste zeigt sie abwechselnd. Über
  den Mitschnitt gemessen betrifft es 2 von 84 Namen (`ZephyrusXI`,
  `Mammon90`) — das Abzeichen blieb bei beiden über alle Bilder dasselbe.
  **Die Auskunft ist wertvoll, nicht störend:** wer beide Farben zeigt, ließe
  sich in beiden Teams einplanen.
- **Balken und Abzeichen sagen nicht dasselbe.** Bei `Puwe` steht in **allen**
  drei Bildern ein oranger Balken über einem `A`-Abzeichen. Das ist kein
  Fehler: Der Balken nennt die Zeit, für die sich jemand gemeldet hat, das
  Abzeichen das Team, in das er eingeteilt **ist**. Beides kann auseinandergehen
  — und für `teamAssign` zählt die Einteilung.

Über fünf Spieler führte die Balkenfarbe zu widersprüchlichen Werten, die die
Gegenprobe scheitern ließen; mit dem Abzeichen blieb genau einer übrig.

Gelesen wird der Buchstabe als **Bild, nicht als Text** — Tesseract und die
Texterkennung von macOS liefern bei diesem verzierten Einzelzeichen meist gar
nichts (`A` in 4 von 10 Fällen, `B` nie). Der Vorlagenabgleich
(`scripts/ws_service/vorlagen/team_a.png`, `team_b.png`) trennt beide dagegen
sauber: der richtige Buchstabe kommt auf 0,96–1,00, der falsche auf 0,59–0,68.
Wer ohne Platz ist, hat kein Abzeichen — für ihn bleibt es beim Balken.

Welche Uhrzeit welches Team ist, kommt aus `wsTime` im Planungsstand, nicht aus
dem Code: die Zeiten sind je Team umstellbar (`WS_ZEITEN`) und wechseln.

**Wer beide Zeiten gemeldet hat, steht im Bericht** (seit 16.09.2026,
`match.beide_zeiten`). Das Abzeichen sagt, in welchem Team jemand *ist*; der
Balken, für welche Zeiten er *könnte*. Beim Nachrücken ist die zweite Auskunft
die nützlichere, und sie fiel vorher weg: `zu_werten` wertete den Balken nur
aus, wo kein Abzeichen stand — also bei niemandem, der einen Platz hat. Heute
wird er immer gelesen und je Spieler über alle seine Zeilen gesammelt
(`balken_teams`). Im Mitschnitt vom 16.09. sind das 2 von 69 (`Mammon90`,
`ZephyrusXI`). **Ein Name, der dort fehlt, heißt „nicht gesehen", nicht „nur
eine Zeit"** — wer nur in einem Bild stand, kann den Wechsel gar nicht gezeigt
haben; die Zahl der Zeilen steht deshalb daneben.

**Bei Streit zwischen Farbe und Uhrzeit gewinnt die Farbe.** Bis dahin war es
umgekehrt, und das war falsch herum: über die 242 Zeilen des Mitschnitts wurden
überhaupt nur **26 Uhrzeiten** gelesen, und **4 davon falsch** — jede drehte
das Team. Die Erkennung macht aus `18:00` ein `13:00`, und das ist ausgerechnet
die *lokale* Zeit des anderen Teams; bei `NuSReT` und `Little Kong` steht im
Bild nachweislich `Serverzeit: … 18:00 ~ 18:30` über einem orangen Balken. Die
Uhrzeit bleibt trotzdem stehen — nur eine Stufe höher: über **alle** Zeilen
gemittelt sagt sie überhaupt erst, was die Farbe bedeutet. Gemessen in
`pruefe_balken_zeit.py`.

**Grün gehört dem Blatt, nicht dem Team** (seit 17.09.2026, `roster.farb_teams`).
Im Code stand fest `{"gruen": "A", "orange": "B"}`, und das ist widerlegt: grün
sind die, die sich für die Zeit des **gerade gescannten Blatts** gemeldet haben.
Über zwei Mitschnitte desselben Tages — 12:45 Uhr auf Blatt A (grün = 09:00 = A,
16×), 23:37 Uhr auf Blatt B (grün = 18:00/18:30 = B, 23×).

Betroffen sind nur Zeilen **ohne** Abzeichen, denn das Abzeichen schlägt den
Balken — also ausgerechnet die Ausgeschlossenen, bei denen `AC`/`BC` die ganze
Auskunft ist: im Lauf vom 23:37 landeten `Carmen0804` und `Naruto1284` auf `AC`
statt `BC`, `Stalker24601` umgekehrt. Quelle ist deshalb das gescannte Blatt
(`run.py` aus der Kampfzeit, `mitlesen.py` aus `--team`), und beide bestimmen es
jetzt **vor** der Farbzuordnung. Die gelesenen Uhrzeiten sind die Gegenprobe;
widersprechen sie der Mehrheit nach, wird das gemeldet.

**Auch die Blatt-Erkennung im Mitschnitt hing daran** — sie nahm die Mehrheit der
Farben und zeigte damit in *beiden* Mitschnitten auf das falsche Blatt: die
Zeilen des anderen Teams stehen ebenso in der Liste. `pruefe_team_abzeichen.py`
nimmt das Blatt als zweites Argument; ohne den Nachzug maß es über einen
B-Mitschnitt 163 Scheinabweichungen — eine Messung, die ihre eigene Annahme misst.

**Jeder Zähler der Gegenprobe wird für sich geprüft** (`roster.zaehler_pruefen`).
War einer der beiden unlesbar, fiel vorher die **ganze** Gegenprobe aus; am
17.09.2026 blieb der Ersatz-Zähler von R3 offen, und damit verschwand auch der
Vergleich der Gesetzten, der dagestanden hätte („gefunden 19, Spiel sagt 20").
Fehlt die Aufschlüsselung je Rang, springt die Zahl über der Liste ein — sie sagt
nur, *dass* etwas fehlt, statt *wo*, liest sich dafür aber zuverlässiger. In der
Meldung steht, woher der Sollwert kam.

**Die Heldenkraft wird beim Scan gleich mit gepflegt** (seit 15.09.2026,
`tool.schreibe_heldenkraft`). Neben jedem Namen in der Anmeldeliste steht die
Heldenkraft — dieselbe Zahl, die `match.py` ohnehin zum Zuordnen der Namen
gegen den Kader liest —, vorher fiel sie nach dem Scan unter den Tisch und
musste weiterhin von Hand im Profil eingetragen werden. Geschrieben wird wie
eine manuelle Eingabe: erst `ws_players.hero_power`, dann eine Momentaufnahme
nach `ws_player_history` (`changed_by='ws_service'`), analog zu
`savePlayerHistory()` in `src/ui/allianz.js`.

Drei Dinge dabei:

- **Läuft auch dann, wenn die Teilnehmerliste selbst verworfen wird.** Eine
  unvollständig gescannte Liste (siehe Scroll-Hänger unten) sagt nichts darüber
  aus, ob die einzelnen gelesenen Zeilen falsch wären — die Gegenprobe der
  Teilnehmerliste ist deshalb keine Bedingung für die Heldenkraft.
- **Nur sichere Namenstreffer.** Geschrieben wird ausschließlich aus
  `erg["treffer"]` (`match.zuordnen`) — eine unsichere Zeile („offen") darf
  nicht die Heldenkraft eines falschen Spielers überschreiben.
- **Unveränderte Werte werden übersprungen.** Sonst wüchse `ws_player_history`
  bei jedem Wochenlauf um eine Zeile je Spieler, auch wenn sich nichts getan
  hat.

**Text wird gelesen, Zustand wird gemessen.** Namen liest Tesseract nicht
buchstabengetreu — aus `IIBlackJackII` wird `IBlackJackli`. Das reicht, weil der
Name anschließend gegen den Kader in `ws_players` abgeglichen wird (`match.py`,
normalisiert wie beim T1-Import: ohne Leerzeichen, ohne Diakritika,
kleingeschrieben). Woran die Auswertung wirklich hängt, wird deshalb **nicht**
aus Text gewonnen: ob ein Badge da ist, entscheidet der Blau-Rot-Abstand der
Pixel (Badge ≈ +56, leeres Feld ≈ −2), und welches Team darin steht, der
Vorlagenabgleich auf dem Buchstaben. Bleibt ein Name unsicher, wird er
**gemeldet statt geraten** — lieber eine Lücke im Bericht als ein Wert beim
Falschen.

**Bekannte Fehllesungen stehen in `aliase.json`, nicht im Kader.** Wo zwischen
Bild und Kader kein gemeinsames Zeichen steht, hilft kein Ähnlichkeitswert:
`ΧΑΣΑΠΗΣ` kommt als `XAZANHZ` an, das Kapitälchen-Unicode `ꜱɪɴɴᴇʀ` als
`SINNER`. Die Datei ordnet dem **Kadernamen** seine Lesarten zu und hängt sie
als zusätzliche Schreibweise in dieselbe Ähnlichkeitsprüfung — damit trifft
auch eine leicht abweichende Lesung. Den Kader an die OCR anzupassen wäre der
falsche Weg: die Namen im Tool sind richtig, und mit dem echten Namen verlöre
man die Anzeige und jeden späteren Abgleich.

**Dieselbe Lesart darf nur einmal vergeben werden.** Der Rest-Durchlauf in
`match.py` streicht jeden getroffenen Kadernamen aus dem Kandidatenkreis. Steht
dieselbe Zeile im nächsten Bild noch einmal da, ist ihr eigener Name dadurch
schon weg — und sie bekommt zwangsläufig einen **anderen**: am 16.09.2026 wurde
`'JG ASTRID OG'` (116,7M) einmal `ʚɞ ASTRID ʚɞ` (0,60) und einmal `Stargreg`
(0,44 bei 1,4 % Kraftabstand). Aus 20 gesetzten Spielern wurden so 21, und die
Gegenprobe fiel durch — ausgerechnet an einem Lauf, der die Liste vollständig
gesehen hatte. Beide Durchläufe merken sich deshalb, welche Lesart sie schon
vergeben haben.

**Verglichen wurde dafür die wörtliche Lesart, und genau daran lief es am
17.09.2026 erneut vorbei.** Dieselbe Ersatz-Zeile kam in vier Bildern als
`'JG ASTRID 3g'`, `'DG ASTRID 3G'`, `'JG ASTRID JG'` und `'JG ASTRID 9G'` an; der
Wortvergleich sah vier verschiedene Dinge, `Stargreg` stand wieder da, und die
Ersatzbank hatte 11 von 10 Plätzen. **Eine Zeile ist nicht ihr Text**
(`match._dieselbe_zeile`): wiedererkannt wird sie an Kraftzahl, Platz und
Abzeichen **und** der Ähnlichkeit der beiden Lesungen (0,75 — `dgastrid3g` gegen
`jgastrid3g` kommt auf 0,90). Die Kraft allein reicht nicht: bei einer
Nachkommastelle sind Doppelungen im Kader zu erwarten. Gefaltet wird **vor** dem
Rest-Durchlauf, angetreten ist die häufigste Lesung — eine Zeile, ein Versuch.

**Im selben Bild entscheidet die Lage statt des Textes.** Beim Scrollen zeichnet
die Liste neu, und ein Bild trifft sie gelegentlich mittendrin: derselbe Kopf
wird zweimal gefunden, ein paar Dutzend Pixel versetzt, und die zweite Lesung
fällt entsprechend aus — `ღ SWORD ღ` stand einmal als `'n3 SWORD n'` und 39 px
darüber als `'JOOパンセーとン'`. Zwei *verschiedene* Zeilen liegen in einem Bild
immer eine ganze Zeilenhöhe auseinander (`ZEILE_MIN_ABSTAND_PX` 150, Zeilenhöhe
rund 210). Ein fehlendes Abzeichen steht dem nicht entgegen — `None` heißt „nicht
gelesen", nicht „anderes Team" —, und der **Wert** kommt dann von der sicheren
Lesung: dieselben Pixel, einmal besser und einmal schlechter gemessen.

Fünf Dinge, die nicht wegoptimiert werden dürfen:

- **Die Geste ist es nicht — hier ist jede Erklärung gestorben, die eine war.**
  Sechs Anläufe, jeder einzeln gemessen, jeder widerlegt. Wer hier eine siebte
  Geste bauen will, baut die siebte vergebliche:

  | Erklärung | Status |
  |---|---|
  | Strecke zu kurz (150 px) | widerlegt — Bens Züge waren kürzer und gingen durch |
  | zu langsam ziehen (2000 ms) | widerlegt — Bens Hand zieht mit 244 px/s und wird angenommen |
  | zu schnell / S-Taste nachbilden (2329 px/s) | **widerlegt — Ben hat es am 16.09.2026 gegengeprüft: hilft nicht** |
  | fehlender Tipp vor dem Wisch | widerlegt — löste echte Hänger nicht |
  | 500 ms am Endpunkt halten (`halten_s`) | widerlegt — Lauf 6 war der schlechteste der Nacht |
  | Langdruck löst einen Dialog aus | widerlegt — löst nachweislich nichts aus |

  **Die Gemeinsamkeit aller Messungen: während eines Hängers kommt _keine_
  Geste an — jede misst 0 px.** Die App lebt weiter (der übrige Bildschirm
  bewegt sich), nur die Liste nimmt nichts mehr an. Es ist also gar keine Frage
  der Geste, und deshalb konnte keine Geste es lösen.

  **Was übrig bleibt, stand seit dem 02.09.2026 in `device.py`** und wurde eine
  ganze Nacht lang umarbeitet statt gelesen: *„Last War blockiert beim Scrollen
  in unbekanntes Listenterrain kurz selbst. Dagegen hilft nur Zeit, keine
  ausgefeiltere Nachbildung."* Der einzige Hänger, der sich von allein löste,
  tat das nach **47 Sekunden** — beim sechsten Versuch, dem mit der längsten
  Pause. Und jeder Eingriff von Ben hat vor allem Zeit gekostet.

  **Die Eingriffskurve ist der klarste Beleg** (Touch-Mitschnitt vom
  16.09.2026; **Mehrfinger-Gesten kann der Dienst gar nicht erzeugen**, sie sind
  damit ein harter Nachweis für eine Hand am Trackpad):

  | Lauf | Hand-Gesten | zugeordnet |
  |---|---|---|
  | 3b (00:46) | 2 | 63 |
  | 4 (01:11) | 5 | 52 |
  | 5 (01:22) | 3 | 55 |
  | 6 (01:36) | **0** | 36 |
  | 7 (01:51) | **0** | 15 |
  | 8 (10:13) | **0**, frisches Spiel | 16 |

  Mit Eingriff 52–63, ohne 15–36. Es ist **keine** Zeitkurve — eine
  „Verfall durch Laufzeit"-Hypothese fiel mit Lauf 8, einem eben gestarteten
  Spiel. **Der Scanner kommt ohne Bens Hand nicht durch die Liste.** Der
  pragmatische Weg ist deshalb `mitschreiben.py` (siehe unten): ein Mensch
  scrollt, der Rechner schaut zu — 68 zugeordnete Spieler gegen 16.

  Aktuelle Gegenmaßnahme: `pause_nach_s` 0,9 → **2,5 s** nach *jedem* Schritt,
  nicht erst beim Hänger — die Pause soll verhindern, dass er entsteht, statt
  ihn hinterher aufbrechen zu wollen (Begründung als `_kommentar_pause` in
  `config.json`). **Nächster ehrlicher Schritt:** den Mitschnitt einer echten
  Hand-Geste **roh nachspielen**, Ereignis für Ereignis über `sendevent`. Sechs
  Nachbauten sind gescheitert; die Aufnahme enthält das Original.

  **Der zweite Hebel ist unabhängig vom Hänger und größer: Redundanz.** 42 von
  65 Zeilen werden nur **einmal** gesehen — ein Lesefehler ist sofort ein
  verlorener Spieler. Bei ~280 px statt 451 px Schrittweite sieht der Scan jede
  Zeile dreimal und kann die häufigste Lesung nehmen.

  **Die Sorge ums Nachschleudern ist gemessen und unbegründet.** Über den
  Mitschnitt per Vorlagenabgleich verfolgt, verschiebt eine S-Tasten-Geste den
  Inhalt um median 238 und höchstens 513 Pixel — bei 850 Pixeln Fensterhöhe.
  Es kann keine Zeile durchfallen. Die Zahl gehört bei jeder Änderung an der
  Geste nachgemessen: **Bewegung < Fensterhöhe** ist die Bedingung, nicht
  Langsamkeit.

  **`adb shell input keyevent 47` hilft nicht.** Die Tastenbelegung sitzt in
  BlueStacks auf dem Mac, nicht in Android; ein über ADB eingespeister
  Tastendruck läuft daran vorbei und bewirkt nichts. Nachzubilden wäre die
  Geste, nicht der Tastendruck — was nach obiger Tabelle allerdings nichts
  bringt.
- **Sechs stehende Bilder, nicht drei, bevor „Listenende" gilt.** Auch mit der
  richtigen Geste hakt die Liste gelegentlich. Ein zusätzlicher Anlauf kostet
  Sekunden, ein zu früher Abbruch den ganzen Lauf — und er sieht hinterher aus
  wie ein vollständiger Scan. Angesetzt wird bei jedem Versuch anders (andere
  Spalte, etwas längere Strecke, mehr Zeit).
- **Der aktive Reiter trägt kein Wort, sondern ein Bild.** Wer das Blatt über
  den Reitertext sucht, findet das bereits geöffnete nie und schiebt den
  Streifen bis zum Anschlag. Geprüft wird deshalb der **Blatt-Titel**
  („Wüstensturm" oben links im Fenster), der Reitertext dient nur zum Finden.
  Wie viele Reiter es gibt, hängt an den laufenden Events — feste Koordinaten
  treffen dort früher oder später den falschen.
- **Jede Rang-Gruppe wird genau einmal aufgeklappt.** Gemerkt wird sie am
  OCR-Text ihres Balkens, der sich beim Scrollen nicht ändert. Ohne dieses
  Gedächtnis tippt derselbe Balken im nächsten Bild erneut — und klappt zu.
- **Zwei Gegenproben, und beide müssen aufgehen.** Die Zähler der Rang-Kopfzeilen
  (R4: 👤x 7) werden gegen das Gefundene gehalten — je Rang, damit ein Fehler
  auch zeigt, *wo* er sitzt. Ihre Summe wiederum muss die Gesamtzahl über der
  Liste treffen; sonst wurde eine ganze Rang-Gruppe übersprungen, was den
  Einzelzählern allein nicht auffällt. Passt etwas nicht, wird **nicht
  geschrieben** — eine halb gelesene Liste ist schlimmer als gar keine, weil sie
  plausibel aussieht. `--erzwingen` ist für Notfälle da.
- **Eine Zahl, die sich geändert hat, ist kein Fehler.** In der Anmeldephase
  dürfen R4 und R5 die Zuordnung jederzeit umstellen; zwischen zwei Läufen kann
  aus „20/20 gesetzt" ein „15/20" werden, ohne dass am Scan etwas falsch war.
  Der Dienst liest einen Zustand, keine Wahrheit auf Dauer — deshalb trägt jeder
  Bericht seinen Zeitstempel und die Restzeit bis zum Anmeldeschluss.
- **Rang-Balken werden über den Pixelanteil erkannt, nicht über den
  Zeilenmittelwert.** Symbole und Zahlen brechen den Balken in der Mitte auf; im
  Mittelwert zerfällt er dort in zwei dünne Ränder, die durch jede Mindesthöhe
  fallen. Nach Anteil gemessen liegt er durchgehend bei 0,6…1,0, Spielerzeilen
  bei 0,0. Die Zähler selbst sind weiß auf hellem Flieder und erst nach
  Umkehrung lesbar — und nur mit `--psm 6`, weil die Einzelzeichen-Modi die Null
  durchfallen lassen.
- **Ohne `--schreiben` passiert nichts.** Der Lauf dauert zehn bis zwanzig
  Minuten; ein Fehlgriff wäre die Aufstellung einer ganzen Woche. Vor dem
  Schreiben legt der Dienst eine Sicherung des bisherigen Planungsstands ab und
  zieht `savedAt` mit — sonst hält ein offener Browser-Tab seinen älteren Stand
  für den neueren und schreibt ihn zurück.

Nach dem Anmeldeschluss (Donnerstag 04:00) gibt es „Teilnehmer auswählen" nicht
mehr, sondern rechts „Teilnehmer" mit den 30 Eingeteilten. Der Dienst erkennt
das am fehlenden Knopf im unteren Streifen und bricht mit `AnmeldungGeschlossen`
ab, statt irgendwohin zu tippen.

**Ab dann fehlen auch die Zeit-Balken — und mit ihnen die Anmeldung** (seit
17.09.2026). Die Abzeichen bleiben lesbar, `AC`/`BC` nicht: wer aussortiert
wurde, ist danach von jemandem, der sich nie gemeldet hat, nicht mehr zu
unterscheiden. **Der Scan muss deshalb vor Donnerstag 04:00 laufen.** Am
17.09. um 12:00 fand der Mitschnitt über 66 Bilder 0 Zeilen; das sah aus wie
der Renderfehler vom 09.09., blieb aber nach `am force-stop` und Neustart so.
Daneben stand statt „Kampftag: … 13:00 ~ 13:30" ein „Schlacht beginnt in".

Gelesen wird die Liste in diesem Zustand über einen zweiten Anker
(`roster.zeilenkoepfe`, Schalter `--ohne-balken`): den 28 px hohen beigen
**Trennstreifen zwischen zwei Zeilenkarten**, gemessen in der leeren rechten
Spalte, Zeilenabstand 320 px. Rot über Blau trennt ihn von den fliederfarbenen
Rang-Balken, die Helligkeit vom Weiß der Karte. Als Kennung liefert er `None`
statt einer geratenen Farbe — die Auskunft ist weg, nicht verschoben.

Das Suchfenster des Team-Abzeichens muss beide Anker aushalten: mit Balken
sitzt es bei `dy` 60, am Trennstreifen bei 93. Mit dem alten Fenster
(+45…+185) fiel der untere Rand der 110 px hohen Vorlage heraus und der
Abgleich brach von 0,99 auf 0,35 ein — beide Buchstaben gleich schlecht, also
`None`. Seit +215 werden über `lauf10` **176 statt 170** Abzeichen gelesen.

**Der Stand nach dem Zusammenführen wird noch einmal geprüft**
(`roster.bestand_pruefen`). `zaehler_pruefen` misst den Fund; was hinterher im
Werkzeug steht, ist etwas anderes, denn die Zusammenführung löscht nie. Wer
aussortiert wurde und dessen Zeile ein Lauf nicht gesehen hat, bliebe sonst
still auf seinem alten `A` — aus 20 gesetzten würden 21. Gemeldet wird
namentlich, wessen Wert *nicht* aus diesem Lauf stammt; korrigiert wird
nichts, denn über eine ungesehene Zeile weiß der Lauf nichts.

`scripts/ws_service/hin_zur_liste.py` navigiert zur Liste und sagt, ob die
Balken da sind — bevor jemand zehn Minuten von Hand scrollt.

Alle Koordinaten in `config.json` gelten für **2560×2560** — die Auflösung, die
`scripts/bluestacks_start.sh` setzt. Der `wm size`-Override überlebt keinen
Neustart der Instanz; deshalb prüft der Dienst die Auflösung beim Start und
bricht ab, statt ins Leere zu tippen.

### Von Hand scrollen, mitschreiben, hinterher auswerten (seit 16.09.2026)

Solange der Dienst nicht allein durch die Liste kommt, gibt es den Weg daneben:
ein Mensch scrollt, der Rechner schaut nur zu.

```
.venv/bin/python -u -m scripts.ws_service.mitschreiben --name lauf9
.venv/bin/python -m scripts.ws_service.mitschreiben --auswerten <ordner> --team A
.venv/bin/python -m scripts.ws_service.mitschreiben --auswerten <ordner> --nur-rechnen --schreiben
```

`mitschreiben.py` tippt und wischt **nichts** — nur `screencap`, und abgelegt
wird jedes Bild, in dem sich etwas geändert hat. `mitlesen.py` liest hinterher
mit **denselben** Funktionen wie der Dienst (`roster.zeitkoepfe`,
`roster.zeile_lesen`), dieselben Gegenproben gelten. Das Trennen ist der Punkt:
Sammeln muss Schritt halten (0,7 s je Bild), Lesen kostet je Zeile eine
Texterkennung. `--nur-rechnen` rechnet aus `roh.json` neu, ohne die Bilder
wieder durch die Erkennung zu schicken — eine Änderung am Abgleich ist damit in
Sekunden gemessen statt in Minuten.

Der erste Lauf am 16.09.2026: 220 Bilder, 242 Rohzeilen, **68 Spieler
zugeordnet**, Gegenprobe `20/20` gesetzt. Zum Vergleich der maschinelle Lauf
desselben Vormittags: 30 Zeilen, 16 zugeordnet, bei `R3 14/82` steckengeblieben.

**Was der Mitschnitt über den Hänger sagt.** Parallel lief
`scripts/touch_aufnahme.py`. Von Bens 76 Wischen gingen **50 über 450 px, und
davon wurde kein einziger abgewiesen** (46 voll, 4 halb). Wirkungslos blieben
nur kurze Wische und Tipps — die ignoriert eine Scrollliste ohnehin. Auch kein
einziger Fremdeingriff: von 129 gemessenen Bewegungen hatte **jede** eine Geste
davor, Rücksprünge gab es keine.

Damit fällt die Tempo-Erklärung: Bens Hand zieht mit **244 px/s** (Median
610 px in 2221 ms, 72 Stützpunkte) — fast genau das Tempo, das der Dienst als
„zu langsam" verworfen hatte —, und die Liste nimmt es an. Der Dienst ahmt
seit dem 02.09.2026 die S-Taste nach (2329 px/s) und bleibt trotzdem hängen.
Der Unterschied liegt also nicht im Tempo, sondern darin, dass die Geste
synthetisch ist. Was Bens Pfad zusätzlich zeigt und kein Nachbau bisher hatte:
Finger aufsetzen, **eine halbe Sekunde ruhig liegen lassen**, ziehen, am Ende
**noch eine Sekunde halten**, erst dann loslassen.

### Dienst: Kampfergebnis aus dem Postfach lesen

`scripts/ws_service/ergebnis.py` liest die Rangliste aus der Mail
„[Wüstensturm]-Kampfergebnis!": Basis → Mail → Ordner „Event" → Mail öffnen →
unter „Individuelle Punkte" herunterscrollen. Heraus kommen Platz, Name und
Punkte je Spieler, dazu die Gesamtpunkte beider Allianzen und die Zuordnung zum
Kader. Ohne `--schreiben` bleibt es beim Bericht.

```
.venv/bin/python -m scripts.ws_service.ergebnis            # neuestes Ergebnis
.venv/bin/python -m scripts.ws_service.ergebnis --nr 2     # das zweitneueste
.venv/bin/python -m scripts.ws_service.ergebnis --pruefen  # nur das aktuelle Bild
.venv/bin/python -m scripts.ws_service.ergebnis --schreiben          # lesen und eintragen
.venv/bin/python -m scripts.ws_service.ergebnis --bericht <ordner> --schreiben
.venv/bin/python -m scripts.ws_service.ergebnis --offen --hierbleiben  # die Mail, die gerade offen ist
.venv/bin/python -m scripts.ws_service.ergebnis --offen --alias skyluna=senasinasona
```

**Ältere Ergebnisse nachtragen.** Wer eine ältere Mail von Hand öffnet, liest
sie mit `--offen`: das Skript scrollt sie an den Anfang zurück (dort liest es die
Gesamtpunkte) und navigiert nicht selbst. Zwei Dinge sind dabei anders:

- **Umbenannte Spieler** stehen in der Mail unter dem Namen, der zum Kampf galt.
  `--alias ALT=NEU` (mehrfach möglich) ordnet sie zu; ohne den Hinweis sieht
  kein Abgleich, dass `skyluna` und `senasinasona` dieselbe Spielerin sind.
- **Aussetzen wird nicht geschrieben, wenn der Kader der Folgewoche schon
  steht.** Die Marke käme zu spät, um etwas zu bewirken, und stünde als
  Behauptung über eine Woche da, in der längst gespielt wurde. Das Fehlen selbst
  steht trotzdem im Event.

**`--schreiben` trägt ein** (`eintragen.py`): Gesamtpunkte, Sieg/Niederlage,
Gegner-Server und MVP am Event; `played`/`individual_pts`/`rank` an jeder
Kaderzeile; wer ohne Kaderplatz mitgespielt hat, mit `registered=false`. Wer im
fixierten Kader stand und in der Liste fehlt, bekommt `played=false` — die
Oberfläche zeigt das als „Gefehlt" — **und setzt beim nächsten Wüstensturm aus**
(siehe unten). Die Ersatzbank zählt mit: im Wüstensturm spielen alle 30
gleichzeitig. Entschuldigte und Warteliste setzen nicht aus. Namen ohne
Kadertreffer werden nicht eingetragen, nur gemeldet. Drei Sperren, mit
`--erzwingen` zu übergehen: die Gegenprobe muss aufgehen, mindestens die Hälfte
der Gelesenen muss im Kader des Events stehen (sonst ist es die Mail des
anderen Teams), höchstens zehn Fehlende. Vorher liegt eine Sicherung im
Berichtsordner. Welches Event gemeint ist, ergibt sich aus Datum und Uhrzeit der
Mail; spielen A und B zur selben Zeit, entscheidet der Kader.

Berichte und Belegbilder unter `~/.local/state/warsync/ws_ergebnis/<zeit>/`.
Erster Lauf am 11.09.2026: 28 Spieler, 26 sofort zugeordnet, alle Gegenproben grün.

Fünf Dinge, die nicht wegoptimiert werden dürfen:

- **Der Platz kommt aus der Reihenfolge auf dem Bildschirm** — weder aus der
  Platzziffer (verzierte Schrift, aus 11 wird 17) noch aus der Punktzahl.
  Nach Punkten zu sortieren lässt ausgerechnet die Zahl über den Platz
  entscheiden, die falsch gelesen sein kann: im Test rutschte Republica58 mit
  einer verdeckten Ziffer von Platz 2 auf Platz 24, ohne dass es auffiel. Die
  Bilder werden über gemeinsame Zeilen aneinandergelegt (`_einfuegen`).
- **Drei Gegenproben**: Punkte fallen von oben nach unten, gelesene
  Platzziffern passen zur Position, und jedes Bild teilt eine Zeile mit dem
  vorigen — sonst fehlt dazwischen etwas.
- **Gelesen wird mit Lage** (`vision_ocr.swift --boxen`): Platz, Name und
  Punkte sind drei getrennte Texte, und erst die Lage sagt, was zu einer Zeile
  gehört. Die Mails im Ordner werden über ihren Titel gesucht, nicht über eine
  Stelle — eine neue Mail oben verschiebt alle anderen. Gesperrt geschriebene
  Namen (`H  A  N  A  N`) liefert Vision als Einzelstücke nebeneinander; alles
  rechts vom Namen auf seiner Höhe gehört deshalb dazu.
- **Die übrigen Lesungen zählen mit.** Jede Zeile steht in mehreren Bildern,
  und gewonnen hat die häufigste Lesung. Chinesische Zeichen liest Vision aber
  jedes Mal anders: `小木瓜lemon` kam über dieselben Bilder einmal als Treffer
  heraus und einmal als `[331/lmn`. Bleibt ein Name offen, treten deshalb die
  anderen Lesungen gegen den Rest-Kader an, mit der strengen Schwelle der
  ersten Runde und nur, wenn alle Treffer auf denselben Spieler zeigen.
  Verglichen wird dabei im **Skelett**: griechische und kyrillische Buchstaben
  auf ihr lateinisches Gegenstück gebracht. Griechisch kann Vision gar nicht,
  `ΧΑΣΑΠΗΣ` kommt als `XAZANHM` oder `ХАZАПНЕ` an.
- **Namen liest Vision mit Japanisch vorn, alles andere mit Englisch/Deutsch**
  (`SPRACHEN_NAMEN` / `SPRACHEN_TEXT`). Mit Englisch/Deutsch kam von
  `V ベジータ王子` nur `v` an; Japanisch *hinter* Englisch änderte gar nichts,
  die erste Sprache entscheidet. Über die drei Läufe vom 11.09.2026 (80 Zeilen)
  ging dabei kein lateinischer Name verloren, zugeordnet stieg von 78 auf 80.
  Datum und Kopf bleiben bei Englisch/Deutsch: mit Japanisch vorn wurde aus
  `22:30:13` einmal `22:30:73`, und an der Uhrzeit hängt, welches Event gemeint
  ist. Zeichen in voller Breite (`［XP33］`) fängt NFKC in `zeilen_lesen` ab.
  `vision_ocr.swift` nimmt die Sprachen dafür als `--sprachen`; ohne die Angabe
  liest es wie bisher, das Kartenarchiv ist davon nicht berührt.

### Aussetzen nach einem Fehlen (seit 11.09.2026)

Wer beim Wüstensturm im fixierten Kader stand und nicht gespielt hat, setzt beim
nächsten aus. `ws_aussetzen` (Migration `db/2026-09-11_ws_aussetzen.sql`, in
`TENANT_TABLES`) hält eine Zeile je Spieler und Event, **bei dem** er aussetzt —
nicht bei dem er gefehlt hat; das steht in `quelle_event_id` und weiterhin in
`ws_participation`. Eine eigene Tabelle aus demselben Grund wie die Prioliste:
für das künftige Event gibt es beim Eintragen noch keine Teilnahme-Zeile.

Geschrieben wird sie vom Ergebnis-Dienst, angezeigt als „⛔ Aussetzen" neben dem
Namen in der Wüstensturm-Anmeldung des betreffenden Freitags
(`src/core/aussetzen.js`, `ctx.aussetzen` in `anmeldeZeile`). **Die Marke schlägt
vor, sie sperrt nicht** — eingeteilt wird im Spiel, und die Knöpfe bleiben
bedienbar. Das ✕ in der Marke (nur `canAccess('ws')`) hebt sie auf, etwa wenn
sich jemand nachträglich entschuldigt hat; es löscht die Zeile, das Fehlen
bleibt in `ws_participation` stehen.

`aussetzenAufheben(mode, eventDate, name)` hat den Namen hinten, weil die
Anmeldezeile ihn an einen Aufruf-Präfix der jeweiligen Ansicht hängt
(`ctx.aussetzenAuf`). Getestet in `tests/aussetzen.spec.js`.

**Seit dem 18.09.2026 gibt es zwei Ausnahmen**, und beide gehören zusammen: ein
fester Platz übergeht die Marke (sie bleibt sichtbar, wird aber nicht
vollstreckt), und wer sich **vorher** abgemeldet hat, bekommt gar keine — er
gilt als entschuldigt. Siehe den Reiter „🧮 Verteilung" weiter oben.

### Touch-Mitschnitt: vormachen statt beschreiben

`scripts/touch_aufnahme.py` schneidet mit, wo jemand in BlueStacks tippt und
wischt — Grundlage, um einen Ablauf als Skript nachzubauen. Je Geste eine
Zeile in `gesten.jsonl` plus ein Bildschirmfoto beim Aufsetzen des Fingers;
Ablage `~/.local/state/warsync/aufnahme/<zeit>_<name>/`, `aktuell` zeigt auf den
letzten Lauf.

**Der Touch-Rohbereich bildet X anders ab als Y.** In Y ergibt 0–32767 genau
die 2560 Bildschirmpixel. In X deckt er das ganze 16:9-Fenster ab (physisch
2560×1440), und der quadratische Bildschirm sitzt in dessen Mitte:
`x = 1280 + (roh/32768 − 0,5) · 4551`. Gemessen am 11.09.2026 gegen die
Kopfzeile von Androids „Zeigerposition"; mit dem naiven Faktor lag ein Tipp
bei x≈640 um 280 px daneben. In der Bildmitte fällt es nicht auf — deshalb
stimmte der Mitschnitt der S-Tasten-Geste (x=1280). `rad_schritt` in
`device.py` rechnet X noch mit dem naiven Faktor; das trifft nur den seitlichen
Versatz der Ausweich-Varianten (80 px werden 45 px).

**Unveränderte Koordinaten meldet `getevent` nicht.** Tippt man zweimal auf
dieselbe Stelle, fehlt beim zweiten Mal die X- oder Y-Zeile. Der Rekorder
führt deshalb die letzte Position je Finger mit; ohne das fielen solche
Gesten ganz aus der Aufnahme.

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

### Kampfsimulation — Kampfberichte aus Fotos.app sammeln (seit 14.09.2026)

Ben schickt hin und wieder Last-War-Kampfberichte (Screenshots aus dem Spiel,
die als iCloud-Fotos auf dem Mac landen) — Ziel ist eine Sammlung, aus der sich
später Kämpfe vergleichen und simulieren lassen. Tabelle `combat_reports`
(Migration `db/2026-09-14_combat_reports.sql`), gefüllt von Claude direkt per
`docker exec -i supabase-db psql`, **nicht** über `api.js`/PostgREST — es gibt
dafür (noch) keine Oberfläche im Werkzeug.

**Holen der Bilder:** die letzten *n* Fotos aus Fotos.app per `osascript`
exportieren — über den Index (`item (count of media items) - n + 1 thru
(count of media items) of media items`, dann `export … using originals
false`), **nicht** über ein Datums-`whose`-Filter: `media items whose date >
…` scheitert an einem AppleScript-Typfehler („date kann nicht in Typ
specifier umgewandelt werden"), auch mit Variable statt Literal. Jeder
Kampfbericht verteilt sich auf mehrere Screenshots (Helden-/Armee-/
Statistiken-Tab, dazwischen Ausrüstung/Fähigkeiten) — alle exportierten Bilder
mit `Read` ansehen und die Werte per Auge ablesen, keine OCR-Pipeline dafür
bauen.

**Kein Mandanten-Tisch.** Anders als `ws_players` & Co. gehört ein Kampf keiner
der beiden Allianzen dieses Werkzeugs — die Gegenseite kann aus einer dritten
Allianz sein. `alliance_id` würde hier nichts abbilden, also steht die Tabelle
bewusst nicht in `TENANT_TABLES` — wie schon `karte_basen`.

**Eine Zeile, zwei JSONB-Spalten (`side_a`/`side_b`), kein Spalten-Wildwuchs.**
Das Berichts-Layout im Spiel variiert bereits zwischen den ersten beiden
ausgewerteten Kämpfen; ein starres Spaltenschema bräche bei jeder Abweichung.
**`side_a` ist immer der Angreifer, `side_b` immer der Verteidiger** — die Rolle
ist die eine Variable, die das Ergebnis bisher erklärt (siehe unten), und als
feste Spaltenbedeutung lässt sie sich ohne `CASE` über alle Kämpfe vergleichen.
Beide Seiten tragen dieselbe Struktur: `name`, `tag`, `server`, `x`/`y`,
`rolle`, `ergebnis`, `verluste`, `kraft` (Helden, Armee, Drohne, Technologie,
Dekoration, Einheiten, Ehrenwand, Overlord, Kosmetik, Andere — alle in Mio,
siehe `kraft.einheit`), `kraft_helden_detail` (Aufstellung, exklusive Waffe,
Ausrüstung, Heldenfähigkeit), `aufstellung_bonus`, `tech_boni` (Prozentwerte aus
dem Technologie-Tab), `attribut_boosts`, `allianz_tech`,
`kampffortschritt_level`, `chip_sternstufe`, `overlord`, `drohne_level`,
`moral`, `einheiten_stats` (Besiegt/Lazarett/Verletzt/Überleben),
`gesamtschaden_mio`, `schaden_je_position_mio` und
`erlittener_schaden_je_position_mio` (Reihenfolge aus dem Statistiken-Tab,
**nicht** namentlich den Helden zugeordnet — welcher Held an welcher Position
kämpft, ist aus dem Bild allein nicht sicher zuzuordnen) sowie `besetzung`
(Heldenname/Level/Sterne/Ausrüstungslevel aus dem Fähigkeiten-Tab, getrennt von
der Schadensliste geführt statt zusammengeraten). Fehlt ein Wert im
Screenshot-Satz, bleibt das Feld **weg** statt geraten zu werden.

**`kampfbericht_id`** (aus der Fusszeile jedes Berichts-Screenshots) ist der
Unique-Key gegen Dubletten — dieselben Fotos könnten sonst bei jedem erneuten
Hochladen doppelt landen. `ON CONFLICT (kampfbericht_id) DO NOTHING` beim
Einfügen.

**Der erste Befund — und warum die naheliegende Lesart falsch ist.** Am
14.09.2026 stehen zwei Kämpfe 23 Sekunden auseinander, beide mit Ben als einer
Seite und damit mit identischen eigenen Werten — ein kontrolliertes Experiment,
wie es sonst nicht zu bekommen ist. In **beiden** gewann der Verteidiger, und
zwar mit fast derselben Zahl:

| Zeit | Angreifer | Verteidiger | Schaden A | Schaden V | V/A | Überlebende A / V |
|---|---|---|---|---|---|---|
| 14:23:27 | `[BKNz]對不起錯過` | `[XP33]Ben the men` | 42,4 Mio | 53,3 Mio | **1,258** | 0 / 616 |
| 14:23:50 | `[XP33]Ben the men` | `[CYKA]panglimas` | 41,9 Mio | 52,6 Mio | **1,256** | 0 / 495 |

Hier stand daraufhin „die Rolle schlägt die Statistik, der Verteidiger hat rund
26 % Bonus". **Das war falsch, und der Fehler ist lehrreich genug, um ihn
stehenzulassen:**

- **Die 1,26 ist keine zweite Messung, sondern dieselbe.** Der berichtete Schaden
  einer Seite ist ~proportional zu den Verlusten der anderen. Verlustverhältnis
  gegen Schadensverhältnis: 1,290 gegen 1,258 (Kampf 1), 1,228 gegen 1,256
  (Kampf 2) — 2 % auseinander. „Der Sieger macht mehr Schaden" ist damit
  tautologisch und belegt gar nichts.
- **Ein Vorteil von 5–6 % genügt für dieses Ergebnis.** Nach dem
  Lanchester-Quadratgesetz (`a·A² − b·B² = const`, weil jede überlebende Einheit
  weiterschießt) reicht ein Vorsprung von **+6,4 %** (Kampf 1) bzw. **+5,1 %**
  (Kampf 2) je Einheit, um den Gegner vollständig auszulöschen und selbst 616
  bzw. 495 Mann zu behalten. Totalverlust auf der einen Seite ist also **kein**
  Zeichen von Überlegenheit, sondern das normale Ende eines knappen Kampfes.
- **Die Moral schien den Vorsprung zu erklären** — Kampf 1 nennt „Die Moral der
  Roten ist das **1.07-fache** der Blauen und verursacht im Kampf 107 % Schaden",
  und Rot war Ben, der Gewinner. Benötigt waren 6,4 %. Das passte zu gut.

**Zweiter Irrtum, und er hing an einem ungelesenen Screenshot.** Daraus wurde
„erster Term ist die Moral, nicht die Rolle", samt der Vorhersage: in Kampf 2
müsse `panglimas` die höhere Moral haben. **Im Bericht steht das Gegenteil** —
„die Blauen haben das 1.08-fache der Roten (108 % Schaden)", und Blau war Ben.
Er hatte also in **beiden** Kämpfen den Moralvorteil und hat trotzdem einen
gewonnen und einen total verloren:

| | Blau = Angreifer | Rot = Verteidiger | Moral | Ausgang |
|---|---|---|---|---|
| 14:23:27 | `BKNz` | **Ben** | Ben +7 % | Verteidiger siegt |
| 14:23:50 | **Ben** | `panglimas` | Ben +8 % | Verteidiger siegt |

**Blau ist immer der Angreifer, Rot immer der Verteidiger** — in beiden
Berichten. Und Bens Moralvorsprung ist konstant (~7–8 %, dieselbe Armee,
dieselben Gegnerklassen). Damit taugt die Moral gerade **nicht** als Erklärung:
sie zeigt in beiden Kämpfen in dieselbe Richtung, während sich das Ergebnis
umdreht. Eine Variable, die sich nicht ändert, erklärt keinen Unterschied.

Rechnet man die Moral heraus, bleibt je Kampf ein Rest aus unbekannter Quelle:
**−0,6 %** in Kampf 1 (die Moral reichte dort exakt aus) gegen **+13,5 %** in
Kampf 2. Ein *konstanter* Verteidigerbonus müsste in beiden Zeilen dieselbe Zahl
sein — ist er nicht. Auch die Rolle allein erklärt es also nicht.

Was öffentlich dokumentiert ist, stützt dabei nur die Moralregel selbst:
`lastwar.wiki` formuliert sie als „for every 1 % your morale exceeds the enemy's,
you deal an additional 1 % damage"; Moral speist sich aus Truppenzahl,
Truppenqualität, Forschung und der Kriegsherr-Fähigkeit „Inspire". **Einen
Angreifer-/Verteidiger-Bonus nennt keine Quelle**, und die einzige dokumentierte
Asymmetrie — der Truppentyp-Konter — war laut Bericht in beiden Kämpfen neutral
(„Deine Aufstellung ist gleich stark wie die gegnerische").

**Stand der Beweislage, ohne Kür:**

- *Für* einen Rollenbonus spricht, dass sich zwischen den beiden Kämpfen genau
  eine relevante Größe umdreht — die Rolle — und mit ihr das Ergebnis, obwohl
  Bens Werte und sein Moralvorsprung gleich bleiben. Dazu kommt, dass der
  Angreifer, der *gegen* Ben verlor (`BKNz`), auf dem Papier **stärker** war als
  der Verteidiger, gegen den Ben verlor (`panglimas`): Armee 32,0 vs 29,6 Mio,
  Helden-Tech 84 % vs 64 %, Einheiten-Tech 98 % vs 84 %.
- *Dagegen* spricht, dass die beiden Gegner verschiedene Spieler sind. Die
  fehlenden 13,5 % könnten schlicht heißen, dass `panglimas` in etwas stärker
  ist, das der Bericht nicht als Kraftzahl ausweist (Truppenstufen,
  Heldenfähigkeiten im Gefecht).

Beides ist mit zwei Kämpfen **nicht trennbar**. Das entscheidende Experiment ist
deshalb nicht „noch ein Kampf", sondern ein ganz bestimmter: **derselbe Gegner in
beide Richtungen** — einmal von ihm angegriffen werden, einmal ihn angreifen.
Dann ist die Gegnerstärke konstant und nur die Rolle wechselt. Alles andere
vermischt die beiden Erklärungen weiter.

**Methodische Lehre aus zwei Fehlschlüssen hintereinander:** beide entstanden
daraus, aus zwei Datenpunkten eine Ursache zu benennen. Die Sammlung ist dafür
da, das zu vermeiden — bis ein Kampf die Rolle isoliert, bleibt in der Doku
*keine* Ursache behauptet.

#### Was von den öffentlichen Formeln brauchbar ist

`lastwarhandbook.com/guides/troop-combat-math-guide` blockt `WebFetch` mit 403
(Cloudflare, wie bei LW Atlas) — über den Playwright-Browser kommt man durch.
Die Seite ist teils SEO-Füllmaterial („1 views", Datumsangaben widersprechen
sich, die „Kernformel" `Final Damage = (Base Attack × Skill × Type) − (Defense ×
Reduction) + Equipment` hat weder Einheiten noch Zahlen und ist damit nicht
rechenbar). **Prüfbar ist sie trotzdem** — und an der einen Stelle, wo unsere
Berichte sie gegenlesen können, stimmt sie exakt:

| Gleiche Heldentypen | Guide | unsere Kampfberichte |
|---|---|---|
| 4 Helden | +15 % auf HP/Angriff/Verteidigung | Ben: „…jeweils um 15.0 %" ✓ |
| 5 Helden | +20 % | BKNz: „…jeweils um 20.0 %" ✓ |
| 3 Helden | +5 % | (kein Beleg) |

Damit sind auch die übrigen Konstanten als Arbeitsgrundlage tragbar:

- **Truppentyp-Konter: ±20 %** (1,20× ausgeteilt, 0,83× erhalten) — zusammen ein
  Schwung von rund 40 %. Der Berichtssatz „Deine Aufstellung ist gleich stark wie
  die gegnerische" meint **diesen** Konter, nicht den Formationsbonus: er stand
  auch dort, wo BKNz +20 % gegen Bens +15 % hatte.
- **Moral 1 : 1** wie bei `lastwar.wiki`, und wichtiger die **Kaskade**: „Losing
  troops reduces morale, which reduces damage, which causes more losses." Die im
  Bericht genannte Moral ist damit ein **Startwert**, nicht der Kampfwert — das
  Kampfmodell ist rückgekoppelt (Lanchester plus Moralverfall), und genau deshalb
  kippen knappe Kämpfe in Totalverluste.
- **Die einzige genannte Verteidiger-Asymmetrie** ist ein Gebäudebonus von
  **+25 % gegen Aircraft bei Basisverteidigung**. Sonst nennt auch diese Quelle
  keinen Rollenbonus.

**Und damit fällt selbst die weg — denn beide Kämpfe waren gar keine
Basisverteidigung.** `#9016` in der Kopfzeile ist **nicht der Server**, sondern
das **Schlachtfeld** (Spalte heißt deshalb `schlachtfeld`, nicht `ort_server`).
Zwei Belege: die Gegner stammen aus **#1746** und **#1668**, der Kampf lief also
serverübergreifend; und die Berichts-Koordinaten passen nicht zur Weltkarte — in
`lwa_spieler` steht Ben auf **482/554** und panglimas auf **480/442**, im Bericht
auf 499/514 und 494/520. Dazu passt „Besiegt 0" auf **allen vier** Seiten: auf
Event-Schlachtfeldern gibt es laut Guide keine dauerhaften Truppenverluste.

Für die offene Rollenfrage heißt das: Gebäude, Wälle und die
Verteidigungsanlagen-Technologie greifen dort vermutlich überhaupt nicht — die
naheliegendste Quelle eines Verteidigervorteils ist damit **ausgeschlossen**, und
der Rest von 13,5 % in Kampf 2 bleibt unerklärt. Der Kampfort selbst
unterscheidet die beiden Fälle zusätzlich: bei `BKNz` lag er **exakt auf Bens
Position** (499/514), bei `panglimas` auf **keiner** der beiden (498/519). Auch
darin sind die zwei Kämpfe also nicht dasselbe Experiment.

#### Die Codename-Bosse folgen anderen Regeln als PvP

Wichtig für eine spätere Simulation: **PvE-Boss und PvP sind zwei Modelle, nicht
eines mit anderen Zahlen.** Für die Wanted-Bosse (Codename 87 / 64 / 39) ist die
Faktenlage über mehrere Quellen hinweg einig:

| Boss | Tage | schwach gegen |
|---|---|---|
| Code 87 | Mo + Do | **Tank** |
| Code 64 | Di + Fr | **Missile** |
| Code 39 | Mi + Sa | **Aircraft** |

Sonntags kein Boss. Vier Fenster täglich (00:00 · 06:00 · 12:00 · 18:00
Serverzeit), je 3 Stunden auf der Karte, **5 Angriffe am Tag**, ab Basis Stufe 8,
**keine Rallys**. Drei Unterschiede zum PvP entscheiden alles:

- **+50 % statt ±20 %.** Der passende Typ macht 50 % Mehrschaden — keine
  Schere wie beim PvP-Konter, kein Gegenmalus. Der Bonus **stapelt mit dem
  Formationsbonus** (5 gleiche Typen +20 %), weshalb ein Mono-Typ-Trupp doppelt
  zahlt: „a 4-star UR tank squad will outdamage a 5-star UR aircraft squad
  against Code 87".
- **90 Sekunden statt Kampf bis zur Vernichtung.** Der Boss stirbt nicht; jeder
  Angriff ist ein Schadensrennen auf Zeit, gewertet wird der **höchste
  Einzelschaden** für die Rangliste. Wird der Trupp vorher aufgerieben, zählt der
  bis dahin gemachte Schaden weiter.
- **Damit gilt Lanchester dort nicht.** Das Rückkopplungsmodell von oben lebt
  davon, dass überlebende Einheiten weiterschießen und Verluste sich aufschaukeln
  — bei einem Zeitlimit gegen ein Ziel, das nicht fällt, zählt schlicht Schaden
  pro Sekunde. Wer beides in eine Formel presst, rechnet eines davon falsch.

**Eine rechenbare Schadensformel gibt es auch hier nicht.** Was die Guides
„Damage Calculation" nennen (`Base = Hero Power × Abilities × Equipment`, dann
`× 1.50`, dann `× Formation Synergy × Skill Timing`), hat keine Einheiten und
keine Zahlen außer der 1,50. Belastbar sind nur: **+50 % Typbonus**, **+1 %
Angriff je War-Fever-Scout**, und ein unbezifferter PvE-Bonus durch Masons
Passiv „Zombie Purge" gegen neutrale Ziele.

**Praktisch für XP33:** die Kaderverteilung passt schlecht zur Rotation — **56
Tank, 19 Aircraft, 8 Missile** (16 ohne Eintrag). An Code-87-Tagen (Mo/Do) ist
die Allianz gut aufgestellt, an Code-64-Tagen (Di/Fr) trifft der Bonus nur acht
Leute. Das ist dieselbe Zahl, die schon beim Mischen der T1-Typen je Gebäude
klemmt.

## Themen-Übersicht

Die Liste unten zeigt nur die jüngsten Sessions. **Alle** Themen dieses Projekts
stehen in [`SESSIONS.md`](SESSIONS.md) — dort per Grep nach Stichwort suchen,
Details je Session unter `docs/sessions/`.
