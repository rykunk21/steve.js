-- Migration 010: Create teams table for MCMC prediction infrastructure

CREATE TABLE IF NOT EXISTS teams (
    team_id TEXT PRIMARY KEY,
    statbroadcast_gid TEXT UNIQUE NOT NULL,
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teams_statbroadcast_gid ON teams(statbroadcast_gid);
CREATE INDEX IF NOT EXISTS idx_teams_sport ON teams(sport);
CREATE INDEX IF NOT EXISTS idx_teams_conference ON teams(conference);
CREATE INDEX IF NOT EXISTS idx_teams_last_synced ON teams(last_synced);
