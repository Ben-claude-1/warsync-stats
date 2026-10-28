-- ══════════════════════════════════════════════════════════════════════════════
--  Anmeldebeleg: der Bildausschnitt, aus dem ein Anmeldewert gelesen wurde
--  09.10.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- scripts/ws_service/belege.py legt schon seit dem 24.09.2026 für jeden Lauf
-- Beweisbilder ab — aber nur lokal auf dem Mac Studio
-- (~/.local/state/warsync/ws_service/…). Die Web-Oberfläche hat darauf keinen
-- Zugriff, und der ganze Lauf trug bisher nur einen gemeinsamen Zeitstempel
-- (Anfang bis Ende), keinen je Spieler.
--
-- Diese Tabelle holt beides ins Tool: das Bild selbst (Base64-PNG, dieselbe
-- Tafel, die auch lokal entsteht) und den Zeitpunkt, zu dem genau diese Zeile
-- aufgenommen wurde — nicht den des ganzen Laufs. Geschrieben wird bei JEDEM
-- Lauf, nicht nur bei `--schreiben`: die Beweisbilder liefen schon immer
-- unabhängig vom Schreiben mit, dieselbe Begründung gilt für den Upload.
--
-- `wert` ist NULL, wenn der Beleg zeigt, dass der Spieler zu diesem Zeitpunkt
-- NICHT angemeldet war — das ist eine echte Aussage, keine fehlende. Nur der
-- Suchlauf (`quelle='suchlauf'`) kann das beweisen, weil er jeden Kadernamen
-- einzeln nachschlägt; der Scroll-Lauf (`quelle='scroll'`) sieht nur Zeilen mit
-- Zeit-Balken und hat deshalb nie einen NULL-Beleg — fehlt er dort, bedeutet
-- das nur „nicht gesehen", nicht „nicht angemeldet" (siehe belege.py).
--
-- Eine Zeile je Beleg, nicht eine je Spieler und Woche: derselbe Spieler
-- bekommt bei jedem Lauf eine neue Zeile, auch wenn sich der Wert nicht
-- geändert hat — genau das ist die Lückenlosigkeit, um die es geht.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists ws_anmeldebeleg(
  id          bigint generated always as identity primary key,
  alliance_id uuid not null references alliances(id) on delete cascade,
  player_name text not null,
  mode        text not null default 'ws',
  event_date  date not null,
  quelle      text not null,
  wert        text,
  erkannt_um  timestamptz not null,
  bild        text not null,
  created_at  timestamptz not null default now(),
  constraint ws_anmeldebeleg_mode_check check (mode in ('ws','cs')),
  constraint ws_anmeldebeleg_quelle_check check (quelle in ('suchlauf','scroll')),
  constraint ws_anmeldebeleg_wert_check check (wert is null or wert in ('A','AE','B','BE','AC','BC','ABC'))
);

-- `event_date` ist der Freitag, fuer den ein Beleg gilt — berechnet aus
-- `erkannt_um` (naechster Freitag ab dem Aufnahmetag), nicht das Aufnahme-
-- datum selbst. So laesst sich ein Beleg demselben Wochen-Kaestchen zuordnen,
-- das die Anmeldehistorie (core/anmeldehistorie.js) schon zeigt.
create index if not exists idx_ws_anmeldebeleg_lookup
  on ws_anmeldebeleg(alliance_id, player_name, mode, event_date, erkannt_um desc);

comment on table ws_anmeldebeleg is
  'Beweisbild je Scan-Durchlauf und Spieler, mit dem exakten Aufnahmezeitpunkt. wert=NULL heißt "laut diesem Beleg nicht angemeldet" (nur beweiskräftig bei quelle=suchlauf).';

notify pgrst, 'reload schema';
commit;
