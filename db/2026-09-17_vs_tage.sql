-- VS-Duell: die Punkte je Spieler und Tag
--
-- Bisher kannte das Werkzeug nur die Wochensumme (`vs_weeks`/`vs_entries`, aus
-- hochgeladenen Screenshots). Das Ziel ist aber ein Tagesziel — 7,2 Mio, je Tag
-- eine eigene Aufgabe (Montag Radar, Dienstag Bau, …). Wer die Woche mit 43,2
-- Mio abschliesst, kann an drei Tagen nichts getan und an dreien doppelt
-- geliefert haben; genau das soll sichtbar werden.
--
-- Gelesen wird im Spiel unter Allianzduell -> Rang -> Tagesrang, gefiltert auf
-- „Deine Allianz" (scripts/vs_service). Die Tagesreiter decken Mo bis Sa der
-- laufenden Duellwoche ab und werden Sonntag zurueckgesetzt — was bis dahin
-- nicht gelesen ist, ist weg. Deshalb wird die ganze Woche in einem Lauf geholt.

create table if not exists vs_tage (
  id           uuid primary key default gen_random_uuid(),
  alliance_id  uuid not null references alliances(id) on delete cascade,
  datum        date not null,
  player_name  text not null,
  pts          bigint not null,
  rang         integer,
  quelle       text not null default 'scan',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Eindeutig je Allianz, wie jede Mandanten-Tabelle: derselbe Mensch kann in
-- zwei Allianzen stehen. `on_conflict` muss die Spalte deshalb mitfuehren.
create unique index if not exists vs_tage_uidx
  on vs_tage (alliance_id, datum, player_name);
create index if not exists idx_vs_tage_alliance on vs_tage (alliance_id);
create index if not exists idx_vs_tage_datum on vs_tage (alliance_id, datum);

-- Was ein Lauf an einem Tag gesehen hat.
--
-- **Das ist der Unterschied zwischen „0 Punkte" und „nicht gelesen".** Die
-- Rangliste im Spiel endet bei 100 Zeilen, und XP33 hat genau 100 aktive
-- Mitglieder. Findet ein Lauf *weniger* als 100 Zeilen, war die Liste nicht
-- abgeschnitten — wer dann fehlt, ist an dem Tag nicht angetreten und hat
-- tatsaechlich nichts geholt. Findet er genau 100, weiss er ueber einen
-- Fehlenden nichts: der kann unterhalb der Schnittkante stehen. Ohne diese
-- Zeile waere beides nicht zu unterscheiden, und die Auswertung wuerde
-- Abwesende als Nuller behaupten.
create table if not exists vs_tage_lauf (
  alliance_id   uuid not null references alliances(id) on delete cascade,
  datum         date not null,
  gelesen       integer not null,
  letzter_rang  integer,
  min_pts       bigint,
  vollstaendig  boolean not null default false,
  gelaufen_at   timestamptz default now(),
  primary key (alliance_id, datum)
);

create or replace function vs_tage_touch() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists vs_tage_touch_trg on vs_tage;
create trigger vs_tage_touch_trg before update on vs_tage
  for each row execute function vs_tage_touch();

-- Ohne das kennt PostgREST die neuen Tabellen nicht und die App bekommt sie
-- schlicht nicht geliefert.
notify pgrst, 'reload schema';
