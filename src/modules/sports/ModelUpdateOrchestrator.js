const logger = require('../../utils/logger');
const TransitionProbabilityComputer = require('./TransitionProbabilityComputer');
const OnlineLearner = require('./OnlineLearner');
const BayesianFeatureUpdater = require('./BayesianFeatureUpdater');

/**
 * Orchestrates all model updates after a game completes
 * Coordinates MLP updates, feature updates, and database persistence
 */
class ModelUpdateOrchestrator {
  constructor(historicalGameRepository, teamRepository, xmlGameParser) {
    this.historicalGameRepo = historicalGameRepository;
    this.teamRepo = teamRepository;
    this.xmlGameParser = xmlGameParser;

    // Initialize components
    this.transitionComputer = new TransitionProbabilityComputer();
    this.onlineLearner = new OnlineLearner(historicalGameRepository);
    this.featureUpdater = new BayesianFeatureUpdater(
      teamRepository,
      this.onlineLearner.featureExtractor
    );

    // Update configuration
    this.config = {
      enableMLPUpdate: true,
      enableFeatureUpdate: true,
      enableRollback: true,
      maxRetries: 3
    };

    // Update metrics
    this.metrics = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      avgUpdateTime: 0
    };
  }

  /**
   * Perform complete model update after game completion
   * @param {string} gameId - Game ID
   * @param {string} xmlData - StatBroadcast XML data
   * @param {Object} gameMetadata - Game metadata
   * @returns {Promise<Object>} - Update results
   */
  async updateFromCompletedGame(gameId, xmlData, gameMetadata) {
    const startTime = Date.now();

    logger.info('Starting model update orchestration', {
      gameId,
      homeTeamId: gameMetadata.homeTeamId,
      awayTeamId: gameMetadata.awayTeamId,
      sport: gameMetadata.sport
    });

    const updateState = {
      gameId,
      steps: [],
      success: false,
      error: null
    };

    try {
      // Step 1: Parse game XML and compute actual transition probabilities
      logger.info('Step 1: Computing actual transition probabilities');
      const gameData = await this.xmlGameParser.parseGameXML(xmlData);
      const actualMatrix = this.transitionComputer.computeFromGameData(gameData);
      
      updateState.steps.push({
        step: 'compute_probabilities',
        success: true,
        timestamp: Date.now()
      });

      // Step 2: Update MLP weights (online learning)
      if (this.config.enableMLPUpdate) {
        logger.info('Step 2: Updating MLP weights');
        
        const mlpUpdate = await this.onlineLearner.updateFromGame(
          gameData,
          gameMetadata,
          gameMetadata.sport,
          gameMetadata.season
        );

        updateState.steps.push({
          step: 'update_mlp',
          success: mlpUpdate.updated,
          loss: mlpUpdate.loss,
          predictionError: mlpUpdate.predictionError,
          timestamp: Date.now()
        });
      }

      // Step 3: Update team feature vectors
      if (this.config.enableFeatureUpdate) {
        logger.info('Step 3: Updating team feature vectors');

        // Extract actual and predicted statistics
        const actualStats = this.extractGameStatistics(gameData);
        const predictedStats = this.extractPredictedStatistics(actualMatrix);

        const featureUpdate = await this.featureUpdater.updateFromGame(
          gameMetadata.homeTeamId,
          gameMetadata.awayTeamId,
          actualStats,
          predictedStats,
          gameMetadata.sport
        );

        updateState.steps.push({
          step: 'update_features',
          success: true,
          homeChange: featureUpdate.home.avgChange,
          awayChange: featureUpdate.away.avgChange,
          timestamp: Date.now()
        });
      }

      // Step 4: Save update metrics
      logger.info('Step 4: Saving update metrics');
      await this.saveUpdateMetrics(gameId, updateState, actualMatrix);

      updateState.steps.push({
        step: 'save_metrics',
        success: true,
        timestamp: Date.now()
      });

      // Mark as successful
      updateState.success = true;
      this.metrics.successfulUpdates++;

      const duration = Date.now() - startTime;
      this.updateAverageTime(duration);

      logger.info('Model update orchestration completed', {
        gameId,
        duration: `${duration}ms`,
        steps: updateState.steps.length
      });

      return updateState;

    } catch (error) {
      logger.error('Model update orchestration failed', {
        gameId,
        error: error.message,
        stack: error.stack
      });

      updateState.success = false;
      updateState.error = error.message;
      this.metrics.failedUpdates++;

      // Attempt rollback if enabled
      if (this.config.enableRollback) {
        await this.rollbackUpdates(updateState);
      }

      throw error;
    } finally {
      this.metrics.totalUpdates++;
    }
  }

  /**
   * Batch update from multiple completed games
   * @param {Array} games - Array of game objects with XML data
   * @returns {Promise<Object>} - Batch update results
   */
  async batchUpdateFromGames(games) {
    logger.info('Starting batch model update', {
      gamesCount: games.length
    });

    const results = {
      total: games.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const game of games) {
      try {
        await this.updateFromCompletedGame(
          game.gameId,
          game.xmlData,
          game.metadata
        );
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          gameId: game.gameId,
          error: error.message
        });
      }
    }

    logger.info('Batch model update completed', {
      total: results.total,
      successful: results.successful,
      failed: results.failed
    });

    return results;
  }

  /**
   * Extract game statistics from parsed game data
   * @param {Object} gameData - Parsed game data
   * @returns {Object} - Game statistics
   */
  extractGameStatistics(gameData) {
    const { home, visitor } = gameData.teams;

    return {
      home: {
        score: home.score,
        possessions: home.advancedMetrics.possessionCount || 70,
        effectiveFieldGoalPct: home.derivedMetrics.effectiveFgPct / 100,
        turnovers: home.stats.turnovers,
        rebounds: home.stats.rebounds
      },
      away: {
        score: visitor.score,
        possessions: visitor.advancedMetrics.possessionCount || 70,
        effectiveFieldGoalPct: visitor.derivedMetrics.effectiveFgPct / 100,
        turnovers: visitor.stats.turnovers,
        rebounds: visitor.stats.rebounds
      }
    };
  }

  /**
   * Extract predicted statistics from transition matrix
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Predicted statistics
   */
  extractPredictedStatistics(matrix) {
    return {
      home: {
        expectedPoints: matrix.home.expectedPoints,
        scoreProb: matrix.home.scoreProb,
        possessions: matrix.possessions
      },
      away: {
        expectedPoints: matrix.away.expectedPoints,
        scoreProb: matrix.away.scoreProb,
        possessions: matrix.possessions
      }
    };
  }

  /**
   * Save update metrics to database or log
   * @param {string} gameId - Game ID
   * @param {Object} updateState - Update state
   * @param {Object} actualMatrix - Actual transition matrix
   */
  async saveUpdateMetrics(gameId, updateState, actualMatrix) {
    // Log metrics for monitoring
    logger.info('Update metrics', {
      gameId,
      steps: updateState.steps.length,
      success: updateState.success,
      homeScoreProb: actualMatrix.home.scoreProb.toFixed(3),
      awayScoreProb: actualMatrix.away.scoreProb.toFixed(3)
    });

    // In production, this would save to a metrics database
    // For now, we just log
  }

  /**
   * Rollback updates in case of failure
   * @param {Object} updateState - Update state
   */
  async rollbackUpdates(updateState) {
    logger.warn('Attempting to rollback updates', {
      gameId: updateState.gameId,
      completedSteps: updateState.steps.length
    });

    // In production, this would restore previous model state
    // For now, we just log the rollback attempt
    
    for (const step of updateState.steps.reverse()) {
      if (step.success) {
        logger.info('Would rollback step', {
          step: step.step,
          timestamp: step.timestamp
        });
      }
    }
  }

  /**
   * Update average update time metric
   * @param {number} duration - Update duration in ms
   */
  updateAverageTime(duration) {
    const total = this.metrics.avgUpdateTime * (this.metrics.totalUpdates - 1);
    this.metrics.avgUpdateTime = (total + duration) / this.metrics.totalUpdates;
  }

  /**
   * Get update metrics
   * @returns {Object} - Metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalUpdates > 0
        ? (this.metrics.successfulUpdates / this.metrics.totalUpdates) * 100
        : 0
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      avgUpdateTime: 0
    };
    logger.info('Reset update metrics');
  }

  /**
   * Configure orchestrator
   * @param {Object} config - Configuration options
   */
  configure(config) {
    this.config = { ...this.config, ...config };
    logger.info('Updated orchestrator configuration', this.config);
  }

  /**
   * Health check for orchestrator components
   * @returns {Promise<Object>} - Health status
   */
  async healthCheck() {
    const health = {
      orchestrator: 'healthy',
      components: {}
    };

    try {
      // Check if components are initialized
      health.components.transitionComputer = this.transitionComputer ? 'healthy' : 'missing';
      health.components.onlineLearner = this.onlineLearner ? 'healthy' : 'missing';
      health.components.featureUpdater = this.featureUpdater ? 'healthy' : 'missing';

      // Check database connections
      const testTeam = await this.teamRepo.getTeamByEspnId('test');
      health.components.teamRepository = 'healthy';

    } catch (error) {
      health.orchestrator = 'unhealthy';
      health.error = error.message;
    }

    return health;
  }
}

module.exports = ModelUpdateOrchestrator;
