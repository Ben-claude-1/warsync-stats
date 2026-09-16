-- Ersatz-Wunsch: „stell mich auf die Bank, mir ist es nicht so wichtig zu spielen"
--
-- Longrow hat das am 16.09.2026 gesagt. Als Name im Quelltext waere es in einem
-- Monat eine Zeile, die niemand mehr erklaeren kann — dieselbe Falle wie beim
-- Super-Admin, der frueher als `name==='Ben_the_men'` im Code stand.
--
-- Der Wunsch schlaegt die Rangfolge der Zuteilung: wer ihn setzt, landet im
-- Ersatz, auch wenn seine Kraft fuer die 20 reichen wuerde. Er ist **kein**
-- Ausschluss — im Wuestensturm spielen alle 30 gleichzeitig, der Ersatz
-- bekommt nur kein Gebaeude.
ALTER TABLE ws_players ADD COLUMN IF NOT EXISTS ersatz_wunsch boolean NOT NULL DEFAULT false;

UPDATE ws_players SET ersatz_wunsch = true
 WHERE name = 'Longrow'
   AND alliance_id = (SELECT id FROM alliances WHERE tag = 'XP33');

NOTIFY pgrst, 'reload schema';
