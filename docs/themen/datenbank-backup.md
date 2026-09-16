---
thema: Datenbank, PostgREST, Migrationen, Backup
code: scripts/backup_local_db.sh, scripts/verify_db_backup.sh · db/*.sql
verwandt: mehrere-allianzen-rollen, vision-server-ports, sicherheit-secrets
---

# Datenbank, PostgREST und Backup

## Der Weg zur Datenbank

Die App schreibt und liest gegen den lokalen Postgres im Docker-Container `supabase-db`
über den Tailscale Funnel `https://mac-studio.taild5562c.ts.net:8443/rest/v1/`. Das ist
seit dem Cutover (30.04.2026) die einzige produktive Datenbank.

**Von Hand:** `docker exec -i supabase-db psql …` — das **`-i` ist Pflicht**, sonst kommt
das SQL nie am `psql` an und der Befehl läuft ohne Wirkung durch.

**Nach Schema-Änderungen `NOTIFY pgrst, 'reload schema';`** — sonst kennt PostgREST die
neue Spalte nicht und die App bekommt sie schlicht nicht geliefert. Das war mehrfach die
Ursache für „Feld fehlt, obwohl die Migration lief".

**PostgREST deckelt bei 1000 Zeilen je Antwort** (`PGRST_DB_MAX_ROWS`). Ein größeres
`limit` allein hilft nicht — große Tabellen müssen über `sbGetAll` in Blöcken geholt
werden. Genau das fehlte bei `ws_player_history`: ein festes `limit=500` schnitt still ab,
sobald die Tabelle darüber wuchs (am 11.08.2026 waren es 557 Zeilen). Die ältesten
Einträge fehlten in jedem Diagramm, ohne Fehlermeldung.

**PostgREST kann kein DISTINCT.** Wo eine Gruppierung gebraucht wird, muss eine Sicht her
(so entstand `lwa_allianz_liste` — im Browser zu gruppieren wäre bei fünfstellig vielen
Zeilen nicht gegangen).

## Cloud-Supabase ist tot

Der frühere Hot-Standby-Sync (`sync_local_to_cloud.sh`, LaunchAgent
`com.onemann.warsync-sync`) scheiterte seit 06.05.2026 bei jedem Lauf
(`tenant/user postgres.ktdzxhyuvukontcxghte not found`) und ist seit 31.07.2026
abgeschaltet (Plist als `.disabled` geparkt). **Es gibt keinen Rollback auf die Cloud
mehr.**

## Backup

Stündlicher lokaler Dump nach `~/Backups/warsync-db/` via `scripts/backup_local_db.sh`
(LaunchAgent `com.onemann.warsync-backup`), inklusive Schema. Aufbewahrung: 7 Tage
stündlich, 180 Tage täglich, Monatserster dauerhaft. Restore-Anleitung:
`~/Backups/warsync-db/README.md`.

`scripts/verify_db_backup.sh` spielt das jüngste Backup in eine Wegwerf-DB zurück und
vergleicht alle Zeilenzahlen — wöchentlich (`com.onemann.warsync-backup-verify`), jederzeit
von Hand startbar.

**Kontrolle:** letzter `[OK]` in `~/.local/state/warsync/backup.log` sollte < 1 h alt sein.

### Das Backup war einmal still kaputt

Und die Ursache ist lehrreich: die Dump-Prüfung nutzte `grep -q` hinter einer Pipe, gzip
stirbt dabei an SIGPIPE, und mit `pipefail` galt **jeder heile Dump als fehlgeschlagen** —
sobald der Rest des Dumps nicht mehr in den Pipe-Puffer passt. Die Multi-Allianz-Migration
hat die Datei über genau diese Schwelle geschoben, und dadurch fiel es auf. Behoben mit
`grep -c`; Restore-Probe danach: 14 Tabellen identisch.

## Migrationen

Liegen als `db/<datum>_<name>.sql` im Repo. Die wichtigsten:

| Datei | was |
|---|---|
| `db/2026-08-07_ws_event_unique.sql` | Unique auf `(event_date, team)` bzw. `(event_id, player_name)` |
| `db/2026-08-25_multi_alliance.sql` · `_xp33_setup.sql` | Mandantentrennung |
| `db/2026-08-30_ws_cs_rotation.sql` | feste Spielerzahl je Event |
| `db/2026-08-31_ws_presence.sql` | Anwesenheit |
| `db/2026-09-01_ws_priority.sql` · `_gemeinsam` · `_gesamt` | Prioliste, gemeinsamer Zähler, `c_total` |
| `db/2026-09-02_ws_players_t1_type.sql` | T1-Typ |
| `db/2026-09-02_xp33_t1_import.sql` · `_census` | Import aus dem Google Sheet |
| `db/2026-09-08_karte_basen.sql` | Basen der Weltkarte |
| `db/2026-09-11_ws_aussetzen.sql` | Aussetzen nach einem Fehlen |
| `db/2026-09-12_lwatlas.sql` | `lwa_spieler`, `lwa_allianzen` |
| `db/2026-09-13_lwa_allianz_liste.sql` | Sicht für die Gegnerauswahl |
| `db/2026-09-14_combat_reports.sql` | Kampfberichte |
| `db/2026-09-14_ws_players_stern.sql` | Handmarke |
| `db/2026-09-16_ws_players_ersatz_wunsch.sql` | (neu, noch nicht committet) |

## Tote Tabellen

`ws_player_coords` ist seit April ungenutzt und wurde bewusst **nicht** wiederbelebt — LW
Atlas ist die zuverlässigere, laufend aktualisierte Quelle für Koordinaten.

## Ein Browser-Test schreibt in die Produktiv-DB

`localhost` isoliert nur den `localStorage`, nicht die Datenbank. Schon das Öffnen der
Wüstensturm-Seite schreibt (`POST ws_events` aus `ensureWeeklyEvents`). Vor einem Test
deshalb `sbUpsert`/`plannerPush` blockieren und den `localStorage` sichern und danach
wiederherstellen — Tests teilen den Origin mit Bens echten Tabs. Der Test in
`tests/app.spec.js` nagelt die Liste der erlaubten Schreibwege fest, damit ein neuer
sofort auffällt.

## Sessions

- `docs/sessions/2026-08-25-1a86077f.md` — Migration + das kaputte Backup
- `docs/sessions/2026-08-27-bb8c45c4.md` — `null value in column "alliance_id"` durch
  veralteten Bundle im Browser-Cache
- `docs/sessions/2026-08-08-e39699e4.md` — Schreibwege festgenagelt
