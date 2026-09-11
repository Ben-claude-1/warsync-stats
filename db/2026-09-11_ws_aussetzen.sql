-- ══════════════════════════════════════════════════════════════════════════════
--  Aussetzen: wer beim nächsten Wüstensturm nicht eingeplant werden soll
--  11.09.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Wer im fixierten Kader stand (20 gesetzt + 10 Ersatz) und im Kampfergebnis
-- nicht auftaucht, hat gefehlt. Das steht schon heute in ws_participation
-- (played=false, excused=false). Neu ist die Folge: er setzt beim nächsten
-- Event aus. Das ist eine Aussage über ein **künftiges** Event, für das es beim
-- Eintragen noch keine Teilnahme-Zeile gibt — deshalb eine eigene Tabelle, wie
-- bei der Prioliste.
--
-- Eine Zeile je Spieler und Event, bei dem er aussetzt. Die Zeilen bleiben
-- stehen: sie sind zugleich die Geschichte, wer wann aussetzen musste.
-- `quelle_event_id` zeigt auf das Event, bei dem er gefehlt hat.
--
-- Die Markierung schlägt vor, sie teilt nicht ein — dieselbe Haltung wie die
-- Prioliste. Eingeteilt wird im Spiel; das Tool zeigt die Marke in der
-- Anmeldeliste neben dem Namen.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists ws_aussetzen(
  alliance_id     uuid not null references alliances(id) on delete cascade,
  player_name     text not null,
  mode            text not null default 'ws',
  event_date      date not null,                        -- das Event, bei dem er aussetzt
  grund           text,
  quelle_event_id uuid references ws_events(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (alliance_id, player_name, mode, event_date),
  constraint ws_aussetzen_mode_check check (mode in ('ws','cs'))
);

comment on table ws_aussetzen is
  'Wer beim genannten Event aussetzen soll — gesetzt, wenn er beim vorigen im Kader stand und nicht gespielt hat. Vorschlag für die Einteilung, keine Sperre.';
comment on column ws_aussetzen.quelle_event_id is
  'Das Event, bei dem er gefehlt hat.';

notify pgrst, 'reload schema';
commit;
