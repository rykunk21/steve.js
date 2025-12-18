#!/usr/bin/env node

/**
 * Script to reset the database and run all migrations
 * WARNING: This will delete all data!
 */

const fs = require('fs');
const path = require('path');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

async function resetDatabase() {
  try {
    const dbPath = path.join(__dirname, '../data/bot.db');
    
    // Close any existing connection
    if (dbConnection.isReady()) {
      await dbConnection.close();
    }
    
    // Delete the database file
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      logger.info('Deleted existing database');
    }
    
    // Initialize fresh database with all migrations
    logger.info('Initializing fresh database...');
    await dbConnection.initialize();
    
    logger.info('Database reset complete!');
    logger.info('All migrations have been run in order');
    
    // Show migration status
    const migrations = await dbConnection.all('SELECT name, executed_at FROM migrations ORDER BY executed_at');
    logger.info('Executed migrations:', migrations);
    
    process.exit(0);
  } catch (error) {
    logger.error('Failed to reset database', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  resetDatabase();
}

module.exports = { resetDatabase };