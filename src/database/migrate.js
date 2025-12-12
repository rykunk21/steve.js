#!/usr/bin/env node

const dbConnection = require('./connection');
const logger = require('../utils/logger');

/**
 * Database migration script
 * Run with: npm run migrate
 */
async function migrate() {
  try {
    logger.info('Starting database migration...');
    
    // Initialize database connection and create tables
    await dbConnection.initialize();
    
    logger.info('Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Database migration failed:', error);
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;