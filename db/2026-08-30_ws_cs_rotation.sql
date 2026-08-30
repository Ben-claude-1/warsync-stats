-- 15 fest gesetzte Spieler + Rotation für Wüstensturm UND Schluchtsturm.
--
-- Bisher war die Team-Einteilung komplett manuell (A/AE/B/BE-Knöpfe je Spieler,
-- Kappung bei 20 gesetzt + 10 Ersatz). Ab jetzt bleibt nur die Anmeldung manuell
-- (unbegrenzt); wie viele davon einen Platz bekommen, entscheidet automatisch
-- eine Fairness-Rotation. Schluchtsturm bekommt dafür zum ersten Mal überhaupt
-- eine Teilnahme-Historie — es nutzt dieselben Tabellen wie Wüstensturm, per
-- neuer Spalte `mode` unterschieden, statt eigener cs_events/cs_participation-
-- Tabellen (siehe Memo project_schluchtsturm: das war für später schon so
-- vorgeschlagen).
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

-- Einstellbare Fixplatz-Zahl je Event, getrennt für WS/CS, Default 15.
alter table alliances add column if not exists ws_fixed_count integer not null default 15;
alter table alliances add column if not exists cs_fixed_count integer not null default 15;

-- Schluchtsturm nutzt künftig dieselbe Event-Tabelle wie Wüstensturm.
alter table ws_events add column if not exists mode text not null default 'ws';
alter table ws_events drop constraint if exists ws_events_mode_check;
alter table ws_events add constraint ws_events_mode_check check (mode in ('ws','cs'));

drop index if exists ws_events_alliance_date_team_uidx;
create unique index if not exists ws_events_alliance_date_team_mode_uidx
  on ws_events(alliance_id, event_date, team, mode);

-- Historie: jede Anmeldung bekommt eine Zeile, nicht nur wer einen Platz bekam.
alter table ws_participation add column if not exists fixed boolean not null default false;
alter table ws_participation add column if not exists waitlisted boolean not null default false;
comment on column ws_participation.fixed is
  'War einer der N stärksten Angemeldeten und damit automatisch gesetzt (N = alliances.ws_fixed_count/cs_fixed_count zum Zeitpunkt des Einfrierens)';
comment on column ws_participation.waitlisted is
  'War angemeldet, hat aber weder Haupt- noch Ersatzplatz bekommen (mehr als 30 Anmeldungen)';

notify pgrst, 'reload schema';
commit;
