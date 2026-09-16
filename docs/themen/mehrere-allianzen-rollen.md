---
thema: Mehrere Allianzen (Mandantentrennung) und Rollen
code: src/core/api.js, src/core/tenant.js, src/core/state.js, src/core/alliance.js
migrationen: db/2026-08-25_multi_alliance.sql, db/2026-08-25_xp33_setup.sql
verwandt: datenbank-backup, planungsstand-anwesenheit, spielerdaten
---

# Mehrere Allianzen und Rollen

## Worum es geht

Seit 25.08.2026 gibt es nicht mehr *die* Allianz, sondern mehrere nebeneinander:
`alliances` (`tag`, `name`, `server`, `active`). Jede Zeile in einer Mandanten-Tabelle
trägt eine `alliance_id` — **NOT NULL, ohne Default**. Ein vergessenes `alliance_id` soll
laut scheitern statt still in der falschen Allianz zu landen.

Aktuell: **AR1S** (binabean verwaltet) und **XP33** (Ben), beide auf Server #1668.

## Die Trennung sitzt an einer Stelle

`src/core/api.js`. Jede Anfrage an eine Tabelle aus `TENANT_TABLES` (`src/core/tenant.js`)
bekommt die aktuelle Allianz automatisch — GET/PATCH/DELETE als Filter in der URL,
POST/UPSERT als Spalte im Datensatz.

**Nicht an den Aufrufstellen filtern.** Der Filter steht bewusst nicht in den rund sechzig
`sbGet`/`sbPatch`-Aufrufen: eine vergessene Stelle wäre still — sie lieferte die Daten der
anderen Allianz mit oder überschriebe sie, ohne Fehlermeldung. Beim Umbau wurden dafür
**alle** rohen `fetch(SB+'/rest/v1/…')` durch die API-Schicht ersetzt; sonst wäre die
Trennung an ~24 Stellen umgehbar geblieben. Wer einen rohen Zugriff braucht, nimmt
`sbPost`/`sbPostRet`/`sbPatchRet` mit `{prefer:…}`.

- **Bewusst über alle Allianzen hinweg** arbeitet nur, wer `{scoped:false}` setzt
  (Anmeldung, Tabelle `alliances`).
- **Eine bestimmte fremde Allianz** adressiert `{alliance:id}` (Spieler kopieren).
- **Kommt eine Tabelle dazu, gehört sie in `TENANT_TABLES`** — sonst ist sie über alle
  Allianzen hinweg sichtbar.

Bewusste Ausnahmen (serverweit, nicht in `TENANT_TABLES`): `karte_basen`, `lwa_spieler`,
`lwa_allianzen`, `combat_reports`. Jede hat ihre eigene Begründung — siehe
`basen-erkennung.md`, `lw-atlas.md`, `kampfanalyse.md`.

## Eindeutigkeit gilt je Allianz

`ws_players.name`, `ws_events(event_date,team)`, `zug_rides.ride_date`,
`vs_weeks.week_start`, `ws_rankings`, `ws_player_coords` und der Primärschlüssel von
`ws_planner_state` haben die `alliance_id` im Index. Nur so kann derselbe Mensch in zwei
Allianzen stehen. Tabellen, die über einen Fremdschlüssel schon an einer Allianz hängen
(`ws_participation` → `ws_events`, `ws_poll_votes` → `ws_polls`, `vs_entries` →
`vs_weeks`), bleiben unangetastet.

**`on_conflict` muss die Spalte mitführen** — `'alliance_id,key'`,
`'alliance_id,ride_date'`, `'alliance_id,event_date,team'`.

## localStorage trägt die Allianz im Schlüssel

`lsKey()` in `src/core/tenant.js`: `warsync_ws_state@<uuid>`, ebenso Schluchtsturm und
Kartenbild. Ohne Suffix zeigte ein Wechsel der Ansicht die Aufstellung der vorigen
Allianz — der lokale Puffer wäre ein Leck zwischen zwei Mandanten.

Ausnahme: die `device_id` der Anwesenheit liegt bewusst **ohne** `lsKey()`-Suffix, sie
gehört dem Browser und nicht der Allianz.

## Rollen

| Stufe | Spalte | Darf |
|---|---|---|
| Super-Admin | `ws_players.super_admin` | alles, über alle Allianzen · umschalten, anlegen, stilllegen, Spieler kopieren |
| Allianz-Admin | `ws_players.alliance_admin` | alles **innerhalb seiner** Allianz, Admin-Panel eingeschlossen |
| R1–R5 | `ws_players.role` | wie bisher |

Der Super-Admin stand früher als Name im Quelltext (`name==='Ben_the_men'`). Das trägt
nicht mehr, sobald derselbe Name in zwei Allianzen steht — jetzt ist es eine Spalte.

`canAccess('alliances')` ist die einzige Prüfung, die dem Super-Admin vorbehalten bleibt;
alles andere gilt für beide Verwalterstufen. `adminSetPerm` vergibt nur `ws_admin`,
`profile_edit`, `alliance_admin` — **`super_admin` wird nicht aus einer einzelnen Allianz
heraus vergeben**, sondern in der Datenbank.

**`canAccess('admin')` gibt für R5 absichtlich `true` zurück** („Der R5 führt die Allianz
im Spiel und verwaltet sie deshalb auch hier"). Zwei Tests in `allianzen.spec.js:289`
behaupten das Gegenteil und stehen deshalb dauerhaft rot — ein offener Widerspruch zwischen
Test und Regel, den nur Ben auflösen kann.

## Drei Dinge, die nicht wegoptimiert werden dürfen

- **Beim Wechsel fällt der ganze Mandanten-Zustand zurück** (`resetTenantState()` in
  `src/core/state.js`, ausgelöst von `switchAlliance`). Eine stehengebliebene Aufstellung
  würde beim nächsten Speichern in die neue Allianz geschrieben.
- **`plannerPush` merkt sich die Allianz beim Einplanen, nicht beim Ausführen.** Der Push
  ist um 900 ms entprellt; wer in der Zwischenzeit umschaltet, überschriebe sonst die
  fremde Aufstellung. Drei Schichten sichern das: `plannerCancelPending()` beim Wechsel,
  der Vergleich `AID()!==aid` im Timer und das mitgegebene `{alliance:aid}`.
- **Die Anmeldung sucht über alle Allianzen und fragt bei Mehrdeutigkeit nach.** Derselbe
  Name mit demselben Passwort in zwei Allianzen führt zur Auswahl, nicht zum Raten — sonst
  arbeitete jemand in der falschen Allianz, ohne es zu merken. Der Super-Admin ist
  ausgenommen. Die Reihenfolge der Kandidaten ist nach Allianz-Tag festgelegt, nicht der
  Laune der Datenbank überlassen.

## Getestet

`tests/allianzen.spec.js`. Der wichtigste Test ist der erste: er hört bei einem vollen
Durchlauf **jede** Anfrage mit und verlangt, dass keine Mandanten-Tabelle ohne Allianz
angefasst wird. Beim Umbau wurde er gegengeprüft, indem die Trennung absichtlich
kaputtgemacht wurde — vier Mutationen, jede wird gefangen.

Dazu eine Abnahme gegen die **echte** Datenbank mit einem Wegwerf-Zugang (danach
gelöscht), Schreibzugriffe blockiert: gleicher Name in beiden Allianzen → Rückfrage statt
Raten · Umschalten und Zurückschalten laden sauber neu · Insert ohne Allianz scheitert ·
gleiches Datum+Team in beiden Allianzen erlaubt, Dublette innerhalb einer Allianz nicht.

## Spieler zwischen Allianzen

Ben ist in **beiden** Allianzen als Super-Admin eingetragen — die AR1S-Zeile bleibt
absichtlich stehen (an ihr hängen Teilnahmen und Stärkeverlauf), und der Zugang darf nicht
daran hängen, dass sie irgendwann aufgeräumt wird.

Spieler kopieren (`{alliance:id}`) überträgt Kampfkraft, HQ-Level, Rang und Avatar-Bild.
Am 28.08.2026 wurden so AR1S-Spieler nach XP33 übernommen (98 Spieler danach), am
30.08.2026 weitere acht; inaktive wurden auf `inactive` gesetzt statt gelöscht.

## Sessions

- `docs/sessions/2026-08-25-1a86077f.md` — der Umbau, 82 Tests, Abnahme gegen echte DB
- `docs/sessions/2026-08-27-a1186b32.md` — Admin-Rechte-Knopf, Heldenkraft beim Anlegen
- `docs/sessions/2026-08-28-9cd3d5fb.md` — Spielerdaten AR1S → XP33
- `docs/sessions/2026-08-30-19de8bab.md` — Statusaktualisierung, inactive setzen
