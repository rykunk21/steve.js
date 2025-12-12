const VAEFeatureExtractor = require('./VAEFeatureExtractor');
const VariationalAutoencoder = require('./VariationalAutoencoder');
const TransitionProbabilityNN = require('./TransitionProbabilityNN');
const VAEFeedbackTrainer = require('./VAEFeedbackTrainer');
const BayesianTeamUpdater = require('./BayesianTeamUpdater');
const TeamRepository = require('../../database/repositories/TeamRepository');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');

/**
 * Post-Game Update Pipeline
 * 
 * Handles completed games for continuous online learning:
 * 1. Fetch actual game XML after completion
 * 2. Extract actual transition probabilities from play-by-play
 * 3. Calculate NN prediction error vs actual outcomes
 * 4. Update NN weights using small learning rate (avoid catastrophic forgetting)
 * 5. Update VAE encoder if NN performance was poor (decaying α)
 * 6. Bayesian update team latent distributions based on observed performance
 */
class PostGameUpdater {
  constructor(options = {}) {
    // Initialize components
    this.featureExtractor = new VAEFeatureExtractor();
    this.vae = new VariationalAutoencoder(88, 16); // 88-dim input, 16-dim latent
    this.transitionNN = new TransitionProbabilityNN(10); // 10-dim game context
    this.teamRepository = new TeamRepository();
    
    // Initialize training components with conservative parameters for post-game updates
    this.feedbackTrainer = new VAEFeedbackTrainer(this.vae, this.transitionNN, {
      feedbackThreshold: options.feedbackThreshold || 0.7, // Higher threshold for post-game
      initialAlpha: options.initialAlpha || 0.05, // Lower alpha for stability
      alphaDecayRate: options.alphaDecayRate || 0.995, // Slower decay
      minAlpha: options.minAlpha || 0.001
    });
    
    this.bayesianUpdater = new BayesianTeamUpdater(this.teamRepository, {
      initialUncertainty: options.initialUncertainty || 1.0,
      minUncertainty: options.minUncertainty || 0.1,
      uncertaintyDecayRate: options.uncertaintyDecayRate || 0.98, // Slower decay for post-game
      learningRate: options.learningRate || 0.05 // Smaller learning rate for stability
    });

    // Post-game specific parameters
    this.postGameLearningRate = options.postGameLearningRate || 0.0001; // Very small for catastrophic forgetting prevention
    this.maxUpdateAttempts = options.maxUpdateAttempts || 3;
    this.updateTimeout = options.updateTimeout || 30000; // 30 seconds timeout
    
    // Performance tracking
    this.updateStats = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      averageUpdateTime: 0,
      totalUpdateTime: 0,
      modelImprovements: 0,
      modelDegradations: 0,
      errors: []
    };

    logger.info('Initialized PostGameUpdater', {
      feedbackThreshold: this.feedbackTrainer.feedbackThreshold,
      postGameLearningRate: this.postGameLearningRate,
      maxUpdateAttempts: this.maxUpdateAttempts
    });
  }

  /**
   * Process a completed game for post-game learning
   * @param {string} gameId - StatBroadcast game ID
   * @param {Object} preGamePrediction - Prediction made before the game (optional)
   * @returns {Promise<Object>} - Update results
   */
  async processCompletedGame(gameId, preGamePrediction = null) {
    const startTime = Date.now();
    let attempt = 0;

    while (attempt < this.maxUpdateAttempts) {
      attempt++;
      
      try {
        logger.info('Processing completed game for post-game learning', {
          gameId,
          attempt,
          maxAttempts: this.maxUpdateAttempts
        });

        // Step 1: Fetch actual game XML after completion
        const gameData = await this.fetchCompletedGameData(gameId);
        
        if (!gameData) {
          throw new Error(`Failed to fetch completed game data for ${gameId}`);
        }

        // Step 2: Extract actual transition probabilities from play-by-play
        const actualTransitionProbs = this.extractActualTransitionProbabilities(gameData);
        
        // Step 3: Get current team distributions and make fresh prediction
        const currentPrediction = await this.makeFreshPrediction(gameData);
        
        // Step 4: Calculate prediction error vs actual outcomes
        const predictionError = this.calculatePredictionError(
          currentPrediction.transitionProbabilities,
          actualTransitionProbs
        );

        // Step 5: Determine if model update is needed
        const shouldUpdate = this.shouldUpdateModel(predictionError, preGamePrediction);
        
        let updateResults = {
          gameId,
          gameData: {
            homeTeam: gameData.teams.home.name,
            awayTeam: gameData.teams.visitor.name,
            homeScore: gameData.teams.home.score,
            awayScore: gameData.teams.visitor.score,
            gameDate: gameData.metadata.date
          },
          predictionError,
          shouldUpdate,
          modelUpdated: false,
          bayesianUpdated: false,
          processingTime: 0
        };

        if (shouldUpdate) {
          // Step 6: Update models with small learning rate
          const modelUpdateResult = await this.updateModelsPostGame(
            gameData,
            actualTransitionProbs,
            currentPrediction
          );
          
          // Step 7: Bayesian update team distributions
          const bayesianUpdateResult = await this.updateTeamDistributions(
            gameData,
            currentPrediction.teamRepresentations
          );

          updateResults.modelUpdated = modelUpdateResult.success;
          updateResults.bayesianUpdated = bayesianUpdateResult.success;
          updateResults.modelUpdateDetails = modelUpdateResult;
          updateResults.bayesianUpdateDetails = bayesianUpdateResult;
        }

        // Step 8: Record update statistics
        const processingTime = Date.now() - startTime;
        updateResults.processingTime = processingTime;
        
        this.recordUpdateStats(updateResults, processingTime);

        logger.info('Post-game update completed', {
          gameId,
          attempt,
          processingTime,
          modelUpdated: updateResults.modelUpdated,
          bayesianUpdated: updateResults.bayesianUpdated,
          predictionError: predictionError.totalError.toFixed(6)
        });

        return updateResults;

      } catch (error) {
        logger.warn('Post-game update attempt failed', {
          gameId,
          attempt,
          maxAttempts: this.maxUpdateAttempts,
          error: error.message
        });

        if (attempt >= this.maxUpdateAttempts) {
          // All attempts failed
          const processingTime = Date.now() - startTime;
          this.updateStats.failedUpdates++;
          this.updateStats.errors.push({
            gameId,
            error: error.message,
            timestamp: new Date().toISOString(),
            attempts: attempt
          });

          logger.error('Post-game update failed after all attempts', {
            gameId,
            attempts: attempt,
            error: error.message
          });

          throw error;
        }

        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Fetch completed game data from StatBroadcast XML
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<Object>} - Parsed game data
   */
  async fetchCompletedGameData(gameId) {
    try {
      // Use existing feature extractor to get game data
      const gameData = await this.featureExtractor.processGame(gameId);
      
      // Validate that the game is actually completed
      if (!this.isGameCompleted(gameData)) {
        throw new Error(`Game ${gameId} is not yet completed`);
      }

      return gameData;

    } catch (error) {
      logger.error('Failed to fetch completed game data', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if a game is completed based on game data
   * @param {Object} gameData - Parsed game data
   * @returns {boolean} - Whether the game is completed
   */
  isGameCompleted(gameData) {
    // Check if we have final scores
    const homeScore = gameData.teams?.home?.score;
    const awayScore = gameData.teams?.visitor?.score;
    
    if (typeof homeScore !== 'number' || typeof awayScore !== 'number') {
      return false;
    }

    // Check if scores are reasonable (both teams scored)
    if (homeScore <= 0 && awayScore <= 0) {
      return false;
    }

    // Check if we have play-by-play data (indicates game was played)
    const hasPlayByPlay = gameData.playByPlay && gameData.playByPlay.length > 0;
    
    return hasPlayByPlay;
  }

  /**
   * Extract actual transition probabilities from completed game data
   * @param {Object} gameData - Parsed game data
   * @returns {Object} - Actual transition probabilities for both teams
   */
  extractActualTransitionProbabilities(gameData) {
    // Use existing transition probabilities computed by feature extractor
    return {
      home: gameData.transitionProbabilities.home,
      away: gameData.transitionProbabilities.visitor
    };
  }

  /**
   * Make a fresh prediction using current model state
   * @param {Object} gameData - Game data
   * @returns {Promise<Object>} - Fresh prediction results
   */
  async makeFreshPrediction(gameData) {
    try {
      // Get current team distributions
      const homeTeamId = await this.getTeamIdFromGameData(gameData, 'home');
      const awayTeamId = await this.getTeamIdFromGameData(gameData, 'away');
      
      const homeTeamDistribution = await this.bayesianUpdater.getTeamDistribution(homeTeamId);
      const awayTeamDistribution = await this.bayesianUpdater.getTeamDistribution(awayTeamId);

      if (!homeTeamDistribution || !awayTeamDistribution) {
        throw new Error('Team distributions not found for prediction');
      }

      // VAE encode game features to team latent representations
      const homeLatent = this.vae.encodeGameToTeamDistribution(
        this.convertFeaturesToArray(gameData.features.home)
      );
      const awayLatent = this.vae.encodeGameToTeamDistribution(
        this.convertFeaturesToArray(gameData.features.visitor)
      );

      // Build game context features
      const gameContext = this.buildGameContext(gameData.metadata);

      // NN predict transition probabilities
      const homeTransitionPred = this.transitionNN.predict(
        homeLatent.mu, homeLatent.sigma,
        awayLatent.mu, awayLatent.sigma,
        gameContext
      );
      
      const awayTransitionPred = this.transitionNN.predict(
        awayLatent.mu, awayLatent.sigma,
        homeLatent.mu, homeLatent.sigma,
        gameContext
      );

      return {
        teamRepresentations: {
          home: { id: homeTeamId, latent: homeLatent, distribution: homeTeamDistribution },
          away: { id: awayTeamId, latent: awayLatent, distribution: awayTeamDistribution }
        },
        transitionProbabilities: {
          home: homeTransitionPred,
          away: awayTransitionPred
        },
        gameContext
      };

    } catch (error) {
      logger.error('Failed to make fresh prediction', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calculate prediction error between predicted and actual transition probabilities
   * @param {Object} predicted - Predicted transition probabilities
   * @param {Object} actual - Actual transition probabilities
   * @returns {Object} - Error metrics
   */
  calculatePredictionError(predicted, actual) {
    const homeError = this.calculateTransitionError(predicted.home, actual.home);
    const awayError = this.calculateTransitionError(predicted.away, actual.away);
    
    return {
      home: homeError,
      away: awayError,
      totalError: (homeError.crossEntropyLoss + awayError.crossEntropyLoss) / 2,
      maxError: Math.max(homeError.crossEntropyLoss, awayError.crossEntropyLoss)
    };
  }

  /**
   * Calculate error metrics for a single team's transition probabilities
   * @param {Object} predicted - Predicted probabilities
   * @param {Object} actual - Actual probabilities
   * @returns {Object} - Error metrics
   */
  calculateTransitionError(predicted, actual) {
    // Convert to arrays for calculation
    const predArray = this.convertTransitionProbsToArray(predicted);
    const actualArray = this.convertTransitionProbsToArray(actual);
    
    // Calculate cross-entropy loss
    const crossEntropyLoss = this.transitionNN.computeLoss(predArray, actualArray);
    
    // Calculate mean absolute error
    let mae = 0;
    for (let i = 0; i < predArray.length; i++) {
      mae += Math.abs(predArray[i] - actualArray[i]);
    }
    mae /= predArray.length;
    
    // Calculate mean squared error
    let mse = 0;
    for (let i = 0; i < predArray.length; i++) {
      mse += Math.pow(predArray[i] - actualArray[i], 2);
    }
    mse /= predArray.length;

    return {
      crossEntropyLoss,
      meanAbsoluteError: mae,
      meanSquaredError: mse,
      predicted: predArray,
      actual: actualArray
    };
  }

  /**
   * Determine if model should be updated based on prediction error
   * @param {Object} predictionError - Prediction error metrics
   * @param {Object} preGamePrediction - Pre-game prediction (optional)
   * @returns {boolean} - Whether to update the model
   */
  shouldUpdateModel(predictionError, preGamePrediction = null) {
    // Always update if error is above feedback threshold
    if (predictionError.totalError > this.feedbackTrainer.feedbackThreshold) {
      return true;
    }

    // If we have pre-game prediction, compare performance
    if (preGamePrediction && preGamePrediction.error) {
      // Update if current model is significantly worse than pre-game
      const errorIncrease = predictionError.totalError - preGamePrediction.error;
      if (errorIncrease > 0.1) { // 10% increase threshold
        return true;
      }
    }

    // Update if maximum error for either team is very high
    if (predictionError.maxError > 1.0) {
      return true;
    }

    return false;
  }

  /**
   * Update VAE-NN models with post-game data using small learning rate
   * @param {Object} gameData - Game data
   * @param {Object} actualTransitionProbs - Actual transition probabilities
   * @param {Object} currentPrediction - Current prediction results
   * @returns {Promise<Object>} - Update results
   */
  async updateModelsPostGame(gameData, actualTransitionProbs, currentPrediction) {
    try {
      logger.debug('Updating models with post-game data');

      // Get pre-update performance baseline
      const preUpdateError = this.calculatePredictionError(
        currentPrediction.transitionProbabilities,
        actualTransitionProbs
      );

      // Train VAE-NN system with feedback loop using conservative parameters
      const homeTrainingResult = await this.feedbackTrainer.trainOnGame(
        this.convertFeaturesToArray(gameData.features.home),
        this.convertTransitionProbsToArray(actualTransitionProbs.home),
        currentPrediction.teamRepresentations.home.latent.mu,
        currentPrediction.teamRepresentations.home.latent.sigma,
        currentPrediction.teamRepresentations.away.latent.mu,
        currentPrediction.teamRepresentations.away.latent.sigma,
        currentPrediction.gameContext
      );

      const awayTrainingResult = await this.feedbackTrainer.trainOnGame(
        this.convertFeaturesToArray(gameData.features.visitor),
        this.convertTransitionProbsToArray(actualTransitionProbs.away),
        currentPrediction.teamRepresentations.away.latent.mu,
        currentPrediction.teamRepresentations.away.latent.sigma,
        currentPrediction.teamRepresentations.home.latent.mu,
        currentPrediction.teamRepresentations.home.latent.sigma,
        currentPrediction.gameContext
      );

      // Make post-update prediction to measure improvement
      const postUpdatePrediction = await this.makeFreshPrediction(gameData);
      const postUpdateError = this.calculatePredictionError(
        postUpdatePrediction.transitionProbabilities,
        actualTransitionProbs
      );

      // Determine if update improved performance
      const improved = postUpdateError.totalError < preUpdateError.totalError;
      
      if (improved) {
        this.updateStats.modelImprovements++;
      } else {
        this.updateStats.modelDegradations++;
        logger.warn('Model update did not improve performance', {
          preUpdateError: preUpdateError.totalError.toFixed(6),
          postUpdateError: postUpdateError.totalError.toFixed(6)
        });
      }

      return {
        success: true,
        improved,
        preUpdateError: preUpdateError.totalError,
        postUpdateError: postUpdateError.totalError,
        homeTrainingResult,
        awayTrainingResult,
        feedbackTriggered: homeTrainingResult.feedbackTriggered || awayTrainingResult.feedbackTriggered
      };

    } catch (error) {
      logger.error('Failed to update models post-game', {
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update team latent distributions based on observed game performance
   * @param {Object} gameData - Game data
   * @param {Object} teamRepresentations - Team representations from prediction
   * @returns {Promise<Object>} - Update results
   */
  async updateTeamDistributions(gameData, teamRepresentations) {
    try {
      logger.debug('Updating team distributions with post-game performance');

      // Extract game results
      const homeGameResult = {
        won: gameData.teams.home.score > gameData.teams.visitor.score,
        pointDifferential: gameData.teams.home.score - gameData.teams.visitor.score
      };

      const awayGameResult = {
        won: gameData.teams.visitor.score > gameData.teams.home.score,
        pointDifferential: gameData.teams.visitor.score - gameData.teams.home.score
      };

      // Build game context for Bayesian updater
      const gameContext = {
        isNeutralSite: gameData.metadata.neutralGame === 'Y',
        isPostseason: gameData.metadata.postseason === 'Y',
        gameDate: gameData.metadata.date
      };

      // Update home team distribution
      const homeUpdateResult = await this.bayesianUpdater.updateTeamDistribution(
        teamRepresentations.home.id,
        teamRepresentations.home.latent.mu,
        {
          ...gameContext,
          gameResult: homeGameResult
        },
        teamRepresentations.away.distribution,
        teamRepresentations.home.latent.sigma
      );

      // Update away team distribution
      const awayUpdateResult = await this.bayesianUpdater.updateTeamDistribution(
        teamRepresentations.away.id,
        teamRepresentations.away.latent.mu,
        {
          ...gameContext,
          gameResult: awayGameResult
        },
        teamRepresentations.home.distribution,
        teamRepresentations.away.latent.sigma
      );

      return {
        success: true,
        homeUpdate: homeUpdateResult,
        awayUpdate: awayUpdateResult
      };

    } catch (error) {
      logger.error('Failed to update team distributions', {
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get team ID from game data
   * @param {Object} gameData - Game data
   * @param {string} side - 'home' or 'away'
   * @returns {Promise<string>} - Team ID
   */
  async getTeamIdFromGameData(gameData, side) {
    const teamName = side === 'home' ? gameData.teams.home.name : gameData.teams.visitor.name;
    
    // Try to find team by name in database
    const team = await this.teamRepository.findByName(teamName);
    
    if (team) {
      return team.team_id;
    }

    // If not found, use a normalized name as ID (fallback)
    return teamName.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Convert feature object to array for VAE input (same as OnlineLearningOrchestrator)
   * @param {Object} features - Feature object
   * @returns {Array} - Feature array [88]
   */
  convertFeaturesToArray(features) {
    // Convert feature object to ordered array (88 dimensions total)
    return [
      // Basic shooting stats (9)
      features.fgm || 0, features.fga || 0, features.fgPct || 0,
      features.fg3m || 0, features.fg3a || 0, features.fg3Pct || 0,
      features.ftm || 0, features.fta || 0, features.ftPct || 0,
      
      // Rebounding stats (3)
      features.rebounds || 0, features.offensiveRebounds || 0, features.defensiveRebounds || 0,
      
      // Other basic stats (7)
      features.assists || 0, features.turnovers || 0, features.steals || 0,
      features.blocks || 0, features.personalFouls || 0, features.technicalFouls || 0,
      features.points || 0,
      
      // Advanced metrics (10)
      features.pointsInPaint || 0, features.fastBreakPoints || 0, features.secondChancePoints || 0,
      features.pointsOffTurnovers || 0, features.benchPoints || 0, features.possessionCount || 0,
      features.ties || 0, features.leads || 0, features.largestLead || 0, features.biggestRun || 0,
      
      // Derived metrics (3)
      features.effectiveFgPct || 0, features.trueShootingPct || 0, features.turnoverRate || 0,
      
      // Player-level features (20)
      features.avgPlayerMinutes || 0, features.avgPlayerPlusMinus || 0, features.avgPlayerEfficiency || 0,
      features.topPlayerMinutes || 0, features.topPlayerPoints || 0, features.topPlayerRebounds || 0,
      features.topPlayerAssists || 0, features.playersUsed || 0, features.starterMinutes || 0,
      features.benchMinutes || 0, features.benchContribution || 0, features.starterEfficiency || 0,
      features.benchEfficiency || 0, features.depthScore || 0, features.minuteDistribution || 0,
      features.topPlayerUsage || 0, features.balanceScore || 0, features.clutchPerformance || 0,
      features.experienceLevel || 0, features.versatilityScore || 0,
      
      // Lineup features (15)
      features.startingLineupMinutes || 0, features.startingLineupPoints || 0, features.startingLineupEfficiency || 0,
      features.benchContribution || 0, features.benchMinutes || 0, features.benchPoints || 0,
      features.rotationDepth || 0, features.minutesDistribution || 0, features.lineupBalance || 0,
      features.substitutionRate || 0, features.depthUtilization || 0, features.starterDominance || 0,
      features.lineupVersatility || 0, features.benchImpact || 0, features.rotationEfficiency || 0,
      
      // Context features (8)
      features.isNeutralSite || 0, features.isPostseason || 0, features.gameLength || 0,
      features.paceOfPlay || 0, features.competitiveBalance || 0, features.gameFlow || 0,
      features.intensityLevel || 0, features.gameContext || 0,
      
      // Shooting distribution features (8)
      features.twoPointAttemptRate || 0, features.threePointAttemptRate || 0, features.freeThrowRate || 0,
      features.twoPointAccuracy || 0, features.threePointAccuracy || 0, features.freeThrowAccuracy || 0,
      features.shotSelection || 0, features.shootingEfficiency || 0,
      
      // Defensive features (5)
      features.opponentFgPctAllowed || 0, features.opponentFg3PctAllowed || 0,
      features.defensiveReboundingPct || 0, features.pointsInPaintAllowed || 0,
      features.defensiveEfficiency || 0
    ];
  }

  /**
   * Convert transition probabilities object to array for NN training
   * @param {Object} transitionProbs - Transition probabilities object
   * @returns {Array} - Probability array [8]
   */
  convertTransitionProbsToArray(transitionProbs) {
    return [
      transitionProbs.twoPointMakeProb || 0,
      transitionProbs.twoPointMissProb || 0,
      transitionProbs.threePointMakeProb || 0,
      transitionProbs.threePointMissProb || 0,
      transitionProbs.freeThrowMakeProb || 0,
      transitionProbs.freeThrowMissProb || 0,
      transitionProbs.offensiveReboundProb || 0,
      transitionProbs.turnoverProb || 0
    ];
  }

  /**
   * Build game context features for NN input
   * @param {Object} metadata - Game metadata
   * @returns {Array} - Game context array [10]
   */
  buildGameContext(metadata) {
    return [
      metadata.neutralGame === 'Y' ? 1 : 0, // Neutral site
      metadata.postseason === 'Y' ? 1 : 0,  // Postseason
      0, // Rest days (not available in current data)
      0, // Travel distance (not available)
      0, // Conference game (not available)
      0, // Rivalry game (not available)
      0, // TV game (not available)
      0, // Time of day (not available)
      0, // Day of week (not available)
      0  // Season progress (not available)
    ];
  }

  /**
   * Record update statistics
   * @param {Object} updateResult - Update result
   * @param {number} processingTime - Processing time in ms
   */
  recordUpdateStats(updateResult, processingTime) {
    this.updateStats.totalUpdates++;
    
    if (updateResult.modelUpdated || updateResult.bayesianUpdated) {
      this.updateStats.successfulUpdates++;
    }
    
    this.updateStats.totalUpdateTime += processingTime;
    this.updateStats.averageUpdateTime = this.updateStats.totalUpdateTime / this.updateStats.totalUpdates;
  }

  /**
   * Get update statistics
   * @returns {Object} - Update statistics
   */
  getUpdateStats() {
    return {
      ...this.updateStats,
      successRate: this.updateStats.totalUpdates > 0 
        ? (this.updateStats.successfulUpdates / this.updateStats.totalUpdates) * 100 
        : 0,
      improvementRate: this.updateStats.totalUpdates > 0
        ? (this.updateStats.modelImprovements / this.updateStats.totalUpdates) * 100
        : 0
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.updateStats = {
      totalUpdates: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      averageUpdateTime: 0,
      totalUpdateTime: 0,
      modelImprovements: 0,
      modelDegradations: 0,
      errors: []
    };
    
    logger.debug('PostGameUpdater statistics reset');
  }

  /**
   * Close resources
   * @returns {Promise<void>}
   */
  async close() {
    try {
      await this.featureExtractor.close();
      logger.info('PostGameUpdater resources closed');
    } catch (error) {
      logger.error('Error closing PostGameUpdater resources', {
        error: error.message
      });
    }
  }
}

module.exports = PostGameUpdater;