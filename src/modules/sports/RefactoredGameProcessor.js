const TeamRepresentationManager = require('./TeamRepresentationManager');
const BayesianPosteriorUpdater = require('./BayesianPosteriorUpdater');
const FrozenVAEEncoder = require('./FrozenVAEEncoder');
const TransitionProbabilityNN = require('./TransitionProbabilityNN');
const TeamRepository = require('../../database/repositories/TeamRepository');
const logger = require('../../utils/logger');

/**
 * Refactored Game Processor for InfoNCE VAE-NN Architecture
 * 
 * Implements the new three-phase architecture:
 * 1. Uses frozen VAE encoder (no gradient updates)
 * 2. Loads posterior distributions from database
 * 3. Updates posteriors via Bayesian inference
 * 4. Trains NN using posterior latents
 * 
 * Key changes from original:
 * - No VAE encoding during game processing (encoder is frozen)
 * - Uses stored posterior distributions as primary source
 * - Falls back to frozen encoder for new teams only
 * - Bayesian updates without encoder backpropagation
 */
class RefactoredGameProcessor {
  constructor(options = {}) {
    // Initialize repositories
    this.teamRepository = new TeamRepository();
    
    // Initialize frozen encoder (loaded from saved weights)
    this.frozenEncoder = new FrozenVAEEncoder(options.encoderWeightsPath);
    
    // Initialize team representation manager
    this.teamRepManager = new TeamRepresentationManager(
      this.teamRepository,
      this.frozenEncoder,
      {
        latentDim: options.latentDim || 16,
        defaultUncertainty: options.defaultUncertainty || 1.0,
        validateInfoNCEStructure: options.validateInfoNCEStructure !== false,
        enableFallback: options.enableFallback !== false
      }
    );
    
    // Initialize neural network for transition probability prediction
    this.transitionNN = new TransitionProbabilityNN(options.nnInputDim || 74); // 16+16+16+16+10 context
    
    // Initialize Bayesian posterior updater
    this.posteriorUpdater = new BayesianPosteriorUpdater(
      this.teamRepository,
      this.transitionNN,
      {
        learningRate: options.learningRate || 0.1,
        minUncertainty: options.minUncertainty || 0.1,
        maxUncertainty: options.maxUncertainty || 2.0,
        latentDim: options.latentDim || 16
      }
    );
    
    // Processing parameters
    this.nnLearningRate = options.nnLearningRate || 0.001;
    this.saveInterval = options.saveInterval || 10;
    this.logInterval = options.logInterval || 5;
    
    logger.info('Initialized RefactoredGameProcessor', {
      latentDim: options.latentDim || 16,
      nnInputDim: options.nnInputDim || 74,
      learningRate: options.learningRate || 0.1,
      nnLearningRate: this.nnLearningRate
    });
  }

  /**
   * Process a single game using the new architecture
   * 
   * @param {Object} gameData - Game data with features and transition probabilities
   * @returns {Promise<Object>} - Processing result
   */
  async processGame(gameData) {
    try {
      const startTime = Date.now();
      
      // Extract game information
      const { gameId, homeTeamId, awayTeamId, gameContext, actualTransitionProbs } = gameData;
      
      logger.info('Processing game with new architecture', {
        gameId,
        homeTeamId,
        awayTeamId,
        gameDate: gameContext.gameDate
      });

      // Step 1: Get team posterior distributions (primary) or fallback to frozen encoder
      const teamRepresentations = await this.getTeamRepresentationsForGame(
        homeTeamId,
        awayTeamId,
        gameData.gameFeatures
      );

      // Step 2: Build NN input using posterior distributions
      const nnInput = this.buildNNInputFromPosteriors(
        teamRepresentations.home,
        teamRepresentations.away,
        gameContext
      );

      // Step 3: NN forward pass to predict transition probabilities
      const predictedTransitionProbs = await this.transitionNN.predict(nnInput);

      // Step 4: Compute NN loss and update NN weights (no VAE updates)
      const nnLoss = this.computeNNLoss(predictedTransitionProbs, actualTransitionProbs);
      await this.updateNNWeights(nnInput, actualTransitionProbs, nnLoss);

      // Step 5: Bayesian posterior updates for both teams
      const posteriorUpdates = await this.updateTeamPosteriors(
        homeTeamId,
        awayTeamId,
        actualTransitionProbs,
        gameContext
      );

      // Step 6: Update cache and log results
      this.teamRepManager.updateCache(homeTeamId, posteriorUpdates.home);
      this.teamRepManager.updateCache(awayTeamId, posteriorUpdates.away);

      const processingTime = Date.now() - startTime;
      
      logger.info('Completed game processing', {
        gameId,
        processingTime,
        nnLoss: nnLoss.toFixed(4),
        homeGamesProcessed: posteriorUpdates.home.games_processed,
        awayGamesProcessed: posteriorUpdates.away.games_processed
      });

      return {
        gameId,
        success: true,
        processingTime,
        nnLoss,
        teamUpdates: posteriorUpdates,
        teamSources: {
          home: teamRepresentations.home.source,
          away: teamRepresentations.away.source
        }
      };

    } catch (error) {
      logger.error('Failed to process game', {
        gameId: gameData.gameId,
        error: error.message
      });
      
      return {
        gameId: gameData.gameId,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get team representations for a game (posteriors or fallback)
   * 
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Object} gameFeatures - Game features for fallback encoding
   * @returns {Promise<Object>} - Team representations
   */
  async getTeamRepresentationsForGame(homeTeamId, awayTeamId, gameFeatures) {
    try {
      // Try to get stored posterior distributions first
      const representations = await this.teamRepManager.getGameTeamRepresentations(
        homeTeamId,
        awayTeamId,
        gameFeatures
      );

      // Log representation sources
      logger.debug('Retrieved team representations', {
        homeTeamId,
        awayTeamId,
        homeSource: representations.home.source,
        awaySource: representations.away.source,
        homeGames: representations.home.games_processed,
        awayGames: representations.away.games_processed
      });

      return representations;

    } catch (error) {
      logger.error('Failed to get team representations', {
        homeTeamId,
        awayTeamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Build NN input from posterior distributions
   * 
   * @param {Object} homeRep - Home team representation
   * @param {Object} awayRep - Away team representation
   * @param {Object} gameContext - Game context
   * @returns {Array} - NN input vector
   */
  buildNNInputFromPosteriors(homeRep, awayRep, gameContext) {
    const input = [];
    
    // Home team posterior (16 + 16 = 32 dimensions)
    input.push(...homeRep.mu);
    input.push(...homeRep.sigma.map(s => s * s)); // Use variance
    
    // Away team posterior (16 + 16 = 32 dimensions)
    input.push(...awayRep.mu);
    input.push(...awayRep.sigma.map(s => s * s)); // Use variance
    
    // Game context features (~10 dimensions)
    input.push(gameContext.isHomeGame ? 1.0 : 0.0);
    input.push(gameContext.isNeutralSite ? 1.0 : 0.0);
    input.push(gameContext.isConferenceGame ? 1.0 : 0.0);
    input.push(gameContext.isPostseason ? 1.0 : 0.0);
    input.push(gameContext.restDays || 2.0);
    input.push(gameContext.seasonProgress || 0.5);
    input.push(gameContext.temperature || 70.0);
    input.push(gameContext.altitude || 0.0);
    input.push(gameContext.crowdSize || 10000.0);
    input.push(gameContext.tvGame ? 1.0 : 0.0);
    
    return input;
  }

  /**
   * Compute neural network loss
   * 
   * @param {Array} predicted - Predicted transition probabilities
   * @param {Array} actual - Actual transition probabilities
   * @returns {number} - Cross-entropy loss
   */
  computeNNLoss(predicted, actual) {
    if (predicted.length !== actual.length) {
      throw new Error('Predicted and actual arrays must have same length');
    }
    
    let crossEntropy = 0;
    for (let i = 0; i < predicted.length; i++) {
      // Clamp probabilities to avoid log(0)
      const p = Math.max(1e-8, Math.min(1 - 1e-8, predicted[i]));
      const a = Math.max(1e-8, Math.min(1 - 1e-8, actual[i]));
      crossEntropy -= a * Math.log(p);
    }
    
    return crossEntropy;
  }

  /**
   * Update neural network weights (NN only, no VAE updates)
   * 
   * @param {Array} input - NN input
   * @param {Array} target - Target transition probabilities
   * @param {number} loss - Computed loss
   * @returns {Promise<void>}
   */
  async updateNNWeights(input, target, loss) {
    try {
      // Update only NN weights, encoder remains frozen
      await this.transitionNN.trainStep(input, target, this.nnLearningRate);
      
      logger.debug('Updated NN weights', {
        loss: loss.toFixed(4),
        learningRate: this.nnLearningRate
      });

    } catch (error) {
      logger.error('Failed to update NN weights', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update team posterior distributions using Bayesian inference
   * 
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Array} actualTransitionProbs - Actual transition probabilities
   * @param {Object} gameContext - Game context
   * @returns {Promise<Object>} - Updated posteriors
   */
  async updateTeamPosteriors(homeTeamId, awayTeamId, actualTransitionProbs, gameContext) {
    try {
      // Split transition probabilities by team (assuming first 4 are home, last 4 are away)
      const homeTransitionProbs = actualTransitionProbs.slice(0, 4).concat(new Array(4).fill(0));
      const awayTransitionProbs = new Array(4).fill(0).concat(actualTransitionProbs.slice(4, 8));

      // Update home team posterior
      const homeUpdate = await this.posteriorUpdater.updatePosterior(
        homeTeamId,
        homeTransitionProbs,
        awayTeamId,
        { ...gameContext, isHomeTeam: true }
      );

      // Update away team posterior
      const awayUpdate = await this.posteriorUpdater.updatePosterior(
        awayTeamId,
        awayTransitionProbs,
        homeTeamId,
        { ...gameContext, isHomeTeam: false }
      );

      logger.debug('Updated team posteriors', {
        homeTeamId,
        awayTeamId,
        homeGamesProcessed: (homeUpdate.games_processed || 0),
        awayGamesProcessed: (awayUpdate.games_processed || 0)
      });

      return {
        home: homeUpdate,
        away: awayUpdate
      };

    } catch (error) {
      logger.error('Failed to update team posteriors', {
        homeTeamId,
        awayTeamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Batch process multiple games
   * 
   * @param {Array} gameDataList - Array of game data objects
   * @returns {Promise<Array>} - Processing results
   */
  async batchProcessGames(gameDataList) {
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    logger.info('Starting batch game processing', {
      totalGames: gameDataList.length
    });

    for (let i = 0; i < gameDataList.length; i++) {
      const gameData = gameDataList[i];
      
      try {
        const result = await this.processGame(gameData);
        results.push(result);
        
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }

        // Log progress periodically
        if ((i + 1) % this.logInterval === 0) {
          logger.info('Batch processing progress', {
            processed: i + 1,
            total: gameDataList.length,
            successCount,
            failureCount,
            progressPercent: ((i + 1) / gameDataList.length * 100).toFixed(1)
          });
        }

        // Save models periodically
        if ((i + 1) % this.saveInterval === 0) {
          await this.saveModels();
        }

      } catch (error) {
        logger.error('Failed to process game in batch', {
          gameIndex: i,
          gameId: gameData.gameId,
          error: error.message
        });
        
        results.push({
          gameId: gameData.gameId,
          success: false,
          error: error.message
        });
        failureCount++;
      }
    }

    // Final save
    await this.saveModels();

    logger.info('Completed batch game processing', {
      totalGames: gameDataList.length,
      successCount,
      failureCount,
      successRate: (successCount / gameDataList.length * 100).toFixed(1)
    });

    return results;
  }

  /**
   * Save model weights and state
   * 
   * @returns {Promise<void>}
   */
  async saveModels() {
    try {
      // Save NN weights (VAE encoder is frozen, no need to save)
      await this.transitionNN.saveWeights();
      
      // Clean expired cache entries
      this.teamRepManager.cleanExpiredCache();
      
      logger.debug('Saved model weights and cleaned cache');

    } catch (error) {
      logger.error('Failed to save models', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get processing statistics
   * 
   * @returns {Object} - Processing statistics
   */
  getStatistics() {
    return {
      teamRepManager: this.teamRepManager.getConfiguration(),
      posteriorUpdater: this.posteriorUpdater.getConfiguration(),
      nnLearningRate: this.nnLearningRate,
      saveInterval: this.saveInterval,
      logInterval: this.logInterval
    };
  }

  /**
   * Update configuration
   * 
   * @param {Object} config - New configuration
   */
  updateConfiguration(config) {
    if (config.nnLearningRate !== undefined) {
      this.nnLearningRate = config.nnLearningRate;
    }
    if (config.saveInterval !== undefined) {
      this.saveInterval = config.saveInterval;
    }
    if (config.logInterval !== undefined) {
      this.logInterval = config.logInterval;
    }
    if (config.teamRepManager) {
      this.teamRepManager.updateConfiguration(config.teamRepManager);
    }
    if (config.posteriorUpdater) {
      this.posteriorUpdater.updateConfiguration(config.posteriorUpdater);
    }

    logger.info('Updated RefactoredGameProcessor configuration', config);
  }
}

module.exports = RefactoredGameProcessor;