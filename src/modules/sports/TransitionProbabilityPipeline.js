const XMLGameParser = require('./XMLGameParser');
const TransitionProbabilityComputer = require('./TransitionProbabilityComputer');
const TransitionProbabilityExtractor = require('./TransitionProbabilityExtractor');
const GameIdsRepository = require('../../database/repositories/GameIdsRepository');
const logger = require('../../utils/logger');

/**
 * Complete pipeline for extracting transition probabilities from StatBroadcast XML
 * Implements task 0.4: Create transition probability extraction pipeline
 */
class TransitionProbabilityPipeline {
  constructor() {
    this.xmlParser = new XMLGameParser();
    this.probabilityComputer = new TransitionProbabilityComputer();
    this.extractor = new TransitionProbabilityExtractor();
    this.gameIdsRepo = new GameIdsRepository();
  }

  /**
   * Complete pipeline: Parse XML → Compute probabilities → Normalize → Store
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<Object>} - Pipeline results with 8-dimensional vectors
   */
  async processSingleGame(gameId) {
    try {
      logger.info('Starting transition probability pipeline', { gameId });

      // Step 1: Parse StatBroadcast XML to extract play-by-play data
      logger.debug('Step 1: Parsing StatBroadcast XML');
      const xmlData = await this.extractor.gameFetcher.fetchGameXML(gameId);
      const gameData = await this.xmlParser.parseGameXML(xmlData);

      // Step 2: Compute transition probabilities from play-by-play
      logger.debug('Step 2: Computing transition probabilities from play-by-play');
      const transitionProbs = this.probabilityComputer.computeTransitionProbabilities(gameData);

      // Step 3: Convert to 8-dimensional vectors [2pt_make, 2pt_miss, 3pt_make, 3pt_miss, ft_make, ft_miss, oreb, turnover]
      logger.debug('Step 3: Converting to 8-dimensional vectors');
      const homeVector = this.convertToEightDimensionalVector(transitionProbs.home);
      const awayVector = this.convertToEightDimensionalVector(transitionProbs.visitor);

      // Step 4: Normalize vectors to sum to 1.0
      logger.debug('Step 4: Normalizing vectors to sum to 1.0');
      const normalizedHome = this.normalizeVector(homeVector);
      const normalizedAway = this.normalizeVector(awayVector);

      // Step 5: Store computed vectors in game_ids table for InfoNCE training
      logger.debug('Step 5: Storing vectors in database');
      await this.gameIdsRepo.saveTransitionProbabilities(gameId, {
        home: normalizedHome,
        away: normalizedAway
      });

      const result = {
        gameId,
        homeVector: normalizedHome,
        awayVector: normalizedAway,
        metadata: {
          homeTeam: gameData.teams.home?.name,
          awayTeam: gameData.teams.visitor?.name,
          gameDate: gameData.metadata.date
        },
        validation: {
          homeSum: normalizedHome.reduce((a, b) => a + b, 0),
          awaySum: normalizedAway.reduce((a, b) => a + b, 0)
        }
      };

      logger.info('Transition probability pipeline completed successfully', {
        gameId,
        homeSum: result.validation.homeSum.toFixed(6),
        awaySum: result.validation.awaySum.toFixed(6)
      });

      return result;

    } catch (error) {
      logger.error('Transition probability pipeline failed', {
        gameId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Convert transition probability object to 8-dimensional vector
   * @param {Object} probabilities - Transition probability object
   * @returns {Array} - 8-dimensional vector [2pt_make, 2pt_miss, 3pt_make, 3pt_miss, ft_make, ft_miss, oreb, turnover]
   */
  convertToEightDimensionalVector(probabilities) {
    return [
      probabilities.twoPointMakeProb || 0,      // 2pt_make
      probabilities.twoPointMissProb || 0,      // 2pt_miss
      probabilities.threePointMakeProb || 0,    // 3pt_make
      probabilities.threePointMissProb || 0,    // 3pt_miss
      probabilities.freeThrowMakeProb || 0,     // ft_make
      probabilities.freeThrowMissProb || 0,     // ft_miss
      probabilities.offensiveReboundProb || 0,  // oreb
      probabilities.turnoverProb || 0           // turnover
    ];
  }

  /**
   * Normalize vector to sum to 1.0
   * @param {Array} vector - 8-dimensional vector
   * @returns {Array} - Normalized vector
   */
  normalizeVector(vector) {
    const sum = vector.reduce((a, b) => a + b, 0);
    
    if (sum === 0) {
      // Handle edge case: return uniform distribution
      return new Array(8).fill(1/8);
    }
    
    if (Math.abs(sum - 1.0) < 0.0001) {
      // Already normalized
      return [...vector];
    }
    
    // Normalize to sum to 1.0
    return vector.map(prob => prob / sum);
  }

  /**
   * Validate that vector is properly normalized
   * @param {Array} vector - 8-dimensional vector
   * @returns {boolean} - True if valid
   */
  validateVector(vector) {
    if (!Array.isArray(vector) || vector.length !== 8) {
      return false;
    }

    // Check all values are non-negative and <= 1.0
    for (const prob of vector) {
      if (prob < 0 || prob > 1.0) {
        return false;
      }
    }

    // Check sum is approximately 1.0
    const sum = vector.reduce((a, b) => a + b, 0);
    return Math.abs(sum - 1.0) < 0.0001;
  }

  /**
   * Process multiple games in batch
   * @param {Array} gameIds - Array of StatBroadcast game IDs
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Batch processing results
   */
  async processBatch(gameIds, options = {}) {
    const { batchSize = 10 } = options;
    
    const results = {
      processed: 0,
      failed: 0,
      errors: []
    };

    logger.info('Starting batch transition probability pipeline', {
      totalGames: gameIds.length,
      batchSize
    });

    for (let i = 0; i < gameIds.length; i += batchSize) {
      const batch = gameIds.slice(i, i + batchSize);
      
      for (const gameId of batch) {
        try {
          await this.processSingleGame(gameId);
          results.processed++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            gameId,
            error: error.message
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Batch delay
      if (i + batchSize < gameIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info('Batch transition probability pipeline completed', results);
    return results;
  }

  /**
   * Get pipeline statistics
   * @returns {Promise<Object>} - Pipeline statistics
   */
  async getStatistics() {
    try {
      const total = await this.gameIdsRepo.count();
      const extracted = await this.gameIdsRepo.count({ labels_extracted: true });
      const pending = total - extracted;

      return {
        total,
        extracted,
        pending,
        extractionRate: total > 0 ? (extracted / total * 100).toFixed(2) : 0
      };
    } catch (error) {
      logger.error('Failed to get pipeline statistics', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = TransitionProbabilityPipeline;