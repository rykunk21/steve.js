-- Migration 002: Create betting and sports data tables

-- Betting Snapshots Table
CREATE TABLE IF NOT EXISTS betting_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    source TEXT NOT NULL,
    snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Spread betting data
    home_spread REAL,
    away_spread REAL,
    home_spread_odds INTEGER,
    away_spread_odds INTEGER,
    
    -- Moneyline data
    home_moneyline INTEGER,
    away_moneyline INTEGER,
    
    -- Totals data
    over_under REAL,
    over_odds INTEGER,
    under_odds INTEGER,
    
    -- Raw data for debugging
    raw_data TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Betting Threads Table
CREATE TABLE IF NOT EXISTS betting_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    game_date DATETIME NOT NULL,
    
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Note: Historical games functionality moved to enhanced game_ids table in migration 005

-- Reconciliation Log Table
CREATE TABLE IF NOT EXISTS reconciliation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    espn_game_id TEXT NOT NULL,
    statbroadcast_game_id TEXT,
    reconciliation_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('matched', 'unmatched', 'error')),
    confidence_score REAL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for betting tables
CREATE INDEX IF NOT EXISTS idx_betting_snapshots_game_id ON betting_snapshots(game_id);
CREATE INDEX IF NOT EXISTS idx_betting_snapshots_time ON betting_snapshots(snapshot_time);
CREATE INDEX IF NOT EXISTS idx_betting_threads_game_id ON betting_threads(game_id);
CREATE INDEX IF NOT EXISTS idx_betting_threads_guild ON betting_threads(guild_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_espn ON reconciliation_log(espn_game_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_log_date ON reconciliation_log(reconciliation_date);