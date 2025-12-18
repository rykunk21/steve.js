const GameIdsRepository = require('../../database/repositories/GameIdsRepository');
const logger = require('../../utils/logger');

/**
 * Data sampler for InfoNCE contrastive learning
 * 
 * Handles positive and negative sampling from the game_ids table:
 * - Positive samples: current team's transition probabilities
 * - Negative samples: randomly sampled transition probabilities from other games
 */
class InfoNCEDataSampler {
  constructor() {
    this.gameIdsRepository = new GameIdsRepository();
    this.negativeCache = new Map(); // Cache for negative samples
    this.cacheSize = 1000; // Maximum cache size
    this.cacheRefreshInterval = 100; // Refresh cache every N samples
    this.sampleCount = 0;
  }

  /**
   * Sample positive and negative examples for InfoNCE training
   * @param {string} gameId - Current game ID (positive sample)
   * @param {number} numNegatives - Number of negative samples (default: 64)
   * @param {string} sport - Sport type (default: 'mens-college-basketball')
   * @returns {Promise<Object>} - {positive: {home: Array, away: Array}, negatives: Array}
   */
  async sampleContrastivePair(gameId, numNegatives = 64, sport = 'mens-college-basketball') {
    try {
      // Get positive sample (current game's transition probabilities)
      const positiveGame = await this.gameIdsRepository.getGameById(gameId);
      
      if (!positiveGame || !positiveGame.labelsExtracted) {
        throw new Error(`Game ${gameId} not found or labels not extracted`);
      }

      const positive = {
        home: this.deserializeTransitionProbs(positiveGame.transitionProbabilitiesHome),
        away: this.deserializeTransitionProbs(positiveGame.transitionProbabilitiesAway)
      };

      // Get negative samples
      const negatives = await this.sampleNegativeExamples(numNegatives, gameId, sport);

      this.sampleCount++;
      
      logger.debug('Sampled contrastive pair', {
        gameId,
        numNegatives,
        positiveHome: positive.home?.slice(0, 3), // Log first 3 elements
        positiveAway: positive.away?.slice(0, 3),
        negativesCount: negatives.length
      });

      return { positive, negatives };

    } catch (error) {
      logger.error('Failed to sample contrastive pair', {
        gameId,
        numNegatives,
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Sample negative examples from other games
   * @param {number} numNegatives - Number of negative samples
   * @param {string} excludeGameId - Game ID to exclude
   * @param {string} sport - Sport type
   * @returns {Promise<Array>} - Array of transition probability vectors
   */
  async sampleNegativeExamples(numNegatives, excludeGameId, sport) {
    try {
      // Refresh cache periodically or if empty
      if (this.negativeCache.size === 0 || this.sampleCount % this.cacheRefreshInterval === 0) {
        await this.refreshNegativeCache(sport);
      }

      // Get available negative samples (excluding current game)
      const availableNegatives = Array.from(this.negativeCache.entries())
        .filter(([gameId, _]) => gameId !== excludeGameId)
        .map(([_, probs]) => probs)
        .flat(); // Flatten home and away probabilities

      if (availableNegatives.length < numNegatives) {
        logger.warn('Insufficient negative samples in cache, fetching more', {
          available: availableNegatives.length,
          requested: numNegatives
        });
        
        // Fetch more negatives directly from database
        const additionalNegatives = await this.fetchRandomNegatives(
          numNegatives - availableNegatives.length,
          excludeGameId,
          sport
        );
        availableNegatives.push(...additionalNegatives);
      }

      // Randomly sample the requested number of negatives
      const sampledNegatives = this.randomSample(availableNegatives, numNegatives);

      return sampledNegatives;

    } catch (error) {
      logger.error('Failed to sample negative examples', {
        numNegatives,
        excludeGameId,
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Refresh the negative samples cache
   * @param {string} sport - Sport type
   */
  async refreshNegativeCache(sport) {
    try {
      logger.debug('Refreshing negative samples cache');
      
      // Get random games with extracted labels
      const games = await this.gameIdsRepository.getGamesWithLabels(sport, this.cacheSize);
      
      this.negativeCache.clear();
      
      for (const game of games) {
        const homeProbs = this.deserializeTransitionProbs(game.transitionProbabilitiesHome);
        const awayProbs = this.deserializeTransitionProbs(game.transitionProbabilitiesAway);
        
        if (homeProbs && awayProbs) {
          this.negativeCache.set(game.gameId, { home: homeProbs, away: awayProbs });
        }
      }

      logger.info('Refreshed negative samples cache', {
        cacheSize: this.negativeCache.size,
        sport
      });

    } catch (error) {
      logger.error('Failed to refresh negative cache', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Fetch random negative samples directly from database
   * @param {number} count - Number of samples to fetch
   * @param {string} excludeGameId - Game ID to exclude
   * @param {string} sport - Sport type
   * @returns {Promise<Array>} - Array of transition probability vectors
   */
  async fetchRandomNegatives(count, excludeGameId, sport) {
    try {
      // This would ideally use a SQL query with RANDOM() or similar
      // For now, fetch a larger set and sample from it
      const games = await this.gameIdsRepository.getGamesWithLabels(sport, count * 2);
      
      const negatives = [];
      
      for (const game of games) {
        if (game.gameId === excludeGameId) continue;
        
        const homeProbs = this.deserializeTransitionProbs(game.transitionProbabilitiesHome);
        const awayProbs = this.deserializeTransitionProbs(game.transitionProbabilitiesAway);
        
        if (homeProbs) negatives.push(homeProbs);
        if (awayProbs) negatives.push(awayProbs);
        
        if (negatives.length >= count) break;
      }

      return this.randomSample(negatives, Math.min(count, negatives.length));

    } catch (error) {
      logger.error('Failed to fetch random negatives', {
        count,
        excludeGameId,
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Deserialize transition probabilities from BLOB storage
   * @param {Buffer|string} data - Serialized transition probabilities
   * @returns {Array|null} - 8-dimensional transition probability vector
   */
  deserializeTransitionProbs(data) {
    if (!data) return null;
    
    try {
      // Handle both Buffer and string formats
      if (Buffer.isBuffer(data)) {
        return JSON.parse(data.toString());
      } else if (typeof data === 'string') {
        return JSON.parse(data);
      } else {
        return null;
      }
    } catch (error) {
      logger.warn('Failed to deserialize transition probabilities', {
        dataType: typeof data,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Randomly sample elements from an array
   * @param {Array} array - Source array
   * @param {number} count - Number of elements to sample
   * @returns {Array} - Randomly sampled elements
   */
  randomSample(array, count) {
    if (array.length <= count) {
      return [...array];
    }

    const sampled = [];
    const indices = new Set();
    
    while (sampled.length < count && indices.size < array.length) {
      const index = Math.floor(Math.random() * array.length);
      if (!indices.has(index)) {
        indices.add(index);
        sampled.push(array[index]);
      }
    }
    
    return sampled;
  }

  /**
   * Validate transition probabilities
   * @param {Array} probs - Transition probability vector
   * @returns {boolean} - Whether probabilities are valid
   */
  validateTransitionProbs(probs) {
    if (!Array.isArray(probs) || probs.length !== 8) {
      return false;
    }

    // Check if all elements are numbers and non-negative
    if (!probs.every(p => typeof p === 'number' && p >= 0)) {
      return false;
    }

    // Check if probabilities sum to approximately 1.0 (within tolerance)
    const sum = probs.reduce((a, b) => a + b, 0);
    return Math.abs(sum - 1.0) < 1e-6;
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    return {
      cacheSize: this.negativeCache.size,
      sampleCount: this.sampleCount,
      cacheRefreshInterval: this.cacheRefreshInterval
    };
  }

  /**
   * Clear the negative samples cache
   */
  clearCache() {
    this.negativeCache.clear();
    this.sampleCount = 0;
    logger.debug('Cleared negative samples cache');
  }
}

module.exports = InfoNCEDataSampler;