-- Helden-Besetzung je Truppe: welcher Held in welchem Platz einer der vier
-- Truppen (T1-T4) eines Spielers steht.
--
-- Eigene Tabelle statt einer JSONB-Spalte auf ws_players: fester Slot
-- (Truppe 1-4, Platz 0-4), Mandant über alliance_id+player_name wie
-- ws_priority. `typ` wird beim Speichern aus lw_helden übernommen statt per
-- Join gelesen — die App macht kaum Joins über PostgREST, und der Typ eines
-- Helden ändert sich praktisch nie.
--
-- Woher ein Held kommt, ist (noch) reine Handarbeit: aus dem Truppen-Screenshot
-- lässt sich der Name nicht lesen (nur Portraits, kein Text), die Zuordnung
-- läuft über Vergleich mit der Helden-Sammelübersicht — siehe die Frage zur
-- automatischen Erkennung im Chat.
create table if not exists ws_player_heroes (
  alliance_id uuid not null,
  player_name text not null,
  truppe      smallint not null check (truppe between 1 and 4),
  slot        smallint not null check (slot between 0 and 4),
  held        text not null,
  typ         text check (typ in ('T','A','M')),
  updated_at  timestamptz not null default now(),
  primary key (alliance_id, player_name, truppe, slot)
);

notify pgrst, 'reload schema';
