const logger = require('../../utils/logger');
const InterYearUncertaintyManager = require('./InterYearUncertaintyManager');

/**
 * Bayesian Team Distribution Updater
 * 
 * Updates team latent distributions N(μ, σ²) using Bayesian inference
 * Handles VAE-encoded team representations with uncertainty quantification
 * 
 * Key Features:
 * - Bayesian inference: posterior = bayesian_update(prior, likelihood)
 * - Opponent strength considerations in update calculations
 * - Uncertainty estimates that decrease with more game observations
 * - Integration with VAE latent space (16-dimensional)
 */
class BayesianTeamUpdater {
  constructor(teamRepository, options = {}) {
    this.teamRepo = teamRepository;
    
    // Bayesian update parameters
    this.initialUncertainty = options.initialUncertainty || 1.0; // Initial σ for new teams
    this.minUncertainty = options.minUncertainty || 0.1; // Minimum σ after many games
    this.uncertaintyDecayRate = options.uncertaintyDecayRate || 0.95; // How fast uncertainty decreases
    this.learningRate = options.learningRate || 0.1; // Base learning rate for updates
    this.opponentStrengthWeight = options.opponentStrengthWeight || 0.3; // Weight for opponent adjustments
    
    // Convergence parameters
    this.maxGamesForConvergence = options.maxGamesForConvergence || 20; // Games needed for full convergence
    this.confidenceThreshold = options.confidenceThreshold || 0.8; // Confidence threshold for stable estimates
    
    // Season-aware parameters
    this.enableSeasonTransitions = options.enableSeasonTransitions !== false; // Default true
    this.crossSeasonDecay = options.crossSeasonDecay || 0.7; // Exponential decay for cross-season games
    
    // Initialize inter-year uncertainty manager
    this.uncertaintyManager = new InterYearUncertaintyManager(teamRepository, {
      interYearVariance: options.interYearVariance || 0.25,
      maxUncertainty: options.maxUncertainty || 2.0,
      minUncertainty: this.minUncertainty,
      logAdjustments: options.logSeasonTransitions !== false,
      seasonDetector: options.seasonDetector || {}
    });
    
    logger.info('Initialized BayesianTeamUpdater', {
      initialUncertainty: this.initialUncertainty,
      minUncertainty: this.minUncertainty,
      uncertaintyDecayRate: this.uncertaintyDecayRate,
      learningRate: this.learningRate,
      opponentStrengthWeight: this.opponentStrengthWeight,
      enableSeasonTransitions: this.enableSeasonTransitions,
      crossSeasonDecay: this.crossSeasonDecay
    });
  }

  /**
   * Initialize team latent distribution for new teams
   * @param {string} teamId - Team ID
   * @param {number} latentDim - Latent space dimensions (default 16)
   * @returns {Object} - Initial team distribution {mu: Array[16], sigma: Array[16], games_processed: 0}
   */
  initializeTeamDistribution(teamId, latentDim = 16) {
    // Initialize with zero mean and initial uncertainty
    const mu = new Array(latentDim).fill(0.0);
    const sigma = new Array(latentDim).fill(this.initialUncertainty);
    
    const distribution = {
      mu,
      sigma,
      games_processed: 0,
      confidence: 0.0,
      last_updated: new Date().toISOString(),
      initialized_at: new Date().toISOString(),
      last_season: this.uncertaintyManager.seasonDetector.getCurrentSeason()
    };

    logger.info('Initialized team latent distribution', {
      teamId,
      latentDim,
      initialUncertainty: this.initialUncertainty,
      gamesProcessed: 0,
      lastSeason: distribution.last_season
    });

    return distribution;
  }

  /**
   * Update team latent distribution from game stats using VAE encoding + Bayesian inference
   * @param {string} teamId - Team ID
   * @param {Array} gameStats - Normalized game statistics [80] for VAE encoding
   * @param {Object} vae - VAE instance for encoding
   * @param {Object} gameContext - Game context information
   * @param {Object} opponentDistribution - Opponent's latent distribution (optional)
   * @returns {Promise<Object>} - Updated team distribution
   */
  async updateTeamDistributionFromGameStats(teamId, gameStats, vae, gameContext, opponentDistribution = null) {
    try {
      // Check for season transitions before updating
      if (this.enableSeasonTransitions && gameContext.gameDate) {
        await this.checkAndApplySeasonTransition(teamId, gameContext.gameDate);
      }
      
      // Encode game stats to latent distribution
      const { mu: observedMu, sigma: observedSigma } = vae.encodeGameToTeamDistribution(gameStats);
      
      // Update using the observed latent distribution
      return await this.updateTeamDistribution(
        teamId, 
        observedMu, 
        gameContext, 
        opponentDistribution,
        observedSigma // Pass observed uncertainty
      );
    } catch (error) {
      logger.error('Failed to update team distribution from game stats', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update team latent distribution using Bayesian inference
   * @param {string} teamId - Team ID
   * @param {Array} observedLatent - Observed latent representation from VAE encoding [16]
   * @param {Object} gameContext - Game context information
   * @param {Object} opponentDistribution - Opponent's latent distribution (optional)
   * @param {Array} observedUncertainty - Observed uncertainty from VAE (optional)
   * @returns {Promise<Object>} - Updated team distribution
   */
  async updateTeamDistribution(teamId, observedLatent, gameContext, opponentDistribution = null, observedUncertainty = null) {
    try {
      // Check for season transitions before updating
      let seasonTransitionResult = null;
      if (this.enableSeasonTransitions && gameContext.gameDate) {
        seasonTransitionResult = await this.checkAndApplySeasonTransition(teamId, gameContext.gameDate);
      }
      
      // Get current team distribution (prior) - refresh after potential season transition
      let currentDistribution = await this.getTeamDistribution(teamId);
      
      if (!currentDistribution) {
        // Initialize if doesn't exist
        currentDistribution = this.initializeTeamDistribution(teamId, observedLatent.length);
        await this.saveTeamDistribution(teamId, currentDistribution);
      }

      // Apply season-aware weighting for cross-season games
      const seasonAwareWeight = this.calculateSeasonAwareWeight(gameContext, currentDistribution);

      // Calculate observation uncertainty based on game context
      let observationUncertainty;
      if (observedUncertainty) {
        // Use VAE-provided uncertainty, adjusted for context and season
        const contextMultiplier = this.calculateContextMultiplier(gameContext, opponentDistribution);
        observationUncertainty = observedUncertainty.map(sigma => sigma * contextMultiplier * seasonAwareWeight);
      } else {
        // Calculate uncertainty based on context and season
        const baseUncertainty = this.calculateObservationUncertainty(
          gameContext,
          currentDistribution.games_processed,
          opponentDistribution
        );
        observationUncertainty = new Array(observedLatent.length).fill(baseUncertainty * seasonAwareWeight);
      }

      // Perform Bayesian update for each dimension
      const updatedMu = [];
      const updatedSigma = [];

      for (let i = 0; i < observedLatent.length; i++) {
        const { mu, sigma } = this.bayesianUpdate(
          currentDistribution.mu[i],
          currentDistribution.sigma[i],
          observedLatent[i],
          observationUncertainty[i] || observationUncertainty[0] // Use first element if scalar
        );
        
        updatedMu.push(mu);
        updatedSigma.push(sigma);
      }

      // Apply opponent strength adjustment if available
      if (opponentDistribution && gameContext.gameResult) {
        this.applyOpponentStrengthAdjustment(
          updatedMu,
          updatedSigma,
          opponentDistribution,
          gameContext.gameResult
        );
      }

      // Update metadata
      const updatedDistribution = {
        mu: updatedMu,
        sigma: updatedSigma,
        games_processed: currentDistribution.games_processed + 1,
        confidence: this.calculateConfidence(currentDistribution.games_processed + 1),
        last_updated: new Date().toISOString(),
        initialized_at: currentDistribution.initialized_at || new Date().toISOString(),
        last_season: currentDistribution.last_season || this.uncertaintyManager.seasonDetector.getCurrentSeason(),
        // Preserve season transition history if it exists
        season_transition_history: currentDistribution.season_transition_history
      };

      // Save updated distribution
      await this.saveTeamDistribution(teamId, updatedDistribution);

      logger.info('Updated team latent distribution', {
        teamId,
        gamesProcessed: updatedDistribution.games_processed,
        confidence: updatedDistribution.confidence.toFixed(3),
        avgUncertainty: (updatedSigma.reduce((sum, s) => sum + s, 0) / updatedSigma.length).toFixed(3),
        seasonAwareWeight: seasonAwareWeight.toFixed(3)
      });

      return updatedDistribution;

    } catch (error) {
      logger.error('Failed to update team distribution', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Perform Bayesian update for a single dimension
   * @param {number} priorMu - Prior mean
   * @param {number} priorSigma - Prior standard deviation
   * @param {number} observedValue - Observed value
   * @param {number} observationSigma - Observation uncertainty
   * @returns {Object} - Updated {mu, sigma}
   */
  bayesianUpdate(priorMu, priorSigma, observedValue, observationSigma) {
    // Bayesian update using precision (inverse variance) weighting
    const priorPrecision = 1 / (priorSigma * priorSigma);
    const observationPrecision = 1 / (observationSigma * observationSigma);
    
    // Posterior precision is sum of precisions
    const posteriorPrecision = priorPrecision + observationPrecision;
    const posteriorVariance = 1 / posteriorPrecision;
    const posteriorSigma = Math.sqrt(posteriorVariance);
    
    // Posterior mean is precision-weighted average
    const posteriorMu = (priorMu * priorPrecision + observedValue * observationPrecision) / posteriorPrecision;
    
    return {
      mu: posteriorMu,
      sigma: Math.max(posteriorSigma, this.minUncertainty) // Enforce minimum uncertainty
    };
  }

  /**
   * Calculate observation uncertainty based on game context and opponent strength
   * Uses ELO-like logic to adjust uncertainty based on expected vs actual performance
   * @param {Object} gameContext - Game context information
   * @param {number} gamesProcessed - Number of games already processed
   * @param {Object} opponentDistribution - Opponent's distribution (optional)
   * @returns {Array|number} - Observation uncertainty (per dimension or scalar)
   */
  calculateObservationUncertainty(gameContext, gamesProcessed, opponentDistribution = null) {
    // Base uncertainty decreases with more games
    let baseUncertainty = this.initialUncertainty * Math.pow(this.uncertaintyDecayRate, gamesProcessed);
    baseUncertainty = Math.max(baseUncertainty, this.minUncertainty);

    // Adjust for game context factors
    let contextMultiplier = 1.0;

    // Higher uncertainty for unusual game contexts
    if (gameContext.isNeutralSite) {
      contextMultiplier *= 1.2; // Neutral site games are less predictable
    }

    if (gameContext.isConferenceGame === false) {
      contextMultiplier *= 1.1; // Non-conference games have more uncertainty
    }

    if (gameContext.restDays && gameContext.restDays < 2) {
      contextMultiplier *= 1.15; // Back-to-back games are less reliable
    }

    if (gameContext.isPostseason) {
      contextMultiplier *= 0.9; // Tournament games are more reliable (teams play harder)
    }

    // ELO-like opponent strength adjustment
    if (opponentDistribution && gameContext.gameResult) {
      const opponentStrengthAdjustment = this.calculateOpponentStrengthAdjustment(
        opponentDistribution,
        gameContext.gameResult
      );
      contextMultiplier *= opponentStrengthAdjustment;
    }

    const finalUncertainty = baseUncertainty * contextMultiplier;

    logger.debug('Calculated observation uncertainty', {
      baseUncertainty: baseUncertainty.toFixed(3),
      contextMultiplier: contextMultiplier.toFixed(3),
      finalUncertainty: finalUncertainty.toFixed(3),
      gamesProcessed
    });

    return finalUncertainty;
  }

  /**
   * Calculate ELO-like opponent strength adjustment for observation uncertainty
   * @param {Object} opponentDistribution - Opponent's latent distribution
   * @param {Object} gameResult - Game result information
   * @returns {number} - Uncertainty multiplier (0.5 to 2.0)
   */
  calculateOpponentStrengthAdjustment(opponentDistribution, gameResult) {
    // Calculate opponent strength (average latent value)
    const opponentStrength = opponentDistribution.mu 
      ? opponentDistribution.mu.reduce((sum, mu) => sum + mu, 0) / opponentDistribution.mu.length
      : 0;
    
    // Calculate opponent uncertainty (how well we know their strength)
    const opponentUncertainty = opponentDistribution.sigma 
      ? opponentDistribution.sigma.reduce((sum, s) => sum + s, 0) / opponentDistribution.sigma.length
      : this.initialUncertainty;

    // Expected performance based on opponent strength
    // Strong opponents (positive latent): we expect to perform worse
    // Weak opponents (negative latent): we expect to perform better
    const expectedPerformanceImpact = -opponentStrength * 0.3; // Negative because strong opponents hurt our stats

    // Actual performance (normalized point differential)
    const actualPerformance = gameResult.pointDifferential 
      ? Math.tanh(gameResult.pointDifferential / 20.0) // Normalize to [-1, 1]
      : (gameResult.won ? 0.2 : -0.2); // Basic win/loss if no point differential

    // Surprise factor: how much the result differed from expectation
    const surpriseFactor = Math.abs(actualPerformance - expectedPerformanceImpact);

    // Uncertainty adjustment based on surprise and opponent uncertainty
    let uncertaintyMultiplier = 1.0;

    if (surpriseFactor > 0.5) {
      // High surprise: either we performed much better/worse than expected
      // This could indicate our model is wrong, so increase uncertainty
      uncertaintyMultiplier *= (1 + surpriseFactor * 0.5);
    } else {
      // Low surprise: result was as expected, so we can be more confident
      uncertaintyMultiplier *= (1 - surpriseFactor * 0.3);
    }

    // If opponent is well-known (low uncertainty), trust the observation more
    if (opponentUncertainty < this.initialUncertainty * 0.5) {
      uncertaintyMultiplier *= 0.8; // More confident in observations against known opponents
    } else {
      uncertaintyMultiplier *= 1.2; // Less confident against unknown opponents
    }

    // Clamp to reasonable range
    uncertaintyMultiplier = Math.max(0.5, Math.min(2.0, uncertaintyMultiplier));

    logger.debug('Calculated opponent strength adjustment', {
      opponentStrength: opponentStrength.toFixed(3),
      opponentUncertainty: opponentUncertainty.toFixed(3),
      expectedPerformance: expectedPerformanceImpact.toFixed(3),
      actualPerformance: actualPerformance.toFixed(3),
      surpriseFactor: surpriseFactor.toFixed(3),
      uncertaintyMultiplier: uncertaintyMultiplier.toFixed(3)
    });

    return uncertaintyMultiplier;
  }

  /**
   * Calculate context multiplier for uncertainty adjustment
   * @param {Object} gameContext - Game context information
   * @param {Object} opponentDistribution - Opponent's distribution (optional)
   * @returns {number} - Context multiplier
   */
  calculateContextMultiplier(gameContext, opponentDistribution = null) {
    let contextMultiplier = 1.0;

    // Game context adjustments
    if (gameContext.isNeutralSite) contextMultiplier *= 1.2;
    if (gameContext.isConferenceGame === false) contextMultiplier *= 1.1;
    if (gameContext.restDays && gameContext.restDays < 2) contextMultiplier *= 1.15;
    if (gameContext.isPostseason) contextMultiplier *= 0.9;

    // Opponent strength adjustment
    if (opponentDistribution && gameContext.gameResult) {
      const opponentAdjustment = this.calculateOpponentStrengthAdjustment(
        opponentDistribution,
        gameContext.gameResult
      );
      contextMultiplier *= opponentAdjustment;
    }

    return contextMultiplier;
  }

  /**
   * Apply opponent strength adjustment to updated distribution
   * @param {Array} updatedMu - Updated mean vector (modified in place)
   * @param {Array} updatedSigma - Updated sigma vector (modified in place)
   * @param {Object} opponentDistribution - Opponent's latent distribution
   * @param {Object} gameResult - Game result information
   */
  applyOpponentStrengthAdjustment(updatedMu, updatedSigma, opponentDistribution, gameResult) {
    if (!opponentDistribution.mu || !gameResult) return;

    // Calculate opponent strength (average of latent dimensions)
    const opponentStrength = opponentDistribution.mu.reduce((sum, mu) => sum + mu, 0) / opponentDistribution.mu.length;
    const opponentUncertainty = opponentDistribution.sigma 
      ? opponentDistribution.sigma.reduce((sum, s) => sum + s, 0) / opponentDistribution.sigma.length
      : this.initialUncertainty;

    // Calculate performance delta based on game result
    const performanceDelta = this.calculatePerformanceDelta(gameResult, opponentStrength);

    // Apply opponent-adjusted update to each dimension
    for (let i = 0; i < updatedMu.length; i++) {
      // Stronger opponents make good performance more impressive
      const opponentAdjustment = performanceDelta * this.opponentStrengthWeight * (1 + opponentStrength * 0.1);
      
      updatedMu[i] += opponentAdjustment;
      
      // Higher opponent uncertainty increases our uncertainty slightly
      updatedSigma[i] = Math.max(
        updatedSigma[i] * (1 + opponentUncertainty * 0.1),
        this.minUncertainty
      );
    }

    logger.debug('Applied opponent strength adjustment', {
      opponentStrength: opponentStrength.toFixed(3),
      opponentUncertainty: opponentUncertainty.toFixed(3),
      performanceDelta: performanceDelta.toFixed(3)
    });
  }

  /**
   * Calculate performance delta from game result
   * @param {Object} gameResult - Game result information
   * @param {number} opponentStrength - Opponent's average strength
   * @returns {number} - Performance delta (-1 to 1)
   */
  calculatePerformanceDelta(gameResult, opponentStrength) {
    // Basic win/loss delta
    let delta = gameResult.won ? 0.1 : -0.1;

    // Adjust for margin of victory/defeat
    if (gameResult.pointDifferential !== undefined) {
      // Normalize point differential to [-1, 1] range
      const normalizedMargin = Math.tanh(gameResult.pointDifferential / 20.0);
      delta += normalizedMargin * 0.2;
    }

    // Adjust for expected outcome based on opponent strength
    // Strong opponents: good performance is more impressive
    // Weak opponents: poor performance is more concerning
    const expectedPerformance = -opponentStrength * 0.1; // Negative because strong opponents are harder
    const surpriseFactor = delta - expectedPerformance;
    
    return Math.max(-1.0, Math.min(1.0, surpriseFactor));
  }

  /**
   * Calculate confidence level based on games processed
   * @param {number} gamesProcessed - Number of games processed
   * @returns {number} - Confidence level (0-1)
   */
  calculateConfidence(gamesProcessed) {
    // Asymptotic approach to confidence threshold
    const progress = gamesProcessed / this.maxGamesForConvergence;
    return this.confidenceThreshold * (1 - Math.exp(-progress * 3));
  }

  /**
   * Get team latent distribution from database
   * @param {string} teamId - Team ID
   * @returns {Promise<Object|null>} - Team distribution or null
   */
  async getTeamDistribution(teamId) {
    try {
      const team = await this.teamRepo.getTeamByEspnId(teamId);
      
      if (!team || !team.statisticalRepresentation) {
        return null;
      }

      const representation = JSON.parse(team.statisticalRepresentation);
      
      // Validate distribution structure
      if (!representation.mu || !representation.sigma) {
        logger.warn('Invalid team distribution structure', { teamId });
        return null;
      }

      return representation;

    } catch (error) {
      logger.error('Failed to get team distribution', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Save team latent distribution to database
   * @param {string} teamId - Team ID
   * @param {Object} distribution - Team latent distribution
   * @returns {Promise<void>}
   */
  async saveTeamDistribution(teamId, distribution) {
    try {
      await this.teamRepo.updateStatisticalRepresentation(teamId, distribution);
      
      logger.debug('Saved team distribution to database', {
        teamId,
        gamesProcessed: distribution.games_processed,
        confidence: distribution.confidence
      });

    } catch (error) {
      logger.error('Failed to save team distribution', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Batch update multiple teams from game results
   * @param {Array} gameResults - Array of game result objects
   * @returns {Promise<Array>} - Array of update results
   */
  async batchUpdateTeams(gameResults) {
    const updateResults = [];

    for (const gameResult of gameResults) {
      try {
        // Update home team
        if (gameResult.homeTeamLatent) {
          const homeUpdate = await this.updateTeamDistribution(
            gameResult.homeTeamId,
            gameResult.homeTeamLatent,
            {
              ...gameResult.gameContext,
              gameResult: {
                won: gameResult.homeScore > gameResult.awayScore,
                pointDifferential: gameResult.homeScore - gameResult.awayScore
              }
            },
            gameResult.awayTeamDistribution
          );
          updateResults.push({ teamId: gameResult.homeTeamId, update: homeUpdate });
        }

        // Update away team
        if (gameResult.awayTeamLatent) {
          const awayUpdate = await this.updateTeamDistribution(
            gameResult.awayTeamId,
            gameResult.awayTeamLatent,
            {
              ...gameResult.gameContext,
              gameResult: {
                won: gameResult.awayScore > gameResult.homeScore,
                pointDifferential: gameResult.awayScore - gameResult.homeScore
              }
            },
            gameResult.homeTeamDistribution
          );
          updateResults.push({ teamId: gameResult.awayTeamId, update: awayUpdate });
        }

      } catch (error) {
        logger.error('Failed to update team in batch', {
          gameId: gameResult.gameId,
          error: error.message
        });
        updateResults.push({ 
          teamId: gameResult.homeTeamId || gameResult.awayTeamId, 
          error: error.message 
        });
      }
    }

    logger.info('Completed batch team updates', {
      totalGames: gameResults.length,
      successfulUpdates: updateResults.filter(r => !r.error).length,
      failedUpdates: updateResults.filter(r => r.error).length
    });

    return updateResults;
  }

  /**
   * Get team distribution statistics
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} - Distribution statistics
   */
  async getTeamStatistics(teamId) {
    try {
      const distribution = await this.getTeamDistribution(teamId);
      
      if (!distribution) {
        return null;
      }

      // Calculate statistics
      const avgMu = distribution.mu.reduce((sum, mu) => sum + mu, 0) / distribution.mu.length;
      const avgSigma = distribution.sigma.reduce((sum, s) => sum + s, 0) / distribution.sigma.length;
      const totalUncertainty = Math.sqrt(distribution.sigma.reduce((sum, s) => sum + s * s, 0));

      return {
        teamId,
        gamesProcessed: distribution.games_processed,
        confidence: distribution.confidence,
        averageMu: avgMu,
        averageSigma: avgSigma,
        totalUncertainty,
        lastUpdated: distribution.last_updated,
        initializedAt: distribution.initialized_at,
        isConverged: distribution.confidence >= this.confidenceThreshold,
        uncertaintyReduction: this.initialUncertainty > 0 
          ? (1 - avgSigma / this.initialUncertainty) 
          : 0
      };

    } catch (error) {
      logger.error('Failed to get team statistics', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Reset team distribution (for new season or retraining)
   * @param {string} teamId - Team ID
   * @param {number} regressionFactor - How much to regress toward mean (0-1)
   * @returns {Promise<Object>} - Reset distribution
   */
  async resetTeamDistribution(teamId, regressionFactor = 0.5) {
    try {
      const currentDistribution = await this.getTeamDistribution(teamId);
      
      if (!currentDistribution) {
        // Initialize new distribution
        return this.initializeTeamDistribution(teamId);
      }

      // Apply regression toward zero mean
      const regressedMu = currentDistribution.mu.map(mu => mu * (1 - regressionFactor));
      const regressedSigma = currentDistribution.sigma.map(sigma => 
        Math.max(sigma * (1 + regressionFactor), this.initialUncertainty * 0.5)
      );

      const resetDistribution = {
        mu: regressedMu,
        sigma: regressedSigma,
        games_processed: 0,
        confidence: 0.0,
        last_updated: new Date().toISOString(),
        initialized_at: currentDistribution.initialized_at,
        reset_from: {
          games_processed: currentDistribution.games_processed,
          confidence: currentDistribution.confidence,
          reset_at: new Date().toISOString()
        }
      };

      await this.saveTeamDistribution(teamId, resetDistribution);

      logger.info('Reset team distribution', {
        teamId,
        regressionFactor,
        previousGames: currentDistribution.games_processed,
        previousConfidence: currentDistribution.confidence
      });

      return resetDistribution;

    } catch (error) {
      logger.error('Failed to reset team distribution', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Export configuration and parameters
   * @returns {Object} - Configuration object
   */
  getConfiguration() {
    return {
      initialUncertainty: this.initialUncertainty,
      minUncertainty: this.minUncertainty,
      uncertaintyDecayRate: this.uncertaintyDecayRate,
      learningRate: this.learningRate,
      opponentStrengthWeight: this.opponentStrengthWeight,
      maxGamesForConvergence: this.maxGamesForConvergence,
      confidenceThreshold: this.confidenceThreshold,
      enableSeasonTransitions: this.enableSeasonTransitions,
      crossSeasonDecay: this.crossSeasonDecay,
      uncertaintyManager: this.uncertaintyManager.getConfiguration()
    };
  }

  /**
   * Check and apply season transition for a team
   * @param {string} teamId - Team ID
   * @param {Date} gameDate - Game date to check transition against
   * @returns {Promise<Object>} - Transition result
   */
  async checkAndApplySeasonTransition(teamId, gameDate) {
    try {
      if (!this.enableSeasonTransitions) {
        return { transitionDetected: false };
      }

      const result = await this.uncertaintyManager.checkAndApplySeasonTransition(teamId, gameDate);
      
      if (result.transitionDetected) {
        logger.info('Season transition applied during Bayesian update', {
          teamId,
          previousSeason: result.previousSeason,
          newSeason: result.newSeason,
          gameDate: gameDate.toISOString()
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to check season transition during Bayesian update', {
        teamId,
        gameDate: gameDate.toISOString(),
        error: error.message
      });
      // Don't throw - continue with update even if season transition fails
      return { transitionDetected: false, error: error.message };
    }
  }

  /**
   * Calculate season-aware weight for game observations
   * Recent games within the same season get full weight
   * Games from previous seasons get exponentially decayed weight
   * @param {Object} gameContext - Game context information
   * @param {Object} currentDistribution - Current team distribution
   * @returns {number} - Weight multiplier (0-1)
   */
  calculateSeasonAwareWeight(gameContext, currentDistribution) {
    if (!this.enableSeasonTransitions || !gameContext.gameDate || !currentDistribution.last_season) {
      return 1.0; // Full weight if season transitions disabled or no season info
    }

    const gameDate = new Date(gameContext.gameDate);
    const gameSeason = this.uncertaintyManager.seasonDetector.getSeasonForDate(gameDate);
    const currentSeason = currentDistribution.last_season;

    if (gameSeason === currentSeason) {
      // Same season - full weight
      return 1.0;
    }

    // Cross-season game - apply exponential decay
    // Calculate how many seasons ago this game was
    const gameSeasonYear = parseInt(gameSeason.split('-')[0], 10);
    const currentSeasonYear = parseInt(currentSeason.split('-')[0], 10);
    const seasonsDifference = currentSeasonYear - gameSeasonYear;

    if (seasonsDifference <= 0) {
      // Future season or same season - full weight
      return 1.0;
    }

    // Apply exponential decay based on seasons difference
    const weight = Math.pow(this.crossSeasonDecay, seasonsDifference);
    
    logger.debug('Applied season-aware weighting', {
      gameSeason,
      currentSeason,
      seasonsDifference,
      weight: weight.toFixed(3),
      crossSeasonDecay: this.crossSeasonDecay
    });

    return weight;
  }

  /**
   * Get season transition statistics for all teams
   * @param {string} sport - Sport filter (optional)
   * @returns {Promise<Object>} - Season transition statistics
   */
  async getSeasonTransitionStatistics(sport = 'mens-college-basketball') {
    return await this.uncertaintyManager.getSeasonTransitionStatistics(sport);
  }

  /**
   * Manually trigger season transitions for all teams
   * @param {Date} currentDate - Current date
   * @param {string} sport - Sport filter (optional)
   * @returns {Promise<Array>} - Transition results
   */
  async triggerSeasonTransitionsForAllTeams(currentDate, sport = 'mens-college-basketball') {
    if (!this.enableSeasonTransitions) {
      logger.warn('Season transitions are disabled');
      return [];
    }

    return await this.uncertaintyManager.applySeasonTransitionsForAllTeams(currentDate, sport);
  }

  /**
   * Update configuration parameters
   * @param {Object} config - New configuration parameters
   */
  updateConfiguration(config) {
    if (config.initialUncertainty !== undefined) {
      this.initialUncertainty = config.initialUncertainty;
    }
    if (config.minUncertainty !== undefined) {
      this.minUncertainty = config.minUncertainty;
    }
    if (config.uncertaintyDecayRate !== undefined) {
      this.uncertaintyDecayRate = config.uncertaintyDecayRate;
    }
    if (config.learningRate !== undefined) {
      this.learningRate = config.learningRate;
    }
    if (config.opponentStrengthWeight !== undefined) {
      this.opponentStrengthWeight = config.opponentStrengthWeight;
    }
    if (config.maxGamesForConvergence !== undefined) {
      this.maxGamesForConvergence = config.maxGamesForConvergence;
    }
    if (config.confidenceThreshold !== undefined) {
      this.confidenceThreshold = config.confidenceThreshold;
    }
    if (config.enableSeasonTransitions !== undefined) {
      this.enableSeasonTransitions = config.enableSeasonTransitions;
    }
    if (config.crossSeasonDecay !== undefined) {
      this.crossSeasonDecay = config.crossSeasonDecay;
    }
    if (config.uncertaintyManager) {
      this.uncertaintyManager.updateConfiguration(config.uncertaintyManager);
    }

    logger.info('Updated BayesianTeamUpdater configuration', config);
  }
}

module.exports = BayesianTeamUpdater;