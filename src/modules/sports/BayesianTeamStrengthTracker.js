const logger = require('../../utils/logger');

/**
 * Bayesian Team Strength Tracker
 * Maintains and updates team strength distributions using Bayesian inference
 * Implements Requirement 11: Bayesian updating of team strength parameters
 */
class BayesianTeamStrengthTracker {
  constructor(dbConnection) {
    this.db = dbConnection;
    
    // Default prior parameters (league average)
    this.defaultPrior = {
      offensiveRatingMean: 100.0,
      offensiveRatingStd: 15.0,
      defensiveRatingMean: 100.0,
      defensiveRatingStd: 15.0
    };
    
    // Regression parameters for new seasons
    this.regressionFactor = 0.5; // 50% regression toward mean
    this.uncertaintyIncrease = 2.0; // Double uncertainty for new season
  }

  /**
   * Initialize prior distribution for a team
   * Uses historical data if available, otherwise uses league average
   * 
   * @param {string} teamId - Team ID
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @returns {Promise<Object>} - Prior distribution
   */
  async initializeTeamPrior(teamId, sport, season) {
    try {
      // Check for historical data from previous season
      const previousSeason = season - 1;
      const historical = await this.db.get(`
        SELECT * FROM team_strength_history
        WHERE team_id = ? AND sport = ? AND season = ?
        ORDER BY as_of_date DESC
        LIMIT 1
      `, [teamId, sport, previousSeason]);

      let prior;
      
      if (historical) {
        // Regress toward mean for new season
        prior = this.regressDistribution(
          historical.offensive_rating_mean,
          historical.offensive_rating_std,
          historical.defensive_rating_mean,
          historical.defensive_rating_std
        );
        
        logger.info('Initialized team prior from historical data', {
          teamId,
          sport,
          season,
          previousSeason,
          offensiveRatingMean: prior.offensiveRatingMean
        });
      } else {
        // Use default league average prior
        prior = { ...this.defaultPrior };
        
        logger.info('Initialized team prior with default values', {
          teamId,
          sport,
          season
        });
      }

      // Add metadata
      prior.teamId = teamId;
      prior.sport = sport;
      prior.season = season;
      prior.gamesPlayed = 0;
      prior.confidenceLevel = 0.0;
      prior.asOfDate = new Date().toISOString().split('T')[0];

      // Store initial prior in database
      await this.saveStrength(prior);

      return prior;
    } catch (error) {
      logger.error('Failed to initialize team prior', {
        teamId,
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Regress distribution toward mean for new season
   * Accounts for roster changes and increased uncertainty
   * 
   * @param {number} offMean - Previous offensive rating mean
   * @param {number} offStd - Previous offensive rating std
   * @param {number} defMean - Previous defensive rating mean
   * @param {number} defStd - Previous defensive rating std
   * @returns {Object} - Regressed distribution
   */
  regressDistribution(offMean, offStd, defMean, defStd) {
    const leagueMean = 100.0;
    
    return {
      offensiveRatingMean: offMean * (1 - this.regressionFactor) + leagueMean * this.regressionFactor,
      offensiveRatingStd: offStd * this.uncertaintyIncrease,
      defensiveRatingMean: defMean * (1 - this.regressionFactor) + leagueMean * this.regressionFactor,
      defensiveRatingStd: defStd * this.uncertaintyIncrease
    };
  }

  /**
   * Update posterior distribution after observing a game result
   * Uses Bayesian inference to update beliefs about team strength
   * 
   * @param {string} teamId - Team ID
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @param {Object} gameResult - Game result data
   * @returns {Promise<Object>} - Updated posterior distribution
   */
  async updatePosterior(teamId, sport, season, gameResult) {
    try {
      // Get current strength (prior)
      let current = await this.getCurrentStrength(teamId, sport, season);
      
      if (!current) {
        // Initialize if doesn't exist
        current = await this.initializeTeamPrior(teamId, sport, season);
      }

      // Calculate observed performance
      const observedOffensive = this.calculateObservedOffensive(
        gameResult.teamScore,
        gameResult.opponentStrength.defensiveRatingMean,
        gameResult.isHome
      );
      
      const observedDefensive = this.calculateObservedDefensive(
        gameResult.opponentScore,
        gameResult.opponentStrength.offensiveRatingMean,
        gameResult.isHome
      );

      // Bayesian update: combine prior with observation
      const posterior = this.bayesianUpdate(
        current.offensiveRatingMean,
        current.offensiveRatingStd,
        current.defensiveRatingMean,
        current.defensiveRatingStd,
        observedOffensive,
        observedDefensive,
        current.gamesPlayed
      );

      // Update metadata
      posterior.teamId = teamId;
      posterior.sport = sport;
      posterior.season = season;
      posterior.gamesPlayed = current.gamesPlayed + 1;
      posterior.confidenceLevel = this.calculateConfidence(posterior.gamesPlayed);
      posterior.asOfDate = new Date().toISOString().split('T')[0];

      // Save updated posterior
      await this.saveStrength(posterior);

      logger.info('Updated team posterior', {
        teamId,
        sport,
        season,
        gamesPlayed: posterior.gamesPlayed,
        offensiveRatingMean: posterior.offensiveRatingMean.toFixed(2),
        defensiveRatingMean: posterior.defensiveRatingMean.toFixed(2)
      });

      return posterior;
    } catch (error) {
      logger.error('Failed to update posterior', {
        teamId,
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calculate observed offensive rating from game result
   * 
   * @param {number} teamScore - Team's score
   * @param {number} oppDefense - Opponent's defensive rating
   * @param {boolean} isHome - Whether team was home
   * @returns {number} - Observed offensive rating
   */
  calculateObservedOffensive(teamScore, oppDefense, isHome) {
    const homeAdvantage = isHome ? 3.5 : 0;
    // Offensive rating: points scored adjusted for opponent defense
    // If opponent has good defense (low rating like 90), our offense looks better
    // If opponent has bad defense (high rating like 110), our offense looks worse
    const baseRating = (teamScore / 85) * 100; // Normalize around 85 points
    const opponentAdjustment = (100 - oppDefense) * 0.3; // Adjust for opponent quality
    return baseRating + opponentAdjustment + homeAdvantage;
  }

  /**
   * Calculate observed defensive rating from game result
   * 
   * @param {number} oppScore - Opponent's score
   * @param {number} oppOffense - Opponent's offensive rating
   * @param {boolean} isHome - Whether team was home
   * @returns {number} - Observed defensive rating (lower is better)
   */
  calculateObservedDefensive(oppScore, oppOffense, isHome) {
    const homeAdvantage = isHome ? -3.5 : 0; // Home defense is better (lower rating)
    // Defensive rating: points allowed adjusted for opponent offense
    // If opponent has good offense (high rating like 110), our defense looks better
    // If opponent has bad offense (low rating like 90), our defense looks worse
    const baseRating = (oppScore / 85) * 100; // Normalize around 85 points
    const opponentAdjustment = (oppOffense - 100) * 0.3; // Adjust for opponent quality
    return baseRating - opponentAdjustment + homeAdvantage;
  }

  /**
   * Perform Bayesian update combining prior and observation
   * Uses weighted average based on uncertainty
   * 
   * @param {number} priorOffMean - Prior offensive mean
   * @param {number} priorOffStd - Prior offensive std
   * @param {number} priorDefMean - Prior defensive mean
   * @param {number} priorDefStd - Prior defensive std
   * @param {number} obsOffensive - Observed offensive rating
   * @param {number} obsDefensive - Observed defensive rating
   * @param {number} gamesPlayed - Number of games already played
   * @returns {Object} - Posterior distribution
   */
  bayesianUpdate(priorOffMean, priorOffStd, priorDefMean, priorDefStd, obsOffensive, obsDefensive, gamesPlayed) {
    // Observation uncertainty decreases as we see more games
    const obsStd = 20.0 / Math.sqrt(gamesPlayed + 1);
    
    // Bayesian update: weighted average of prior and observation
    // Weight is inversely proportional to variance
    const offPriorWeight = 1 / (priorOffStd * priorOffStd);
    const offObsWeight = 1 / (obsStd * obsStd);
    const offTotalWeight = offPriorWeight + offObsWeight;
    
    const defPriorWeight = 1 / (priorDefStd * priorDefStd);
    const defObsWeight = 1 / (obsStd * obsStd);
    const defTotalWeight = defPriorWeight + defObsWeight;
    
    return {
      offensiveRatingMean: (priorOffMean * offPriorWeight + obsOffensive * offObsWeight) / offTotalWeight,
      offensiveRatingStd: Math.sqrt(1 / offTotalWeight),
      defensiveRatingMean: (priorDefMean * defPriorWeight + obsDefensive * defObsWeight) / defTotalWeight,
      defensiveRatingStd: Math.sqrt(1 / defTotalWeight)
    };
  }

  /**
   * Calculate confidence level based on games played
   * 
   * @param {number} gamesPlayed - Number of games played
   * @returns {number} - Confidence level (0-1)
   */
  calculateConfidence(gamesPlayed) {
    // Asymptotic approach to 1.0 as games increase
    // Reaches 0.5 at ~3 games, 0.75 at ~6 games, 0.95 at ~13 games
    return 1 - Math.exp(-gamesPlayed / 4.3);
  }

  /**
   * Get current strength distribution for a team
   * 
   * @param {string} teamId - Team ID
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @returns {Promise<Object|null>} - Current strength or null
   */
  async getCurrentStrength(teamId, sport, season) {
    try {
      const strength = await this.db.get(`
        SELECT * FROM team_strength_history
        WHERE team_id = ? AND sport = ? AND season = ?
        ORDER BY as_of_date DESC, id DESC
        LIMIT 1
      `, [teamId, sport, season]);

      if (!strength) {
        return null;
      }

      return {
        teamId: strength.team_id,
        sport: strength.sport,
        season: strength.season,
        asOfDate: strength.as_of_date,
        offensiveRatingMean: strength.offensive_rating_mean,
        offensiveRatingStd: strength.offensive_rating_std,
        defensiveRatingMean: strength.defensive_rating_mean,
        defensiveRatingStd: strength.defensive_rating_std,
        adjOffensiveRating: strength.adj_offensive_rating,
        adjDefensiveRating: strength.adj_defensive_rating,
        strengthOfSchedule: strength.strength_of_schedule,
        gamesPlayed: strength.games_played,
        confidenceLevel: strength.confidence_level
      };
    } catch (error) {
      logger.error('Failed to get current strength', {
        teamId,
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calculate confidence interval for team strength
   * 
   * @param {string} teamId - Team ID
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @param {number} confidenceLevel - Confidence level (e.g., 0.95 for 95%)
   * @returns {Promise<Object>} - Confidence intervals
   */
  async getConfidenceInterval(teamId, sport, season, confidenceLevel = 0.95) {
    try {
      const strength = await this.getCurrentStrength(teamId, sport, season);
      
      if (!strength) {
        throw new Error(`No strength data found for team ${teamId}`);
      }

      // Z-score for confidence level (1.96 for 95%)
      const zScore = this.getZScore(confidenceLevel);

      return {
        offensive: {
          mean: strength.offensiveRatingMean,
          lower: strength.offensiveRatingMean - zScore * strength.offensiveRatingStd,
          upper: strength.offensiveRatingMean + zScore * strength.offensiveRatingStd,
          std: strength.offensiveRatingStd
        },
        defensive: {
          mean: strength.defensiveRatingMean,
          lower: strength.defensiveRatingMean - zScore * strength.defensiveRatingStd,
          upper: strength.defensiveRatingMean + zScore * strength.defensiveRatingStd,
          std: strength.defensiveRatingStd
        },
        confidenceLevel: confidenceLevel
      };
    } catch (error) {
      logger.error('Failed to calculate confidence interval', {
        teamId,
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get Z-score for confidence level
   * 
   * @param {number} confidenceLevel - Confidence level (0-1)
   * @returns {number} - Z-score
   */
  getZScore(confidenceLevel) {
    const zScores = {
      0.90: 1.645,
      0.95: 1.96,
      0.99: 2.576
    };
    
    return zScores[confidenceLevel] || 1.96;
  }

  /**
   * Apply regression toward mean for new season
   * 
   * @param {string} teamId - Team ID
   * @param {string} sport - Sport key
   * @param {number} fromSeason - Previous season
   * @param {number} toSeason - New season
   * @returns {Promise<Object>} - Regressed distribution
   */
  async regressTowardMean(teamId, sport, fromSeason, toSeason) {
    try {
      // Get final strength from previous season
      const previousStrength = await this.db.get(`
        SELECT * FROM team_strength_history
        WHERE team_id = ? AND sport = ? AND season = ?
        ORDER BY as_of_date DESC, id DESC
        LIMIT 1
      `, [teamId, sport, fromSeason]);

      if (!previousStrength) {
        throw new Error(`No historical data found for team ${teamId} in season ${fromSeason}`);
      }

      // Apply regression
      const regressed = this.regressDistribution(
        previousStrength.offensive_rating_mean,
        previousStrength.offensive_rating_std,
        previousStrength.defensive_rating_mean,
        previousStrength.defensive_rating_std
      );

      logger.info('Applied regression toward mean', {
        teamId,
        sport,
        fromSeason,
        toSeason,
        previousOffensive: previousStrength.offensive_rating_mean,
        regressedOffensive: regressed.offensiveRatingMean
      });

      return regressed;
    } catch (error) {
      logger.error('Failed to regress toward mean', {
        teamId,
        sport,
        fromSeason,
        toSeason,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Save team strength to database
   * 
   * @param {Object} strength - Strength distribution
   * @returns {Promise<void>}
   */
  async saveStrength(strength) {
    try {
      await this.db.run(`
        INSERT INTO team_strength_history (
          team_id, sport, season, as_of_date,
          offensive_rating_mean, offensive_rating_std,
          defensive_rating_mean, defensive_rating_std,
          adj_offensive_rating, adj_defensive_rating,
          strength_of_schedule,
          games_played, confidence_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        strength.teamId,
        strength.sport,
        strength.season,
        strength.asOfDate,
        strength.offensiveRatingMean,
        strength.offensiveRatingStd,
        strength.defensiveRatingMean,
        strength.defensiveRatingStd,
        strength.adjOffensiveRating || null,
        strength.adjDefensiveRating || null,
        strength.strengthOfSchedule || null,
        strength.gamesPlayed,
        strength.confidenceLevel
      ]);

      logger.debug('Saved team strength to database', {
        teamId: strength.teamId,
        sport: strength.sport,
        season: strength.season,
        gamesPlayed: strength.gamesPlayed
      });
    } catch (error) {
      logger.error('Failed to save team strength', {
        teamId: strength.teamId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = BayesianTeamStrengthTracker;
