-- Migration 004: Create prediction and validation tables

-- Team Strength History Table
CREATE TABLE IF NOT EXISTS team_strength_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    season INTEGER NOT NULL,
    as_of_date DATE NOT NULL,
    
    offensive_rating_mean REAL NOT NULL,
    offensive_rating_std REAL NOT NULL,
    defensive_rating_mean REAL NOT NULL,
    defensive_rating_std REAL NOT NULL,
    
    adj_offensive_rating REAL,
    adj_defensive_rating REAL,
    strength_of_schedule REAL,
    
    games_played INTEGER NOT NULL,
    confidence_level REAL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Model Predictions Table
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
    
    -- Actual outcomes
    actual_home_score INTEGER,
    actual_away_score INTEGER,
    
    -- Validation metrics
    brier_score REAL,
    log_loss REAL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for prediction tables
CREATE INDEX IF NOT EXISTS idx_team_strength_team_date ON team_strength_history(team_id, as_of_date);
CREATE INDEX IF NOT EXISTS idx_team_strength_season ON team_strength_history(season, sport);
CREATE INDEX IF NOT EXISTS idx_model_predictions_game ON model_predictions(game_id);
CREATE INDEX IF NOT EXISTS idx_model_predictions_model ON model_predictions(model_name);