-- Migration 003: Create teams and game_ids tables for InfoNCE architecture

-- Teams Table
CREATE TABLE IF NOT EXISTS teams (
    team_id TEXT PRIMARY KEY,
    statbroadcast_gid TEXT NOT NULL,
    team_name TEXT NOT NULL,
    sport TEXT NOT NULL DEFAULT 'mens-college-basketball',
    conference TEXT,
    
    -- VAE posterior latent team representation (JSON blob)
    -- Contains: {"mu": [16-dim array], "sigma": [16-dim array], "games_processed": int, "last_season": "2023-24", "last_updated": "2024-01-15"}
    -- Represents team as posterior N(μ, σ²) distribution in frozen InfoNCE latent space
    -- Updated via Bayesian inference, not gradient descent
    statistical_representation TEXT,
    
    -- Player roster for injury analysis (JSON array)
    player_roster TEXT,
    
    -- Sync tracking
    last_synced TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Allow multiple teams with same statbroadcast_gid for multi-sport support
    UNIQUE(statbroadcast_gid, sport)
);

-- Game IDs Table with InfoNCE fields
CREATE TABLE IF NOT EXISTS game_ids (
    game_id TEXT PRIMARY KEY,
    sport TEXT NOT NULL DEFAULT 'mens-college-basketball',
    home_team_id TEXT,
    away_team_id TEXT,
    game_date DATE NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT 0,
    
    -- InfoNCE training labels: transition probability vectors for contrastive learning
    transition_probabilities_home BLOB,
    transition_probabilities_away BLOB,
    labels_extracted BOOLEAN NOT NULL DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (home_team_id) REFERENCES teams(team_id),
    FOREIGN KEY (away_team_id) REFERENCES teams(team_id)
);

-- VAE Model Weights Table
CREATE TABLE IF NOT EXISTS vae_model_weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_version TEXT NOT NULL,
    encoder_weights BLOB NOT NULL,
    decoder_weights BLOB,
    latent_dim INTEGER NOT NULL DEFAULT 16,
    input_dim INTEGER NOT NULL DEFAULT 80,
    training_completed BOOLEAN NOT NULL DEFAULT 0,
    frozen BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for teams and games
CREATE INDEX IF NOT EXISTS idx_teams_statbroadcast_gid ON teams(statbroadcast_gid);
CREATE INDEX IF NOT EXISTS idx_teams_sport ON teams(sport);
CREATE INDEX IF NOT EXISTS idx_teams_conference ON teams(conference);
CREATE INDEX IF NOT EXISTS idx_teams_last_synced ON teams(last_synced);
CREATE INDEX IF NOT EXISTS idx_game_ids_home_team ON game_ids(home_team_id);
CREATE INDEX IF NOT EXISTS idx_game_ids_away_team ON game_ids(away_team_id);
CREATE INDEX IF NOT EXISTS idx_game_ids_processed ON game_ids(processed);
CREATE INDEX IF NOT EXISTS idx_game_ids_date ON game_ids(game_date);
CREATE INDEX IF NOT EXISTS idx_game_ids_sport ON game_ids(sport);
CREATE INDEX IF NOT EXISTS idx_game_ids_labels_extracted ON game_ids(labels_extracted);
CREATE INDEX IF NOT EXISTS idx_game_ids_home_team_labels ON game_ids(home_team_id) WHERE labels_extracted = 1;
CREATE INDEX IF NOT EXISTS idx_game_ids_away_team_labels ON game_ids(away_team_id) WHERE labels_extracted = 1;