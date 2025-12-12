-- Migration 007: Create statbroadcast_game_ids table for ESPN ↔ StatBroadcast mappings

CREATE TABLE IF NOT EXISTS statbroadcast_game_ids (
    espn_game_id TEXT PRIMARY KEY,
    statbroadcast_game_id TEXT NOT NULL UNIQUE,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    game_date DATE NOT NULL,
    match_confidence REAL,
    match_method TEXT DEFAULT 'discovery',
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_fetched TIMESTAMP,
    data_quality TEXT CHECK (data_quality IN ('full', 'partial', 'none'))
);

CREATE INDEX IF NOT EXISTS idx_statbroadcast_game_ids_sb_id ON statbroadcast_game_ids(statbroadcast_game_id);
CREATE INDEX IF NOT EXISTS idx_statbroadcast_game_ids_date ON statbroadcast_game_ids(game_date);
CREATE INDEX IF NOT EXISTS idx_statbroadcast_game_ids_confidence ON statbroadcast_game_ids(match_confidence);
