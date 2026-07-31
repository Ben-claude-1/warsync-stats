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

## Was nie tun

- **Nicht** direkt im GitHub-UI Dateien ändern (würde Hook nicht durchlaufen).
- **Nicht** Branch-Protection deaktivieren.
- **Nicht** mit `--force` pushen außer in echten Notfällen, und dann nur nach klarer Absprache.
- **Nicht** auf `master` arbeiten oder von `master` rebasen.

## Daten-Layer

App schreibt/liest gegen den lokalen Postgres im Docker-Container `supabase-db` über Tailscale Funnel `https://mac-studio.taild5562c.ts.net:8443/rest/v1/`. Das ist seit dem Cutover die einzige produktive Datenbank.

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
