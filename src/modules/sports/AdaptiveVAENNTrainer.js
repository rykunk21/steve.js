const logger = require('../../utils/logger');

/**
 * Refactored VAE-NN Trainer for InfoNCE Architecture
 * 
 * New architecture eliminates VAE-NN feedback loop:
 * - Uses frozen VAE encoder for logging only (no gradients)
 * - Loads/saves posterior distributions instead of encoding on-the-fly
 * - Separates NN training from VAE operations completely
 * - Maintains team representations via Bayesian posterior updates
 */
class AdaptiveVAENNTrainer {
  constructor(frozenEncoder, transitionNN, bayesianUpdater, options = {}) {
    this.frozenEncoder = frozenEncoder; // FrozenVAEEncoder instance
    this.transitionNN = transitionNN;
    this.bayesianUpdater = bayesianUpdater; // BayesianPosteriorUpdater instance
    
    // NN training parameters (no more VAE feedback)
    this.baseNNLearningRate = options.baseNNLearningRate || 0.001;
    this.currentNNLearningRate = this.baseNNLearningRate;
    
    // Game context dimension (should match the NN's expected dimension)
    this.gameContextDim = this.transitionNN.gameContextDim || 20;
    
    // Training state tracking
    this.gamesInSeason = 0;
    this.currentSeason = null;
    this.totalGamesProcessed = 0;
    
    // Performance tracking
    this.seasonalStats = new Map();
    this.nnLossHistory = [];
    this.posteriorUpdateHistory = [];
    
    logger.info('Initialized Refactored AdaptiveVAENNTrainer', {
      architecture: 'InfoNCE with frozen encoder',
      baseNNLearningRate: this.baseNNLearningRate,
      gameContextDim: this.gameContextDim,
      frozenEncoderLoaded: !!this.frozenEncoder,
      bayesianUpdaterLoaded: !!this.bayesianUpdater
    });
  }

  /**
   * Validate that encoder remains frozen during training
   * @returns {Promise<boolean>} - True if encoder is still frozen
   */
  async validateEncoderImmutability() {
    if (!this.frozenEncoder) {
      logger.warn('No frozen encoder available for validation');
      return false;
    }
    
    try {
      return await this.frozenEncoder.validateImmutability(false);
    } catch (error) {
      logger.error('Encoder immutability validation failed', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Train on a single game with new InfoNCE architecture
   * @param {Object} gameData - Complete game data
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @returns {Promise<Object>} - Training results
   */
  async trainOnGame(gameData, homeTeamId, awayTeamId) {
    try {
      const gameSeason = this.extractSeason(gameData.gameDate);

      // Step 1: Load current posterior distributions from database
      const homePosterior = await this.bayesianUpdater.teamRepo.getTeamEncodingFromDb(homeTeamId);
      const awayPosterior = await this.bayesianUpdater.teamRepo.getTeamEncodingFromDb(awayTeamId);

      if (!homePosterior || !awayPosterior) {
        throw new Error(`Missing posterior distributions for teams ${homeTeamId}, ${awayTeamId}`);
      }

      // Step 2: Frozen VAE encoding for logging only (no gradients)
      let frozenEncodingHome = null;
      let frozenEncodingAway = null;
      
      if (this.frozenEncoder && gameData.features) {
        try {
          frozenEncodingHome = this.frozenEncoder.encodeToTeamDistribution(gameData.features.home);
          frozenEncodingAway = this.frozenEncoder.encodeToTeamDistribution(gameData.features.visitor);
          
          // Validate encoder immutability
          await this.validateEncoderImmutability();
        } catch (error) {
          logger.warn('Frozen encoder failed, continuing without encoding', {
            error: error.message
          });
        }
      }

      // Step 3: NN training using posterior distributions
      const gameContext = this.buildGameContext(gameData.metadata);
      
      // Train NN on home team
      const homeNNResult = await this.trainNNOnTeam(
        homePosterior,
        awayPosterior,
        gameContext,
        gameData.actualTransProbs.home,
        'home'
      );

      // Train NN on away team  
      const awayNNResult = await this.trainNNOnTeam(
        awayPosterior,
        homePosterior,
        gameContext,
        gameData.actualTransProbs.visitor,
        'away'
      );

      // Step 4: Bayesian posterior updates (separate from NN training)
      const homePosteriorUpdate = await this.bayesianUpdater.updatePosterior(
        homeTeamId,
        gameData.actualTransProbs.home,
        awayTeamId,
        {
          ...gameContext,
          gameDate: gameData.gameDate,
          isHomeGame: true
        }
      );

      const awayPosteriorUpdate = await this.bayesianUpdater.updatePosterior(
        awayTeamId,
        gameData.actualTransProbs.visitor,
        homeTeamId,
        {
          ...gameContext,
          gameDate: gameData.gameDate,
          isHomeGame: false
        }
      );

      // Increment counters
      this.gamesInSeason++;
      this.totalGamesProcessed++;

      const result = {
        gameId: gameData.gameId,
        season: gameSeason,
        gamesInSeason: this.gamesInSeason,
        totalGames: this.totalGamesProcessed,
        nnLearningRate: this.currentNNLearningRate,
        
        // NN training results
        homeNNResult,
        awayNNResult,
        
        // Posterior update results
        homePosteriorUpdate,
        awayPosteriorUpdate,
        
        // Frozen encoder results (logging only)
        frozenEncodingHome,
        frozenEncodingAway,
        
        // Original data for validation
        actualTransProbs: gameData.actualTransProbs
      };

      // Track performance
      this.trackPerformance(result);

      // Log progress periodically
      if (this.totalGamesProcessed % 10 === 0) {
        logger.info('InfoNCE training progress', {
          totalGames: this.totalGamesProcessed,
          season: gameSeason,
          nnLR: this.currentNNLearningRate.toFixed(6),
          homeNNLoss: homeNNResult.nnLoss.toFixed(6),
          awayNNLoss: awayNNResult.nnLoss.toFixed(6),
          encoderFrozen: await this.validateEncoderImmutability()
        });
      }

      return result;

    } catch (error) {
      logger.error('Error in InfoNCE training', {
        gameId: gameData.gameId,
        homeTeamId,
        awayTeamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Train NN on a single team using posterior distributions
   * @param {Object} teamPosterior - Team's posterior distribution
   * @param {Object} opponentPosterior - Opponent's posterior distribution
   * @param {Object} gameContext - Game context features
   * @param {Array} actualTransProbs - Actual transition probabilities
   * @param {string} teamRole - 'home' or 'away'
   * @returns {Promise<Object>} - NN training results
   */
  async trainNNOnTeam(teamPosterior, opponentPosterior, gameContext, actualTransProbs, teamRole) {
    try {
      // Build NN input using posterior distributions
      const nnInput = this.buildNNInput(teamPosterior, opponentPosterior, gameContext);
      
      // Forward pass: predict transition probabilities
      const predictedTransProbs = await this.transitionNN.predict(nnInput);
      
      // Compute loss
      const nnLoss = this.transitionNN.computeLoss(predictedTransProbs, actualTransProbs);
      
      // Backward pass: update NN weights only (no VAE feedback)
      await this.transitionNN.trainStep(nnInput, actualTransProbs, this.currentNNLearningRate);
      
      return {
        teamRole,
        nnInput,
        predictedTransProbs,
        actualTransProbs,
        nnLoss,
        nnLearningRate: this.currentNNLearningRate
      };
      
    } catch (error) {
      logger.error('Failed to train NN on team', {
        teamRole,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Build NN input vector from posterior distributions and context
   * @param {Object} teamPosterior - Team posterior distribution {mu, sigma}
   * @param {Object} opponentPosterior - Opponent posterior distribution {mu, sigma}
   * @param {Object} gameContext - Game context features
   * @returns {Array} - NN input vector
   */
  buildNNInput(teamPosterior, opponentPosterior, gameContext) {
    const input = [];
    
    // Team posterior mean and variance (16 + 16 = 32 dimensions)
    input.push(...teamPosterior.mu);
    input.push(...teamPosterior.sigma.map(s => s * s)); // Use variance
    
    // Opponent posterior mean and variance (16 + 16 = 32 dimensions)
    input.push(...opponentPosterior.mu);
    input.push(...opponentPosterior.sigma.map(s => s * s)); // Use variance
    
    // Game context features (remaining dimensions to match gameContextDim)
    const contextFeatures = this.buildGameContext(gameContext);
    input.push(...contextFeatures);
    
    return input;
  }

  /**
   * Track performance metrics for monitoring
   * @param {Object} result - Training result
   */
  trackPerformance(result) {
    // Track NN loss history
    this.nnLossHistory.push({
      gameId: result.gameId,
      totalGames: result.totalGames,
      homeNNLoss: result.homeNNResult.nnLoss,
      awayNNLoss: result.awayNNResult.nnLoss,
      avgNNLoss: (result.homeNNResult.nnLoss + result.awayNNResult.nnLoss) / 2,
      timestamp: new Date().toISOString()
    });
    
    // Track posterior update history
    this.posteriorUpdateHistory.push({
      gameId: result.gameId,
      totalGames: result.totalGames,
      homePosteriorUpdate: result.homePosteriorUpdate,
      awayPosteriorUpdate: result.awayPosteriorUpdate,
      timestamp: new Date().toISOString()
    });
    
    // Keep only recent history (last 1000 games)
    if (this.nnLossHistory.length > 1000) {
      this.nnLossHistory = this.nnLossHistory.slice(-1000);
    }
    if (this.posteriorUpdateHistory.length > 1000) {
      this.posteriorUpdateHistory = this.posteriorUpdateHistory.slice(-1000);
    }
  }

  /**
   * Complete current season and store statistics
   * @param {string} completedSeason - Identifier of completed season
   */
  completeSeason(completedSeason) {
    // Store stats for completed season
    if (this.currentSeason) {
      const recentNNLoss = this.nnLossHistory.slice(-10);
      const avgRecentNNLoss = recentNNLoss.length > 0 
        ? recentNNLoss.reduce((sum, entry) => sum + entry.avgNNLoss, 0) / recentNNLoss.length
        : 0;
        
      this.seasonalStats.set(this.currentSeason, {
        gamesProcessed: this.gamesInSeason,
        avgNNLoss: avgRecentNNLoss,
        totalGamesProcessed: this.totalGamesProcessed
      });
    }

    logger.info('Season completed', {
      seasonId: completedSeason,
      gamesProcessed: this.gamesInSeason,
      totalGamesProcessed: this.totalGamesProcessed
    });

    // Reset season counters
    this.gamesInSeason = 0;
    this.currentSeason = completedSeason;
  }

  /**
   * Check if this is a new season
   * @param {string} season - Season identifier
   * @returns {boolean} - Whether this is a new season
   */
  isNewSeason(season) {
    return this.currentSeason !== null && this.currentSeason !== season;
  }

  /**
   * Extract season from game date
   * @param {string} gameDate - Game date string
   * @returns {string} - Season identifier (e.g., "2011-2012")
   */
  extractSeason(gameDate) {
    const date = new Date(gameDate);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // JavaScript months are 0-indexed
    
    // Basketball season spans two calendar years
    // Games from Aug-Dec are start of season, Jan-Jul are end of season
    if (month >= 8) {
      return `${year}-${year + 1}`;
    } else {
      return `${year - 1}-${year}`;
    }
  }

  /**
   * Get current NN learning rate
   * @returns {number} - Current NN learning rate
   */
  getCurrentNNLearningRate() {
    return this.currentNNLearningRate;
  }
  
  /**
   * Update NN learning rate (optional adaptive adjustment)
   * @param {number} newRate - New learning rate
   */
  updateNNLearningRate(newRate) {
    const minLearningRate = 0.0001;
    const maxLearningRate = 0.01;
    
    this.currentNNLearningRate = Math.max(minLearningRate, Math.min(maxLearningRate, newRate));
    
    logger.debug('Updated NN learning rate', {
      newRate: this.currentNNLearningRate,
      requestedRate: newRate
    });
  }

  /**
   * Build game context features
   * @param {Object} metadata - Game metadata
   * @returns {Array} - Game context array
   */
  buildGameContext(metadata) {
    // Enhanced context features with more meaningful information
    const baseContext = [
      metadata.neutralGame === 'Y' ? 1 : 0,
      metadata.postseason === 'Y' ? 1 : 0,
      // Add season timing (0-1 scale based on month)
      this.getSeasonProgress(metadata.gameDate || new Date().toISOString()),
      // Add day of week (0-6)
      new Date(metadata.gameDate || new Date()).getDay() / 6.0,
      // Add conference game indicator (placeholder for now)
      0,
      // Add rivalry game indicator (placeholder for now) 
      0,
      // Add home court advantage factors
      1, // home team gets 1, away gets 0 (set externally)
      // Add recent performance indicators (placeholders)
      0.5, 0.5, 0.5,
      // Add strength of schedule indicators (placeholders)
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5
    ];
    
    // Ensure we have exactly the right dimension
    const paddingNeeded = this.gameContextDim - baseContext.length;
    if (paddingNeeded > 0) {
      const padding = new Array(paddingNeeded).fill(0);
      return [...baseContext, ...padding];
    } else {
      return baseContext.slice(0, this.gameContextDim);
    }
  }

  /**
   * Get season progress as a 0-1 value
   * @param {string} gameDate - Game date string
   * @returns {number} - Season progress (0 = start of season, 1 = end)
   */
  getSeasonProgress(gameDate) {
    const date = new Date(gameDate);
    const month = date.getMonth() + 1; // 1-12
    
    // Basketball season: Nov(11) = 0, Mar(3) = 1
    if (month >= 11) {
      return (month - 11) / 4.0; // Nov-Feb
    } else if (month <= 3) {
      return (month + 1) / 4.0; // Jan-Mar
    } else {
      return 0; // Off-season
    }
  }

  /**
   * Get comprehensive training statistics
   * @returns {Object} - Training statistics
   */
  getTrainingStats() {
    const recentNNLoss = this.nnLossHistory.slice(-10);
    const avgRecentNNLoss = recentNNLoss.length > 0 
      ? recentNNLoss.reduce((sum, entry) => sum + entry.avgNNLoss, 0) / recentNNLoss.length
      : 0;
      
    return {
      architecture: 'InfoNCE with frozen encoder',
      totalGamesProcessed: this.totalGamesProcessed,
      currentSeason: this.currentSeason,
      gamesInSeason: this.gamesInSeason,
      nnLearningRate: this.getCurrentNNLearningRate(),
      avgRecentNNLoss: avgRecentNNLoss,
      seasonalStats: Object.fromEntries(this.seasonalStats),
      nnLossHistoryLength: this.nnLossHistory.length,
      posteriorUpdateHistoryLength: this.posteriorUpdateHistory.length,
      frozenEncoderStatus: this.frozenEncoder ? 'loaded' : 'not_loaded',
      bayesianUpdaterStatus: this.bayesianUpdater ? 'loaded' : 'not_loaded'
    };
  }

  /**
   * Reset trainer state
   */
  reset() {
    this.gamesInSeason = 0;
    this.currentSeason = null;
    this.totalGamesProcessed = 0;
    this.seasonalStats.clear();
    this.nnLossHistory = [];
    this.posteriorUpdateHistory = [];
    this.currentNNLearningRate = this.baseNNLearningRate;
    
    logger.info('Reset AdaptiveVAENNTrainer state (InfoNCE architecture)');
  }

  /**
   * Export trainer state
   * @returns {Object} - Serializable state
   */
  toJSON() {
    return {
      architecture: 'InfoNCE with frozen encoder',
      gamesInSeason: this.gamesInSeason,
      currentSeason: this.currentSeason,
      totalGamesProcessed: this.totalGamesProcessed,
      currentNNLearningRate: this.currentNNLearningRate,
      seasonalStats: Object.fromEntries(this.seasonalStats),
      nnLossHistory: this.nnLossHistory.slice(-100), // Save recent history
      posteriorUpdateHistory: this.posteriorUpdateHistory.slice(-100),
      config: {
        baseNNLearningRate: this.baseNNLearningRate,
        gameContextDim: this.gameContextDim
      }
    };
  }

  /**
   * Import trainer state
   * @param {Object} state - Serialized state
   */
  fromJSON(state) {
    this.gamesInSeason = state.gamesInSeason || 0;
    this.currentSeason = state.currentSeason;
    this.totalGamesProcessed = state.totalGamesProcessed || 0;
    this.currentNNLearningRate = state.currentNNLearningRate || this.baseNNLearningRate;
    this.seasonalStats = new Map(Object.entries(state.seasonalStats || {}));
    this.nnLossHistory = state.nnLossHistory || [];
    this.posteriorUpdateHistory = state.posteriorUpdateHistory || [];
    
    if (state.config) {
      this.baseNNLearningRate = state.config.baseNNLearningRate || this.baseNNLearningRate;
      this.gameContextDim = state.config.gameContextDim || this.gameContextDim;
    }
    
    logger.info('Loaded AdaptiveVAENNTrainer state (InfoNCE architecture)', {
      totalGames: this.totalGamesProcessed,
      currentNNLearningRate: this.currentNNLearningRate,
      currentSeason: this.currentSeason,
      architecture: state.architecture || 'InfoNCE with frozen encoder'
    });
  }
}

module.exports = AdaptiveVAENNTrainer;