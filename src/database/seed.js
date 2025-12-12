#!/usr/bin/env node

const dbConnection = require('./connection');
const logger = require('../utils/logger');

/**
 * Database seeding script for development and testing
 * Run with: npm run seed
 */
async function seed() {
  try {
    logger.info('Starting database seeding...');
    
    // Initialize database connection
    await dbConnection.initialize();
    
    // Sample server configuration
    const sampleGuildId = '123456789012345678';
    
    // Insert sample server config
    await dbConnection.run(`
      INSERT OR REPLACE INTO server_config (
        guild_id, nfl_channel_id, nba_channel_id, nhl_channel_id, ncaa_channel_id,
        lobby_duration_minutes, max_lobby_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      sampleGuildId,
      '123456789012345679', // NFL channel
      '123456789012345680', // NBA channel
      '123456789012345681', // NHL channel
      '123456789012345682', // NCAA channel
      60, // 1 hour lobby duration
      8   // max 8 players per lobby
    ]);

    // Insert sample user preferences
    await dbConnection.run(`
      INSERT OR REPLACE INTO user_preferences (
        user_id, guild_id, sports_notifications, lobby_notifications
      ) VALUES (?, ?, ?, ?)
    `, [
      '987654321098765432', // Sample user ID
      sampleGuildId,
      1, // Enable sports notifications
      1  // Enable lobby notifications
    ]);

    // Insert sample lobby (expired for testing cleanup)
    const expiredLobbyId = 'lobby_' + Date.now();
    await dbConnection.run(`
      INSERT INTO lobbies (
        id, guild_id, leader_id, game_type, voice_channel_id, expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      expiredLobbyId,
      sampleGuildId,
      '987654321098765432',
      'Valorant',
      '123456789012345683',
      new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
      'expired'
    ]);

    // Insert sample game thread
    await dbConnection.run(`
      INSERT OR REPLACE INTO game_threads (
        game_id, thread_id, channel_id, guild_id, league,
        home_team, away_team, game_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'nfl_2024_week8_chiefs_raiders',
      '123456789012345684',
      '123456789012345679', // NFL channel
      sampleGuildId,
      'nfl',
      'Kansas City Chiefs',
      'Las Vegas Raiders',
      new Date(Date.now() + 86400000).toISOString(), // Tomorrow
      'scheduled'
    ]);

    logger.info('Database seeding completed successfully');
    logger.info('Sample data created for development and testing');
    
    await dbConnection.close();
    process.exit(0);
  } catch (error) {
    logger.error('Database seeding failed:', error);
    process.exit(1);
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seed();
}

module.exports = seed;