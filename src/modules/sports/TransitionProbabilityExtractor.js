const XMLGameParser = require('./XMLGameParser');
const TransitionProbabilityComputer = require('./TransitionProbabilityComputer');
const HistoricalGameFetcher = require('./HistoricalGameFetcher');
const GameIdsRepository = require('../../database/repositories/GameIdsRepository');
const logger = require('../../utils/logger');

/**
 * Extracts transition probabilities from StatBroadcast XML data
 * Converts play-by-play data into 8-dimensional vectors for InfoNCE training
 */
class TransitionProbabilityExtractor {
  constructor() {
    this.xmlParser = new XMLGameParser();
    this.probabilityComputer = new TransitionProbabilityComputer();
    this.gameFetcher = new HistoricalGameFetcher();
    this.gameIdsRepo = new GameIdsRepository();
  }

  /**
   * Extract transition probabilities for a single game
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<Object>} - Extracted transition probabilities {home: Array, away: Array}
   */
  async extractGameTransitionProbabilities(gameId) {
    try {
      logger.info('Extracting transition probabilities for game', { gameId });

      // Fetch XML data from StatBroadcast
      const xmlData = await this.gameFetcher.fetchGameXML(gameId);
      
      if (!xmlData) {
        throw new Error(`No XML data found for game ${gameId}`);
      }

      // Parse XML to structured data
      const gameData = await this.xmlParser.parseGameXML(xmlData);
      
      if (!gameData || !gameData.teams) {
        throw new Error(`Invalid game data structure for game ${gameId}`);
      }

      // Compute transition probabilities from play-by-play
      const transitionProbs = this.probabilityComputer.computeTransitionProbabilities(gameData);
      
      if (!transitionProbs || !transitionProbs.visitor || !transitionProbs.home) {
        throw new Error(`Failed to compute transition probabilities for game ${gameId}`);
      }

      // Convert to 8-dimensional vectors
      const homeVector = this.convertToVector(transitionProbs.home);
      const awayVector = this.convertToVector(transitionProbs.visitor);

      // Validate vectors
      this.validateTransitionVector(homeVector, 'home');
      this.validateTransitionVector(awayVector, 'away');

      logger.info('Successfully extracted transition probabilities', {
        gameId,
        homeVector: homeVector.map(v => v.toFixed(4)),
        awayVector: awayVector.map(v => v.toFixed(4)),
        homeSum: homeVector.reduce((a, b) => a + b, 0).toFixed(4),
        awaySum: awayVector.reduce((a, b) => a + b, 0).toFixed(4)
      });

      return {
        home: homeVector,
        away: awayVector,
        metadata: {
          gameId: gameData.metadata.gameId,
          homeTeam: gameData.teams.home?.name,
          awayTeam: gameData.teams.visitor?.name,
          gameDate: gameData.metadata.date
        }
      };

    } catch (error) {
      logger.error('Failed to extract transition probabilities', {
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
  convertToVector(probabilities) {
    return [
      probabilities.twoPointMakeProb || 0,
      probabilities.twoPointMissProb || 0,
      probabilities.threePointMakeProb || 0,
      probabilities.threePointMissProb || 0,
      probabilities.freeThrowMakeProb || 0,
      probabilities.freeThrowMissProb || 0,
      probabilities.offensiveReboundProb || 0,
      probabilities.turnoverProb || 0
    ];
  }

  /**
   * Validate that transition vector is properly normalized
   * @param {Array} vector - 8-dimensional transition vector
   * @param {string} teamType - 'home' or 'away' for logging
   */
  validateTransitionVector(vector, teamType) {
    if (!Array.isArray(vector) || vector.length !== 8) {
      throw new Error(`Invalid transition vector for ${teamType} team: must be 8-dimensional array`);
    }

    // Check all values are non-negative
    for (let i = 0; i < vector.length; i++) {
      if (vector[i] < 0 || vector[i] > 1) {
        throw new Error(`Invalid probability at index ${i} for ${teamType} team: ${vector[i]} (must be between 0 and 1)`);
      }
    }

    // Check sum is approximately 1.0
    const sum = vector.reduce((a, b) => a + b, 0);
    const tolerance = 0.0001;
    
    if (Math.abs(sum - 1.0) > tolerance) {
      throw new Error(`Transition vector for ${teamType} team does not sum to 1.0: ${sum.toFixed(6)}`);
    }
  }

  /**
   * Extract and store transition probabilities for multiple games
   * @param {Array} gameIds - Array of StatBroadcast game IDs
   * @param {Object} options - Processing options {batchSize, skipExisting}
   * @returns {Promise<Object>} - Processing results {processed, failed, skipped}
   */
  async extractBatchTransitionProbabilities(gameIds, options = {}) {
    const { batchSize = 10, skipExisting = true } = options;
    
    const results = {
      processed: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    logger.info('Starting batch transition probability extraction', {
      totalGames: gameIds.length,
      batchSize,
      skipExisting
    });

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < gameIds.length; i += batchSize) {
      const batch = gameIds.slice(i, i + batchSize);
      
      logger.info('Processing batch', {
        batchStart: i + 1,
        batchEnd: Math.min(i + batchSize, gameIds.length),
        totalGames: gameIds.length
      });

      for (const gameId of batch) {
        try {
          // Check if already processed
          if (skipExisting) {
            const existing = await this.gameIdsRepo.getGameById(gameId);
            if (existing && existing.labelsExtracted) {
              logger.debug('Skipping already processed game', { gameId });
              results.skipped++;
              continue;
            }
          }

          // Extract transition probabilities
          const transitionProbs = await this.extractGameTransitionProbabilities(gameId);
          
          // Store in database
          await this.gameIdsRepo.saveTransitionProbabilities(gameId, transitionProbs);
          
          results.processed++;
          
          logger.debug('Successfully processed game', { 
            gameId, 
            processed: results.processed,
            remaining: gameIds.length - i - batch.indexOf(gameId) - 1
          });

        } catch (error) {
          logger.error('Failed to process game in batch', {
            gameId,
            error: error.message
          });
          
          results.failed++;
          results.errors.push({
            gameId,
            error: error.message
          });
        }

        // Add small delay to be respectful to StatBroadcast servers
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Longer delay between batches
      if (i + batchSize < gameIds.length) {
        logger.info('Batch completed, waiting before next batch', {
          processed: results.processed,
          failed: results.failed,
          skipped: results.skipped
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info('Batch transition probability extraction completed', results);
    return results;
  }

  /**
   * Extract transition probabilities for all games without labels
   * @param {Object} options - Processing options {limit, sport, batchSize}
   * @returns {Promise<Object>} - Processing results
   */
  async extractAllPendingTransitionProbabilities(options = {}) {
    try {
      const { limit = null, sport = 'mens-college-basketball', batchSize = 10 } = options;

      // Get games without extracted labels
      const pendingGames = await this.gameIdsRepo.getGamesWithoutLabels({ limit, sport });
      
      if (pendingGames.length === 0) {
        logger.info('No pending games found for transition probability extraction');
        return { processed: 0, failed: 0, skipped: 0, errors: [] };
      }

      logger.info('Found pending games for transition probability extraction', {
        count: pendingGames.length,
        sport
      });

      // Extract game IDs
      const gameIds = pendingGames.map(game => game.gameId);

      // Process batch
      return await this.extractBatchTransitionProbabilities(gameIds, { 
        batchSize, 
        skipExisting: true 
      });

    } catch (error) {
      logger.error('Failed to extract all pending transition probabilities', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get extraction statistics
   * @param {string} sport - Sport filter
   * @returns {Promise<Object>} - Statistics {total, extracted, pending, processed}
   */
  async getExtractionStatistics(sport = 'mens-college-basketball') {
    try {
      const total = await this.gameIdsRepo.count({ sport });
      const extracted = await this.gameIdsRepo.count({ sport, labels_extracted: true });
      const pending = await this.gameIdsRepo.count({ sport, labels_extracted: false });
      const processed = await this.gameIdsRepo.count({ sport, processed: true });

      return {
        total,
        extracted,
        pending,
        processed,
        extractionRate: total > 0 ? (extracted / total * 100).toFixed(2) : 0,
        processingRate: total > 0 ? (processed / total * 100).toFixed(2) : 0
      };
    } catch (error) {
      logger.error('Failed to get extraction statistics', {
        error: error.message
      });
      throw error;
    }
  }
}

/**
 * CLI interface for running transition probability extraction
 */
async function main() {
  try {
    console.log('Starting transition probability extraction pipeline...\n');

    // Initialize database connection
    console.log('Initializing database connection...');
    const dbConnection = require('../../database/connection');
    await dbConnection.initialize();

    const extractor = new TransitionProbabilityExtractor();

    // Get current statistics
    console.log('Getting current extraction statistics...');
    const stats = await extractor.getExtractionStatistics();
    
    console.log('Current Statistics:');
    console.log(`  Total games: ${stats.total}`);
    console.log(`  Labels extracted: ${stats.extracted} (${stats.extractionRate}%)`);
    console.log(`  Pending extraction: ${stats.pending}`);
    console.log(`  Processed games: ${stats.processed} (${stats.processingRate}%)\n`);

    if (stats.pending === 0) {
      console.log('No games pending transition probability extraction.');
      return;
    }

    // Extract transition probabilities for all pending games
    console.log(`Processing ${stats.pending} games for transition probability extraction...\n`);
    
    const results = await extractor.extractAllPendingTransitionProbabilities({
      batchSize: 5 // Smaller batch size for CLI
    });

    console.log('\nExtraction Results:');
    console.log(`  Successfully processed: ${results.processed}`);
    console.log(`  Failed: ${results.failed}`);
    console.log(`  Skipped: ${results.skipped}`);

    if (results.errors.length > 0) {
      console.log('\nErrors encountered:');
      results.errors.forEach(error => {
        console.log(`  Game ${error.gameId}: ${error.error}`);
      });
    }

    // Get updated statistics
    console.log('\nGetting updated statistics...');
    const updatedStats = await extractor.getExtractionStatistics();
    
    console.log('Updated Statistics:');
    console.log(`  Total games: ${updatedStats.total}`);
    console.log(`  Labels extracted: ${updatedStats.extracted} (${updatedStats.extractionRate}%)`);
    console.log(`  Pending extraction: ${updatedStats.pending}`);

    console.log('\nTransition probability extraction pipeline completed successfully!');

  } catch (error) {
    console.error('Error running transition probability extraction:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = TransitionProbabilityExtractor;