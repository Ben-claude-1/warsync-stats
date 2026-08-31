-- ══════════════════════════════════════════════════════════════════════════════
--  Wer ist gerade angemeldet? (Anwesenheit)
--  31.08.2026
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Die App kennt keine Sitzung auf dem Server: die Anmeldung lebt im Browser-Tab
-- (APP.user), ein Neuladen führt zurück auf die Anmeldeseite. Es gibt deshalb
-- nichts, was man nach „wer ist gerade da" fragen könnte — das muss der Client
-- selbst melden.
--
-- Jeder angemeldete Tab schreibt daher im Minutentakt eine Zeile fort
-- (Herzschlag). Wer sich abmeldet, löscht seine Zeile; wer den Tab einfach
-- zumacht, fällt nach ein paar Minuten von selbst aus der Liste — deshalb steht
-- hier `last_seen` und kein Flag `online`. Ein Flag bliebe nach jedem Absturz
-- für immer auf „an".
--
-- Ein Mensch kann an mehreren Geräten angemeldet sein, deshalb gehört die
-- `device_id` in den Schlüssel: Handy und Laptop sind zwei Zeilen, nicht eine,
-- die sich gegenseitig überschreibt.
--
-- Vor dem Einspielen: docker exec -i supabase-db psql -U postgres < ...
-- (die -i-Flag ist Pflicht, sonst kommt das SQL nie an).

begin;

create table if not exists ws_presence(
  alliance_id uuid not null references alliances(id) on delete cascade,
  player_name text not null,
  device_id   text not null,          -- zufällige ID je Browser, liegt im localStorage
  device      text,                   -- grobes Etikett: 'iPhone', 'Android', 'Mac', …
  page        text,                   -- welcher Bereich gerade offen ist
  first_seen  timestamptz not null default now(),   -- Beginn dieser Sitzung
  last_seen   timestamptz not null default now(),   -- letzter Herzschlag
  primary key (alliance_id, player_name, device_id)
);

comment on table ws_presence is
  'Herzschlag der angemeldeten Browser-Tabs. Eine Zeile je Spieler und Gerät; wer länger als ein paar Minuten nicht meldet, gilt als weg.';

-- Die einzige Abfrage: die zuletzt Gesehenen einer Allianz.
create index if not exists ws_presence_last_seen_idx
  on ws_presence(alliance_id, last_seen desc);

notify pgrst, 'reload schema';
commit;
