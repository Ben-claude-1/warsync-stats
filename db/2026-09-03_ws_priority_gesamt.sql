-- ══════════════════════════════════════════════════════════════════════════════
--  Prioliste: zusätzlich ein Gesamtzähler für Team C
--  03.09.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `counter` ist eine Warteschlange: er steigt bei 'C' und fällt wieder, sobald
-- jemand aufgestellt wurde. Genau deshalb beantwortet er die Frage nicht, die
-- man beim Einteilen eigentlich hat — nämlich wie oft jemand über die Monate
-- hinweg zugeschaut hat. Wer abwechselnd spielt und aussetzt, steht dort dauernd
-- bei 0 oder 1, und dass es immer dieselben trifft, sieht man nie.
--
-- `c_total` zählt deshalb nur hoch, nie herunter: die Lebenszeit-Summe der
-- 'C'-Einteilungen, über beide Events zusammen (wie `counter` — wer in derselben
-- Woche in Wüstensturm und Schluchtsturm leer ausgeht, hat zweimal zugeschaut).
--
-- Wie oft jemand gesetzt oder als Ersatz eingeteilt war, steht bewusst NICHT
-- hier: das lässt sich aus `ws_participation` ablesen (`substitute`, dazu
-- `ws_events.mode` für die Trennung nach Event) und wird in
-- `einsatzBilanzAlle()` in src/core/rotation.js in einem Durchlauf gezählt. Eine
-- abgeleitete Zahl kann nicht auseinanderlaufen, und sie gilt rückwirkend für
-- alle Events, die schon in der Datenbank stehen. Für 'C' geht das nicht — ein
-- 'C'-Spieler gehört zu keinem Team und hat deshalb gar keine Teilnahme-Zeile.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

alter table ws_priority add column if not exists c_total integer not null default 0;

alter table ws_priority drop constraint if exists ws_priority_c_total_nonneg;
alter table ws_priority add constraint ws_priority_c_total_nonneg check (c_total >= 0);

-- Bestandsschutz: der offene Zähler ist die Untergrenze dessen, was jemand schon
-- an 'C' gesammelt hat. Beim Einspielen am 03.09. war die Tabelle leer; die
-- Zeile steht hier für Datenbanken, in denen schon gezählt wurde.
update ws_priority set c_total = counter where c_total < counter;

comment on column ws_priority.c_total is
  'Wie oft der Spieler insgesamt auf Team C stand (beide Events zusammen). Zählt nur hoch — im Gegensatz zu counter, der beim nächsten Einsatz wieder sinkt.';

notify pgrst, 'reload schema';
commit;
