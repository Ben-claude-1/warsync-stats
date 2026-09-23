-- ══════════════════════════════════════════════════════════════════════════════
--  Abmeldung: wer vorher Bescheid gegeben hat, dass er fehlen wird
--  18.09.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Seit dem 18.09.2026 schlägt ein Fixplatz die ⛔-Marke: die stärksten
-- `alliances.ws_fixed_count` Angemeldeten je Team werden im Reiter „Verteilung"
-- nicht mehr ausgeschlossen, auch nicht nach einem Fehlen. Damit daraus kein
-- Freibrief wird, braucht es die Gegenrichtung — den Fall, in dem jemand
-- **vorher** sagt, dass er nicht kann.
--
-- Diese Tabelle ist genau diese Aussage, und sie ist eine über ein **künftiges**
-- Event: zum Zeitpunkt der Abmeldung gibt es dafür noch keine Teilnahme-Zeile
-- (die entsteht erst beim Anmeldeschluss Donnerstag 04:00). Deshalb eine eigene
-- Tabelle — dieselbe Begründung wie bei ws_aussetzen und ws_priority.
--
-- Drei Wirkungen, alle aus derselben Zeile:
--   1. Der Verteilungs-Vorschlag plant ihn nicht ein (vor jeder anderen Regel,
--      auch vor dem Fixplatz — wer sagt, dass er fehlt, ist kein Kandidat).
--   2. In der Anmeldeliste steht die Marke „🚫 Abwesend" statt „⛔ Aussetzen".
--   3. Steht er beim Einfrieren trotzdem im Kader, bekommt seine Zeile
--      `ws_participation.excused = true`. Genau daran hängt, dass er beim
--      **nächsten** Mal nicht aussetzen muss: scripts/ws_service/eintragen.py
--      schreibt für Entschuldigte keine ws_aussetzen-Zeile.
--
-- `mode` gibt es wie bei ws_aussetzen für beide Events; gesetzt wird sie derzeit
-- nur im Wüstensturm, weil nur dort ein Fehlen eine Folge hat.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists ws_abmeldung(
  alliance_id uuid not null references alliances(id) on delete cascade,
  player_name text not null,
  mode        text not null default 'ws',
  event_date  date not null,                       -- das Event, bei dem er fehlt
  grund       text,
  created_at  timestamptz not null default now(),
  primary key (alliance_id, player_name, mode, event_date),
  constraint ws_abmeldung_mode_check check (mode in ('ws','cs'))
);

comment on table ws_abmeldung is
  'Vorab-Abmeldung: der Spieler hat angekündigt, bei diesem Event zu fehlen. Er wird nicht eingeplant und gilt als entschuldigt — es folgt also keine ws_aussetzen-Marke.';
comment on column ws_abmeldung.grund is
  'Freitext, optional. Leer heißt „ohne Angabe", nicht „kein Grund".';

notify pgrst, 'reload schema';
commit;
