-- Migration 013: Restructure game IDs table for StatBroadcast-centric architecture
-- This migration renames statbroadcast_game_ids to game_ids and simplifies the schema
-- to use StatBroadcast as the source of truth for game tracking

-- Drop the old table (we'll reseed from scratch)
DROP TABLE IF EXISTS statbroadcast_game_ids;

-- Create simplified game_ids table
CREATE TABLE IF NOT EXISTS game_ids (
    game_id TEXT PRIMARY KEY,                    -- StatBroadcast game ID (e.g., "mbb-2023-duke-unc-12345")
    sport TEXT NOT NULL DEFAULT 'mens-college-basketball',
    home_team_id TEXT NOT NULL,                  -- FK to teams.team_id
    away_team_id TEXT NOT NULL,                  -- FK to teams.team_id
    game_date DATE NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT 0,        -- Track if game has been processed for feature extraction
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
    FOREIGN KEY (away_team_id) REFERENCES teams(team_id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_game_ids_home_team ON game_ids(home_team_id);
CREATE INDEX IF NOT EXISTS idx_game_ids_away_team ON game_ids(away_team_id);
CREATE INDEX IF NOT EXISTS idx_game_ids_processed ON game_ids(processed);
CREATE INDEX IF NOT EXISTS idx_game_ids_date ON game_ids(game_date);
CREATE INDEX IF NOT EXISTS idx_game_ids_sport ON game_ids(sport);

