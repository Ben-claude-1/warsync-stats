-- Rally / Versammlungs-Schema. Quelle: Rally-Detail-Screenshots (vom iPhone
-- per AirDrop oder vom AVD per ADB-Screencap). Pro Rally sind alle Squads
-- mit Truppen + Combat-Strength sichtbar — daraus lässt sich pro Spieler
-- eine Stärke-Schätzung speichern.

CREATE TABLE IF NOT EXISTS warsync.rallies (
    id                  BIGSERIAL PRIMARY KEY,
    discovered_at       TIMESTAMPTZ DEFAULT NOW(),
    rally_started_at    TIMESTAMPTZ,                  -- aus dem Screenshot wenn lesbar
    rally_kind          TEXT,                         -- 'attack' | 'gather' | 'defense' | 'rally' | other
    target_x            INT,                          -- Ziel-Koordinaten auf der Map
    target_y            INT,
    target_player_id    BIGINT REFERENCES warsync.players(id),
    target_label        TEXT,                         -- z.B. Bauwerk-Name oder Allianz-Tag des Ziels
    leader_player_id    BIGINT REFERENCES warsync.players(id),
    raw_screenshot_path TEXT,
    raw_ocr_json        JSONB,
    notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_rallies_discovered ON warsync.rallies(discovered_at);
CREATE INDEX IF NOT EXISTS idx_rallies_target_xy  ON warsync.rallies(target_x, target_y);
CREATE INDEX IF NOT EXISTS idx_rallies_leader     ON warsync.rallies(leader_player_id);

-- Pro Squad in einer Rally — Stärke-Quelle pro Spieler
CREATE TABLE IF NOT EXISTS warsync.rally_squads (
    id                  BIGSERIAL PRIMARY KEY,
    rally_id            BIGINT REFERENCES warsync.rallies(id) ON DELETE CASCADE,
    player_id           BIGINT REFERENCES warsync.players(id),
    squad_index         INT,                          -- 1, 2, ..., 8 in der Rally-Liste
    troops_total        INT,
    troops_t1           INT,
    troops_t2           INT,
    troops_t3           INT,
    troops_t4           INT,
    troops_t5           INT,
    combat_strength     NUMERIC,                      -- aus dem Spiel angezeigt
    march_speed_buff    REAL,                         -- z.B. 12.5 % als 0.125
    raw_ocr_json        JSONB,
    UNIQUE (rally_id, player_id, squad_index)
);
CREATE INDEX IF NOT EXISTS idx_rally_squads_player   ON warsync.rally_squads(player_id);
CREATE INDEX IF NOT EXISTS idx_rally_squads_strength ON warsync.rally_squads(combat_strength DESC);

-- Convenience view: best-known combat strength per player (max of any squad they fielded)
CREATE OR REPLACE VIEW warsync.player_strength_max AS
SELECT
    p.id           AS player_id,
    p.name         AS player_name,
    MAX(rs.combat_strength) AS max_strength,
    SUM(rs.troops_total)    AS total_troops_seen,
    COUNT(*)               AS squads_seen
FROM warsync.rally_squads rs
JOIN warsync.players p ON p.id = rs.player_id
GROUP BY p.id, p.name;
