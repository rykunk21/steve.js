-- Migration 006: Migrate existing team representations to posterior format

-- Add metadata fields to teams table if they don't exist
ALTER TABLE teams ADD COLUMN model_version TEXT DEFAULT 'v1.0';
ALTER TABLE teams ADD COLUMN representation_type TEXT DEFAULT 'bayesian_posterior';

-- Update existing statistical representations to include metadata
UPDATE teams 
SET statistical_representation = json_set(
  COALESCE(statistical_representation, '{}'),
  '$.type', 'bayesian_posterior',
  '$.model_version', 'v1.0',
  '$.last_updated', datetime('now'),
  '$.games_processed', COALESCE(json_extract(statistical_representation, '$.games_processed'), 0)
)
WHERE statistical_representation IS NOT NULL;

-- Create index for representation type
CREATE INDEX IF NOT EXISTS idx_teams_representation_type ON teams(representation_type);
CREATE INDEX IF NOT EXISTS idx_teams_model_version ON teams(model_version);