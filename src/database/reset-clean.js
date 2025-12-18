#!/usr/bin/env node

/**
 * Database Reset and Clean Script for InfoNCE VAE-NN Refactoring
 * 
 * This script implements task 0.2:
 * - Backup existing database if needed
 * - Drop and recreate all tables with clean schema
 * - Clear any corrupted or inconsistent data
 * - Reset all processed flags and training state
 */

const fs = require('fs');
const path = require('path');
const dbConnection = require('./connection');
const logger = require('../utils/logger');
const config = require('../config');

class DatabaseResetManager {
  constructor() {
    this.dbPath = config.database.path;
    this.backupDir = path.join(path.dirname(this.dbPath), 'backups');
  }

  /**
   * Create a backup of the current database
   */
  async createBackup() {
    try {
      if (!fs.existsSync(this.dbPath)) {
        logger.info('No existing database to backup');
        return null;
      }

      // Ensure backup directory exists
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
        logger.info(`Created backup directory: ${this.backupDir}`);
      }

      // Create timestamped backup filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.backupDir, `bot.db.backup-${timestamp}`);

      // Copy database file
      fs.copyFileSync(this.dbPath, backupPath);
      logger.info(`Database backed up to: ${backupPath}`);
      
      return backupPath;
    } catch (error) {
      logger.error('Failed to create database backup:', error);
      throw error;
    }
  }

  /**
   * Drop all existing tables and data
   */
  async dropAllTables() {
    try {
      logger.info('Dropping all existing tables...');

      // Get list of all tables
      const tables = await dbConnection.all(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `);

      // Disable foreign key constraints temporarily
      await dbConnection.run('PRAGMA foreign_keys = OFF');

      // Drop all tables
      for (const table of tables) {
        await dbConnection.run(`DROP TABLE IF EXISTS ${table.name}`);
        logger.info(`Dropped table: ${table.name}`);
      }

      // Re-enable foreign key constraints
      await dbConnection.run('PRAGMA foreign_keys = ON');

      logger.info('All tables dropped successfully');
    } catch (error) {
      logger.error('Failed to drop tables:', error);
      throw error;
    }
  }

  /**
   * Recreate all tables with clean schema
   */
  async recreateSchema() {
    try {
      logger.info('Recreating database schema...');

      // Run all migrations in order to recreate clean schema
      await dbConnection.runMigrations();

      logger.info('Database schema recreated successfully');
    } catch (error) {
      logger.error('Failed to recreate schema:', error);
      throw error;
    }
  }

  /**
   * Reset all processed flags and training state
   */
  async resetProcessingState() {
    try {
      logger.info('Resetting all processing flags and training state...');

      // Reset game processing flags
      await dbConnection.run(`
        UPDATE game_ids 
        SET processed = 0, 
            labels_extracted = 0,
            transition_probabilities_home = NULL,
            transition_probabilities_away = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE processed = 1 OR labels_extracted = 1
      `);

      // Clear team statistical representations (VAE posterior distributions)
      await dbConnection.run(`
        UPDATE teams 
        SET statistical_representation = NULL,
            last_synced = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE statistical_representation IS NOT NULL
      `);

      // Reset VAE model weights training status
      await dbConnection.run(`
        UPDATE vae_model_weights 
        SET training_completed = 0,
            frozen = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE training_completed = 1 OR frozen = 1
      `);

      // Clear any existing model predictions
      await dbConnection.run('DELETE FROM model_predictions');

      // Clear team strength history
      await dbConnection.run('DELETE FROM team_strength_history');

      // Reset betting thread status
      await dbConnection.run(`
        UPDATE betting_threads 
        SET status = 'cancelled',
            updated_at = CURRENT_TIMESTAMP
        WHERE status = 'active'
      `);

      // Clear reconciliation log
      await dbConnection.run('DELETE FROM reconciliation_log');

      logger.info('Processing state reset completed');
    } catch (error) {
      logger.error('Failed to reset processing state:', error);
      throw error;
    }
  }

  /**
   * Verify database integrity after reset
   */
  async verifyIntegrity() {
    try {
      logger.info('Verifying database integrity...');

      // Check that all expected tables exist
      const expectedTables = [
        'server_config', 'lobbies', 'lobby_members', 'game_threads', 'user_preferences',
        'betting_snapshots', 'betting_threads', 'reconciliation_log',
        'teams', 'game_ids', 'vae_model_weights',
        'team_strength_history', 'model_predictions', 'migrations'
      ];

      const existingTables = await dbConnection.all(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `);

      const existingTableNames = existingTables.map(t => t.name);
      const missingTables = expectedTables.filter(t => !existingTableNames.includes(t));

      if (missingTables.length > 0) {
        throw new Error(`Missing expected tables: ${missingTables.join(', ')}`);
      }

      // Verify foreign key constraints are enabled
      const fkResult = await dbConnection.get('PRAGMA foreign_keys');
      if (fkResult.foreign_keys !== 1) {
        throw new Error('Foreign key constraints are not enabled');
      }

      // Check that processing flags are reset
      const processedGames = await dbConnection.get(`
        SELECT COUNT(*) as count FROM game_ids WHERE processed = 1
      `);
      
      const teamsWithStats = await dbConnection.get(`
        SELECT COUNT(*) as count FROM teams WHERE statistical_representation IS NOT NULL
      `);

      const trainedModels = await dbConnection.get(`
        SELECT COUNT(*) as count FROM vae_model_weights WHERE training_completed = 1
      `);

      logger.info('Database integrity check results:', {
        tablesFound: existingTableNames.length,
        expectedTables: expectedTables.length,
        processedGames: processedGames.count,
        teamsWithStats: teamsWithStats.count,
        trainedModels: trainedModels.count
      });

      if (processedGames.count > 0 || teamsWithStats.count > 0 || trainedModels.count > 0) {
        logger.warn('Some processing state may not have been fully reset');
      }

      logger.info('Database integrity verification completed');
    } catch (error) {
      logger.error('Database integrity verification failed:', error);
      throw error;
    }
  }

  /**
   * Complete database reset and clean operation
   */
  async resetAndClean() {
    try {
      logger.info('Starting database reset and clean operation...');

      // Step 1: Create backup
      const backupPath = await this.createBackup();
      if (backupPath) {
        logger.info(`Backup created: ${backupPath}`);
      }

      // Step 2: Initialize connection if not already connected
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      // Step 3: Drop all tables
      await this.dropAllTables();

      // Step 4: Recreate clean schema
      await this.recreateSchema();

      // Step 5: Reset processing state (this should be minimal since tables are new)
      await this.resetProcessingState();

      // Step 6: Verify integrity
      await this.verifyIntegrity();

      logger.info('Database reset and clean operation completed successfully!');
      logger.info('The database is now ready for InfoNCE VAE-NN refactoring');

      return {
        success: true,
        backupPath,
        message: 'Database reset and cleaned successfully'
      };

    } catch (error) {
      logger.error('Database reset and clean operation failed:', error);
      throw error;
    }
  }
}

/**
 * Main execution function
 */
async function main() {
  const resetManager = new DatabaseResetManager();
  
  try {
    const result = await resetManager.resetAndClean();
    console.log('\n✅ Database Reset Complete!');
    console.log(`📁 Backup: ${result.backupPath || 'No backup needed'}`);
    console.log('🔄 All tables recreated with clean schema');
    console.log('🧹 All processed flags and training state cleared');
    console.log('✨ Ready for InfoNCE VAE-NN implementation');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database Reset Failed!');
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    // Ensure database connection is closed
    if (dbConnection.isReady()) {
      await dbConnection.close();
    }
  }
}

// Export for use in other modules
module.exports = { DatabaseResetManager };

// Run if executed directly
if (require.main === module) {
  main();
}