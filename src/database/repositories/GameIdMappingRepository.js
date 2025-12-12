const BaseRepository = require('./BaseRepository');
const logger = require('../../utils/logger');

/**
 * Repository for ESPN ↔ StatBroadcast game ID mappings
 */
class GameIdMappingRepository extends BaseRepository {
  constructor() {
    super('statbroadcast_game_ids');
  }

  /**
   * Save or update a game ID mapping
   * @param {Object} mapping - Mapping data
   * @returns {Promise<Object>} - Database result
   */
  async saveMapping(mapping) {
    try {
      const existing = await this.getMapping(mapping.espnGameId);

      const data = {
        espn_game_id: mapping.espnGameId,
        statbroadcast_game_id: mapping.statbroadcastGameId,
        home_team: mapping.homeTeam,
        away_team: mapping.awayTeam,
        game_date: mapping.gameDate,
        match_confidence: mapping.confidence,
        match_method: mapping.matchMethod || 'discovery',
        data_quality: mapping.dataQuality || null
      };

      if (existing) {
        // Update existing mapping
        data.last_fetched = new Date().toISOString();
        return await this.update(mapping.espnGameId, data, 'espn_game_id');
      } else {
        // Create new mapping
        data.discovered_at = new Date().toISOString();
        return await this.create(data);
      }
    } catch (error) {
      logger.error('Failed to save game ID mapping', {
        espnGameId: mapping.espnGameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get mapping by ESPN game ID
   * @param {string} espnGameId - ESPN game ID
   * @returns {Promise<Object|null>} - Mapping object or null
   */
  async getMapping(espnGameId) {
    try {
      const row = await this.findById(espnGameId, 'espn_game_id');
      
      if (!row) return null;

      return this.mapRowToObject(row);
    } catch (error) {
      logger.error('Failed to get game ID mapping', {
        espnGameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get mapping by StatBroadcast game ID
   * @param {string} statbroadcastGameId - StatBroadcast game ID
   * @returns {Promise<Object|null>} - Mapping object or null
   */
  async getMappingBySbId(statbroadcastGameId) {
    try {
      const row = await this.findOneBy({ statbroadcast_game_id: statbroadcastGameId });
      
      if (!row) return null;

      return this.mapRowToObject(row);
    } catch (error) {
      logger.error('Failed to get game ID mapping by StatBroadcast ID', {
        statbroadcastGameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all mappings for a specific date
   * @param {string} date - Game date (YYYY-MM-DD)
   * @returns {Promise<Array>} - Array of mapping objects
   */
  async getMappingsByDate(date) {
    try {
      const rows = await this.findBy({ game_date: date });
      return rows.map(row => this.mapRowToObject(row));
    } catch (error) {
      logger.error('Failed to get game ID mappings by date', {
        date,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update last fetched timestamp
   * @param {string} espnGameId - ESPN game ID
   * @returns {Promise<Object>} - Database result
   */
  async updateLastFetched(espnGameId) {
    try {
      return await this.update(
        espnGameId,
        { last_fetched: new Date().toISOString() },
        'espn_game_id'
      );
    } catch (error) {
      logger.error('Failed to update last fetched timestamp', {
        espnGameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update data quality indicator
   * @param {string} espnGameId - ESPN game ID
   * @param {string} quality - Data quality ('full', 'partial', 'none')
   * @returns {Promise<Object>} - Database result
   */
  async updateDataQuality(espnGameId, quality) {
    try {
      const validQualities = ['full', 'partial', 'none'];
      
      if (!validQualities.includes(quality)) {
        throw new Error(`Invalid data quality: ${quality}. Must be one of: ${validQualities.join(', ')}`);
      }

      return await this.update(
        espnGameId,
        { data_quality: quality },
        'espn_game_id'
      );
    } catch (error) {
      logger.error('Failed to update data quality', {
        espnGameId,
        quality,
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
      espnGameId: row.espn_game_id,
      statbroadcastGameId: row.statbroadcast_game_id,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      gameDate: row.game_date,
      confidence: row.match_confidence,
      matchMethod: row.match_method,
      dataQuality: row.data_quality,
      discoveredAt: row.discovered_at,
      lastFetched: row.last_fetched
    };
  }
}

module.exports = GameIdMappingRepository;
