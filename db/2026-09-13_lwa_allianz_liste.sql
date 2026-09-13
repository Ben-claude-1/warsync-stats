-- Welche Allianzen es auf einem Server gibt — fuer die Auswahl des VS-Gegners.
--
-- **Warum eine Sicht und nicht `lwa_allianzen`.** Dort steht nur, wessen
-- Mitgliederliste jemand geholt hat, und die kostet eine Anfrage am Kontingent
-- je Allianz. Auf einem frisch geholten Gegner-Server ist das genau eine (am
-- 13.09.2026: `cult` auf #1655, neben 72 weiteren, die es dort gibt). Eine
-- Auswahlliste aus dieser Tabelle saehe deshalb leer aus, obwohl der
-- Kartenabruf alle Kuerzel laengst kennt.
--
-- **Warum eine Sicht und nicht im Browser gruppieren.** PostgREST kann kein
-- DISTINCT; ohne die Sicht muesste die Oberflaeche alle Spielerzeilen des
-- Servers laden (5598 auf #1655), um daraus 73 Kuerzel zu gewinnen.
--
-- `power` und `kills` summieren nur ueber Spieler, zu denen eine
-- Mitgliederliste vorliegt — fuer die uebrigen ist NULL die ehrliche Auskunft
-- („nicht geholt"), nicht 0. `mit_daten` sagt, auf wie vielen Spielern die
-- Summe beruht; ist es 0, zeigt die Auswahl das ausdruecklich an.

CREATE OR REPLACE VIEW lwa_allianz_liste AS
SELECT s.server,
       s.allianz                AS tag,
       count(*)::int            AS spieler,
       count(s.army_kill)::int  AS mit_daten,
       sum(s.power)::bigint     AS power,
       sum(s.army_kill)::bigint AS kills,
       max(s.last_active_at)    AS zuletzt_aktiv
FROM lwa_spieler s
WHERE s.allianz IS NOT NULL AND s.allianz <> ''
GROUP BY s.server, s.allianz;

-- Die Rechte kommen aus den Default-ACLs (anon/authenticated wie bei jeder
-- Tabelle hier); ein eigenes GRANT braucht es deshalb nicht.

NOTIFY pgrst, 'reload schema';
