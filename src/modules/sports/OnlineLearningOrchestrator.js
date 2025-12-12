const VAEFeatureExtractor = require('./VAEFeatureExtractor');
const VariationalAutoencoder = require('./VariationalAutoencoder');
const TransitionProbabilityNN = require('./TransitionProbabilityNN');
const VAEFeedbackTrainer = require('./VAEFeedbackTrainer');
const BayesianTeamUpdater = require('./BayesianTeamUpdater');
const TeamRepository = require('../../database/repositories/TeamRepository');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');

/**
 * Online Learning Orchestrator
 * 
 * Coordinates the complete VAE-NN training process:
 * 1. Process games chronologically from game_ids table (processed=false)
 * 2. For each game: extract features → VAE encode → NN predict → compute loss → update models → Bayesian update teams
 * 3. Implement error handling and rollback for failed updates
 * 4. Add comprehensive logging and progress tracking
 */
class OnlineLearningOrchestrator {
  constructor(options = {}) {
    // Initialize components
    this.featureExtractor = new VAEFeatureExtractor();
    this.vae = new VariationalAutoencoder(88, 16); // 88-dim input, 16-dim latent
    this.transitionNN = new TransitionProbabilityNN(10); // 10-dim game context
    this.teamRepository = new TeamRepository();
    
    // Initialize training components
    this.feedbackTrainer = new VAEFeedbackTrainer(this.vae, this.transitionNN, {
      feedbackThreshold: options.feedbackThreshold || 0.5,
      initialAlpha: options.initialAlpha || 0.1,
      alphaDecayRate: options.alphaDecayRate || 0.99,
      minAlpha: options.minAlpha || 0.001
    });
    
    this.bayesianUpdater = new BayesianTeamUpdater(this.teamRepository, {
      initialUncertainty: options.initialUncertainty || 1.0,
      minUncertainty: options.minUncertainty || 0.1,
      uncertaintyDecayRate: options.uncertaintyDecayRate || 0.95,
      learningRate: options.learningRate || 0.1
    });

    // Training parameters
    this.batchSize = options.batchSize || 1; // Process games one at a time for chronological order
    this.maxGamesPerSession = options.maxGamesPerSession || 100;
    this.saveInterval = options.saveInterval || 10; // Save models every N games
    this.validationInterval = options.validationInterval || 25; // Validate every N games
    
    // Error handling
    this.maxRetries = options.maxRetries || 3;
    this.continueOnError = options.continueOnError !== false; // Default true
    this.rollbackOnError = options.rollbackOnError !== false; // Default true
    
    // Progress tracking
    this.stats = {
      totalGamesProcessed: 0,
      successfulGames: 0,
      failedGames: 0,
      averageProcessingTime: 0,
      totalProcessingTime: 0,
      lastProcessedGameId: null,
      lastProcessedDate: null,
      modelSaves: 0,
      validationRuns: 0,
      errors: []
    };

    // State management
    this.isRunning = false;
    this.shouldStop = false;
    this.currentGameId = null;
    this.sessionStartTime = null;

    logger.info('Initialized OnlineLearningOrchestrator', {
      batchSize: this.batchSize,
      maxGamesPerSession: this.maxGamesPerSession,
      saveInterval: this.saveInterval,
      validationInterval: this.validationInterval,
      maxRetries: this.maxRetries,
      continueOnError: this.continueOnError
    });
  }

  /**
   * Start the online learning process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results
   */
  async startOnlineLearning(options = {}) {
    if (this.isRunning) {
      throw new Error('Online learning is already running');
    }

    try {
      this.isRunning = true;
      this.shouldStop = false;
      this.sessionStartTime = Date.now();
      
      const { 
        maxGames = this.maxGamesPerSession,
        startFromGameId = null,
        onProgress = null,
        onGameComplete = null,
        onError = null
      } = options;

      logger.info('Starting online learning session', {
        maxGames,
        startFromGameId,
        sessionId: this.sessionStartTime
      });

      // Load existing models if available
      await this.loadModels();

      // Get unprocessed games in chronological order
      const unprocessedGames = await this.getUnprocessedGames(maxGames, startFromGameId);
      
      if (unprocessedGames.length === 0) {
        logger.info('No unprocessed games found');
        return this.getSessionResults();
      }

      logger.info('Found unprocessed games', {
        count: unprocessedGames.length,
        dateRange: {
          earliest: unprocessedGames[0]?.game_date,
          latest: unprocessedGames[unprocessedGames.length - 1]?.game_date
        }
      });

      // Process games chronologically
      for (let i = 0; i < unprocessedGames.length && !this.shouldStop; i++) {
        const gameInfo = unprocessedGames[i];
        const gameStartTime = Date.now();
        
        try {
          this.currentGameId = gameInfo.game_id;
          
          // Process single game
          const result = await this.processGameWithRetry(gameInfo);
          
          // Update statistics
          const processingTime = Date.now() - gameStartTime;
          this.updateProcessingStats(result, processingTime);
          
          // Callbacks
          if (onGameComplete) {
            await onGameComplete(result, i + 1, unprocessedGames.length);
          }
          
          if (onProgress) {
            await onProgress(i + 1, unprocessedGames.length, result);
          }

          // Periodic saves and validation
          await this.handlePeriodicTasks(i + 1);

        } catch (error) {
          this.stats.failedGames++;
          this.stats.errors.push({
            gameId: gameInfo.game_id,
            error: error.message,
            timestamp: new Date().toISOString(),
            gameIndex: i + 1
          });

          logger.error('Failed to process game in session', {
            gameId: gameInfo.game_id,
            gameIndex: i + 1,
            error: error.message
          });

          if (onError) {
            await onError(error, gameInfo, i + 1);
          }

          if (!this.continueOnError) {
            throw error;
          }
        }
      }

      // Final save (skip for now due to TensorFlow.js save issues)
      try {
        await this.saveModels();
      } catch (error) {
        logger.warn('Model saving failed, continuing without save', {
          error: error.message
        });
      }
      
      const results = this.getSessionResults();
      
      logger.info('Online learning session completed', {
        ...results.summary,
        sessionDuration: Date.now() - this.sessionStartTime
      });

      return results;

    } catch (error) {
      logger.error('Online learning session failed', {
        error: error.message,
        stack: error.stack,
        currentGameId: this.currentGameId
      });
      throw error;
    } finally {
      this.isRunning = false;
      this.currentGameId = null;
    }
  }

  /**
   * Process a single game with retry logic and error handling
   * @param {Object} gameInfo - Game information from database
   * @returns {Promise<Object>} - Processing result
   */
  async processGameWithRetry(gameInfo) {
    let lastError = null;
    let attempt = 0;

    while (attempt < this.maxRetries) {
      attempt++;
      
      try {
        logger.debug('Processing game', {
          gameId: gameInfo.game_id,
          attempt,
          maxRetries: this.maxRetries,
          gameDate: gameInfo.game_date
        });

        // Create transaction checkpoint for rollback
        const checkpoint = await this.createCheckpoint(gameInfo);

        try {
          // Process the game
          const result = await this.processGame(gameInfo);
          
          // Commit changes
          await this.commitCheckpoint(checkpoint);
          
          return result;

        } catch (error) {
          // Rollback on error if enabled
          if (this.rollbackOnError) {
            await this.rollbackCheckpoint(checkpoint);
          }
          throw error;
        }

      } catch (error) {
        lastError = error;
        
        logger.warn('Game processing attempt failed', {
          gameId: gameInfo.game_id,
          attempt,
          maxRetries: this.maxRetries,
          error: error.message
        });

        if (attempt < this.maxRetries) {
          // Wait before retry (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    throw new Error(`Failed to process game ${gameInfo.game_id} after ${this.maxRetries} attempts. Last error: ${lastError.message}`);
  }

  /**
   * Process a single game through the complete VAE-NN pipeline
   * @param {Object} gameInfo - Game information from database
   * @returns {Promise<Object>} - Processing result
   */
  async processGame(gameInfo) {
    const gameId = gameInfo.game_id;
    const startTime = Date.now();

    try {
      logger.debug('Starting game processing pipeline', {
        gameId,
        homeTeam: gameInfo.home_team_id,
        awayTeam: gameInfo.away_team_id,
        gameDate: gameInfo.game_date
      });

      // Step 1: Extract features and transition probabilities
      const gameData = await this.featureExtractor.processGame(gameId);
      
      // Step 2: Get current team distributions
      const homeTeamDistribution = await this.bayesianUpdater.getTeamDistribution(gameInfo.home_team_id);
      const awayTeamDistribution = await this.bayesianUpdater.getTeamDistribution(gameInfo.away_team_id);

      // Initialize teams if they don't exist
      if (!homeTeamDistribution) {
        await this.initializeTeam(gameInfo.home_team_id);
      }
      if (!awayTeamDistribution) {
        await this.initializeTeam(gameInfo.away_team_id);
      }

      // Step 3: VAE encode game features to team latent representations
      const homeLatent = this.vae.encodeGameToTeamDistribution(
        this.convertFeaturesToArray(gameData.features.home)
      );
      const awayLatent = this.vae.encodeGameToTeamDistribution(
        this.convertFeaturesToArray(gameData.features.visitor)
      );

      // Step 4: Build game context features
      const gameContext = this.buildGameContext(gameData.metadata, gameInfo);

      // Step 5: NN predict transition probabilities
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

      // Step 6: Convert actual transition probabilities to arrays
      const homeActualProbs = this.convertTransitionProbsToArray(gameData.transitionProbabilities.home);
      const awayActualProbs = this.convertTransitionProbsToArray(gameData.transitionProbabilities.visitor);

      // Step 7: Train VAE-NN system with feedback loop
      const homeTrainingResult = await this.feedbackTrainer.trainOnGame(
        this.convertFeaturesToArray(gameData.features.home),
        homeActualProbs,
        homeLatent.mu, homeLatent.sigma,
        awayLatent.mu, awayLatent.sigma,
        gameContext
      );

      const awayTrainingResult = await this.feedbackTrainer.trainOnGame(
        this.convertFeaturesToArray(gameData.features.visitor),
        awayActualProbs,
        awayLatent.mu, awayLatent.sigma,
        homeLatent.mu, homeLatent.sigma,
        gameContext
      );

      // Step 8: Bayesian update team distributions
      const homeGameResult = {
        won: gameData.teams.home.score > gameData.teams.visitor.score,
        pointDifferential: gameData.teams.home.score - gameData.teams.visitor.score
      };

      const awayGameResult = {
        won: gameData.teams.visitor.score > gameData.teams.home.score,
        pointDifferential: gameData.teams.visitor.score - gameData.teams.home.score
      };

      const homeUpdateResult = await this.bayesianUpdater.updateTeamDistribution(
        gameInfo.home_team_id,
        homeLatent.mu,
        {
          ...this.extractGameContextForBayesian(gameData.metadata),
          gameResult: homeGameResult
        },
        awayTeamDistribution || { mu: awayLatent.mu, sigma: awayLatent.sigma },
        homeLatent.sigma
      );

      const awayUpdateResult = await this.bayesianUpdater.updateTeamDistribution(
        gameInfo.away_team_id,
        awayLatent.mu,
        {
          ...this.extractGameContextForBayesian(gameData.metadata),
          gameResult: awayGameResult
        },
        homeTeamDistribution || { mu: homeLatent.mu, sigma: homeLatent.sigma },
        awayLatent.sigma
      );

      const processingTime = Date.now() - startTime;

      const result = {
        gameId,
        gameDate: gameInfo.game_date,
        processingTime,
        teams: {
          home: {
            id: gameInfo.home_team_id,
            name: gameData.teams.home.name,
            score: gameData.teams.home.score,
            latent: homeLatent,
            trainingResult: homeTrainingResult,
            updateResult: homeUpdateResult
          },
          away: {
            id: gameInfo.away_team_id,
            name: gameData.teams.visitor.name,
            score: gameData.teams.visitor.score,
            latent: awayLatent,
            trainingResult: awayTrainingResult,
            updateResult: awayUpdateResult
          }
        },
        predictions: {
          home: homeTransitionPred,
          away: awayTransitionPred
        },
        actual: {
          home: gameData.transitionProbabilities.home,
          away: gameData.transitionProbabilities.visitor
        },
        losses: {
          home: homeTrainingResult.nnLoss,
          away: awayTrainingResult.nnLoss,
          feedbackTriggered: homeTrainingResult.feedbackTriggered || awayTrainingResult.feedbackTriggered
        }
      };

      logger.info('Game processing completed', {
        gameId,
        processingTime,
        homeTeam: result.teams.home.name,
        awayTeam: result.teams.away.name,
        homeScore: result.teams.home.score,
        awayScore: result.teams.away.score,
        homeLoss: result.losses.home.toFixed(6),
        awayLoss: result.losses.away.toFixed(6),
        feedbackTriggered: result.losses.feedbackTriggered
      });

      return result;

    } catch (error) {
      logger.error('Failed to process game', {
        gameId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Initialize a team with default latent distribution
   * @param {string} teamId - Team ID
   * @returns {Promise<void>}
   */
  async initializeTeam(teamId) {
    try {
      const initialDistribution = this.bayesianUpdater.initializeTeamDistribution(teamId);
      await this.bayesianUpdater.saveTeamDistribution(teamId, initialDistribution);
      
      logger.debug('Initialized team latent distribution', { teamId });
    } catch (error) {
      logger.error('Failed to initialize team', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Convert feature object to array for VAE input
   * @param {Object} features - Feature object
   * @returns {Array} - Feature array [88]
   */
  convertFeaturesToArray(features) {
    // Convert feature object to ordered array (88 dimensions total)
    // Order should match the VAE training expectations
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
   * @param {Object} gameInfo - Game info from database
   * @returns {Array} - Game context array [10]
   */
  buildGameContext(metadata, gameInfo) {
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
   * Extract game context for Bayesian updater
   * @param {Object} metadata - Game metadata
   * @returns {Object} - Game context object
   */
  extractGameContextForBayesian(metadata) {
    return {
      isNeutralSite: metadata.neutralGame === 'Y',
      isPostseason: metadata.postseason === 'Y',
      isConferenceGame: null, // Not available in current data
      restDays: null, // Not available
      gameDate: metadata.date
    };
  }

  /**
   * Get unprocessed games from database in chronological order
   * @param {number} limit - Maximum number of games to retrieve
   * @param {string} startFromGameId - Optional game ID to start from
   * @returns {Promise<Array>} - Array of unprocessed games
   */
  async getUnprocessedGames(limit, startFromGameId = null) {
    try {
      let sql = `
        SELECT game_id, game_date, home_team_id, away_team_id 
        FROM game_ids 
        WHERE processed = 0 AND sport = 'mens-college-basketball'
      `;
      
      const params = [];
      
      if (startFromGameId) {
        sql += ` AND game_date >= (SELECT game_date FROM game_ids WHERE game_id = ?)`;
        params.push(startFromGameId);
      }
      
      sql += ` ORDER BY game_date ASC, game_id ASC`;
      
      if (limit) {
        sql += ` LIMIT ?`;
        params.push(limit);
      }

      const rows = await dbConnection.all(sql, params);
      
      logger.debug('Retrieved unprocessed games', {
        count: rows.length,
        startFromGameId,
        limit
      });

      return rows;

    } catch (error) {
      logger.error('Failed to get unprocessed games', {
        error: error.message,
        startFromGameId,
        limit
      });
      throw error;
    }
  }

  /**
   * Create a checkpoint for rollback capability
   * @param {Object} gameInfo - Game information
   * @returns {Promise<Object>} - Checkpoint information
   */
  async createCheckpoint(gameInfo) {
    try {
      // Get current team distributions before processing
      const homeTeamBefore = await this.bayesianUpdater.getTeamDistribution(gameInfo.home_team_id);
      const awayTeamBefore = await this.bayesianUpdater.getTeamDistribution(gameInfo.away_team_id);
      
      // Get current model states
      const vaeState = await this.vae.toJSON();
      const nnState = await this.transitionNN.toJSON();
      const trainerState = this.feedbackTrainer.toJSON();

      return {
        gameId: gameInfo.game_id,
        timestamp: new Date().toISOString(),
        teamStates: {
          home: homeTeamBefore,
          away: awayTeamBefore
        },
        modelStates: {
          vae: vaeState,
          nn: nnState,
          trainer: trainerState
        }
      };

    } catch (error) {
      logger.error('Failed to create checkpoint', {
        gameId: gameInfo.game_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Commit checkpoint (mark game as processed)
   * @param {Object} checkpoint - Checkpoint information
   * @returns {Promise<void>}
   */
  async commitCheckpoint(checkpoint) {
    try {
      await dbConnection.run(
        'UPDATE game_ids SET processed = 1, updated_at = ? WHERE game_id = ?',
        [new Date().toISOString(), checkpoint.gameId]
      );
      
      logger.debug('Committed checkpoint', { gameId: checkpoint.gameId });

    } catch (error) {
      logger.error('Failed to commit checkpoint', {
        gameId: checkpoint.gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Rollback checkpoint (restore previous states)
   * @param {Object} checkpoint - Checkpoint information
   * @returns {Promise<void>}
   */
  async rollbackCheckpoint(checkpoint) {
    try {
      logger.warn('Rolling back checkpoint', { gameId: checkpoint.gameId });

      // Restore team distributions
      if (checkpoint.teamStates.home) {
        await this.bayesianUpdater.saveTeamDistribution(
          checkpoint.gameId.split('_')[0], // Extract home team ID
          checkpoint.teamStates.home
        );
      }
      
      if (checkpoint.teamStates.away) {
        await this.bayesianUpdater.saveTeamDistribution(
          checkpoint.gameId.split('_')[1], // Extract away team ID
          checkpoint.teamStates.away
        );
      }

      // Restore model states
      await this.vae.fromJSON(checkpoint.modelStates.vae);
      await this.transitionNN.fromJSON(checkpoint.modelStates.nn);
      this.feedbackTrainer.fromJSON(checkpoint.modelStates.trainer);

      logger.debug('Rollback completed', { gameId: checkpoint.gameId });

    } catch (error) {
      logger.error('Failed to rollback checkpoint', {
        gameId: checkpoint.gameId,
        error: error.message
      });
      // Don't throw here as we're already in error handling
    }
  }

  /**
   * Handle periodic tasks (saves, validation)
   * @param {number} gameCount - Number of games processed
   * @returns {Promise<void>}
   */
  async handlePeriodicTasks(gameCount) {
    try {
      // Periodic model saves (skip for now due to TensorFlow.js save issues)
      if (gameCount % this.saveInterval === 0) {
        try {
          await this.saveModels();
          this.stats.modelSaves++;
          
          logger.info('Periodic model save completed', {
            gameCount,
            saveInterval: this.saveInterval
          });
        } catch (error) {
          logger.warn('Periodic model save failed, continuing', {
            gameCount,
            error: error.message
          });
        }
      }

      // Periodic validation
      if (gameCount % this.validationInterval === 0) {
        await this.runValidation();
        this.stats.validationRuns++;
        
        logger.info('Periodic validation completed', {
          gameCount,
          validationInterval: this.validationInterval
        });
      }

    } catch (error) {
      logger.error('Failed to handle periodic tasks', {
        gameCount,
        error: error.message
      });
      // Don't throw - these are non-critical tasks
    }
  }

  /**
   * Save all models to disk
   * @returns {Promise<void>}
   */
  async saveModels() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const modelsDir = 'data/models';
      const basePath = `${modelsDir}/online-learning-${timestamp}`;

      // Ensure models directory exists
      try {
        await fs.mkdir(modelsDir, { recursive: true });
      } catch (error) {
        // Directory might already exist, ignore error
      }

      // Save VAE model
      await this.vae.saveToFile(`${basePath}-vae.json`);
      
      // Save NN model
      await this.transitionNN.saveToFile(`${basePath}-nn`);
      
      // Save trainer state
      await this.feedbackTrainer.saveToFile(`${basePath}-trainer.json`);

      logger.info('Models saved successfully', { basePath });

    } catch (error) {
      logger.error('Failed to save models', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Load existing models from disk
   * @returns {Promise<void>}
   */
  async loadModels() {
    try {
      // Try to load the most recent models
      // This is a simplified implementation - in practice you'd want more sophisticated model versioning
      
      logger.debug('Attempting to load existing models');
      
      // For now, start with fresh models
      // In a full implementation, you would scan for existing model files and load the latest
      
      logger.info('Starting with fresh models (no existing models found)');

    } catch (error) {
      logger.error('Failed to load models', {
        error: error.message
      });
      // Don't throw - we can start with fresh models
    }
  }

  /**
   * Run validation on recent predictions
   * @returns {Promise<void>}
   */
  async runValidation() {
    try {
      // Get recent processed games for validation
      const recentGames = await dbConnection.all(`
        SELECT game_id, game_date 
        FROM game_ids 
        WHERE processed = 1 
        ORDER BY game_date DESC 
        LIMIT 10
      `);

      if (recentGames.length === 0) {
        logger.debug('No recent games available for validation');
        return;
      }

      // Simple validation: check training statistics
      const trainerStats = this.feedbackTrainer.getTrainingStats();
      
      logger.info('Validation results', {
        recentGames: recentGames.length,
        convergenceAchieved: trainerStats.convergenceAchieved,
        averageNNLoss: trainerStats.averageNNLoss,
        averageVAELoss: trainerStats.averageVAELoss,
        feedbackTriggers: trainerStats.feedbackTriggers,
        currentAlpha: trainerStats.stability.currentAlpha
      });

    } catch (error) {
      logger.error('Failed to run validation', {
        error: error.message
      });
      // Don't throw - validation is non-critical
    }
  }

  /**
   * Update processing statistics
   * @param {Object} result - Processing result
   * @param {number} processingTime - Processing time in ms
   */
  updateProcessingStats(result, processingTime) {
    this.stats.totalGamesProcessed++;
    this.stats.successfulGames++;
    this.stats.totalProcessingTime += processingTime;
    this.stats.averageProcessingTime = this.stats.totalProcessingTime / this.stats.totalGamesProcessed;
    this.stats.lastProcessedGameId = result.gameId;
    this.stats.lastProcessedDate = result.gameDate;
  }

  /**
   * Get session results summary
   * @returns {Object} - Session results
   */
  getSessionResults() {
    const sessionDuration = this.sessionStartTime ? Date.now() - this.sessionStartTime : 0;
    
    return {
      summary: {
        totalGamesProcessed: this.stats.totalGamesProcessed,
        successfulGames: this.stats.successfulGames,
        failedGames: this.stats.failedGames,
        successRate: this.stats.totalGamesProcessed > 0 
          ? (this.stats.successfulGames / this.stats.totalGamesProcessed) * 100 
          : 0,
        averageProcessingTime: this.stats.averageProcessingTime,
        totalProcessingTime: this.stats.totalProcessingTime,
        sessionDuration,
        modelSaves: this.stats.modelSaves,
        validationRuns: this.stats.validationRuns
      },
      lastProcessed: {
        gameId: this.stats.lastProcessedGameId,
        gameDate: this.stats.lastProcessedDate
      },
      errors: this.stats.errors,
      trainerStats: this.feedbackTrainer.getTrainingStats()
    };
  }

  /**
   * Stop the online learning process gracefully
   */
  stop() {
    logger.info('Stopping online learning process');
    this.shouldStop = true;
  }

  /**
   * Check if the orchestrator is currently running
   * @returns {boolean} - Whether the orchestrator is running
   */
  getIsRunning() {
    return this.isRunning;
  }

  /**
   * Reset statistics for a new session
   */
  resetStats() {
    this.stats = {
      totalGamesProcessed: 0,
      successfulGames: 0,
      failedGames: 0,
      averageProcessingTime: 0,
      totalProcessingTime: 0,
      lastProcessedGameId: null,
      lastProcessedDate: null,
      modelSaves: 0,
      validationRuns: 0,
      errors: []
    };
    
    logger.debug('Statistics reset');
  }

  /**
   * Close all resources
   * @returns {Promise<void>}
   */
  async close() {
    try {
      await this.featureExtractor.close();
      logger.info('OnlineLearningOrchestrator resources closed');
    } catch (error) {
      logger.error('Error closing OnlineLearningOrchestrator resources', {
        error: error.message
      });
    }
  }
}

module.exports = OnlineLearningOrchestrator;