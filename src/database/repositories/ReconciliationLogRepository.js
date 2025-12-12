const BaseRepository = require('./BaseRepository');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Repository for reconciliation log tracking
 */
class ReconciliationLogRepository extends BaseRepository {
  constructor() {
    super('reconciliation_log');
  }

  /**
   * Start a new reconciliation operation
   * @param {Object} params - Reconciliation parameters
   * @returns {Promise<Object>} - Database result with ID
   */
  async startReconciliation(params) {
    try {
      const id = uuidv4();
      
      const data = {
        id,
        started_at: new Date().toISOString(),
        date_range_start: params.dateRangeStart,
        date_range_end: params.dateRangeEnd,
        triggered_by: params.triggeredBy,
        status: 'running'
      };

      const result = await this.create(data);
      
      logger.info('Started reconciliation', {
        id,
        dateRange: `${params.dateRangeStart} to ${params.dateRangeEnd}`,
        triggeredBy: params.triggeredBy
      });

      return { ...result, id };
    } catch (error) {
      logger.error('Failed to start reconciliation', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Complete a reconciliation operation
   * @param {string} id - Reconciliation ID
   * @param {Object} results - Reconciliation results
   * @returns {Promise<Object>} - Database result
   */
  async completeReconciliation(id, results) {
    try {
      const data = {
        completed_at: new Date().toISOString(),
        games_found: results.gamesFound,
        games_processed: results.gamesProcessed,
        games_failed: results.gamesFailed,
        data_sources: results.dataSources || null,
        status: 'completed'
      };

      const result = await this.update(id, data);

      logger.info('Completed reconciliation', {
        id,
        gamesFound: results.gamesFound,
        gamesProcessed: results.gamesProcessed,
        gamesFailed: results.gamesFailed
      });

      return result;
    } catch (error) {
      logger.error('Failed to complete reconciliation', {
        id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Mark a reconciliation as failed
   * @param {string} id - Reconciliation ID
   * @param {string} errorMessage - Error message
   * @returns {Promise<Object>} - Database result
   */
  async failReconciliation(id, errorMessage) {
    try {
      const data = {
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
        status: 'failed'
      };

      const result = await this.update(id, data);

      logger.error('Reconciliation failed', {
        id,
        error: errorMessage
      });

      return result;
    } catch (error) {
      logger.error('Failed to mark reconciliation as failed', {
        id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get reconciliation by ID
   * @param {string} id - Reconciliation ID
   * @returns {Promise<Object|null>} - Reconciliation object or null
   */
  async getReconciliation(id) {
    try {
      const row = await this.findById(id);
      
      if (!row) return null;

      return this.mapRowToObject(row);
    } catch (error) {
      logger.error('Failed to get reconciliation', {
        id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get recent reconciliations
   * @param {number} limit - Number of records to retrieve
   * @returns {Promise<Array>} - Array of reconciliation objects
   */
  async getRecentReconciliations(limit = 10) {
    try {
      const rows = await this.findAll('started_at DESC', limit);
      return rows.map(row => this.mapRowToObject(row));
    } catch (error) {
      logger.error('Failed to get recent reconciliations', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get reconciliations by status
   * @param {string} status - Status ('running', 'completed', 'failed')
   * @returns {Promise<Array>} - Array of reconciliation objects
   */
  async getReconciliationsByStatus(status) {
    try {
      const rows = await this.findBy({ status }, 'started_at DESC');
      return rows.map(row => this.mapRowToObject(row));
    } catch (error) {
      logger.error('Failed to get reconciliations by status', {
        status,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get reconciliation statistics
   * @returns {Promise<Object>} - Statistics object
   */
  async getReconciliationStats() {
    try {
      const sql = `
        SELECT 
          COUNT(*) as total_reconciliations,
          SUM(games_found) as total_games_found,
          SUM(games_processed) as total_games_processed,
          SUM(games_failed) as total_games_failed
        FROM ${this.tableName}
        WHERE status = 'completed'
      `;

      const result = await this.db.get(sql);

      const totalFound = result.total_games_found || 0;
      const totalProcessed = result.total_games_processed || 0;
      const successRate = totalFound > 0 
        ? (totalProcessed / totalFound) * 100 
        : 0;

      return {
        totalReconciliations: result.total_reconciliations || 0,
        totalGamesFound: totalFound,
        totalGamesProcessed: totalProcessed,
        totalGamesFailed: result.total_games_failed || 0,
        successRate: parseFloat(successRate.toFixed(2))
      };
    } catch (error) {
      logger.error('Failed to get reconciliation stats', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Map database row to object with camelCase properties
   * @param {Object} row - Database row
   * @returns {Object} - Mapped object
   */
  mapRowToObject(row) {
    return {
      id: row.id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      dateRangeStart: row.date_range_start,
      dateRangeEnd: row.date_range_end,
      gamesFound: row.games_found,
      gamesProcessed: row.games_processed,
      gamesFailed: row.games_failed,
      dataSources: row.data_sources,
      status: row.status,
      errorMessage: row.error_message,
      triggeredBy: row.triggered_by
    };
  }
}

module.exports = ReconciliationLogRepository;
