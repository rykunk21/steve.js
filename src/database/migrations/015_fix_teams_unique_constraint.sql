-- Migration 015: Fix teams table to allow same GID for different sports
-- The UNIQUE constraint on statbroadcast_gid prevents schools from having multiple sports
-- We need a composite UNIQUE constraint on (statbroadcast_gid, sport) instead
-- NOTE: This migration will DROP all data in teams and game_ids tables

-- Disable foreign key constraints temporarily
PRAGMA foreign_keys = OFF;

-- Drop any existing backup tables from failed migrations
DROP TABLE IF EXISTS teams_backup;
DROP TABLE IF EXISTS game_ids_backup;

-- Drop tables in correct order (child first, then parent)
DROP TABLE IF EXISTS game_ids;
DROP TABLE IF EXISTS teams;

-- Recreate teams with composite unique constraint
CREATE TABLE teams (
    team_id TEXT PRIMARY KEY,
    statbroadcast_gid TEXT NOT NULL,
    team_name TEXT NOT NULL,
    sport TEXT NOT NULL DEFAULT 'mens-college-basketball',
    conference TEXT,
    
    -- Statistical representation for MCMC (JSON blob for VAE dense representation)
    statistical_representation TEXT,
    
    -- Player roster for injury impact analysis (JSON array)
    player_roster TEXT,
    
    -- Sync tracking
    last_synced TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Composite unique constraint: same school can have multiple sports
    UNIQUE(statbroadcast_gid, sport)
);

-- Recreate game_ids with nullable team IDs (from migration 014)
CREATE TABLE game_ids (
    game_id TEXT PRIMARY KEY,
    sport TEXT NOT NULL DEFAULT 'mens-college-basketball',
    home_team_id TEXT,
    away_team_id TEXT,
    game_date DATE NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
    FOREIGN KEY (away_team_id) REFERENCES teams(team_id)
);

-- Recreate indexes for teams
CREATE INDEX IF NOT EXISTS idx_teams_statbroadcast_gid ON teams(statbroadcast_gid);
CREATE INDEX IF NOT EXISTS idx_teams_sport ON teams(sport);
CREATE INDEX IF NOT EXISTS idx_teams_conference ON teams(conference);
CREATE INDEX IF NOT EXISTS idx_teams_last_synced ON teams(last_synced);

-- Recreate indexes for game_ids
CREATE INDEX IF NOT EXISTS idx_game_ids_home_team ON game_ids(home_team_id);
CREATE INDEX IF NOT EXISTS idx_game_ids_away_team ON game_ids(away_team_id);
CREATE INDEX IF NOT EXISTS idx_game_ids_processed ON game_ids(processed);
CREATE INDEX IF NOT EXISTS idx_game_ids_date ON game_ids(game_date);
CREATE INDEX IF NOT EXISTS idx_game_ids_sport ON game_ids(sport);

-- Re-enable foreign key constraints
PRAGMA foreign_keys = ON;
