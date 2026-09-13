-- Phase D-Img-2026-04-25: extra schema for match-result score boards
-- (Wüstensturm-Endergebnis & ähnliche Listen — anders als Map-Positionen)

CREATE TABLE IF NOT EXISTS warsync.matches (
    id              BIGSERIAL PRIMARY KEY,
    match_kind      TEXT,                         -- 'desert_storm', 'rally_event', ...
    played_at       TIMESTAMPTZ,                  -- aus dem Screenshot extrahiertes Datum
    server          INT,
    notes           TEXT,
    discovered_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warsync.match_results (
    id              BIGSERIAL PRIMARY KEY,
    match_id        BIGINT REFERENCES warsync.matches(id) ON DELETE CASCADE,
    player_id       BIGINT REFERENCES warsync.players(id),
    rank            INT,                          -- 1..N
    score           BIGINT,                       -- die Punktzahl
    alliance_tag    TEXT,
    raw_screenshot_path TEXT,
    raw_ocr_json    JSONB
);

CREATE INDEX IF NOT EXISTS idx_match_results_match  ON warsync.match_results(match_id);
CREATE INDEX IF NOT EXISTS idx_match_results_player ON warsync.match_results(player_id);
CREATE INDEX IF NOT EXISTS idx_match_results_score  ON warsync.match_results(score DESC);
