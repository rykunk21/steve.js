const logger = require('../../utils/logger');
const FeatureExtractor = require('./FeatureExtractor');
const GameRepresentationBuilder = require('./GameRepresentationBuilder');
const TransitionProbabilityComputer = require('./TransitionProbabilityComputer');
const TransitionMatrixMLP = require('./TransitionMatrixMLP');

/**
 * Performs online learning updates to the MLP model
 * Updates model incrementally after each completed game
 */
class OnlineLearner {
  constructor(historicalGameRepository) {
    this.historicalGameRepo = historicalGameRepository;
    
    // Initialize components
    this.featureExtractor = new FeatureExtractor();
    this.gameRepBuilder = new GameRepresentationBuilder(this.featureExtractor);
    this.transitionComputer = new TransitionProbabilityComputer();
    
    // Online learning configuration
    this.config = {
      learningRate: 0.0001, // Small learning rate for stability
      minGamesForUpdate: 5, // Minimum games in history before updating
      maxHistoryGames: 20 // Maximum games to consider for features
    };

    // Model cache
    this.modelCache = null;
    this.modelCacheTimestamp = null;
    this.modelCacheTTL = 3600000; // 1 hour
  }

  /**
   * Update model after a completed game
   * @param {Object} gameData - Parsed game data from XMLGameParser
   * @param {Object} gameMetadata - Game metadata (IDs, date, etc.)
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   * @returns {Promise<Object>} - Update results
   */
  async updateFromGame(gameData, gameMetadata, sport, season) {
    logger.info('Starting online learning update', {
      gameId: gameMetadata.gameId,
      sport,
      season
    });

    try {
      // Load current model
      const model = await this.loadModel(sport, season);

      // Get team histories (before this game)
      const homeHistory = await this.getTeamHistory(
        gameMetadata.homeTeamId,
        season,
        gameMetadata.gameDate
      );

      const awayHistory = await this.getTeamHistory(
        gameMetadata.awayTeamId,
        season,
        gameMetadata.gameDate
      );

      // Check if we have enough history
      if (homeHistory.length < this.config.minGamesForUpdate || 
          awayHistory.length < this.config.minGamesForUpdate) {
        logger.info('Insufficient history for online learning', {
          homeGames: homeHistory.length,
          awayGames: awayHistory.length,
          required: this.config.minGamesForUpdate
        });
        return { updated: false, reason: 'insufficient_history' };
      }

      // Build game representation (input)
      const gameRepresentation = await this.gameRepBuilder.buildFromTeamHistory(
        gameMetadata.homeTeamId,
        gameMetadata.awayTeamId,
        homeHistory,
        awayHistory,
        {
          gameDate: gameMetadata.gameDate,
          isNeutralSite: gameMetadata.isNeutralSite,
          seasonStartDate: new Date(season, 10, 1)
        }
      );

      // Compute actual transition probabilities (target)
      const actualMatrix = this.transitionComputer.computeFromGameData(gameData);
      const actualProbs = this.transitionComputer.matrixToArray(actualMatrix);

      // Generate predicted probabilities
      const predictedProbs = model.forward(gameRepresentation);

      // Calculate prediction error
      const predictionError = model.computeLoss(predictedProbs, actualProbs);

      logger.info('Computed prediction error', {
        gameId: gameMetadata.gameId,
        error: predictionError.toFixed(4)
      });

      // Perform single gradient descent step
      const loss = model.backward(
        gameRepresentation,
        actualProbs,
        this.config.learningRate
      );

      // Save updated model
      await this.saveModel(model, sport, season);

      // Clear model cache
      this.clearModelCache();

      logger.info('Online learning update completed', {
        gameId: gameMetadata.gameId,
        loss: loss.toFixed(4),
        predictionError: predictionError.toFixed(4)
      });

      return {
        updated: true,
        loss,
        predictionError,
        gameId: gameMetadata.gameId
      };

    } catch (error) {
      logger.error('Online learning update failed', {
        gameId: gameMetadata.gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Batch update model from multiple games
   * @param {Array} games - Array of game data objects
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   * @returns {Promise<Object>} - Batch update results
   */
  async batchUpdate(games, sport, season) {
    logger.info('Starting batch online learning update', {
      gamesCount: games.length,
      sport,
      season
    });

    const model = await this.loadModel(sport, season);
    
    let successCount = 0;
    let totalLoss = 0;
    const errors = [];

    for (const game of games) {
      try {
        // Get team histories
        const homeHistory = await this.getTeamHistory(
          game.metadata.homeTeamId,
          season,
          game.metadata.gameDate
        );

        const awayHistory = await this.getTeamHistory(
          game.metadata.awayTeamId,
          season,
          game.metadata.gameDate
        );

        if (homeHistory.length < this.config.minGamesForUpdate || 
            awayHistory.length < this.config.minGamesForUpdate) {
          continue;
        }

        // Build representation
        const gameRepresentation = await this.gameRepBuilder.buildFromTeamHistory(
          game.metadata.homeTeamId,
          game.metadata.awayTeamId,
          homeHistory,
          awayHistory,
          {
            gameDate: game.metadata.gameDate,
            isNeutralSite: game.metadata.isNeutralSite,
            seasonStartDate: new Date(season, 10, 1)
          }
        );

        // Compute actual probabilities
        const actualMatrix = this.transitionComputer.computeFromGameData(game.data);
        const actualProbs = this.transitionComputer.matrixToArray(actualMatrix);

        // Update model
        const loss = model.backward(
          gameRepresentation,
          actualProbs,
          this.config.learningRate
        );

        totalLoss += loss;
        successCount++;

      } catch (error) {
        errors.push({
          gameId: game.metadata.gameId,
          error: error.message
        });
      }
    }

    // Save updated model
    await this.saveModel(model, sport, season);
    this.clearModelCache();

    const avgLoss = successCount > 0 ? totalLoss / successCount : 0;

    logger.info('Batch online learning completed', {
      totalGames: games.length,
      successCount,
      failureCount: errors.length,
      avgLoss: avgLoss.toFixed(4)
    });

    return {
      totalGames: games.length,
      successCount,
      failureCount: errors.length,
      avgLoss,
      errors
    };
  }

  /**
   * Get team game history before a specific date
   * @param {string} teamId - Team ID
   * @param {number} season - Season year
   * @param {Date|string} beforeDate - Date cutoff
   * @returns {Promise<Array>} - Team games
   */
  async getTeamHistory(teamId, season, beforeDate) {
    const allGames = await this.historicalGameRepo.getTeamGameHistory(
      teamId,
      season,
      this.config.maxHistoryGames
    );

    // Filter to only games before the cutoff date
    const cutoff = beforeDate instanceof Date ? beforeDate : new Date(beforeDate);
    
    return allGames.filter(game => {
      const gameDate = game.gameDate instanceof Date ? game.gameDate : new Date(game.gameDate);
      return gameDate < cutoff;
    });
  }

  /**
   * Load model with caching
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   * @returns {Promise<TransitionMatrixMLP>} - Loaded model
   */
  async loadModel(sport, season) {
    const now = Date.now();

    // Check cache
    if (this.modelCache && 
        this.modelCacheTimestamp && 
        (now - this.modelCacheTimestamp) < this.modelCacheTTL) {
      logger.debug('Using cached model');
      return this.modelCache;
    }

    // Load from file
    const filepath = `data/models/transition_mlp_${sport}_${season}.json`;
    const model = new TransitionMatrixMLP();
    
    try {
      await model.loadFromFile(filepath);
      
      // Update cache
      this.modelCache = model;
      this.modelCacheTimestamp = now;
      
      logger.info('Loaded model from file', { filepath });
      return model;
    } catch (error) {
      logger.warn('Failed to load model, creating new one', {
        filepath,
        error: error.message
      });
      
      // Return new model if file doesn't exist
      return new TransitionMatrixMLP();
    }
  }

  /**
   * Save model to file
   * @param {TransitionMatrixMLP} model - Model to save
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   */
  async saveModel(model, sport, season) {
    const filepath = `data/models/transition_mlp_${sport}_${season}.json`;
    await model.saveToFile(filepath);
    logger.info('Saved updated model', { filepath });
  }

  /**
   * Clear model cache
   */
  clearModelCache() {
    this.modelCache = null;
    this.modelCacheTimestamp = null;
    logger.debug('Cleared model cache');
  }

  /**
   * Get prediction for a game without updating
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Object} gameContext - Game context
   * @param {string} sport - Sport identifier
   * @param {number} season - Season year
   * @returns {Promise<Object>} - Predicted transition matrix
   */
  async predict(homeTeamId, awayTeamId, gameContext, sport, season) {
    const model = await this.loadModel(sport, season);

    // Get team histories
    const homeHistory = await this.getTeamHistory(
      homeTeamId,
      season,
      gameContext.gameDate
    );

    const awayHistory = await this.getTeamHistory(
      awayTeamId,
      season,
      gameContext.gameDate
    );

    // Build representation
    const gameRepresentation = await this.gameRepBuilder.buildFromTeamHistory(
      homeTeamId,
      awayTeamId,
      homeHistory,
      awayHistory,
      gameContext
    );

    // Generate prediction
    const predictedProbs = model.forward(gameRepresentation);

    // Convert to matrix format
    const matrix = this.transitionComputer.arrayToMatrix(predictedProbs);

    logger.info('Generated prediction', {
      homeTeamId,
      awayTeamId,
      homeScoreProb: matrix.home.scoreProb.toFixed(3),
      awayScoreProb: matrix.away.scoreProb.toFixed(3)
    });

    return matrix;
  }
}

module.exports = OnlineLearner;
