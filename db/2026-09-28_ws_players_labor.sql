-- Die Stufe des Saison-Gebäudes (Optoelektronisches Labor, Season 4).
--
-- Es ist das Saison-Gebäude, an dem die Truppenstufe hängt — wer dort weiter ist,
-- marschiert mit besseren Einheiten, und zwar unabhängig davon, wie viel T1-Kraft
-- danebensteht. Deshalb gehört die Stufe **neben** `t1`/`t1_type` und nicht in sie
-- hinein: 45 Mio auf Laborstufe 26 sind etwas anderes als 45 Mio auf Stufe 20.
--
-- Erhoben wird sie wie der T1-Typ von der Allianz selbst — am 28.09.2026 über eine
-- Allianzankündigung („XP33 Census"), in der 64 Spieler ihre drei Werte als
-- Kommentar hinterlassen haben (`<Laborstufe> <Typ> <T1 in Mio>`). Das ist eine
-- Selbstauskunft, keine Messung: gerundet wird laut Ansage auf die nächste ganze
-- Zahl, und wer kurz vor dem Aufstieg steht, darf die nächste Stufe nennen.
--
-- Bewusst NULL-bar und ohne Vorgabewert, aus demselben Grund wie beim T1-Typ:
-- NULL heißt „nicht bekannt". Eine 0 wäre die Behauptung, jemand habe das Gebäude
-- nicht — und genau diese Verwechslung („Stufe 0" gegen „nicht gelesen") steht an
-- mehreren Stellen dieses Projekts als Falle beschrieben.
--
-- Kein Eintrag in `ws_player_history`: die Laborstufe ist eine Eigenschaft des
-- Spielers, keine Messreihe — dieselbe Begründung wie beim T1-Typ. Im Diagramm
-- hätte sie keine Achse.
alter table ws_players add column if not exists lab_level integer;

alter table ws_players drop constraint if exists ws_players_lab_level_chk;
alter table ws_players add constraint ws_players_lab_level_chk
  check (lab_level is null or (lab_level >= 1 and lab_level <= 40));

-- Ohne das kennt PostgREST die Spalte nicht und die App bekommt sie nicht geliefert.
notify pgrst, 'reload schema';
