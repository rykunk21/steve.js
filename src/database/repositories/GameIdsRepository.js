const BaseRepository = require('./BaseRepository');
const logger = require('../../utils/logger');

/**
 * Repository for game_ids table management
 * Handles game metadata and InfoNCE training labels (transition probabilities)
 */
class GameIdsRepository extends BaseRepository {
  constructor() {
    super('game_ids');
  }

  /**
   * Save or update a game record
   * @param {Object} game - Game data
   * @returns {Promise<Object>} - Database result
   */
  async saveGame(game) {
    try {
      const existing = await this.findById(game.gameId, 'game_id');

      const data = {
        game_id: game.gameId,
        sport: game.sport || 'mens-college-basketball',
        home_team_id: game.homeTeamId || null,
        away_team_id: game.awayTeamId || null,
        game_date: game.gameDate,
        processed: game.processed || false,
        labels_extracted: game.labelsExtracted || false,
        updated_at: new Date().toISOString()
      };

      if (existing) {
        // Update existing game
        return await this.update(game.gameId, data, 'game_id');
      } else {
        // Create new game
        return await this.create(data);
      }
    } catch (error) {
      logger.error('Failed to save game', {
        gameId: game.gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get game by ID
   * @param {string} gameId - Game ID
   * @returns {Promise<Object|null>} - Game object or null
   */
  async getGameById(gameId) {
    try {
      const row = await this.findById(gameId, 'game_id');
      
      if (!row) return null;

      return this.mapRowToObject(row);
    } catch (error) {
      logger.error('Failed to get game by ID', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Save transition probabilities for a game
   * @param {string} gameId - Game ID
   * @param {Object} transitionProbs - Transition probabilities {home: Array, away: Array}
   * @returns {Promise<Object>} - Database result
   */
  async saveTransitionProbabilities(gameId, transitionProbs) {
    try {
      // Convert arrays to Buffer for BLOB storage
      const homeBuffer = Buffer.from(JSON.stringify(transitionProbs.home));
      const awayBuffer = Buffer.from(JSON.stringify(transitionProbs.away));

      const data = {
        transition_probabilities_home: homeBuffer,
        transition_probabilities_away: awayBuffer,
        labels_extracted: true,
        updated_at: new Date().toISOString()
      };

      return await this.update(gameId, data, 'game_id');
    } catch (error) {
      logger.error('Failed to save transition probabilities', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get transition probabilities for a game
   * @param {string} gameId - Game ID
   * @returns {Promise<Object|null>} - Transition probabilities {home: Array, away: Array} or null
   */
  async getTransitionProbabilities(gameId) {
    try {
      const game = await this.getGameById(gameId);
      
      if (!game || !game.labelsExtracted) {
        return null;
      }

      // Convert Buffer back to arrays
      const homeProbs = game.transitionProbabilitiesHome 
        ? JSON.parse(game.transitionProbabilitiesHome.toString()) 
        : null;
      const awayProbs = game.transitionProbabilitiesAway 
        ? JSON.parse(game.transitionProbabilitiesAway.toString()) 
        : null;

      return {
        home: homeProbs,
        away: awayProbs
      };
    } catch (error) {
      logger.error('Failed to get transition probabilities', {
        gameId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get games without extracted labels for InfoNCE training
   * @param {Object} options - Query options {limit, sport}
   * @returns {Promise<Array>} - Array of game objects
   */
  async getGamesWithoutLabels(options = {}) {
    try {
      const { limit = null, sport = 'mens-college-basketball' } = options;

      const criteria = {
        labels_extracted: false,
        sport: sport
      };

      return await this.findBy(criteria, 'game_date ASC', limit);
    } catch (error) {
      logger.error('Failed to get games without labels', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get games with extracted labels for InfoNCE negative sampling
   * @param {Object} options - Query options {limit, sport, excludeGameId}
   * @returns {Promise<Array>} - Array of game objects with transition probabilities
   */
  async getGamesWithLabels(options = {}) {
    try {
      const { limit = null, sport = 'mens-college-basketball', excludeGameId = null } = options;

      let sql = `
        SELECT game_id, sport, home_team_id, away_team_id, game_date, 
               transition_probabilities_home, transition_probabilities_away
        FROM ${this.tableName} 
        WHERE labels_extracted = 1 AND sport = ?
      `;
      
      const params = [sport];

      if (excludeGameId) {
        sql += ' AND game_id != ?';
        params.push(excludeGameId);
      }

      sql += ' ORDER BY game_date ASC';

      if (limit) {
        sql += ` LIMIT ${limit}`;
      }

      const rows = await this.query(sql, params);
      
      return rows.map(row => ({
        ...this.mapRowToObject(row),
        transitionProbabilitiesHome: row.transition_probabilities_home,
        transitionProbabilitiesAway: row.transition_probabilities_away
      }));
    } catch (error) {
      logger.error('Failed to get games with labels', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Mark game as processed
   * @param {string} gameId - Game ID
   * @returns {Promise<Object>} - Database result
   */
  async markAsProcessed(gameId) {
    try {
      return await this.update(
        gameId,
        { 
          processed: true,
          updated_at: new Date().toISOString()
        },
        'game_id'
      );
    } catch (error) {
      logger.error('Failed to mark game as processed', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get unprocessed games for training
   * @param {Object} options - Query options {limit, sport}
   * @returns {Promise<Array>} - Array of unprocessed game objects
   */
  async getUnprocessedGames(options = {}) {
    try {
      const { limit = null, sport = 'mens-college-basketball' } = options;

      const criteria = {
        processed: false,
        sport: sport
      };

      return await this.findBy(criteria, 'game_date ASC', limit);
    } catch (error) {
      logger.error('Failed to get unprocessed games', {
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
      gameId: row.game_id,
      sport: row.sport,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      gameDate: row.game_date,
      processed: Boolean(row.processed),
      labelsExtracted: Boolean(row.labels_extracted),
      transitionProbabilitiesHome: row.transition_probabilities_home,
      transitionProbabilitiesAway: row.transition_probabilities_away,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get random games for InfoNCE negative sampling
   * @param {number} count - Number of random games to retrieve
   * @param {string} excludeGameId - Game ID to exclude from sampling
   * @param {string} sport - Sport filter
   * @returns {Promise<Array>} - Array of random game objects with labels
   */
  async getRandomGamesForNegativeSampling(count, excludeGameId = null, sport = 'mens-college-basketball') {
    try {
      let sql = `
        SELECT game_id, transition_probabilities_home, transition_probabilities_away
        FROM ${this.tableName} 
        WHERE labels_extracted = 1 AND sport = ?
      `;
      
      const params = [sport];

      if (excludeGameId) {
        sql += ' AND game_id != ?';
        params.push(excludeGameId);
      }

      sql += ' ORDER BY RANDOM() LIMIT ?';
      params.push(count);

      const rows = await this.query(sql, params);
      
      return rows.map(row => ({
        gameId: row.game_id,
        homeTransitionProbs: row.transition_probabilities_home 
          ? JSON.parse(row.transition_probabilities_home.toString()) 
          : null,
        awayTransitionProbs: row.transition_probabilities_away 
          ? JSON.parse(row.transition_probabilities_away.toString()) 
          : null
      }));
    } catch (error) {
      logger.error('Failed to get random games for negative sampling', {
        count,
        excludeGameId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = GameIdsRepository;