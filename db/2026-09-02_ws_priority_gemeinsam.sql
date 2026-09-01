-- ══════════════════════════════════════════════════════════════════════════════
--  Prioliste: ein gemeinsamer Zähler für beide Events
--  02.09.2026  ·  ersetzt die Aufteilung aus 2026-09-01_ws_priority.sql
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Die Prioliste startete mit einem Zähler je Event (`mode` im Schlüssel). Das
-- beantwortet die falsche Frage: wer sich in derselben Woche für Wüstensturm UND
-- Schluchtsturm meldet und beide Male auf 'C' landet, hat zweimal zugeschaut —
-- und gehört damit weiter nach oben als jemand, der einmal leer ausging. Mit zwei
-- getrennten Zählern stünde er zweimal mit einer 1 in zwei Listen, und beide
-- Listen sähen harmlos aus.
--
-- Deshalb: ein Zähler je Spieler, beide Events zahlen darauf ein. Was getrennt
-- bleiben MUSS, ist der Idempotenz-Stempel — sonst blockiert der Schluchtsturm-
-- Anmeldeschluss den des Wüstensturms, sobald beide auf denselben Tag fallen.
-- Dafür gibt es jetzt zwei Datumsspalten statt einer.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

alter table ws_priority add column if not exists last_ws_date date;
alter table ws_priority add column if not exists last_cs_date date;

-- Bestehende Stempel in die neue Spalte ihres Events retten, bevor `mode` fällt.
update ws_priority set last_ws_date=last_event_date where mode='ws' and last_event_date is not null;
update ws_priority set last_cs_date=last_event_date where mode='cs' and last_event_date is not null;

-- Zeilen desselben Spielers zusammenlegen: Zähler addieren, je Event den
-- jüngsten Stempel behalten. Beim Einspielen am 02.09. war die Tabelle leer —
-- die Zusammenlegung steht hier, damit die Migration auch auf einer Datenbank
-- stimmt, in der schon gezählt wurde.
create temporary table ws_priority_neu on commit drop as
select alliance_id,
       player_name,
       sum(counter)::integer as counter,
       max(last_ws_date)     as last_ws_date,
       max(last_cs_date)     as last_cs_date,
       max(updated_at)       as updated_at
from ws_priority
group by alliance_id, player_name;

delete from ws_priority;
alter table ws_priority drop constraint ws_priority_pkey;
alter table ws_priority drop constraint if exists ws_priority_mode_check;
alter table ws_priority drop column if exists mode;
alter table ws_priority drop column if exists last_event_date;
alter table ws_priority add primary key (alliance_id, player_name);

insert into ws_priority (alliance_id, player_name, counter, last_ws_date, last_cs_date, updated_at)
select alliance_id, player_name, counter, last_ws_date, last_cs_date, updated_at from ws_priority_neu;

comment on table ws_priority is
  'Wie oft ein Spieler angemeldet war, aber keinen der 30 Plätze bekommen hat (Team C) — über Wüstensturm und Schluchtsturm zusammen. Steigt je Anmeldeschluss um 1, sinkt um 1 sobald er wieder aufgestellt wurde, nie unter 0. Nur Zeilen > 0 werden angezeigt.';
comment on column ws_priority.last_ws_date is
  'Wüstensturm-Anmeldeschluss, der zuletzt in diesen Zähler einging — verhindert Doppelzählung.';
comment on column ws_priority.last_cs_date is
  'Schluchtsturm-Anmeldeschluss, der zuletzt in diesen Zähler einging. Getrennt von last_ws_date, weil beide Events auf denselben Tag fallen können.';

drop index if exists ws_priority_liste_idx;
create index if not exists ws_priority_liste_idx
  on ws_priority(alliance_id, counter desc);

notify pgrst, 'reload schema';
commit;
