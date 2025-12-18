-- Migration 005: Add indexes for VAE model weights table

-- Index for efficient model version lookups
CREATE INDEX IF NOT EXISTS idx_vae_model_weights_version ON vae_model_weights(model_version);

-- Index for finding frozen models
CREATE INDEX IF NOT EXISTS idx_vae_model_weights_frozen ON vae_model_weights(frozen, training_completed);

-- Index for chronological ordering
CREATE INDEX IF NOT EXISTS idx_vae_model_weights_created ON vae_model_weights(created_at);

-- Composite index for finding latest frozen model efficiently
CREATE INDEX IF NOT EXISTS idx_vae_model_weights_frozen_created ON vae_model_weights(frozen, training_completed, created_at DESC);