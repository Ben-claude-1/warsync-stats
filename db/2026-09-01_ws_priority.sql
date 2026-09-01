-- ══════════════════════════════════════════════════════════════════════════════
--  Prioliste: wer beim nächsten Mal bevorzugt werden soll
--  01.09.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Es melden sich mehr Leute an, als Plätze da sind: 39 Anmeldungen auf 20 Haupt-
-- und 10 Ersatzplätze. Die neun Übriggebliebenen bekommen in der Anmeldung den
-- Wert 'C' — angemeldet, aber kein Platz. Wer das mehrfach hintereinander
-- abbekommt, soll beim nächsten Mal vorgezogen werden.
--
-- Warum eine eigene Tabelle statt einer Auswertung von ws_participation:
-- ein 'C'-Spieler gehört zu keinem Team und damit zu keinem Event — es gibt
-- keine Zeile, an die man ihn hängen könnte. Der Zähler ist außerdem genau das,
-- was der Nutzer sieht und von Hand korrigieren können muss.
--
-- Der Zähler wird beim Anmeldeschluss einmal je Event verrechnet: +1 für jeden
-- mit 'C', -1 für jeden, der einen der 30 Plätze bekommen hat, nie unter 0.
-- `last_event_date` hält die Verrechnung idempotent — ein zweiter Durchlauf für
-- denselben Anmeldeschluss (zwei Geräte, erneutes Schließen) zählt nicht doppelt.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists ws_priority(
  alliance_id     uuid not null references alliances(id) on delete cascade,
  player_name     text not null,
  mode            text not null default 'ws',          -- 'ws' | 'cs', getrennte Zähler
  counter         integer not null default 0,
  last_event_date date,                                -- welcher Anmeldeschluss zuletzt verrechnet wurde
  updated_at      timestamptz not null default now(),
  primary key (alliance_id, player_name, mode),
  constraint ws_priority_counter_nonneg check (counter >= 0),
  constraint ws_priority_mode_check check (mode in ('ws','cs'))
);

comment on table ws_priority is
  'Wie oft ein Spieler angemeldet war, aber keinen der 30 Plätze bekommen hat (Team C). Steigt beim Anmeldeschluss um 1, sinkt um 1 sobald er wieder aufgestellt wurde, nie unter 0. Nur Zeilen > 0 werden angezeigt.';
comment on column ws_priority.last_event_date is
  'Anmeldeschluss, der zuletzt in diesen Zähler eingerechnet wurde — verhindert Doppelzählung bei erneutem Schließen.';

-- Die einzige Abfrage: die Liste einer Allianz, größter Zähler zuerst.
create index if not exists ws_priority_liste_idx
  on ws_priority(alliance_id, mode, counter desc);

notify pgrst, 'reload schema';
commit;
