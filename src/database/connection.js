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
   * Create all required tables
   */
  async createTables() {
    const tables = [
      // Server Configuration Table
      `CREATE TABLE IF NOT EXISTS server_config (
        guild_id TEXT PRIMARY KEY,
        nfl_channel_id TEXT,
        nba_channel_id TEXT,
        nhl_channel_id TEXT,
        ncaa_channel_id TEXT,
        lobby_duration_minutes INTEGER DEFAULT 60,
        max_lobby_size INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Active Lobbies Table
      `CREATE TABLE IF NOT EXISTS lobbies (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        leader_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        voice_channel_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disbanded', 'expired')),
        FOREIGN KEY (guild_id) REFERENCES server_config(guild_id)
      )`,

      // Lobby Members Table
      `CREATE TABLE IF NOT EXISTS lobby_members (
        lobby_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (lobby_id, user_id),
        FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE
      )`,

      // Game Threads Table
      `CREATE TABLE IF NOT EXISTS game_threads (
        game_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        league TEXT NOT NULL CHECK (league IN ('nfl', 'nba', 'nhl', 'ncaa')),
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        game_date DATETIME NOT NULL,
        status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'completed', 'postponed', 'cancelled')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (guild_id) REFERENCES server_config(guild_id)
      )`,

      // User Preferences Table (for notifications)
      `CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        sports_notifications BOOLEAN DEFAULT 1,
        lobby_notifications BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, guild_id),
        FOREIGN KEY (guild_id) REFERENCES server_config(guild_id)
      )`,

      // Historical Games Table (for MCMC model training)
      `CREATE TABLE IF NOT EXISTS historical_games (
        id TEXT PRIMARY KEY,
        sport TEXT NOT NULL,
        season INTEGER NOT NULL,
        game_date DATE NOT NULL,
        home_team_id TEXT NOT NULL,
        away_team_id TEXT NOT NULL,
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        is_neutral_site BOOLEAN DEFAULT 0,
        
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
        
        pre_game_spread REAL,
        pre_game_total REAL,
        pre_game_home_ml INTEGER,
        pre_game_away_ml INTEGER,
        spread_result TEXT,
        total_result TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_source TEXT
      )`,

      // Team Strength History Table (for Bayesian tracking)
      `CREATE TABLE IF NOT EXISTS team_strength_history (
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
      )`,

      // Model Predictions Table (for validation and backtesting)
      `CREATE TABLE IF NOT EXISTS model_predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        prediction_time TIMESTAMP NOT NULL,
        
        home_win_prob REAL,
        away_win_prob REAL,
        predicted_spread REAL,
        predicted_total REAL,
        
        actual_home_score INTEGER,
        actual_away_score INTEGER,
        
        brier_score REAL,
        log_loss REAL,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const tableSQL of tables) {
      await this.run(tableSQL);
    }

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_lobbies_guild_id ON lobbies(guild_id)',
      'CREATE INDEX IF NOT EXISTS idx_lobbies_leader_id ON lobbies(leader_id)',
      'CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status)',
      'CREATE INDEX IF NOT EXISTS idx_lobbies_expires_at ON lobbies(expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_game_threads_guild_id ON game_threads(guild_id)',
      'CREATE INDEX IF NOT EXISTS idx_game_threads_league ON game_threads(league)',
      'CREATE INDEX IF NOT EXISTS idx_game_threads_status ON game_threads(status)',
      'CREATE INDEX IF NOT EXISTS idx_game_threads_game_date ON game_threads(game_date)',
      'CREATE INDEX IF NOT EXISTS idx_historical_games_team ON historical_games(home_team_id, away_team_id)',
      'CREATE INDEX IF NOT EXISTS idx_historical_games_date ON historical_games(game_date)',
      'CREATE INDEX IF NOT EXISTS idx_historical_games_season ON historical_games(season, sport)',
      'CREATE INDEX IF NOT EXISTS idx_team_strength_team_date ON team_strength_history(team_id, as_of_date)',
      'CREATE INDEX IF NOT EXISTS idx_team_strength_season ON team_strength_history(season, sport)',
      'CREATE INDEX IF NOT EXISTS idx_model_predictions_game ON model_predictions(game_id)',
      'CREATE INDEX IF NOT EXISTS idx_model_predictions_model ON model_predictions(model_name)'
    ];

    for (const indexSQL of indexes) {
      await this.run(indexSQL);
    }

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

      // Check if expires_at migration has been run
      const existingMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['001_make_expires_at_nullable']
      );

      if (!existingMigration) {
        // Check if we need to run the migration (if lobbies table exists with NOT NULL expires_at)
        const tableInfo = await this.all("PRAGMA table_info(lobbies)");
        const expiresAtColumn = tableInfo.find(col => col.name === 'expires_at');
        
        if (expiresAtColumn && expiresAtColumn.notnull === 1) {
          logger.info('Running migration: Make expires_at nullable');
          
          const migration = require('./migrations/001_make_expires_at_nullable');
          await migration.migrate(this);
          
          // Record migration as completed
          await this.run(
            'INSERT INTO migrations (name) VALUES (?)',
            ['001_make_expires_at_nullable']
          );
          
          logger.info('Migration completed successfully');
        } else {
          // Migration not needed, record it as completed
          await this.run(
            'INSERT OR IGNORE INTO migrations (name) VALUES (?)',
            ['001_make_expires_at_nullable']
          );
        }
      }

      // Check if team_color_overrides migration has been run
      const teamColorMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['005_add_team_color_overrides']
      );

      if (!teamColorMigration) {
        logger.info('Running migration: Add team_color_overrides column');
        
        const migration = require('./migrations/005_add_team_color_overrides');
        await migration.migrate(this);
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['005_add_team_color_overrides']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if teams table migration has been run
      const teamsMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['010_create_teams_table']
      );

      if (!teamsMigration) {
        logger.info('Running migration: Create teams table');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/010_create_teams_table.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await this.run(statement);
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['010_create_teams_table']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if statbroadcast_game_ids migration has been run
      const statbroadcastMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['007_create_statbroadcast_game_ids']
      );

      if (!statbroadcastMigration) {
        logger.info('Running migration: Create statbroadcast_game_ids table');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/007_create_statbroadcast_game_ids.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await this.run(statement);
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['007_create_statbroadcast_game_ids']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if enhance_historical_games migration has been run
      const enhanceHistoricalMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['008_enhance_historical_games']
      );

      if (!enhanceHistoricalMigration) {
        logger.info('Running migration: Enhance historical_games table');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/008_enhance_historical_games.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            try {
              await this.run(statement);
            } catch (error) {
              // Ignore "duplicate column" errors since ALTER TABLE doesn't have IF NOT EXISTS
              if (!error.message.includes('duplicate column')) {
                throw error;
              }
            }
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['008_enhance_historical_games']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if reconciliation_log migration has been run
      const reconciliationMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['009_create_reconciliation_log']
      );

      if (!reconciliationMigration) {
        logger.info('Running migration: Create reconciliation_log table');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/009_create_reconciliation_log.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await this.run(statement);
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['009_create_reconciliation_log']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if transition_probabilities migration has been run
      const transitionProbsMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['012_add_transition_probabilities']
      );

      if (!transitionProbsMigration) {
        logger.info('Running migration: Add transition_probabilities column');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/012_add_transition_probabilities.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await this.run(statement);
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['012_add_transition_probabilities']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if restructure_game_ids_table migration has been run
      const restructureGameIdsMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['013_restructure_game_ids_table']
      );

      if (!restructureGameIdsMigration) {
        logger.info('Running migration: Restructure game_ids table');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/013_restructure_game_ids_table.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await this.run(statement);
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['013_restructure_game_ids_table']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if allow_null_team_ids migration has been run
      const allowNullTeamIdsMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['014_allow_null_team_ids']
      );

      if (!allowNullTeamIdsMigration) {
        logger.info('Running migration: Allow NULL team IDs in game_ids');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/014_allow_null_team_ids.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await this.run(statement);
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['014_allow_null_team_ids']
        );
        
        logger.info('Migration completed successfully');
      }

      // Check if fix_teams_unique_constraint migration has been run
      const fixTeamsUniqueMigration = await this.get(
        'SELECT * FROM migrations WHERE name = ?',
        ['015_fix_teams_unique_constraint']
      );

      if (!fixTeamsUniqueMigration) {
        logger.info('Running migration: Fix teams UNIQUE constraint for multi-sport support');
        
        const fs = require('fs');
        const path = require('path');
        const migrationSQL = fs.readFileSync(
          path.join(__dirname, 'migrations/015_fix_teams_unique_constraint.sql'),
          'utf-8'
        );
        
        // Split by semicolon and execute each statement
        const statements = migrationSQL.split(';').filter(s => s.trim());
        for (const statement of statements) {
          if (statement.trim()) {
            await this.run(statement);
          }
        }
        
        // Record migration as completed
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          ['015_fix_teams_unique_constraint']
        );
        
        logger.info('Migration completed successfully');
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
  async transaction(queries) {
    await this.run('BEGIN TRANSACTION');
    
    try {
      const results = [];
      for (const { sql, params } of queries) {
        const result = await this.run(sql, params);
        results.push(result);
      }
      
      await this.run('COMMIT');
      return results;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.db) {
      return new Promise((resolve, reject) => {
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
      });
    }
  }

  /**
   * Check if database is connected
   */
  isReady() {
    return this.isConnected && this.db;
  }
}

// Create singleton instance
const dbConnection = new DatabaseConnection();

module.exports = dbConnection;