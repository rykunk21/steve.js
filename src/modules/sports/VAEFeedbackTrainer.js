const logger = require('../../utils/logger');

/**
 * VAE-NN Feedback Loop Training Coordinator
 * 
 * Coordinates training between VAE and TransitionProbabilityNN with feedback mechanism:
 * - When NN cross-entropy loss > threshold, backprop through VAE
 * - Decaying feedback coefficient α that reduces over time as system stabilizes
 * - Loss combination: VAE_loss = reconstruction + KL + α * NN_loss
 * - Monitoring for feedback loop stability and convergence
 */
class VAEFeedbackTrainer {
  constructor(vae, transitionNN, options = {}) {
    this.vae = vae;
    this.transitionNN = transitionNN;
    
    // Feedback loop parameters
    this.feedbackThreshold = options.feedbackThreshold || 0.5; // NN loss threshold for VAE feedback
    this.initialAlpha = options.initialAlpha || 0.1; // Initial feedback coefficient
    this.alphaDecayRate = options.alphaDecayRate || 0.99; // Decay rate for feedback coefficient
    this.minAlpha = options.minAlpha || 0.001; // Minimum feedback coefficient
    
    // Training parameters
    this.maxIterations = options.maxIterations || 1000;
    this.convergenceThreshold = options.convergenceThreshold || 1e-6;
    this.stabilityWindow = options.stabilityWindow || 10; // Window for stability monitoring
    
    // Monitoring state
    this.currentAlpha = this.initialAlpha;
    this.iteration = 0;
    this.lossHistory = [];
    this.feedbackHistory = [];
    this.convergenceHistory = [];
    
    // Statistics
    this.stats = {
      totalIterations: 0,
      feedbackTriggers: 0,
      convergenceAchieved: false,
      finalAlpha: this.currentAlpha,
      averageNNLoss: 0,
      averageVAELoss: 0,
      averageFeedbackLoss: 0
    };

    logger.info('Initialized VAEFeedbackTrainer', {
      feedbackThreshold: this.feedbackThreshold,
      initialAlpha: this.initialAlpha,
      alphaDecayRate: this.alphaDecayRate,
      minAlpha: this.minAlpha,
      maxIterations: this.maxIterations
    });
  }

  /**
   * Train VAE-NN system with feedback loop on a single game
   * @param {Array} gameFeatures - Normalized game features [80]
   * @param {Array} actualTransitionProbs - Actual transition probabilities [8]
   * @param {Array} teamA_mu - Team A mean vector [16] (optional, for direct NN training)
   * @param {Array} teamA_sigma - Team A sigma vector [16] (optional)
   * @param {Array} teamB_mu - Team B mean vector [16] (optional)
   * @param {Array} teamB_sigma - Team B sigma vector [16] (optional)
   * @param {Array} gameContext - Game context features [~10] (optional)
   * @returns {Promise<Object>} - Training results
   */
  async trainOnGame(gameFeatures, actualTransitionProbs, teamA_mu = null, teamA_sigma = null, teamB_mu = null, teamB_sigma = null, gameContext = null) {
    try {
      // Step 1: VAE forward pass to get team representations
      let teamRepresentations;
      if (teamA_mu === null) {
        // Encode game features to get team latent distributions
        const { mu, sigma } = this.vae.encodeGameToTeamDistribution(gameFeatures);
        teamRepresentations = {
          teamA_mu: mu,
          teamA_sigma: sigma,
          teamB_mu: mu, // For simplicity, using same team encoding
          teamB_sigma: sigma
        };
      } else {
        teamRepresentations = {
          teamA_mu,
          teamA_sigma,
          teamB_mu,
          teamB_sigma
        };
      }

      // Default game context if not provided
      if (!gameContext) {
        gameContext = new Array(this.transitionNN.gameContextDim).fill(0.5);
      }

      // Step 2: NN forward pass to predict transition probabilities
      const predictedProbs = this.transitionNN.forward(
        teamRepresentations.teamA_mu,
        teamRepresentations.teamA_sigma,
        teamRepresentations.teamB_mu,
        teamRepresentations.teamB_sigma,
        gameContext
      );

      // Step 3: Compute NN cross-entropy loss
      const nnLoss = this.transitionNN.computeLoss(predictedProbs, actualTransitionProbs);

      // Step 4: Train NN on current prediction
      const nnInput = this.transitionNN.buildInputVector(
        teamRepresentations.teamA_mu,
        teamRepresentations.teamA_sigma,
        teamRepresentations.teamB_mu,
        teamRepresentations.teamB_sigma,
        gameContext
      );
      
      await this.transitionNN.trainStep(nnInput, actualTransitionProbs);

      // Step 5: Check if feedback is needed
      let vaeLoss = 0;
      let feedbackTriggered = false;
      
      if (nnLoss > this.feedbackThreshold && this.currentAlpha > this.minAlpha) {
        // Trigger VAE feedback training
        feedbackTriggered = true;
        this.stats.feedbackTriggers++;
        
        // Train VAE with NN feedback loss
        const vaeLossInfo = await this.vae.backward(gameFeatures, nnLoss);
        vaeLoss = vaeLossInfo.totalLoss;
        
        logger.debug('VAE feedback triggered', {
          nnLoss: nnLoss.toFixed(6),
          threshold: this.feedbackThreshold,
          alpha: this.currentAlpha.toFixed(6),
          vaeLoss: vaeLoss.toFixed(6)
        });
      } else {
        // Regular VAE training without feedback
        const vaeLossInfo = await this.vae.backward(gameFeatures, 0);
        vaeLoss = vaeLossInfo.vaeLoss; // Use VAE loss without feedback
      }

      // Step 6: Update feedback coefficient (decay)
      this.decayFeedbackCoefficient();

      // Step 7: Record training metrics
      const trainingResult = {
        iteration: this.iteration++,
        nnLoss,
        vaeLoss,
        feedbackTriggered,
        currentAlpha: this.currentAlpha,
        predictedProbs,
        actualProbs: actualTransitionProbs,
        teamRepresentations
      };

      this.recordTrainingMetrics(trainingResult);

      return trainingResult;

    } catch (error) {
      logger.error('Error in VAE-NN feedback training', {
        error: error.message,
        iteration: this.iteration
      });
      throw error;
    }
  }

  /**
   * Train VAE-NN system on a batch of games with feedback loop
   * @param {Array} gamesBatch - Array of game training examples
   * @returns {Promise<Object>} - Batch training results
   */
  async trainOnBatch(gamesBatch) {
    const batchResults = [];
    let totalNNLoss = 0;
    let totalVAELoss = 0;
    let feedbackCount = 0;

    for (const game of gamesBatch) {
      const result = await this.trainOnGame(
        game.gameFeatures,
        game.actualTransitionProbs,
        game.teamA_mu,
        game.teamA_sigma,
        game.teamB_mu,
        game.teamB_sigma,
        game.gameContext
      );

      batchResults.push(result);
      totalNNLoss += result.nnLoss;
      totalVAELoss += result.vaeLoss;
      if (result.feedbackTriggered) feedbackCount++;
    }

    const batchSummary = {
      batchSize: gamesBatch.length,
      averageNNLoss: totalNNLoss / gamesBatch.length,
      averageVAELoss: totalVAELoss / gamesBatch.length,
      feedbackTriggerRate: feedbackCount / gamesBatch.length,
      currentAlpha: this.currentAlpha,
      results: batchResults
    };

    logger.info('Completed batch training', {
      batchSize: batchSummary.batchSize,
      avgNNLoss: batchSummary.averageNNLoss.toFixed(6),
      avgVAELoss: batchSummary.averageVAELoss.toFixed(6),
      feedbackRate: (batchSummary.feedbackTriggerRate * 100).toFixed(1) + '%',
      alpha: this.currentAlpha.toFixed(6)
    });

    return batchSummary;
  }

  /**
   * Decay the feedback coefficient α over time
   */
  decayFeedbackCoefficient() {
    if (this.currentAlpha > this.minAlpha) {
      this.currentAlpha *= this.alphaDecayRate;
      this.currentAlpha = Math.max(this.currentAlpha, this.minAlpha);
      
      // Update VAE's feedback coefficient
      this.vae.setFeedbackCoefficient(this.currentAlpha);
    }
  }

  /**
   * Record training metrics for monitoring
   * @param {Object} result - Training result from single iteration
   */
  recordTrainingMetrics(result) {
    // Add to loss history
    this.lossHistory.push({
      iteration: result.iteration,
      nnLoss: result.nnLoss,
      vaeLoss: result.vaeLoss,
      alpha: result.currentAlpha
    });

    // Add to feedback history
    this.feedbackHistory.push({
      iteration: result.iteration,
      triggered: result.feedbackTriggered,
      alpha: result.currentAlpha
    });

    // Keep only recent history for memory efficiency
    const maxHistoryLength = 1000;
    if (this.lossHistory.length > maxHistoryLength) {
      this.lossHistory = this.lossHistory.slice(-maxHistoryLength);
    }
    if (this.feedbackHistory.length > maxHistoryLength) {
      this.feedbackHistory = this.feedbackHistory.slice(-maxHistoryLength);
    }

    // Update running statistics
    this.stats.totalIterations = result.iteration + 1;
    this.stats.finalAlpha = result.currentAlpha;
    
    // Calculate running averages
    const recentWindow = Math.min(this.stabilityWindow, this.lossHistory.length);
    const recentLosses = this.lossHistory.slice(-recentWindow);
    
    this.stats.averageNNLoss = recentLosses.reduce((sum, l) => sum + l.nnLoss, 0) / recentWindow;
    this.stats.averageVAELoss = recentLosses.reduce((sum, l) => sum + l.vaeLoss, 0) / recentWindow;
  }

  /**
   * Check if the training has converged (stable losses)
   * @returns {boolean} - Whether training has converged
   */
  checkConvergence() {
    if (this.lossHistory.length < this.stabilityWindow) {
      return false;
    }

    const recentLosses = this.lossHistory.slice(-this.stabilityWindow);
    
    // Calculate variance of recent NN losses
    const nnLosses = recentLosses.map(l => l.nnLoss);
    const nnMean = nnLosses.reduce((sum, l) => sum + l, 0) / nnLosses.length;
    const nnVariance = nnLosses.reduce((sum, l) => sum + Math.pow(l - nnMean, 2), 0) / nnLosses.length;
    
    // Calculate variance of recent VAE losses
    const vaeLosses = recentLosses.map(l => l.vaeLoss);
    const vaeMean = vaeLosses.reduce((sum, l) => sum + l, 0) / vaeLosses.length;
    const vaeVariance = vaeLosses.reduce((sum, l) => sum + Math.pow(l - vaeMean, 2), 0) / vaeLosses.length;

    // Check if both variances are below threshold
    const converged = nnVariance < this.convergenceThreshold && vaeVariance < this.convergenceThreshold;
    
    if (converged && !this.stats.convergenceAchieved) {
      this.stats.convergenceAchieved = true;
      logger.info('Training convergence achieved', {
        iteration: this.iteration,
        nnVariance: nnVariance.toFixed(8),
        vaeVariance: vaeVariance.toFixed(8),
        threshold: this.convergenceThreshold
      });
    }

    return converged;
  }

  /**
   * Monitor feedback loop stability
   * @returns {Object} - Stability metrics
   */
  monitorStability() {
    if (this.feedbackHistory.length < this.stabilityWindow) {
      return {
        stable: false,
        reason: 'Insufficient history',
        feedbackRate: 0,
        alphaDecayRate: 0
      };
    }

    const recentFeedback = this.feedbackHistory.slice(-this.stabilityWindow);
    const feedbackRate = recentFeedback.filter(f => f.triggered).length / recentFeedback.length;
    
    // Calculate alpha decay rate
    const alphaStart = recentFeedback[0].alpha;
    const alphaEnd = recentFeedback[recentFeedback.length - 1].alpha;
    const alphaDecayRate = (alphaStart - alphaEnd) / alphaStart;

    // System is stable if:
    // 1. Feedback rate is decreasing (< 50%)
    // 2. Alpha is decaying properly
    // 3. Recent losses are not increasing dramatically
    const stable = feedbackRate < 0.5 && alphaDecayRate >= 0;

    return {
      stable,
      feedbackRate,
      alphaDecayRate,
      currentAlpha: this.currentAlpha,
      recentFeedbackTriggers: recentFeedback.filter(f => f.triggered).length
    };
  }

  /**
   * Get comprehensive training statistics
   * @returns {Object} - Training statistics
   */
  getTrainingStats() {
    const stability = this.monitorStability();
    const convergence = this.checkConvergence();

    return {
      ...this.stats,
      convergenceAchieved: convergence,
      stability,
      currentIteration: this.iteration,
      lossHistoryLength: this.lossHistory.length,
      feedbackHistoryLength: this.feedbackHistory.length
    };
  }

  /**
   * Reset training state (for new training session)
   */
  reset() {
    this.currentAlpha = this.initialAlpha;
    this.iteration = 0;
    this.lossHistory = [];
    this.feedbackHistory = [];
    this.convergenceHistory = [];
    
    this.stats = {
      totalIterations: 0,
      feedbackTriggers: 0,
      convergenceAchieved: false,
      finalAlpha: this.currentAlpha,
      averageNNLoss: 0,
      averageVAELoss: 0,
      averageFeedbackLoss: 0
    };

    // Reset VAE feedback coefficient
    this.vae.setFeedbackCoefficient(this.currentAlpha);

    logger.info('Reset VAEFeedbackTrainer state');
  }

  /**
   * Set feedback threshold for triggering VAE updates
   * @param {number} threshold - New threshold value
   */
  setFeedbackThreshold(threshold) {
    this.feedbackThreshold = threshold;
    logger.info('Updated feedback threshold', { threshold });
  }

  /**
   * Set alpha decay parameters
   * @param {number} decayRate - Decay rate (0-1)
   * @param {number} minAlpha - Minimum alpha value
   */
  setAlphaDecayParameters(decayRate, minAlpha) {
    this.alphaDecayRate = decayRate;
    this.minAlpha = minAlpha;
    logger.info('Updated alpha decay parameters', { decayRate, minAlpha });
  }

  /**
   * Export training configuration and state
   * @returns {Object} - Serializable state
   */
  toJSON() {
    return {
      // Configuration
      feedbackThreshold: this.feedbackThreshold,
      initialAlpha: this.initialAlpha,
      alphaDecayRate: this.alphaDecayRate,
      minAlpha: this.minAlpha,
      maxIterations: this.maxIterations,
      convergenceThreshold: this.convergenceThreshold,
      stabilityWindow: this.stabilityWindow,
      
      // Current state
      currentAlpha: this.currentAlpha,
      iteration: this.iteration,
      
      // Statistics
      stats: this.stats,
      
      // Recent history (limited for size)
      recentLossHistory: this.lossHistory.slice(-100),
      recentFeedbackHistory: this.feedbackHistory.slice(-100)
    };
  }

  /**
   * Import training configuration and state
   * @param {Object} state - Serialized state
   */
  fromJSON(state) {
    // Configuration
    this.feedbackThreshold = state.feedbackThreshold;
    this.initialAlpha = state.initialAlpha;
    this.alphaDecayRate = state.alphaDecayRate;
    this.minAlpha = state.minAlpha;
    this.maxIterations = state.maxIterations;
    this.convergenceThreshold = state.convergenceThreshold;
    this.stabilityWindow = state.stabilityWindow;
    
    // Current state
    this.currentAlpha = state.currentAlpha;
    this.iteration = state.iteration;
    
    // Statistics
    this.stats = state.stats;
    
    // History
    this.lossHistory = state.recentLossHistory || [];
    this.feedbackHistory = state.recentFeedbackHistory || [];

    // Update VAE feedback coefficient
    this.vae.setFeedbackCoefficient(this.currentAlpha);

    logger.info('Loaded VAEFeedbackTrainer state from JSON', {
      iteration: this.iteration,
      currentAlpha: this.currentAlpha,
      totalIterations: this.stats.totalIterations
    });
  }

  /**
   * Save trainer state to file
   * @param {string} filepath - File path
   */
  async saveToFile(filepath) {
    const fs = require('fs').promises;
    const state = this.toJSON();
    await fs.writeFile(filepath, JSON.stringify(state, null, 2));
    logger.info('Saved VAEFeedbackTrainer state to file', { filepath });
  }

  /**
   * Load trainer state from file
   * @param {string} filepath - File path
   */
  async loadFromFile(filepath) {
    const fs = require('fs').promises;
    const data = await fs.readFile(filepath, 'utf8');
    const state = JSON.parse(data);
    this.fromJSON(state);
    logger.info('Loaded VAEFeedbackTrainer state from file', { filepath });
  }
}

module.exports = VAEFeedbackTrainer;