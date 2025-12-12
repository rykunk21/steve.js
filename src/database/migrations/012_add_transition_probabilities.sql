-- Migration 011: Add transition probabilities field to historical_games

-- Add transition_probabilities column to store computed probabilities as JSON
ALTER TABLE historical_games ADD COLUMN transition_probabilities TEXT;

-- Add index for games with transition probabilities
CREATE INDEX IF NOT EXISTS idx_historical_games_has_transitions ON historical_games(has_play_by_play) WHERE transition_probabilities IS NOT NULL;

