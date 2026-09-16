---
thema: Frontend — Module, Build, Cache-Stempel, Deploy, Tests, Git-Ablauf
code: src/, dist/main.js, index.html, scripts/stamp_assets.mjs, scripts/check_modules.py, scripts/git-hooks/pre-push
verwandt: i18n-de-en, png-export-karten, datenbank-backup
---

# Frontend, Build und Deploy

## Aufbau

`index.html` ist bewusst leer (14 Zeilen) — nur Kopfdaten, `<div id="app">`, das
Stylesheet und `<script type="module" src="dist/main.js">`. **Dort wird nichts
einprogrammiert.**

```
src/core/    Logik ohne DOM-Ausgabe: config, api, auth, state, i18n, helpers,
             players, hive, png, tenant, alliance, rotation, prio, leistung,
             aussetzen, basen, lwatlas  →  das Wiederverwendbare
src/ui/      je Bereich eine Datei: ws, cs, vs, allianz, admin, hive, karte,
             anmeldung, prio, basen, lwatlas, buildings, profil, wsmap, zuteilung
src/app/     shell, render, init, globals
src/main.js  Einstiegspunkt
src/styles.css
```

**Nach jeder Änderung an `src/` bauen:** `npm run build` (esbuild, ~10 ms). Ohne den Build
ändert sich live nichts — `dist/main.js` ist das, was ausgeliefert wird, und liegt deshalb
mit im Git. `npm run watch` baut bei jedem Speichern.

Ein Symbol gehört genau **einem** Modul. Zwei Modulvariablen (`_vsResultData`,
`_karteBgPulled`) wurden beim Umbau dorthin verschoben, wo sie beschrieben werden:
ES-Module lassen Zuweisungen an Importe nicht zu, das bricht sonst den Build.

`scripts/split_modules.py` hat die Aufteilung einmalig aus der alten einteiligen
`index.html` erzeugt. Es ist Beleg, kein Werkzeug für den Alltag — die Quelle ist `src/`.

## Der Cache-Stempel ist keine Kosmetik

`scripts/stamp_assets.mjs` hängt an `dist/main.js` und `src/styles.css` den Inhalts-Hash
an (`?v=91ba0045`) und läuft automatisch hinter `npm run build`. Ohne das blieb ein Gerät
nach einem Deploy auf dem alten Bundle hängen — GitHub Pages liefert dieselbe URL, der
Browser holt sie nicht neu.

**Der belegte Schaden:** Am 27.08.2026 kam beim Anlegen eines Spielers
`null value in column "alliance_id"` — der zwischengespeicherte Bundle stammte von *vor*
dem Multi-Allianz-Umbau. Die Ursache war nicht die Datenbank, nicht PostgREST und nicht
der Code, sondern der Browser-Cache.

**Die geänderte `index.html` gehört mit in den Commit.** `npm run watch` stempelt nicht
(im Entwicklungs-Browser hilft „Cache deaktivieren").

Dasselbe Muster am Handy: GitHub Pages setzt `cache-control: max-age=600`. Bis zur
Modularisierung lag die komplette App in der `index.html` — wer die gecacht hatte, bekam
die **ganze alte App** zu sehen, nicht nur eine fehlende Kachel. Erzwingen am iPhone: Tab
komplett schließen und neu öffnen (Neuladen allein reicht oft nicht), notfalls Einstellungen
→ Safari → Verlauf und Websitedaten löschen; zum Gegenprüfen ein privater Tab.

Bei jeder Fehlersuche „im Tool fehlt etwas" gehört der Bundle-Stempel deshalb zu den ersten
drei Prüfungen — er war es aber auch schon *nicht* (bei der unsichtbaren Handmarke war
alles in Ordnung, der Schalter war nur zu blass).

## `src/app/globals.js` ist erzeugt, nicht handgepflegt

Die Inline-Handler im gerenderten HTML (`onclick="nav('home')"`) rufen über den globalen
Namensraum auf, den es nach dem Bundeln nicht mehr gibt. Die Datei legt genau die dort
benutzten Namen zurück auf `window`. **Wer eine neue Funktion aus einem `onclick` heraus
aufruft, muss sie dort ergänzen** — sonst kommt erst beim Klick „is not a function".

Der Modul-Splitter hat dabei zwei Fehlerklassen erzeugt, die `scripts/check_modules.py`
seitdem statisch prüft:

- **`const A=1, B=2;`** — nur der erste Name wurde als Export erfasst. `WS_MAX_ERSATZ`
  fehlte deshalb als Import in `ui/buildings.js`; die Wüstensturm-Seite wäre beim Rendern
  mit „is not defined" gestorben.
- **Handler, die erst in einer Hilfsfunktion zu Text zusammengesetzt werden**
  (`adminSetAccess`, `setCsStrength`, `setWsStrength`) — die Extraktion sah nur die wörtlich
  geschriebenen `onclick`. Der Fehler wäre erst beim Klick gekommen.

## Tests

Playwright, `tests/*.spec.js`, gefahren in Chromium **und WebKit** — WebKit ist die Engine
des iPhones, die Fälle werden also im richtigen Browser geprüft. Stand Mitte September:
gut 290 Fälle.

Wichtige Suiten: `allianzen` (Mandantentrennung), `anwesenheit`, `prioliste`,
`ersatz_zeiten`, `t1_typ`, `ws_assassinen`, `ws_typen_mischen`, `ws_gebaeude_standard`,
`ws_karte_label`, `ws_karte_ersatz`, `schluchtsturm_verteilung`, `schluchtsturm_varianten`,
`cs_karte_rand`, `basen_suche`, `lwatlas`, `vs_gegner`, `leistungsindex`, `aussetzen`,
`anmeldung_liste`, `anmeldung_namen`, `anmeldung_raster`, `profil_koordinate`,
`zuteilung`.

**Ein guter Test ist gegengeprüft:** mit der alten Fassung rot, mit der neuen grün. Das
steht bei mehreren Suiten ausdrücklich dabei (`ws_typen_mischen`,
`schluchtsturm_verteilung`, `anmeldung_raster`, `cs_karte_rand`).

**Zwei Tests stehen dauerhaft rot:** `allianzen.spec.js:289` verlangt, dass ein R5 „Kein
Zugriff" im Admin-Panel sieht — `canAccess('admin')` gibt für R5 aber absichtlich `true`
zurück. Entweder ist der Test veraltet oder die Regel; das ist Bens Entscheidung. Wer eine
Änderung prüft, muss die rote Liste **gegen den unveränderten Stand** vergleichen (per
`git stash`), sonst hält man Altlasten für eigene Fehler.

**Ein Browser-Test schreibt in die Produktiv-DB** — Details in `datenbank-backup.md`.

## Git-Ablauf

**Nur auf `main` arbeiten.** `main` liegt 1:1 auf GitHub Pages live. `master` ist
eingefroren als Backup eines früheren WIP-Stands — nicht mehr darauf arbeiten, nicht
hin-mergen, nicht davon rebasen. Falls ein Feature-Branch nötig ist:
`git checkout -b feature/<name> origin/main`.

```
git checkout main
git pull --rebase origin main      # Remote-Commits zuerst einholen
# … ändern …
git add <files>
git commit -m "..."
git push origin main               # Pre-Push-Hook prüft erneut Synchronität
```

Der Pre-Push-Hook (`scripts/git-hooks/pre-push`, aktiviert via
`git config core.hooksPath scripts/git-hooks`) verweigert den Push, sobald `origin/main`
Commits hat, die lokal fehlen. Bei Permission-Denied: `git pull --rebase origin main`,
Konflikte lösen, erneut pushen.

**Was nie tun:** Dateien direkt im GitHub-UI ändern (würde den Hook nicht durchlaufen) ·
Branch-Protection deaktivieren · `--force` pushen außer im Notfall und nur nach Absprache ·
auf `master` arbeiten.

**Fremde WIP nicht mitcommitten.** Mehrfach lagen Änderungen anderer Sessions im
Arbeitsbaum (`SESSION.md` mit 4000 Zeilen, Abschnitte in `CLAUDE.md`,
`package-lock.json`). Ein Commit von `CLAUDE.md` nimmt sie mit — deshalb gezielt nur die
eigenen Dateien einchecken und den Rest stehen lassen.

## GitHub kann ausfallen

Am 05./06.08.2026 blockierte eine GitHub-Störung (Actions und Pages `major_outage`) jeden
Deploy: Lauf #223 stand 30 Minuten ohne Runner. Von hier aus ist dann nichts zu tun — ein
weiterer Push bricht den wartenden Lauf ab und stellt ihn hinten wieder an. Mehrere schnelle
Pushes hintereinander erzeugen dieselbe Wirkung auch ohne Störung (sieben Läufe auf
„cancelled").

**Der Notausgang:** den aktuellen Stand vom Mac Studio über den bestehenden Tailscale-Funnel
ausliefern — dann ist er sofort am Handy testbar, ohne GitHub.

Lesende GitHub-Abfragen (Actions-Läufe, Status) gehen ohne Anmeldung über die öffentliche
REST-API; `gh` ist auf dem Mac **nicht** angemeldet, schreibende Aktionen laufen über den
Browser-Login.

## Sessions

- `docs/sessions/2026-08-08-e39699e4.md` — Modularisierung, vier echte Fehler gefunden
- `docs/sessions/2026-08-27-bb8c45c4.md` — Cache-Fehler, Inhalts-Hash eingeführt
- `docs/sessions/2026-08-05-2ecf289c.md` · `2026-08-06-9b54aacd.md` — GitHub-Störung
- `docs/sessions/2026-09-02-3fd08b5f.md` · `2026-09-02-a6a5eabd.md` — Push-Abläufe
- `docs/sessions/2026-08-20-c21928d1.md` — Cache-Bypass beim Prüfen der Live-Seite
