-- Warsync-stats DB schema. Lives inside the supabase-db Postgres container.
-- Apply via:
--   docker exec -i supabase-db psql -U postgres < db/schema.sql

CREATE SCHEMA IF NOT EXISTS warsync;

-- ----------------------------------------------------------------------------
-- Players (roster, stable across scans)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warsync.players (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    server          INT,                          -- e.g. 1234
    alliance_tag    TEXT,                         -- short tag like [PHX]
    alliance_name   TEXT,                         -- full name
    notes           TEXT,
    first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (name, server)
);

-- ----------------------------------------------------------------------------
-- Scan runs (one row per "we walked the map at time T")
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warsync.scans (
    id              BIGSERIAL PRIMARY KEY,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    scout_account   TEXT,                         -- which account did the scan
    server          INT,
    map_zone        TEXT,                         -- 'state-map', 'desert-storm-day1', ...
    tile_count      INT DEFAULT 0,
    status          TEXT DEFAULT 'running',       -- running | done | aborted | failed
    notes           TEXT
);

-- ----------------------------------------------------------------------------
-- Each detected base / observation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS warsync.player_positions (
    id                      BIGSERIAL PRIMARY KEY,
    scan_id                 BIGINT REFERENCES warsync.scans(id) ON DELETE CASCADE,
    player_id               BIGINT REFERENCES warsync.players(id),
    captured_at             TIMESTAMPTZ DEFAULT NOW(),

    -- World position on the Last War state map
    world_x                 INT,
    world_y                 INT,

    -- Strength / composition (whatever we can OCR)
    strength                NUMERIC,              -- combat power total
    castle_level            INT,
    troops_t1               INT,
    troops_t2               INT,
    troops_t3               INT,
    troops_t4               INT,
    troops_t5               INT,
    alliance_tag            TEXT,
    is_capital              BOOLEAN DEFAULT FALSE,
    is_friendly             BOOLEAN DEFAULT FALSE,

    -- Forensics
    tile_screenshot_path    TEXT,                 -- relative path under scan_shots/
    ocr_confidence          REAL,
    raw_ocr_json            JSONB,
    raw_world_label         TEXT                  -- e.g. "X:512 Y:780"
);

CREATE INDEX IF NOT EXISTS idx_pos_scan       ON warsync.player_positions(scan_id);
CREATE INDEX IF NOT EXISTS idx_pos_player     ON warsync.player_positions(player_id);
CREATE INDEX IF NOT EXISTS idx_pos_captured   ON warsync.player_positions(captured_at);
CREATE INDEX IF NOT EXISTS idx_pos_xy         ON warsync.player_positions(world_x, world_y);

-- ----------------------------------------------------------------------------
-- Convenience view: latest position per player
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW warsync.player_latest AS
SELECT DISTINCT ON (pp.player_id)
    p.id            AS player_id,
    p.name          AS player_name,
    p.alliance_tag,
    pp.captured_at,
    pp.world_x,
    pp.world_y,
    pp.strength,
    pp.castle_level,
    pp.tile_screenshot_path
FROM warsync.player_positions pp
JOIN warsync.players p ON p.id = pp.player_id
ORDER BY pp.player_id, pp.captured_at DESC;
