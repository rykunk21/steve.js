const BettingSnapshot = require('../models/BettingSnapshot');
const logger = require('../../utils/logger');

/**
 * Repository for managing betting snapshot data
 */
class BettingSnapshotRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create betting snapshots table
   */
  async createTable() {
    // Create the table first
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS betting_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        sport TEXT NOT NULL,
        scraped_at DATETIME NOT NULL,
        home_moneyline INTEGER,
        away_moneyline INTEGER,
        spread_line REAL,
        home_spread_odds INTEGER,
        away_spread_odds INTEGER,
        total_line REAL,
        over_odds INTEGER,
        under_odds INTEGER,
        source TEXT DEFAULT 'ActionNetwork',
        sportsbook TEXT,
        is_stale BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes separately
    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_game_sport ON betting_snapshots (game_id, sport)`,
      `CREATE INDEX IF NOT EXISTS idx_scraped_at ON betting_snapshots (scraped_at)`,
      `CREATE INDEX IF NOT EXISTS idx_sport_date ON betting_snapshots (sport, scraped_at)`
    ];

    try {
      // Create table
      await this.db.exec(createTableQuery);
      
      // Create indexes
      for (const indexQuery of indexQueries) {
        await this.db.exec(indexQuery);
      }
      
      logger.info('Betting snapshots table and indexes created successfully');
    } catch (error) {
      logger.error('Failed to create betting snapshots table:', error);
      throw error;
    }
  }

  /**
   * Save a betting snapshot
   * @param {BettingSnapshot} snapshot - Betting snapshot to save
   * @returns {Promise<BettingSnapshot>} - Saved snapshot with ID
   */
  async save(snapshot) {
    const validation = snapshot.validate();
    if (!validation.isValid) {
      throw new Error(`Invalid betting snapshot: ${validation.errors.join(', ')}`);
    }

    const data = snapshot.toDatabase();
    
    const query = `
      INSERT INTO betting_snapshots (
        game_id, sport, scraped_at, home_moneyline, away_moneyline,
        spread_line, home_spread_odds, away_spread_odds,
        total_line, over_odds, under_odds,
        source, sportsbook, is_stale, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.game_id, data.sport, data.scraped_at,
      data.home_moneyline, data.away_moneyline,
      data.spread_line, data.home_spread_odds, data.away_spread_odds,
      data.total_line, data.over_odds, data.under_odds,
      data.source, data.sportsbook, data.is_stale,
      data.created_at, data.updated_at
    ];

    try {
      const result = await this.db.run(query, params);
      snapshot.id = result.lastID;
      
      logger.debug('Betting snapshot saved', {
        id: snapshot.id,
        gameId: snapshot.gameId,
        sport: snapshot.sport
      });
      
      return snapshot;
    } catch (error) {
      logger.error('Failed to save betting snapshot:', error);
      throw error;
    }
  }

  /**
   * Get the latest betting snapshot for a game
   * @param {string} gameId - Game ID
   * @param {string} sport - Sport
   * @returns {Promise<BettingSnapshot|null>} - Latest snapshot or null
   */
  async getLatestForGame(gameId, sport) {
    const query = `
      SELECT * FROM betting_snapshots 
      WHERE game_id = ? AND sport = ? 
      ORDER BY scraped_at DESC 
      LIMIT 1
    `;

    try {
      const row = await this.db.get(query, [gameId, sport]);
      return row ? BettingSnapshot.fromDatabase(row) : null;
    } catch (error) {
      logger.error('Failed to get latest betting snapshot:', error);
      throw error;
    }
  }

  /**
   * Get betting history for a game
   * @param {string} gameId - Game ID
   * @param {string} sport - Sport
   * @param {number} limit - Maximum number of snapshots to return
   * @returns {Promise<BettingSnapshot[]>} - Array of snapshots
   */
  async getHistoryForGame(gameId, sport, limit = 50) {
    const query = `
      SELECT * FROM betting_snapshots 
      WHERE game_id = ? AND sport = ? 
      ORDER BY scraped_at DESC 
      LIMIT ?
    `;

    try {
      const rows = await this.db.all(query, [gameId, sport, limit]);
      return rows.map(row => BettingSnapshot.fromDatabase(row));
    } catch (error) {
      logger.error('Failed to get betting history:', error);
      throw error;
    }
  }

  /**
   * Get all snapshots for a specific date and sport
   * @param {string} sport - Sport
   * @param {Date} date - Date to query
   * @returns {Promise<BettingSnapshot[]>} - Array of snapshots
   */
  async getSnapshotsForDate(sport, date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const query = `
      SELECT * FROM betting_snapshots 
      WHERE sport = ? AND scraped_at BETWEEN ? AND ?
      ORDER BY game_id, scraped_at DESC
    `;

    try {
      const rows = await this.db.all(query, [sport, startOfDay.toISOString(), endOfDay.toISOString()]);
      return rows.map(row => BettingSnapshot.fromDatabase(row));
    } catch (error) {
      logger.error('Failed to get snapshots for date:', error);
      throw error;
    }
  }

  /**
   * Get the previous snapshot for comparison
   * @param {string} gameId - Game ID
   * @param {string} sport - Sport
   * @param {Date} beforeDate - Get snapshot before this date
   * @returns {Promise<BettingSnapshot|null>} - Previous snapshot or null
   */
  async getPreviousSnapshot(gameId, sport, beforeDate) {
    const query = `
      SELECT * FROM betting_snapshots 
      WHERE game_id = ? AND sport = ? AND scraped_at < ?
      ORDER BY scraped_at DESC 
      LIMIT 1
    `;

    try {
      const row = await this.db.get(query, [gameId, sport, beforeDate.toISOString()]);
      return row ? BettingSnapshot.fromDatabase(row) : null;
    } catch (error) {
      logger.error('Failed to get previous snapshot:', error);
      throw error;
    }
  }

  /**
   * Mark old snapshots as stale
   * @param {number} hoursOld - Hours after which snapshots are considered stale
   * @returns {Promise<number>} - Number of snapshots marked as stale
   */
  async markStaleSnapshots(hoursOld = 6) {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hoursOld);

    const query = `
      UPDATE betting_snapshots 
      SET is_stale = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE scraped_at < ? AND is_stale = FALSE
    `;

    try {
      const result = await this.db.run(query, [cutoffDate.toISOString()]);
      
      if (result.changes > 0) {
        logger.info('Marked betting snapshots as stale', {
          count: result.changes,
          cutoffDate: cutoffDate.toISOString()
        });
      }
      
      return result.changes;
    } catch (error) {
      logger.error('Failed to mark stale snapshots:', error);
      throw error;
    }
  }

  /**
   * Get betting statistics for analytics
   * @param {string} sport - Sport
   * @param {Date} startDate - Start date for analysis
   * @param {Date} endDate - End date for analysis
   * @returns {Promise<Object>} - Betting statistics
   */
  async getBettingStats(sport, startDate, endDate) {
    const query = `
      SELECT 
        COUNT(*) as total_snapshots,
        COUNT(DISTINCT game_id) as unique_games,
        AVG(CASE WHEN spread_line IS NOT NULL THEN ABS(spread_line) END) as avg_spread,
        AVG(CASE WHEN total_line IS NOT NULL THEN total_line END) as avg_total,
        MIN(scraped_at) as earliest_snapshot,
        MAX(scraped_at) as latest_snapshot
      FROM betting_snapshots 
      WHERE sport = ? AND scraped_at BETWEEN ? AND ?
    `;

    try {
      const row = await this.db.get(query, [sport, startDate.toISOString(), endDate.toISOString()]);
      return {
        totalSnapshots: row.total_snapshots || 0,
        uniqueGames: row.unique_games || 0,
        averageSpread: row.avg_spread || 0,
        averageTotal: row.avg_total || 0,
        earliestSnapshot: row.earliest_snapshot,
        latestSnapshot: row.latest_snapshot,
        sport,
        dateRange: {
          start: startDate,
          end: endDate
        }
      };
    } catch (error) {
      logger.error('Failed to get betting stats:', error);
      throw error;
    }
  }

  /**
   * Clean up old snapshots (optional - for storage management)
   * @param {number} daysOld - Days after which to delete snapshots
   * @returns {Promise<number>} - Number of snapshots deleted
   */
  async cleanupOldSnapshots(daysOld = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const query = `
      DELETE FROM betting_snapshots 
      WHERE scraped_at < ?
    `;

    try {
      const result = await this.db.run(query, [cutoffDate.toISOString()]);
      
      if (result.changes > 0) {
        logger.info('Cleaned up old betting snapshots', {
          count: result.changes,
          cutoffDate: cutoffDate.toISOString()
        });
      }
      
      return result.changes;
    } catch (error) {
      logger.error('Failed to cleanup old snapshots:', error);
      throw error;
    }
  }
}

module.exports = BettingSnapshotRepository;