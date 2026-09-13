-- Die Handmarke: „dieser Spieler bringt viel".
--
-- Sie steht **neben** dem gemessenen Leistungsindex, nicht an seiner Stelle. Der
-- Index rechnet mit den Einzelpunkten und die bestehen zu 99,8 % aus Kills; was
-- jemand an Spielverstaendnis, Absprache oder Eroberung mitbringt, sieht der
-- Mensch und nicht die Zahl. Am 14.09.2026 hat Cocojamb elf Namen in den
-- Allianz-Chat geschrieben — sieben davon standen auch im Index oben, vier
-- nicht. Genau diese vier waeren ohne Handmarke verloren gegangen.
--
-- Gesetzt wird sie im Werkzeug (Anmeldeliste, nur mit canAccess('ws')), nicht
-- hier. `ws_players` ist mandantengetrennt, die Marke gilt also je Allianz —
-- derselbe Mensch kann in der einen Allianz Leistungstraeger sein und in der
-- anderen neu.

ALTER TABLE ws_players ADD COLUMN IF NOT EXISTS stern boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
