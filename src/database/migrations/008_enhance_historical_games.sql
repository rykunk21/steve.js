-- Migration 008: Enhance historical_games table with StatBroadcast fields

-- Add StatBroadcast-specific columns if they don't exist
ALTER TABLE historical_games ADD COLUMN statbroadcast_game_id TEXT;
ALTER TABLE historical_games ADD COLUMN has_play_by_play BOOLEAN DEFAULT 0;
ALTER TABLE historical_games ADD COLUMN processed_at TIMESTAMP;
ALTER TABLE historical_games ADD COLUMN backfilled BOOLEAN DEFAULT 0;
ALTER TABLE historical_games ADD COLUMN backfill_date TIMESTAMP;

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_historical_games_sb_id ON historical_games(statbroadcast_game_id);
CREATE INDEX IF NOT EXISTS idx_historical_games_date ON historical_games(game_date);
CREATE INDEX IF NOT EXISTS idx_historical_games_backfilled ON historical_games(backfilled);
