-- Migration 001: Create core Discord bot tables

-- Server Configuration Table
CREATE TABLE IF NOT EXISTS server_config (
    guild_id TEXT PRIMARY KEY,
    nfl_channel_id TEXT,
    nba_channel_id TEXT,
    nhl_channel_id TEXT,
    ncaa_channel_id TEXT,
    lobby_duration_minutes INTEGER DEFAULT 60,
    max_lobby_size INTEGER DEFAULT 10,
    team_color_overrides TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Active Lobbies Table
CREATE TABLE IF NOT EXISTS lobbies (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    leader_id TEXT NOT NULL,
    game_type TEXT NOT NULL,
    voice_channel_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disbanded', 'expired')),
    FOREIGN KEY (guild_id) REFERENCES server_config(guild_id)
);

-- Lobby Members Table
CREATE TABLE IF NOT EXISTS lobby_members (
    lobby_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lobby_id, user_id),
    FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE
);

-- Game Threads Table
CREATE TABLE IF NOT EXISTS game_threads (
    game_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    league TEXT NOT NULL CHECK (league IN ('nfl', 'nba', 'nhl', 'ncaa')),
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    game_date DATETIME NOT NULL,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'completed', 'postponed', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guild_id) REFERENCES server_config(guild_id)
);

-- User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    sports_notifications BOOLEAN DEFAULT 1,
    lobby_notifications BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, guild_id),
    FOREIGN KEY (guild_id) REFERENCES server_config(guild_id)
);

-- Create indexes for core tables
CREATE INDEX IF NOT EXISTS idx_lobbies_guild_id ON lobbies(guild_id);
CREATE INDEX IF NOT EXISTS idx_lobbies_leader_id ON lobbies(leader_id);
CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status);
CREATE INDEX IF NOT EXISTS idx_lobbies_expires_at ON lobbies(expires_at);
CREATE INDEX IF NOT EXISTS idx_game_threads_guild_id ON game_threads(guild_id);
CREATE INDEX IF NOT EXISTS idx_game_threads_league ON game_threads(league);
CREATE INDEX IF NOT EXISTS idx_game_threads_status ON game_threads(status);
CREATE INDEX IF NOT EXISTS idx_game_threads_game_date ON game_threads(game_date);