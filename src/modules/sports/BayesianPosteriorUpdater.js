const logger = require('../../utils/logger');

/**
 * Bayesian Posterior Updater for InfoNCE VAE-NN Architecture
 * 
 * Implements Bayesian posterior updates for team representations in the new architecture:
 * - Uses frozen VAE encoder (no gradient updates)
 * - Updates posterior distributions via Bayesian inference: p(z|games) ∝ p(y|z,opponent,context) p(z)
 * - Uses NN model to compute likelihood p(y|z,opponent,context)
 * - Maintains team representations in InfoNCE latent space
 * 
 * Key differences from BayesianTeamUpdater:
 * - No VAE encoding during updates (encoder is frozen)
 * - Uses NN model for likelihood computation
 * - Operates on stored posterior distributions
 * - Preserves InfoNCE structure
 */
class BayesianPosteriorUpdater {
  constructor(teamRepository, nnModel, options = {}) {
    this.teamRepo = teamRepository;
    this.nnModel = nnModel; // Neural network for likelihood computation
    
    // Bayesian update parameters
    this.learningRate = options.learningRate || 0.1;
    this.minUncertainty = options.minUncertainty || 0.1;
    this.maxUncertainty = options.maxUncertainty || 2.0;
    this.likelihoodWeight = options.likelihoodWeight || 1.0;
    
    // InfoNCE space parameters
    this.latentDim = options.latentDim || 16;
    this.preserveInfoNCEStructure = options.preserveInfoNCEStructure !== false;
    
    logger.info('Initialized BayesianPosteriorUpdater', {
      learningRate: this.learningRate,
      minUncertainty: this.minUncertainty,
      maxUncertainty: this.maxUncertainty,
      latentDim: this.latentDim,
      preserveInfoNCEStructure: this.preserveInfoNCEStructure
    });
  }

  /**
   * Update team posterior distribution using Bayesian inference
   * p(z|games) ∝ p(y|z,opponent,context) p(z)
   * 
   * @param {string} teamId - Team ID
   * @param {Array} actualTransitionProbs - Observed transition probabilities [8]
   * @param {string} opponentId - Opponent team ID
   * @param {Object} gameContext - Game context information
   * @returns {Promise<Object>} - Updated posterior distribution
   */
  async updatePosterior(teamId, actualTransitionProbs, opponentId, gameContext) {
    try {
      // Get current posterior distributions (priors)
      const teamPrior = await this.teamRepo.getTeamEncodingFromDb(teamId);
      const opponentPosterior = await this.teamRepo.getTeamEncodingFromDb(opponentId);
      
      if (!teamPrior) {
        throw new Error(`No prior distribution found for team ${teamId}`);
      }
      
      if (!opponentPosterior) {
        logger.warn(`No opponent distribution found for ${opponentId}, using default`);
      }

      // Validate inputs
      if (!Array.isArray(actualTransitionProbs) || actualTransitionProbs.length !== 8) {
        throw new Error('actualTransitionProbs must be array of length 8');
      }

      // Compute likelihood using NN model
      const likelihood = await this.computeLikelihood(
        teamPrior,
        opponentPosterior,
        gameContext,
        actualTransitionProbs
      );

      // Perform Bayesian update
      const updatedPosterior = this.bayesianUpdate(teamPrior, likelihood, gameContext);

      // Validate InfoNCE structure preservation
      if (this.preserveInfoNCEStructure) {
        this.validateInfoNCEStructure(updatedPosterior);
      }

      // Save updated posterior
      const season = this.extractSeason(gameContext.gameDate);
      await this.teamRepo.updatePosteriorAfterGame(teamId, updatedPosterior, season);

      logger.info('Updated team posterior distribution', {
        teamId,
        opponentId,
        gamesProcessed: (teamPrior.games_processed || 0) + 1,
        avgUncertainty: this.calculateAverageUncertainty(updatedPosterior.sigma)
      });

      return updatedPosterior;

    } catch (error) {
      logger.error('Failed to update posterior distribution', {
        teamId,
        opponentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Compute likelihood p(y|z,opponent,context) using NN model
   * 
   * @param {Object} teamPosterior - Team posterior distribution
   * @param {Object} opponentPosterior - Opponent posterior distribution
   * @param {Object} gameContext - Game context
   * @param {Array} actualTransitionProbs - Observed transition probabilities
   * @returns {Promise<Object>} - Likelihood parameters {mu, sigma}
   */
  async computeLikelihood(teamPosterior, opponentPosterior, gameContext, actualTransitionProbs) {
    try {
      // Build NN input: [team_posterior_mu, team_posterior_sigma, opponent_posterior_mu, opponent_posterior_sigma, context]
      const nnInput = this.buildNNInput(teamPosterior, opponentPosterior, gameContext);
      
      // Get NN prediction for transition probabilities
      const predictedTransitionProbs = await this.nnModel.predict(nnInput);
      
      // Compute likelihood based on prediction error
      const predictionError = this.computePredictionError(predictedTransitionProbs, actualTransitionProbs);
      
      // Convert prediction error to likelihood parameters
      const likelihood = this.errorToLikelihood(predictionError, teamPosterior, actualTransitionProbs, predictedTransitionProbs);
      
      logger.debug('Computed likelihood from NN prediction', {
        predictionError: predictionError.toFixed(4),
        likelihoodUncertainty: this.calculateAverageUncertainty(likelihood.sigma),
        performanceSignal: this.computePerformanceSignal(actualTransitionProbs, predictedTransitionProbs).toFixed(4)
      });

      return likelihood;

    } catch (error) {
      logger.error('Failed to compute likelihood', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Build neural network input vector
   * 
   * @param {Object} teamPosterior - Team posterior distribution
   * @param {Object} opponentPosterior - Opponent posterior distribution  
   * @param {Object} gameContext - Game context
   * @returns {Array} - NN input vector
   */
  buildNNInput(teamPosterior, opponentPosterior, gameContext) {
    const input = [];
    
    // Team posterior mean and variance (16 + 16 = 32 dimensions)
    input.push(...teamPosterior.mu);
    input.push(...teamPosterior.sigma.map(s => s * s)); // Use variance, not std dev
    
    // Opponent posterior mean and variance (16 + 16 = 32 dimensions)
    if (opponentPosterior) {
      input.push(...opponentPosterior.mu);
      input.push(...opponentPosterior.sigma.map(s => s * s));
    } else {
      // Use neutral values for unknown opponent
      input.push(...new Array(16).fill(0.0)); // Zero mean
      input.push(...new Array(16).fill(1.0)); // Unit variance
    }
    
    // Game context features (~10 dimensions)
    input.push(gameContext.isHomeGame ? 1.0 : 0.0);
    input.push(gameContext.isNeutralSite ? 1.0 : 0.0);
    input.push(gameContext.isConferenceGame ? 1.0 : 0.0);
    input.push(gameContext.isPostseason ? 1.0 : 0.0);
    input.push(gameContext.restDays || 2.0); // Default 2 rest days
    input.push(gameContext.seasonProgress || 0.5); // Default mid-season
    input.push(gameContext.temperature || 70.0); // Default temperature
    input.push(gameContext.altitude || 0.0); // Default sea level
    input.push(gameContext.crowdSize || 10000.0); // Default crowd size
    input.push(gameContext.tvGame ? 1.0 : 0.0);
    
    return input;
  }

  /**
   * Compute prediction error between predicted and actual transition probabilities
   * 
   * @param {Array} predicted - Predicted transition probabilities [8]
   * @param {Array} actual - Actual transition probabilities [8]
   * @returns {number} - Prediction error (0-1)
   */
  computePredictionError(predicted, actual) {
    if (predicted.length !== actual.length) {
      throw new Error('Predicted and actual arrays must have same length');
    }
    
    // Use cross-entropy loss as prediction error
    let crossEntropy = 0;
    for (let i = 0; i < predicted.length; i++) {
      // Clamp probabilities to avoid log(0)
      const p = Math.max(1e-8, Math.min(1 - 1e-8, predicted[i]));
      const a = Math.max(1e-8, Math.min(1 - 1e-8, actual[i]));
      crossEntropy -= a * Math.log(p);
    }
    
    // Normalize to [0, 1] range
    const maxCrossEntropy = -Math.log(1e-8); // Maximum possible cross-entropy
    return Math.min(1.0, crossEntropy / maxCrossEntropy);
  }

  /**
   * Convert prediction error to likelihood parameters
   * 
   * @param {number} predictionError - Prediction error (0-1)
   * @param {Object} teamPosterior - Current team posterior
   * @param {Array} actualTransitionProbs - Observed transition probabilities
   * @param {Array} predictedTransitionProbs - Predicted transition probabilities
   * @returns {Object} - Likelihood parameters {mu, sigma}
   */
  errorToLikelihood(predictionError, teamPosterior, actualTransitionProbs, predictedTransitionProbs) {
    // Lower prediction error = higher confidence in observation
    // Higher prediction error = lower confidence in observation
    
    const baseUncertainty = 0.5; // Base observation uncertainty
    const errorMultiplier = 1 + predictionError * 2; // Scale uncertainty by error
    
    const likelihoodSigma = teamPosterior.sigma.map(s => 
      Math.max(this.minUncertainty, baseUncertainty * errorMultiplier)
    );
    
    // Compute likelihood mean based on prediction error direction
    // If actual > predicted, nudge latent representation in positive direction
    // If actual < predicted, nudge latent representation in negative direction
    const likelihoodMu = teamPosterior.mu.map((mu, i) => {
      // Calculate aggregate performance signal from transition probabilities
      const performanceSignal = this.computePerformanceSignal(actualTransitionProbs, predictedTransitionProbs);
      
      // Apply small adjustment based on performance signal and prediction error
      const adjustment = performanceSignal * (1 - predictionError) * this.learningRate;
      
      return mu + adjustment;
    });
    
    return {
      mu: likelihoodMu,
      sigma: likelihoodSigma
    };
  }

  /**
   * Compute performance signal from transition probabilities
   * 
   * @param {Array} actual - Actual transition probabilities
   * @param {Array} predicted - Predicted transition probabilities
   * @returns {number} - Performance signal (-1 to 1)
   */
  computePerformanceSignal(actual, predicted) {
    // Compute weighted performance based on positive outcomes
    // Higher make rates and lower miss/turnover rates = positive signal
    const weights = [1, -1, 1.5, -1.5, 1, -1, 0.5, -2]; // [2pt_make, 2pt_miss, 3pt_make, 3pt_miss, ft_make, ft_miss, oreb, turnover]
    
    let actualScore = 0;
    let predictedScore = 0;
    
    for (let i = 0; i < actual.length; i++) {
      actualScore += actual[i] * weights[i];
      predictedScore += predicted[i] * weights[i];
    }
    
    // Return normalized difference
    return Math.tanh(actualScore - predictedScore);
  }

  /**
   * Perform Bayesian update: posterior ∝ likelihood × prior
   * 
   * @param {Object} prior - Prior distribution {mu, sigma}
   * @param {Object} likelihood - Likelihood parameters {mu, sigma}
   * @param {Object} gameContext - Game context for adjustments
   * @returns {Object} - Updated posterior distribution
   */
  bayesianUpdate(prior, likelihood, gameContext) {
    const updatedMu = [];
    const updatedSigma = [];
    
    for (let i = 0; i < prior.mu.length; i++) {
      // Bayesian update using precision weighting
      const priorPrecision = 1 / (prior.sigma[i] * prior.sigma[i]);
      const likelihoodPrecision = 1 / (likelihood.sigma[i] * likelihood.sigma[i]);
      
      // Posterior precision is sum of precisions
      const posteriorPrecision = priorPrecision + likelihoodPrecision * this.likelihoodWeight;
      const posteriorVariance = 1 / posteriorPrecision;
      const posteriorSigma = Math.sqrt(posteriorVariance);
      
      // Posterior mean is precision-weighted average
      const posteriorMu = (
        prior.mu[i] * priorPrecision + 
        likelihood.mu[i] * likelihoodPrecision * this.likelihoodWeight
      ) / posteriorPrecision;
      
      updatedMu.push(posteriorMu);
      updatedSigma.push(Math.max(posteriorSigma, this.minUncertainty));
    }
    
    // Apply context-based adjustments
    this.applyContextAdjustments(updatedMu, updatedSigma, gameContext);
    
    return {
      mu: updatedMu,
      sigma: updatedSigma
    };
  }

  /**
   * Apply context-based adjustments to posterior update
   * 
   * @param {Array} mu - Posterior mean (modified in place)
   * @param {Array} sigma - Posterior sigma (modified in place)
   * @param {Object} gameContext - Game context
   */
  applyContextAdjustments(mu, sigma, gameContext) {
    // Increase uncertainty for unusual game contexts
    let uncertaintyMultiplier = 1.0;
    
    if (gameContext.isNeutralSite) {
      uncertaintyMultiplier *= 1.1; // Neutral site games are less predictable
    }
    
    if (gameContext.isPostseason) {
      uncertaintyMultiplier *= 0.95; // Tournament games are more reliable
    }
    
    if (gameContext.restDays && gameContext.restDays < 2) {
      uncertaintyMultiplier *= 1.15; // Back-to-back games are less reliable
    }
    
    // Apply uncertainty adjustment
    for (let i = 0; i < sigma.length; i++) {
      sigma[i] = Math.min(
        this.maxUncertainty,
        Math.max(this.minUncertainty, sigma[i] * uncertaintyMultiplier)
      );
    }
  }

  /**
   * Validate that posterior remains in InfoNCE structure
   * 
   * @param {Object} posterior - Posterior distribution to validate
   * @throws {Error} - If structure is invalid
   */
  validateInfoNCEStructure(posterior) {
    if (!Array.isArray(posterior.mu) || posterior.mu.length !== this.latentDim) {
      throw new Error(`Invalid posterior mu: expected array of length ${this.latentDim}`);
    }
    
    if (!Array.isArray(posterior.sigma) || posterior.sigma.length !== this.latentDim) {
      throw new Error(`Invalid posterior sigma: expected array of length ${this.latentDim}`);
    }
    
    // Check for reasonable values
    for (let i = 0; i < this.latentDim; i++) {
      if (!isFinite(posterior.mu[i])) {
        throw new Error(`Invalid posterior mu[${i}]: ${posterior.mu[i]}`);
      }
      
      if (!isFinite(posterior.sigma[i]) || posterior.sigma[i] <= 0) {
        throw new Error(`Invalid posterior sigma[${i}]: ${posterior.sigma[i]}`);
      }
      
      if (posterior.sigma[i] > this.maxUncertainty) {
        logger.warn(`High uncertainty detected: sigma[${i}] = ${posterior.sigma[i]}`);
      }
    }
  }

  /**
   * Calculate average uncertainty across dimensions
   * 
   * @param {Array} sigma - Sigma array
   * @returns {number} - Average uncertainty
   */
  calculateAverageUncertainty(sigma) {
    return sigma.reduce((sum, s) => sum + s, 0) / sigma.length;
  }

  /**
   * Extract season from game date
   * 
   * @param {Date|string} gameDate - Game date
   * @returns {string} - Season string (e.g., "2023-24")
   */
  extractSeason(gameDate) {
    const date = gameDate instanceof Date ? gameDate : new Date(gameDate);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // JavaScript months are 0-indexed
    
    // Basketball season spans two calendar years
    // November-December: current year season
    // January-April: previous year season
    if (month >= 11) {
      return `${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `${year - 1}-${year.toString().slice(-2)}`;
    }
  }

  /**
   * Batch update multiple teams from game results
   * 
   * @param {Array} gameResults - Array of game result objects
   * @returns {Promise<Array>} - Array of update results
   */
  async batchUpdatePosteriors(gameResults) {
    const updateResults = [];
    
    for (const gameResult of gameResults) {
      try {
        // Update home team
        if (gameResult.homeTransitionProbs) {
          const homeUpdate = await this.updatePosterior(
            gameResult.homeTeamId,
            gameResult.homeTransitionProbs,
            gameResult.awayTeamId,
            gameResult.gameContext
          );
          updateResults.push({ 
            teamId: gameResult.homeTeamId, 
            update: homeUpdate,
            success: true
          });
        }
        
        // Update away team
        if (gameResult.awayTransitionProbs) {
          const awayUpdate = await this.updatePosterior(
            gameResult.awayTeamId,
            gameResult.awayTransitionProbs,
            gameResult.homeTeamId,
            gameResult.gameContext
          );
          updateResults.push({ 
            teamId: gameResult.awayTeamId, 
            update: awayUpdate,
            success: true
          });
        }
        
      } catch (error) {
        logger.error('Failed to update posterior in batch', {
          gameId: gameResult.gameId,
          error: error.message
        });
        updateResults.push({ 
          teamId: gameResult.homeTeamId || gameResult.awayTeamId, 
          error: error.message,
          success: false
        });
      }
    }
    
    logger.info('Completed batch posterior updates', {
      totalGames: gameResults.length,
      successfulUpdates: updateResults.filter(r => r.success).length,
      failedUpdates: updateResults.filter(r => !r.success).length
    });
    
    return updateResults;
  }

  /**
   * Get configuration parameters
   * 
   * @returns {Object} - Configuration object
   */
  getConfiguration() {
    return {
      learningRate: this.learningRate,
      minUncertainty: this.minUncertainty,
      maxUncertainty: this.maxUncertainty,
      likelihoodWeight: this.likelihoodWeight,
      latentDim: this.latentDim,
      preserveInfoNCEStructure: this.preserveInfoNCEStructure
    };
  }

  /**
   * Update configuration parameters
   * 
   * @param {Object} config - New configuration parameters
   */
  updateConfiguration(config) {
    if (config.learningRate !== undefined) {
      this.learningRate = config.learningRate;
    }
    if (config.minUncertainty !== undefined) {
      this.minUncertainty = config.minUncertainty;
    }
    if (config.maxUncertainty !== undefined) {
      this.maxUncertainty = config.maxUncertainty;
    }
    if (config.likelihoodWeight !== undefined) {
      this.likelihoodWeight = config.likelihoodWeight;
    }
    if (config.preserveInfoNCEStructure !== undefined) {
      this.preserveInfoNCEStructure = config.preserveInfoNCEStructure;
    }
    
    logger.info('Updated BayesianPosteriorUpdater configuration', config);
  }
}

module.exports = BayesianPosteriorUpdater;