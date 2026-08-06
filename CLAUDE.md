# WarSync Stats — Workflow-Regeln

Diese Regeln gelten für jede Session in diesem Repo. Bei Verstoß bricht der Pre-Push-Hook automatisch ab.

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
