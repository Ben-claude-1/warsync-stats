-- T1-Typ: welche Truppengattung der T1-Trupp ist.
--
-- Die T1-Stärke allein sagt nicht, womit jemand marschiert. Für die Aufstellung
-- ist genau das die zweite Hälfte der Auskunft: 48 Mio Tank und 48 Mio Air
-- gehören an verschiedene Gebäude.
--
-- Kurzcodes statt ausgeschriebener Namen, weil die Quelle (die Anmelde-Tabellen
-- der Allianz) sie so führt und die Oberfläche sie ohnehin über T1_TYP auf
-- Beschriftung, Symbol und Farbe abbildet.
--
--   T = Tank · A = Air · M = Missile
--
-- Bewusst NULL-bar: für die meisten Spieler ist der Typ (noch) nicht bekannt,
-- und ein Vorgabewert wäre eine Behauptung. Kein Eintrag in ws_player_history —
-- der Typ ist eine Eigenschaft des Spielers, keine Messreihe.
alter table ws_players add column if not exists t1_type text;

alter table ws_players drop constraint if exists ws_players_t1_type_chk;
alter table ws_players add constraint ws_players_t1_type_chk
  check (t1_type is null or t1_type in ('T','A','M'));

-- Ohne das kennt PostgREST die Spalte nicht und die App bekommt sie nicht geliefert.
notify pgrst, 'reload schema';
