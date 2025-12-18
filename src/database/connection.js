const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../config');

class DatabaseConnection {
  constructor() {
    this.db = null;
    this.isConnected = false;
  }

  /**
   * Initialize database connection and create tables if they don't exist
   */
  async initialize() {
    try {
      // Ensure data directory exists
      const dbPath = config.database.path;
      const dbDir = path.dirname(dbPath);
      
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info(`Created database directory: ${dbDir}`);
      }

      // Create database connection
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          logger.error('Error opening database:', err);
          throw err;
        }
        logger.info(`Connected to SQLite database: ${dbPath}`);
      });

      // Enable foreign keys
      await this.run('PRAGMA foreign_keys = ON');
      
      // Create tables
      await this.createTables();
      
      // Run migrations
      await this.runMigrations();
      
      this.isConnected = true;
      logger.info('Database initialization completed');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Create all required tables (basic structure)
   */
  async createTables() {
    // Basic tables are created in migrations now
    logger.info('Database tables and indexes created successfully');
  }

  /**
   * Run database migrations
   */
  async runMigrations() {
    try {
      // Create migrations table if it doesn't exist
      await this.run(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // List of migrations to run in order
      const migrations = [
        '001_create_core_tables',
        '002_create_betting_tables', 
        '003_create_teams_and_games',
        '004_create_prediction_tables',
        '005_add_vae_model_indexes',
        '006_migrate_team_representations'
      ];

      for (const migrationName of migrations) {
        // Check if migration has been run
        const existingMigration = await this.get(
          'SELECT * FROM migrations WHERE name = ?',
          [migrationName]
        );

        if (!existingMigration) {
          logger.info(`Running migration: ${migrationName}`);
          
          const migrationSQL = fs.readFileSync(
            path.join(__dirname, `migrations/${migrationName}.sql`),
            'utf-8'
          );
          
          // Split by semicolon and execute each statement
          const statements = migrationSQL.split(';').filter(s => s.trim());
          for (const statement of statements) {
            if (statement.trim()) {
              try {
                await this.run(statement);
              } catch (error) {
                // Ignore "duplicate column" and "table already exists" errors
                if (!error.message.includes('duplicate column') && 
                    !error.message.includes('already exists')) {
                  throw error;
                }
              }
            }
          }
          
          // Record migration as completed
          await this.run(
            'INSERT INTO migrations (name) VALUES (?)',
            [migrationName]
          );
          
          logger.info('Migration completed successfully');
        }
      }
    } catch (error) {
      logger.error('Migration failed:', error);
      // Don't throw - continue with app startup
    }
  }

  /**
   * Execute a SQL query that doesn't return rows (INSERT, UPDATE, DELETE, CREATE, etc.)
   */
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Database run error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * Execute a SQL query that returns a single row
   */
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          logger.error('Database get error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Execute a SQL query that returns multiple rows
   */
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          logger.error('Database all error:', { sql, params, error: err.message });
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Execute multiple SQL statements in a transaction
   */
  async transaction(statements) {
    await this.run('BEGIN TRANSACTION');
    try {
      for (const { sql, params } of statements) {
        await this.run(sql, params);
      }
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            logger.error('Error closing database:', err);
            reject(err);
          } else {
            logger.info('Database connection closed');
            this.isConnected = false;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if database is ready
   */
  isReady() {
    return this.isConnected && this.db;
  }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;