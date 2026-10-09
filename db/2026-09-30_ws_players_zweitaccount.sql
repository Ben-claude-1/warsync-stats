-- Zweitaccounts: zwei Zeilen im Werkzeug, ein Mensch im Spiel.
--
-- Ben, 30.09.2026: „little fighter und Ghost Fighter x sind die selbe person,
-- somit, wenn einer aussetzt, dann beide." Und: „wenn Little fighter in der
-- Startaufstellung ist, dann soll Ghost Fighter X auf der Ersatzbank sein."
--
-- Als Namenspaar im Quelltext waere das in einem Monat eine Zeile, die niemand
-- mehr erklaeren kann — dieselbe Falle wie beim Super-Admin (`name ===
-- 'Ben_the_men'`) und beim Ersatz-Wunsch. Deshalb eine Spalte.
--
-- Die Spalte steht am **Zweitaccount** und nennt den Hauptaccount; NULL heisst
-- „eigener Mensch". Die Richtung traegt die Entscheidung: auf die Bank geht der
-- Zweitaccount, gespielt wird der Hauptaccount.
--
-- Zwei Wirkungen in `src/core/zuteilung.js`:
--   1. Steht der Hauptaccount in derselben Aufstellung, bekommt der
--      Zweitaccount **kein Gebaeude** — er wird behandelt wie ein
--      Ersatz-Wunsch. Ein Mensch kann in der Schlacht nur einen Account
--      fuehren; das zweite Gebaeude stuende leer, und zwar ein wertvolles.
--   2. Eine Vorab-Abmeldung (`ws_abmeldung`) gilt dem **Menschen**: sie wirkt
--      auf beide Accounts, egal an welchem sie eingetragen ist. Die ⛔-Marke
--      aus `ws_aussetzen` wandert ausdruecklich **nicht** mit — sie ahndet das
--      Fehlen eines bestimmten Accounts.
--
-- Verglichen wird nur **innerhalb eines Teams**: A und B kaempfen neun Stunden
-- auseinander, dort kann derselbe Mensch sehr wohl zweimal ein Gebaeude halten.
--
-- Der Name ist der Schluessel, wie ueberall im Schema (`ws_players` hat keine
-- `player_uid`). `apdRename` zieht die Spalte deshalb mit um.
ALTER TABLE ws_players ADD COLUMN IF NOT EXISTS zweitaccount_von text;

COMMENT ON COLUMN ws_players.zweitaccount_von IS
  'Name des Hauptaccounts desselben Menschen; NULL = eigener Mensch.';

UPDATE ws_players SET zweitaccount_von = 'LittleFighter'
 WHERE name = 'Ghost Fighter X'
   AND alliance_id = (SELECT id FROM alliances WHERE tag = 'XP33');

NOTIFY pgrst, 'reload schema';
