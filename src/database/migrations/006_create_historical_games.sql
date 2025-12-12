-- Historical games table for model training and validation
CREATE TABLE IF NOT EXISTS historical_games (
    id TEXT PRIMARY KEY,
    sport TEXT NOT NULL,
    season INTEGER NOT NULL,
    game_date DATE NOT NULL,
    home_team_id TEXT NOT NULL,
    away_team_id TEXT NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    is_neutral_site BOOLEAN DEFAULT FALSE,
    
    -- Box score statistics
    home_field_goal_pct REAL,
    away_field_goal_pct REAL,
    home_three_point_pct REAL,
    away_three_point_pct REAL,
    home_free_throw_pct REAL,
    away_free_throw_pct REAL,
    home_rebounds INTEGER,
    away_rebounds INTEGER,
    home_turnovers INTEGER,
    away_turnovers INTEGER,
    home_assists INTEGER,
    away_assists INTEGER,
    
    -- Betting data
    pre_game_spread REAL,
    pre_game_total REAL,
    pre_game_home_ml INTEGER,
    pre_game_away_ml INTEGER,
    spread_result TEXT,
    total_result TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_source TEXT DEFAULT 'espn'
);

CREATE INDEX IF NOT EXISTS idx_historical_games_home_team ON historical_games(home_team_id, season);
CREATE INDEX IF NOT EXISTS idx_historical_games_away_team ON historical_games(away_team_id, season);
CREATE INDEX IF NOT EXISTS idx_historical_games_date ON historical_games(game_date);
CREATE INDEX IF NOT EXISTS idx_historical_games_season ON historical_games(season, sport);

-- Team strength history for Bayesian tracking
CREATE TABLE IF NOT EXISTS team_strength_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    season INTEGER NOT NULL,
    as_of_date DATE NOT NULL,
    
    -- Bayesian parameters (mean and standard deviation)
    offensive_rating_mean REAL NOT NULL,
    offensive_rating_std REAL NOT NULL,
    defensive_rating_mean REAL NOT NULL,
    defensive_rating_std REAL NOT NULL,
    
    -- Opponent-adjusted metrics
    adj_offensive_rating REAL,
    adj_defensive_rating REAL,
    strength_of_schedule REAL,
    
    -- Confidence metrics
    games_played INTEGER NOT NULL,
    confidence_level REAL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_strength_team_date ON team_strength_history(team_id, as_of_date);
CREATE INDEX IF NOT EXISTS idx_team_strength_season ON team_strength_history(season, sport);

-- Model predictions for validation
CREATE TABLE IF NOT EXISTS model_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    prediction_time TIMESTAMP NOT NULL,
    
    -- Predictions
    home_win_prob REAL,
    away_win_prob REAL,
    predicted_spread REAL,
    predicted_total REAL,
    
    -- Actual outcomes (filled after game)
    actual_home_score INTEGER,
    actual_away_score INTEGER,
    
    -- Validation metrics
    brier_score REAL,
    log_loss REAL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_model_predictions_game ON model_predictions(game_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_model ON model_predictions(model_name);
