-- Migration: Create betting snapshots table for historical odds tracking
-- This table stores all betting line snapshots for permanent analytics storage

CREATE TABLE IF NOT EXISTS betting_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  scraped_at DATETIME NOT NULL,
  
  -- Moneyline odds (American format)
  home_moneyline INTEGER,
  away_moneyline INTEGER,
  
  -- Spread/Puck line data
  spread_line REAL,           -- Point spread or puck line (e.g., -3.5, +1.5)
  home_spread_odds INTEGER,   -- Odds for home team spread
  away_spread_odds INTEGER,   -- Odds for away team spread
  
  -- Over/Under totals
  total_line REAL,            -- Total points/goals line (e.g., 45.5, 6.5)
  over_odds INTEGER,          -- Odds for over
  under_odds INTEGER,         -- Odds for under
  
  -- Metadata
  source TEXT DEFAULT 'ActionNetwork',
  sportsbook TEXT,            -- Primary sportsbook for this line
  is_stale BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_betting_snapshots_game_sport ON betting_snapshots(game_id, sport);
CREATE INDEX IF NOT EXISTS idx_betting_snapshots_scraped_at ON betting_snapshots(scraped_at);
CREATE INDEX IF NOT EXISTS idx_betting_snapshots_sport_date ON betting_snapshots(sport, scraped_at);
CREATE INDEX IF NOT EXISTS idx_betting_snapshots_stale ON betting_snapshots(is_stale);

-- Insert migration record
INSERT OR IGNORE INTO migrations (filename, executed_at) 
VALUES ('004_create_betting_snapshots.sql', CURRENT_TIMESTAMP);