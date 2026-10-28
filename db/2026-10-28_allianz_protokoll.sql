-- ══════════════════════════════════════════════════════════════════════════════
--  Allianz-Protokoll: Zu- und Abgänge aus dem Spiel selbst
--  28.10.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Bisher kam die Auskunft „wer ist neu, wer ist weg" aus LW Atlas
-- (`lwa_spieler`, Mitgliederliste je Allianz) — und der Dienst wird
-- abgeschaltet. Last War führt dieselbe Auskunft selbst, und genauer: unter
-- Allianz → Verlauf → Reiter „Mitglieder" steht jeder Eintritt, Austritt,
-- Rauswurf und jede Rangänderung mit Datum und Uhrzeit. LW Atlas sah nur zwei
-- Stände nebeneinander; das Protokoll sagt, wann und durch wen.
--
-- Gelesen von `scripts/allianz_protokoll/run.py` (nachts über die Routine
-- „Allianz-Protokoll lesen"). Eine Zeile je Protokolleintrag; der Lauf
-- scrollt jede Nacht ein Stück in Bekanntes hinein, deshalb der eindeutige
-- Schlüssel — ein zweites Lesen desselben Eintrags legt keine zweite Zeile an.
--
-- `spieler` ist, was im Spiel stand (so gut die Texterkennung es las),
-- `spieler_kader` der zugeordnete Kadername — NULL, wenn keiner sicher passte
-- (bei einem Neuzugang der Normalfall). Dieselbe Trennung wie `name_roh`/`name`
-- in `karte_basen`: der Beleg bleibt, die Deutung steht daneben.
--
-- `zeit` ist die Uhrzeit, die das Spiel anzeigt, ohne Zeitzone — es ist die
-- Ortszeit des Geräts (BlueStacks), wie bei den Belegen des WS-Dienstes.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists allianz_protokoll(
  id            bigint generated always as identity primary key,
  alliance_id   uuid not null references alliances(id) on delete cascade,
  zeit          timestamp not null,
  art           text not null,
  spieler       text not null,
  spieler_kader text,
  akteur        text,
  rang_von      smallint,
  rang_nach     smallint,
  text          text not null,
  symbol        text,
  gelesen_am    timestamptz not null default now(),
  constraint allianz_protokoll_art_check
    check (art in ('zugang','abgang','entfernt','rang','sonstig')),
  constraint allianz_protokoll_eindeutig unique (alliance_id, zeit, art, spieler)
);

create index if not exists idx_allianz_protokoll_zeit
  on allianz_protokoll(alliance_id, zeit desc);

comment on table allianz_protokoll is
  'Allianz → Verlauf → Mitglieder aus Last War: Zugang/Abgang/Rauswurf/Rangänderung je Eintrag. spieler = gelesen, spieler_kader = zugeordnet (NULL = kein sicherer Treffer).';

notify pgrst, 'reload schema';
commit;
