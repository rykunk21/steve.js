-- Migration 014: Allow null team IDs in game_ids table
-- This allows games to be added before team assignments are determined

-- No-op migration: The game_ids table already supports null team IDs
SELECT 1;