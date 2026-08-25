-- ══════════════════════════════════════════════════════════════════════════════
--  Mehrere Allianzen nebeneinander (Mandantentrennung)
--  25.08.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Bis hierher kannte die Datenbank genau eine Allianz — AR1S. Jede Tabelle war
-- implizit ihre Tabelle. Ab jetzt trägt jede Zeile, die zu einer Allianz gehört,
-- eine `alliance_id`; ohne die kommt nichts mehr hinein (NOT NULL, kein Default).
--
-- Bewusst KEIN Default auf AR1S: ein vergessenes alliance_id soll laut scheitern
-- und nicht still in der falschen Allianz landen. Fehlermeldung beim Insert ist
-- lästig, fremde Daten in der eigenen Allianz sind schlimmer.
--
-- Die Eindeutigkeits-Regeln wandern mit: ein Spielername ist ab jetzt nur noch
-- INNERHALB einer Allianz eindeutig. Sonst könnte Ben nicht gleichzeitig in AR1S
-- und XP33 stehen — und genau das ist der Anlass für diese Migration.

begin;

-- ── 1. Allianzen ──────────────────────────────────────────────────────────────
create table if not exists alliances(
  id          uuid primary key default gen_random_uuid(),
  tag         text not null unique,            -- 'AR1S' — kurz, steht in der Kopfzeile
  name        text,                            -- 'Phoenix R1sing'
  server      text,                            -- '#1668'
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into alliances(tag,name,server)
  values('AR1S','Phoenix R1sing','#1668')
  on conflict(tag) do nothing;

-- ── 2. alliance_id an alle Mandanten-Tabellen ─────────────────────────────────
do $$
declare
  t text;
  ar1s uuid;
begin
  select id into ar1s from alliances where tag='AR1S';
  foreach t in array array[
    'ws_players','ws_events','ws_participation','ws_player_history',
    'ws_planner_state','ws_polls','ws_poll_votes','vs_weeks','vs_entries',
    'zug_rides','ws_rankings','ws_versammlungen','ws_player_coords'
  ] loop
    execute format('alter table %I add column if not exists alliance_id uuid references alliances(id) on delete cascade',t);
    execute format('update %I set alliance_id=$1 where alliance_id is null',t) using ar1s;
    execute format('alter table %I alter column alliance_id set not null',t);
    execute format('create index if not exists %I on %I(alliance_id)','idx_'||t||'_alliance',t);
  end loop;
end $$;

-- ── 3. Eindeutigkeit pro Allianz statt global ────────────────────────────────
-- Alles, was bisher global eindeutig war und fachlich zur Allianz gehört, bekommt
-- die alliance_id in den Index. Tabellen, die über einen Fremdschlüssel schon an
-- einer Allianz hängen (ws_participation → ws_events, ws_poll_votes → ws_polls,
-- vs_entries → vs_weeks), bleiben unangetastet: deren Eltern sind bereits getrennt.

alter table ws_players        drop constraint if exists ws_players_name_key;
create unique index if not exists ws_players_alliance_name_uidx on ws_players(alliance_id,name);

drop index if exists ws_events_date_team_uidx;
create unique index if not exists ws_events_alliance_date_team_uidx on ws_events(alliance_id,event_date,team);

alter table zug_rides         drop constraint if exists zug_rides_ride_date_key;
create unique index if not exists zug_rides_alliance_date_uidx on zug_rides(alliance_id,ride_date);

alter table vs_weeks          drop constraint if exists vs_weeks_week_start_key;
create unique index if not exists vs_weeks_alliance_start_uidx on vs_weeks(alliance_id,week_start);

alter table ws_rankings       drop constraint if exists ws_rankings_recorded_at_player_name_key;
create unique index if not exists ws_rankings_alliance_date_player_uidx on ws_rankings(alliance_id,recorded_at,player_name);

alter table ws_player_coords  drop constraint if exists ws_player_coords_player_name_key;
create unique index if not exists ws_player_coords_alliance_player_uidx on ws_player_coords(alliance_id,player_name);

-- ws_planner_state hatte `key` als Primärschlüssel — der geteilte Planungsstand
-- lag also einmal für die ganze Datenbank. Jetzt einmal je Allianz.
alter table ws_planner_state drop constraint if exists ws_planner_state_pkey;
alter table ws_planner_state add primary key (alliance_id,key);

-- ── 4. Rollen: Super-Admin und Allianz-Admin als Spalte statt als Sonderfall ──
-- Der Super-Admin stand bislang als Name im Quelltext (`name==='Ben_the_men'`).
-- Das trägt nicht mehr, sobald derselbe Name in zwei Allianzen steht — und es war
-- ohnehin nichts, was sich ohne Deployment ändern ließ.
--
-- alliance_admin ist absichtlich getrennt vom Rang R5/R4: der Rang kommt aus dem
-- Spiel und wechselt dort, das Verwaltungsrecht am Werkzeug soll davon unberührt
-- bleiben.
alter table ws_players add column if not exists super_admin    boolean not null default false;
alter table ws_players add column if not exists alliance_admin boolean not null default false;

update ws_players set super_admin=true
 where name='Ben_the_men'
   and alliance_id=(select id from alliances where tag='AR1S');

commit;

-- PostgREST kennt neue Spalten erst nach dem Neuladen des Schemas — sonst liefert
-- es alliance_id schlicht nicht aus und die App sieht überall leere Listen.
notify pgrst, 'reload schema';
