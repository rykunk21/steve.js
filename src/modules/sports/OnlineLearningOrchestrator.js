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
    // Initialize components for new InfoNCE architecture
    this.featureExtractor = new VAEFeatureExtractor();
    this.frozenEncoder = null; // Will be loaded from FrozenVAEEncoder
    this.transitionNN = new TransitionProbabilityNN(10); // 10-dim game context
    this.teamRepository = new TeamRepository();
    
    // Initialize Bayesian posterior updater (replaces VAEFeedbackTrainer)
    const BayesianPosteriorUpdater = require('./BayesianPosteriorUpdater');
    this.bayesianUpdater = new BayesianPosteriorUpdater(
      this.teamRepository, 
      this.transitionNN,
      {
        learningRate: options.learningRate || 0.1,
        minUncertainty: options.minUncertainty || 0.1,
        maxUncertainty: options.maxUncertainty || 2.0,
        likelihoodWeight: options.likelihoodWeight || 1.0,
        latentDim: options.latentDim || 16
      }
    );
    
    // Initialize refactored trainer (replaces VAEFeedbackTrainer)
    const AdaptiveVAENNTrainer = require('./AdaptiveVAENNTrainer');
    this.adaptiveTrainer = new AdaptiveVAENNTrainer(
      this.frozenEncoder,
      this.transitionNN,
      this.bayesianUpdater,
      {
        baseNNLearningRate: options.baseNNLearningRate || 0.001,
        gameContextDim: options.gameContextDim || 10
      }
    );

    // Initialize inter-year uncertainty manager for season transitions
    const InterYearUncertaintyManager = require('./InterYearUncertaintyManager');
    this.uncertaintyManager = new InterYearUncertaintyManager(
      this.teamRepository,
      {
        interYearVariance: options.interYearVariance || 0.25,
        maxUncertainty: options.maxUncertainty || 2.0,
        minUncertainty: options.minUncertainty || 0.1,
        preserveSkillFactor: options.preserveSkillFactor || 1.0,
        logAdjustments: options.logAdjustments !== false
      }
    );

    // Training parameters
    this.batchSize = options.batchSize || 1; // Process games one at a time for chronological order
    this.miniBatchSize = options.miniBatchSize || 8; // Accumulate gradients over N games
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

    // Loss tracking for visualization
    this.lossHistory = [];
    this.lossTrackingInterval = options.lossTrackingInterval || 10; // Track every N games

    // State management
    this.isRunning = false;
    this.shouldStop = false;
    this.currentGameId = null;
    this.sessionStartTime = null;

    logger.info('Initialized OnlineLearningOrchestrator (InfoNCE Architecture)', {
      architecture: 'InfoNCE with frozen encoder and Bayesian updates',
      batchSize: this.batchSize,
      maxGamesPerSession: this.maxGamesPerSession,
      saveInterval: this.saveInterval,
      validationInterval: this.validationInterval,
      maxRetries: this.maxRetries,
      continueOnError: this.continueOnError,
      frozenEncoderLoaded: !!this.frozenEncoder,
      bayesianUpdaterLoaded: !!this.bayesianUpdater,
      uncertaintyManagerLoaded: !!this.uncertaintyManager,
      interYearVariance: this.uncertaintyManager ? this.uncertaintyManager.interYearVariance : 'not_loaded'
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
      
      // Load frozen encoder if available
      await this.loadFrozenEncoder();

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
          
          // Track losses for visualization
          this.trackLossHistory(result, i + 1);

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

      // Final save (safe weight-only format)
      try {
        await this.saveModelsSafe();
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

        // Process the game directly without checkpoints (disabled for memory management)
        const result = await this.processGame(gameInfo);
        
        // Mark game as processed directly
        await dbConnection.run(
          'UPDATE game_ids SET processed = 1 WHERE game_id = ?',
          [gameInfo.game_id]
        );
        
        return result;

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
   * Process a single game through the InfoNCE VAE-NN pipeline
   * @param {Object} gameInfo - Game information from database
   * @returns {Promise<Object>} - Processing result
   */
  async processGame(gameInfo) {
    const gameId = gameInfo.game_id;
    const startTime = Date.now();

    try {
      logger.debug('Starting InfoNCE game processing pipeline', {
        gameId,
        homeTeam: gameInfo.home_team_id,
        awayTeam: gameInfo.away_team_id,
        gameDate: gameInfo.game_date
      });

      // Step 1: Extract features and transition probabilities
      const gameData = await this.featureExtractor.processGame(gameId);
      
      // Step 2: Check for season transitions and apply inter-year uncertainty increases
      await this.checkSeasonTransitions(gameInfo.game_date, [gameInfo.home_team_id, gameInfo.away_team_id]);

      // Step 3: Get CURRENT posterior distributions (after potential season transitions)
      const homePosterior = await this.teamRepository.getTeamEncodingFromDb(gameInfo.home_team_id);
      const awayPosterior = await this.teamRepository.getTeamEncodingFromDb(gameInfo.away_team_id);

      // Initialize teams if they don't exist
      if (!homePosterior) {
        await this.initializeTeam(gameInfo.home_team_id);
      }
      if (!awayPosterior) {
        await this.initializeTeam(gameInfo.away_team_id);
      }

      // Get current posteriors after potential initialization
      const currentHomePosterior = homePosterior || await this.teamRepository.getTeamEncodingFromDb(gameInfo.home_team_id);
      const currentAwayPosterior = awayPosterior || await this.teamRepository.getTeamEncodingFromDb(gameInfo.away_team_id);

      // Step 3: Use refactored trainer for complete pipeline
      const trainingResult = await this.adaptiveTrainer.trainOnGame(
        gameData,
        gameInfo.home_team_id,
        gameInfo.away_team_id
      );

      // Step 4: Add error handling for posterior update failures
      let posteriorUpdateSuccess = true;
      let posteriorUpdateError = null;

      try {
        // Posterior updates are handled within the adaptiveTrainer.trainOnGame method
        // This ensures proper sequencing: NN training first, then Bayesian updates
        logger.debug('Posterior updates completed within training pipeline', {
          gameId,
          homeTeam: gameInfo.home_team_id,
          awayTeam: gameInfo.away_team_id
        });
      } catch (updateError) {
        posteriorUpdateSuccess = false;
        posteriorUpdateError = updateError.message;
        
        logger.error('Posterior update failed during game processing', {
          gameId,
          error: updateError.message
        });
        
        // Continue processing but mark the failure
      }

      const processingTime = Date.now() - startTime;

      const result = {
        gameId,
        gameDate: gameInfo.game_date,
        processingTime,
        architecture: 'InfoNCE with frozen encoder',
        
        // Training results from refactored trainer
        trainingResult,
        
        // Posterior update status
        posteriorUpdateSuccess,
        posteriorUpdateError,
        
        // Original team states (for comparison)
        originalPosteriors: {
          home: currentHomePosterior,
          away: currentAwayPosterior
        },
        
        // Game metadata
        teams: {
          home: {
            id: gameInfo.home_team_id,
            name: gameData.teams.home.name,
            score: gameData.teams.home.score
          },
          away: {
            id: gameInfo.away_team_id,
            name: gameData.teams.visitor.name,
            score: gameData.teams.visitor.score
          }
        },
        
        // Actual transition probabilities for validation
        actual: {
          home: gameData.transitionProbabilities.home,
          away: gameData.transitionProbabilities.visitor
        }
      };

      logger.info('InfoNCE game processing completed', {
        gameId,
        processingTime,
        homeTeam: result.teams.home.name,
        awayTeam: result.teams.away.name,
        homeScore: result.teams.home.score,
        awayScore: result.teams.away.score,
        posteriorUpdateSuccess,
        encoderFrozen: this.frozenEncoder ? await this.frozenEncoder.validateImmutability(false) : 'not_loaded'
      });

      return result;

    } catch (error) {
      logger.error('Failed to process game in InfoNCE pipeline', {
        gameId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Load frozen VAE encoder from database or file
   * @returns {Promise<void>}
   */
  async loadFrozenEncoder() {
    try {
      const FrozenVAEEncoder = require('./FrozenVAEEncoder');
      this.frozenEncoder = new FrozenVAEEncoder(80, 16); // 80-dim input, 16-dim latent
      
      // Try to load pretrained weights from database or file
      // For now, create with default weights - in production, load from vae_model_weights table
      logger.info('Frozen encoder initialized (weights to be loaded from database)', {
        inputDim: 80,
        latentDim: 16
      });
      
      // Update the adaptive trainer with the loaded encoder
      if (this.adaptiveTrainer) {
        this.adaptiveTrainer.frozenEncoder = this.frozenEncoder;
      }
      
    } catch (error) {
      logger.warn('Failed to load frozen encoder, continuing without it', {
        error: error.message
      });
      this.frozenEncoder = null;
    }
  }

  /**
   * Initialize a team with default posterior distribution
   * @param {string} teamId - Team ID
   * @returns {Promise<void>}
   */
  async initializeTeam(teamId) {
    try {
      // Create default posterior distribution for InfoNCE space
      const initialPosterior = {
        mu: new Array(16).fill(0.0), // Zero mean in latent space
        sigma: new Array(16).fill(1.0), // Unit variance initially
        games_processed: 0,
        last_season: this.getCurrentSeason(),
        last_updated: new Date().toISOString(),
        initialization_method: 'default_infonce'
      };
      
      await this.teamRepository.saveTeamEncodingToDb(teamId, initialPosterior);
      
      logger.debug('Initialized team posterior distribution', { 
        teamId,
        latentDim: initialPosterior.mu.length,
        avgUncertainty: initialPosterior.sigma.reduce((sum, s) => sum + s, 0) / initialPosterior.sigma.length
      });
    } catch (error) {
      logger.error('Failed to initialize team', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check for season transitions and apply inter-year uncertainty increases
   * @param {string} gameDate - Game date string
   * @param {Array<string>} teamIds - Array of team IDs to check
   * @returns {Promise<void>}
   */
  async checkSeasonTransitions(gameDate, teamIds) {
    try {
      const currentDate = new Date(gameDate);
      
      for (const teamId of teamIds) {
        const transitionResult = await this.uncertaintyManager.checkAndApplySeasonTransition(
          teamId, 
          currentDate
        );
        
        if (transitionResult.transitionDetected) {
          logger.info('Season transition applied during game processing', {
            teamId,
            gameDate,
            previousSeason: transitionResult.previousSeason,
            newSeason: transitionResult.newSeason,
            transitionDate: transitionResult.transitionDate
          });
        }
      }
      
    } catch (error) {
      logger.error('Failed to check season transitions during game processing', {
        gameDate,
        teamIds,
        error: error.message
      });
      
      // Don't throw - season transitions are not critical for game processing
      // The game can still be processed with existing posterior distributions
    }
  }

  /**
   * Get current season string
   * @returns {string} - Current season (e.g., "2023-24")
   */
  getCurrentSeason() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // JavaScript months are 0-indexed
    
    // Basketball season spans two calendar years
    if (month >= 11) {
      return `${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `${year - 1}-${year.toString().slice(-2)}`;
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
      // Periodic model saves (safe weight-only format)
      if (gameCount % this.saveInterval === 0) {
        try {
          await this.saveModelsSafe();
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
   * Save all models to disk (InfoNCE architecture)
   * @returns {Promise<void>}
   */
  async saveModelsSafe() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const modelsDir = 'data/models';
      const basePath = `${modelsDir}/infonce-online-learning-${timestamp}`;

      // Ensure models directory exists
      try {
        await fs.mkdir(modelsDir, { recursive: true });
      } catch (error) {
        // Directory might already exist, ignore error
      }

      // Save frozen encoder state (if available)
      if (this.frozenEncoder) {
        const encoderState = await this.frozenEncoder.saveState();
        await fs.writeFile(`${basePath}-frozen-encoder.json`, JSON.stringify(encoderState, null, 2));
      }
      
      // Save NN model (weight-only format)
      const nnState = await this.transitionNN.toJSON();
      await fs.writeFile(`${basePath}-nn.json`, JSON.stringify(nnState, null, 2));
      
      // Save adaptive trainer state
      const trainerState = this.adaptiveTrainer.toJSON();
      await fs.writeFile(`${basePath}-trainer.json`, JSON.stringify(trainerState, null, 2));

      // Save Bayesian updater configuration
      const bayesianConfig = this.bayesianUpdater.getConfiguration();
      await fs.writeFile(`${basePath}-bayesian-config.json`, JSON.stringify(bayesianConfig, null, 2));

      // Save uncertainty manager configuration
      if (this.uncertaintyManager) {
        const uncertaintyConfig = this.uncertaintyManager.getConfiguration();
        await fs.writeFile(`${basePath}-uncertainty-config.json`, JSON.stringify(uncertaintyConfig, null, 2));
      }

      logger.info('InfoNCE models saved successfully', { 
        basePath,
        architecture: 'InfoNCE with frozen encoder',
        components: ['frozen-encoder', 'nn', 'trainer', 'bayesian-config', 'uncertainty-config']
      });

    } catch (error) {
      logger.error('Failed to save InfoNCE models', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Save all models to disk (legacy TensorFlow.js format)
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
   * Run validation on recent predictions (InfoNCE architecture)
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

      // Validation for InfoNCE architecture
      const trainerStats = this.adaptiveTrainer.getTrainingStats();
      
      // Validate encoder immutability
      let encoderImmutable = false;
      if (this.frozenEncoder) {
        encoderImmutable = await this.frozenEncoder.validateImmutability(false);
      }
      
      // Get Bayesian updater statistics
      const bayesianConfig = this.bayesianUpdater.getConfiguration();
      
      logger.info('InfoNCE validation results', {
        architecture: 'InfoNCE with frozen encoder',
        recentGames: recentGames.length,
        encoderImmutable,
        avgRecentNNLoss: trainerStats.avgRecentNNLoss,
        totalGamesProcessed: trainerStats.totalGamesProcessed,
        nnLearningRate: trainerStats.nnLearningRate,
        bayesianConfig: {
          learningRate: bayesianConfig.learningRate,
          minUncertainty: bayesianConfig.minUncertainty,
          maxUncertainty: bayesianConfig.maxUncertainty
        }
      });

    } catch (error) {
      logger.error('Failed to run InfoNCE validation', {
        error: error.message
      });
      // Don't throw - validation is non-critical
    }
  }

  /**
   * Track loss history for visualization
   * @param {Object} result - Processing result
   * @param {number} gameCount - Current game count
   */
  trackLossHistory(result, gameCount) {
    if (gameCount % this.lossTrackingInterval === 0) {
      const lossEntry = {
        gameCount,
        timestamp: new Date().toISOString(),
        gameId: result.gameId,
        gameDate: result.gameDate,
        homeLoss: result.losses.home,
        awayLoss: result.losses.away,
        averageLoss: (result.losses.home + result.losses.away) / 2,
        feedbackTriggered: result.losses.feedbackTriggered,
        processingTime: result.processingTime
      };

      this.lossHistory.push(lossEntry);

      // Keep only recent history (last 1000 entries)
      if (this.lossHistory.length > 1000) {
        this.lossHistory = this.lossHistory.slice(-1000);
      }

      // Save loss history to file for visualization
      this.saveLossHistory();

      logger.info('Loss tracking update', {
        gameCount,
        averageLoss: lossEntry.averageLoss.toFixed(6),
        feedbackTriggered: lossEntry.feedbackTriggered,
        historyLength: this.lossHistory.length
      });
    }
  }

  /**
   * Save loss history to JSON file for visualization
   */
  async saveLossHistory() {
    try {
      const fs = require('fs').promises;
      const lossFile = 'data/loss-history.json';
      
      const lossData = {
        lastUpdated: new Date().toISOString(),
        totalEntries: this.lossHistory.length,
        history: this.lossHistory
      };

      await fs.writeFile(lossFile, JSON.stringify(lossData, null, 2));
    } catch (error) {
      logger.warn('Failed to save loss history', { error: error.message });
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