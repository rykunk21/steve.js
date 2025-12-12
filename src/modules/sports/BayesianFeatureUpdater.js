const logger = require('../../utils/logger');

/**
 * Updates team feature vectors using Bayesian-style incremental updates
 * Adjusts team representations based on actual vs predicted performance
 */
class BayesianFeatureUpdater {
  constructor(teamRepository, featureExtractor) {
    this.teamRepo = teamRepository;
    this.featureExtractor = featureExtractor;
    
    // Update configuration
    this.config = {
      baseLearningRate: 0.1, // Base learning rate for updates
      minGamesForEstablished: 10, // Games needed to be "established"
      maxGamesForNew: 5, // Games threshold for "new" teams
      regressionStrength: 0.05, // Strength of regression to mean
      uncertaintyDecayRate: 0.95 // How quickly uncertainty decreases
    };

    // Feature bounds for clamping
    this.featureBounds = {
      min: 0.0,
      max: 1.0
    };
  }

  /**
   * Update team feature vectors after a game
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Object} actualStats - Actual game statistics
   * @param {Object} predictedStats - Predicted statistics from simulation
   * @param {string} sport - Sport identifier
   * @returns {Promise<Object>} - Update results
   */
  async updateFromGame(homeTeamId, awayTeamId, actualStats, predictedStats, sport) {
    logger.info('Updating team features', {
      homeTeamId,
      awayTeamId,
      sport
    });

    try {
      // Load current team data
      const homeTeam = await this.teamRepo.getTeamByEspnId(homeTeamId);
      const awayTeam = await this.teamRepo.getTeamByEspnId(awayTeamId);

      // Update home team
      const homeUpdate = await this.updateTeamFeatures(
        homeTeam,
        actualStats.home,
        predictedStats.home,
        true,
        sport
      );

      // Update away team
      const awayUpdate = await this.updateTeamFeatures(
        awayTeam,
        actualStats.away,
        predictedStats.away,
        false,
        sport
      );

      logger.info('Team features updated', {
        homeTeamId,
        awayTeamId,
        homeChange: homeUpdate.avgChange.toFixed(4),
        awayChange: awayUpdate.avgChange.toFixed(4)
      });

      return {
        home: homeUpdate,
        away: awayUpdate
      };

    } catch (error) {
      logger.error('Failed to update team features', {
        homeTeamId,
        awayTeamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update features for a single team
   * @param {Object} team - Team object from database
   * @param {Object} actualStats - Actual game statistics
   * @param {Object} predictedStats - Predicted statistics
   * @param {boolean} isHome - Whether team was home
   * @param {string} sport - Sport identifier
   * @returns {Promise<Object>} - Update result
   */
  async updateTeamFeatures(team, actualStats, predictedStats, isHome, sport) {
    // Get current feature vector
    let currentFeatures = this.getCurrentFeatures(team);

    // Calculate performance delta
    const delta = this.calculatePerformanceDelta(actualStats, predictedStats);

    // Determine learning rate based on team experience
    const gamesPlayed = this.getGamesPlayed(team);
    const learningRate = this.calculateLearningRate(gamesPlayed);

    // Calculate uncertainty
    const uncertainty = this.calculateUncertainty(gamesPlayed);

    // Apply Bayesian-style update
    const updatedFeatures = this.applyBayesianUpdate(
      currentFeatures,
      delta,
      learningRate,
      uncertainty
    );

    // Apply regression toward mean (especially at season boundaries)
    const finalFeatures = this.applyRegressionToMean(
      updatedFeatures,
      this.config.regressionStrength
    );

    // Clamp features to valid range
    const clampedFeatures = this.clampFeatures(finalFeatures);

    // Calculate average change
    const avgChange = this.calculateAverageChange(currentFeatures, clampedFeatures);

    // Save updated features
    await this.saveFeatures(team.teamId, clampedFeatures, sport);

    return {
      teamId: team.teamId,
      avgChange,
      learningRate,
      uncertainty,
      gamesPlayed
    };
  }

  /**
   * Get current feature vector for a team
   * @param {Object} team - Team object
   * @returns {Array} - Feature vector
   */
  getCurrentFeatures(team) {
    if (team && team.statisticalRepresentation) {
      try {
        const parsed = typeof team.statisticalRepresentation === 'string'
          ? JSON.parse(team.statisticalRepresentation)
          : team.statisticalRepresentation;
        
        if (Array.isArray(parsed) && parsed.length === 15) {
          return parsed;
        }
      } catch (error) {
        logger.warn('Failed to parse statistical representation', {
          teamId: team.teamId,
          error: error.message
        });
      }
    }

    // Return default features if none exist
    return this.featureExtractor.getDefaultFeatures();
  }

  /**
   * Calculate performance delta between actual and predicted
   * @param {Object} actualStats - Actual statistics
   * @param {Object} predictedStats - Predicted statistics
   * @returns {Array} - Delta vector (15 dimensions)
   */
  calculatePerformanceDelta(actualStats, predictedStats) {
    // Calculate deltas for each feature
    const delta = new Array(15).fill(0);

    // Offensive efficiency delta
    const actualOffEff = actualStats.score / (actualStats.possessions || 70);
    const predictedOffEff = predictedStats.expectedPoints || 1.0;
    delta[0] = (actualOffEff - predictedOffEff) / 2; // Normalize

    // Defensive efficiency delta (inverse)
    delta[1] = -delta[0] * 0.5; // Defensive is inverse of offensive

    // Pace delta
    const actualPace = actualStats.possessions || 70;
    const predictedPace = predictedStats.possessions || 70;
    delta[2] = (actualPace - predictedPace) / 20; // Normalize

    // Shooting efficiency delta
    const actualEfg = actualStats.effectiveFieldGoalPct || 0.50;
    const predictedEfg = predictedStats.scoreProb || 0.50;
    delta[3] = (actualEfg - predictedEfg);

    // Other deltas (smaller adjustments)
    for (let i = 4; i < 15; i++) {
      delta[i] = (Math.random() - 0.5) * 0.02; // Small random adjustments
    }

    return delta;
  }

  /**
   * Calculate learning rate based on games played
   * @param {number} gamesPlayed - Number of games played
   * @returns {number} - Learning rate
   */
  calculateLearningRate(gamesPlayed) {
    if (gamesPlayed < this.config.maxGamesForNew) {
      // New teams: higher learning rate
      return this.config.baseLearningRate * 2.0;
    } else if (gamesPlayed < this.config.minGamesForEstablished) {
      // Developing teams: medium learning rate
      return this.config.baseLearningRate * 1.5;
    } else {
      // Established teams: lower learning rate
      return this.config.baseLearningRate;
    }
  }

  /**
   * Calculate uncertainty in feature estimates
   * @param {number} gamesPlayed - Number of games played
   * @returns {number} - Uncertainty (0-1)
   */
  calculateUncertainty(gamesPlayed) {
    // Uncertainty decreases exponentially with games played
    const baseUncertainty = 1.0;
    const uncertainty = baseUncertainty * Math.pow(
      this.config.uncertaintyDecayRate,
      gamesPlayed
    );
    
    return Math.max(0.1, Math.min(1.0, uncertainty));
  }

  /**
   * Apply Bayesian-style update to features
   * @param {Array} currentFeatures - Current feature vector
   * @param {Array} delta - Performance delta
   * @param {number} learningRate - Learning rate
   * @param {number} uncertainty - Uncertainty level
   * @returns {Array} - Updated features
   */
  applyBayesianUpdate(currentFeatures, delta, learningRate, uncertainty) {
    const updated = [];

    for (let i = 0; i < currentFeatures.length; i++) {
      // Bayesian update: new = old + lr * uncertainty * delta
      const update = learningRate * uncertainty * delta[i];
      updated.push(currentFeatures[i] + update);
    }

    return updated;
  }

  /**
   * Apply regression toward mean
   * @param {Array} features - Feature vector
   * @param {number} strength - Regression strength
   * @returns {Array} - Regressed features
   */
  applyRegressionToMean(features, strength) {
    const mean = 0.5; // Mean of normalized features
    const regressed = [];

    for (let i = 0; i < features.length; i++) {
      // Regress toward mean: new = old + strength * (mean - old)
      regressed.push(features[i] + strength * (mean - features[i]));
    }

    return regressed;
  }

  /**
   * Clamp features to valid range [0, 1]
   * @param {Array} features - Feature vector
   * @returns {Array} - Clamped features
   */
  clampFeatures(features) {
    return features.map(f => 
      Math.max(this.featureBounds.min, Math.min(this.featureBounds.max, f))
    );
  }

  /**
   * Calculate average change in features
   * @param {Array} oldFeatures - Old feature vector
   * @param {Array} newFeatures - New feature vector
   * @returns {number} - Average absolute change
   */
  calculateAverageChange(oldFeatures, newFeatures) {
    let totalChange = 0;

    for (let i = 0; i < oldFeatures.length; i++) {
      totalChange += Math.abs(newFeatures[i] - oldFeatures[i]);
    }

    return totalChange / oldFeatures.length;
  }

  /**
   * Get number of games played by team
   * @param {Object} team - Team object
   * @returns {number} - Games played
   */
  getGamesPlayed(team) {
    // This would ideally come from the database
    // For now, estimate from last synced date
    if (team && team.lastSynced) {
      const lastSync = new Date(team.lastSynced);
      const now = new Date();
      const daysSinceSync = (now - lastSync) / (1000 * 60 * 60 * 24);
      
      // Estimate ~2 games per week
      return Math.floor(daysSinceSync / 3.5);
    }

    return 0;
  }

  /**
   * Save updated features to database
   * @param {string} teamId - Team ID
   * @param {Array} features - Feature vector
   * @param {string} sport - Sport identifier
   */
  async saveFeatures(teamId, features, sport) {
    await this.teamRepo.updateStatisticalRepresentation(teamId, features);
    await this.teamRepo.updateLastSynced(teamId);

    logger.debug('Saved updated features', {
      teamId,
      sport,
      featureCount: features.length
    });
  }

  /**
   * Batch update features for multiple teams
   * @param {Array} updates - Array of update objects
   * @param {string} sport - Sport identifier
   * @returns {Promise<Object>} - Batch update results
   */
  async batchUpdate(updates, sport) {
    logger.info('Starting batch feature update', {
      updateCount: updates.length,
      sport
    });

    let successCount = 0;
    const errors = [];

    for (const update of updates) {
      try {
        await this.updateFromGame(
          update.homeTeamId,
          update.awayTeamId,
          update.actualStats,
          update.predictedStats,
          sport
        );
        successCount++;
      } catch (error) {
        errors.push({
          homeTeamId: update.homeTeamId,
          awayTeamId: update.awayTeamId,
          error: error.message
        });
      }
    }

    logger.info('Batch feature update completed', {
      total: updates.length,
      success: successCount,
      failures: errors.length
    });

    return {
      total: updates.length,
      success: successCount,
      failures: errors.length,
      errors
    };
  }
}

module.exports = BayesianFeatureUpdater;
