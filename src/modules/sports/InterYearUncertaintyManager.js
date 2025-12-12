const logger = require('../../utils/logger');
const SeasonTransitionDetector = require('./SeasonTransitionDetector');

/**
 * Inter-Year Uncertainty Manager
 * 
 * Manages uncertainty adjustments for team representations across seasons
 * Increases σ² values when new seasons are detected to account for roster changes
 * 
 * Key Features:
 * - Configurable inter-year variance parameter
 * - Automatic season transition detection
 * - Preserves μ values (team skill persists) while increasing uncertainty
 * - Updates last_season field in statistical representations
 * - Comprehensive logging of uncertainty adjustments
 */
class InterYearUncertaintyManager {
  constructor(teamRepository, options = {}) {
    this.teamRepo = teamRepository;
    this.seasonDetector = new SeasonTransitionDetector(options.seasonDetector || {});
    
    // Inter-year uncertainty configuration
    this.interYearVariance = options.interYearVariance || 0.25; // Default variance to add
    this.maxUncertainty = options.maxUncertainty || 2.0; // Maximum σ value
    this.minUncertainty = options.minUncertainty || 0.1; // Minimum σ value
    this.preserveSkillFactor = options.preserveSkillFactor || 1.0; // How much to preserve μ values
    
    // Logging configuration
    this.logAdjustments = options.logAdjustments !== false; // Default true
    
    logger.info('Initialized InterYearUncertaintyManager', {
      interYearVariance: this.interYearVariance,
      maxUncertainty: this.maxUncertainty,
      minUncertainty: this.minUncertainty,
      preserveSkillFactor: this.preserveSkillFactor
    });
  }

  /**
   * Check and apply inter-year variance increase for a team if season transition detected
   * @param {string} teamId - Team ID
   * @param {Date} currentDate - Current game date
   * @returns {Promise<Object>} - {transitionDetected: boolean, updatedDistribution: Object|null}
   */
  async checkAndApplySeasonTransition(teamId, currentDate) {
    try {
      // Get current team distribution
      const team = await this.teamRepo.getTeamByEspnId(teamId);
      
      if (!team || !team.statisticalRepresentation) {
        logger.debug('No statistical representation found for team', { teamId });
        return { transitionDetected: false, updatedDistribution: null };
      }

      const currentDistribution = JSON.parse(team.statisticalRepresentation);
      const lastKnownSeason = currentDistribution.last_season;

      // Check for season transition
      const transitionResult = this.seasonDetector.checkSeasonTransition(currentDate, lastKnownSeason);

      if (!transitionResult.isTransition) {
        return { transitionDetected: false, updatedDistribution: currentDistribution };
      }

      // Apply inter-year variance increase
      const updatedDistribution = await this.applyInterYearVarianceIncrease(
        teamId,
        currentDistribution,
        transitionResult.newSeason,
        transitionResult.previousSeason
      );

      return {
        transitionDetected: true,
        updatedDistribution,
        previousSeason: transitionResult.previousSeason,
        newSeason: transitionResult.newSeason,
        transitionDate: transitionResult.transitionDate
      };

    } catch (error) {
      logger.error('Failed to check season transition for team', {
        teamId,
        currentDate: currentDate.toISOString(),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Apply inter-year variance increase to a team's distribution
   * @param {string} teamId - Team ID
   * @param {Object} currentDistribution - Current team distribution
   * @param {string} newSeason - New season string
   * @param {string} previousSeason - Previous season string
   * @returns {Promise<Object>} - Updated distribution
   */
  async applyInterYearVarianceIncrease(teamId, currentDistribution, newSeason, previousSeason) {
    try {
      // Preserve μ values (team skill persists across seasons)
      const preservedMu = currentDistribution.mu.map(mu => mu * this.preserveSkillFactor);

      // Increase σ² values by adding inter-year variance
      const increasedSigma = currentDistribution.sigma.map(sigma => {
        const newVariance = (sigma * sigma) + this.interYearVariance;
        const newSigma = Math.sqrt(newVariance);
        
        // Clamp to reasonable bounds
        return Math.max(this.minUncertainty, Math.min(this.maxUncertainty, newSigma));
      });

      // Create updated distribution
      const updatedDistribution = {
        ...currentDistribution,
        mu: preservedMu,
        sigma: increasedSigma,
        last_season: newSeason,
        season_transition_history: [
          ...(currentDistribution.season_transition_history || []),
          {
            from_season: previousSeason,
            to_season: newSeason,
            transition_date: new Date().toISOString(),
            variance_added: this.interYearVariance,
            preserve_skill_factor: this.preserveSkillFactor
          }
        ],
        last_updated: new Date().toISOString()
      };

      // Save updated distribution to database
      await this.teamRepo.updateStatisticalRepresentation(teamId, updatedDistribution);

      // Log the adjustment
      if (this.logAdjustments) {
        const avgSigmaIncrease = increasedSigma.reduce((sum, newSigma, i) => {
          return sum + (newSigma - currentDistribution.sigma[i]);
        }, 0) / increasedSigma.length;

        logger.info('Applied inter-year variance increase', {
          teamId,
          previousSeason,
          newSeason,
          interYearVariance: this.interYearVariance,
          avgSigmaIncrease: avgSigmaIncrease.toFixed(4),
          avgSigmaBefore: (currentDistribution.sigma.reduce((sum, s) => sum + s, 0) / currentDistribution.sigma.length).toFixed(4),
          avgSigmaAfter: (increasedSigma.reduce((sum, s) => sum + s, 0) / increasedSigma.length).toFixed(4),
          preserveSkillFactor: this.preserveSkillFactor
        });
      }

      return updatedDistribution;

    } catch (error) {
      logger.error('Failed to apply inter-year variance increase', {
        teamId,
        newSeason,
        previousSeason,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Batch apply season transitions for multiple teams
   * @param {Array<string>} teamIds - Array of team IDs
   * @param {Date} currentDate - Current date to check transitions against
   * @returns {Promise<Array>} - Array of transition results
   */
  async batchApplySeasonTransitions(teamIds, currentDate) {
    const results = [];

    for (const teamId of teamIds) {
      try {
        const result = await this.checkAndApplySeasonTransition(teamId, currentDate);
        results.push({ teamId, ...result });
      } catch (error) {
        logger.error('Failed to apply season transition for team in batch', {
          teamId,
          error: error.message
        });
        results.push({ 
          teamId, 
          transitionDetected: false, 
          error: error.message 
        });
      }
    }

    // Log batch summary
    const transitionsApplied = results.filter(r => r.transitionDetected).length;
    const errors = results.filter(r => r.error).length;

    if (this.logAdjustments) {
      logger.info('Completed batch season transition processing', {
        totalTeams: teamIds.length,
        transitionsApplied,
        errors,
        currentDate: currentDate.toISOString()
      });
    }

    return results;
  }

  /**
   * Apply season transitions for all teams in the database
   * @param {Date} currentDate - Current date to check transitions against
   * @param {string} sport - Sport filter (optional)
   * @returns {Promise<Array>} - Array of transition results
   */
  async applySeasonTransitionsForAllTeams(currentDate, sport = 'mens-college-basketball') {
    try {
      // Get all teams for the sport
      const teams = await this.teamRepo.getTeamsBySport(sport);
      const teamIds = teams.map(team => team.teamId);

      logger.info('Starting season transition check for all teams', {
        totalTeams: teamIds.length,
        sport,
        currentDate: currentDate.toISOString()
      });

      // Apply transitions in batches
      return await this.batchApplySeasonTransitions(teamIds, currentDate);

    } catch (error) {
      logger.error('Failed to apply season transitions for all teams', {
        sport,
        currentDate: currentDate.toISOString(),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get teams that need season transition updates
   * @param {Date} currentDate - Current date
   * @param {string} sport - Sport filter (optional)
   * @returns {Promise<Array>} - Array of teams needing updates
   */
  async getTeamsNeedingSeasonTransition(currentDate, sport = 'mens-college-basketball') {
    try {
      const teams = await this.teamRepo.getTeamsBySport(sport);
      const currentSeason = this.seasonDetector.getSeasonForDate(currentDate);
      
      const teamsNeedingUpdate = [];

      for (const team of teams) {
        if (!team.statisticalRepresentation) continue;

        const distribution = JSON.parse(team.statisticalRepresentation);
        const lastKnownSeason = distribution.last_season;

        if (!lastKnownSeason || lastKnownSeason !== currentSeason) {
          teamsNeedingUpdate.push({
            teamId: team.teamId,
            teamName: team.teamName,
            lastKnownSeason,
            currentSeason,
            needsTransition: true
          });
        }
      }

      return teamsNeedingUpdate;

    } catch (error) {
      logger.error('Failed to get teams needing season transition', {
        sport,
        currentDate: currentDate.toISOString(),
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Manually trigger season transition for a specific team
   * @param {string} teamId - Team ID
   * @param {string} newSeason - New season to transition to
   * @param {string} previousSeason - Previous season (optional, will be detected if not provided)
   * @returns {Promise<Object>} - Updated distribution
   */
  async manualSeasonTransition(teamId, newSeason, previousSeason = null) {
    try {
      const team = await this.teamRepo.getTeamByEspnId(teamId);
      
      if (!team || !team.statisticalRepresentation) {
        throw new Error(`No statistical representation found for team ${teamId}`);
      }

      const currentDistribution = JSON.parse(team.statisticalRepresentation);
      const detectedPreviousSeason = previousSeason || currentDistribution.last_season;

      logger.info('Manually triggering season transition', {
        teamId,
        previousSeason: detectedPreviousSeason,
        newSeason
      });

      return await this.applyInterYearVarianceIncrease(
        teamId,
        currentDistribution,
        newSeason,
        detectedPreviousSeason
      );

    } catch (error) {
      logger.error('Failed to manually trigger season transition', {
        teamId,
        newSeason,
        previousSeason,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get season transition statistics
   * @param {string} sport - Sport filter (optional)
   * @returns {Promise<Object>} - Transition statistics
   */
  async getSeasonTransitionStatistics(sport = 'mens-college-basketball') {
    try {
      const teams = await this.teamRepo.getTeamsBySport(sport);
      const currentSeason = this.seasonDetector.getCurrentSeason();
      
      let teamsWithRepresentation = 0;
      let teamsInCurrentSeason = 0;
      let teamsNeedingTransition = 0;
      let totalTransitions = 0;
      const seasonDistribution = {};

      for (const team of teams) {
        if (!team.statisticalRepresentation) continue;
        
        teamsWithRepresentation++;
        const distribution = JSON.parse(team.statisticalRepresentation);
        
        if (distribution.last_season === currentSeason) {
          teamsInCurrentSeason++;
        } else {
          teamsNeedingTransition++;
        }

        // Count season distribution
        const season = distribution.last_season || 'unknown';
        seasonDistribution[season] = (seasonDistribution[season] || 0) + 1;

        // Count total transitions
        if (distribution.season_transition_history) {
          totalTransitions += distribution.season_transition_history.length;
        }
      }

      return {
        totalTeams: teams.length,
        teamsWithRepresentation,
        teamsInCurrentSeason,
        teamsNeedingTransition,
        totalTransitions,
        currentSeason,
        seasonDistribution,
        transitionRate: teamsWithRepresentation > 0 ? (teamsInCurrentSeason / teamsWithRepresentation) : 0
      };

    } catch (error) {
      logger.error('Failed to get season transition statistics', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get configuration object
   * @returns {Object} - Current configuration
   */
  getConfiguration() {
    return {
      interYearVariance: this.interYearVariance,
      maxUncertainty: this.maxUncertainty,
      minUncertainty: this.minUncertainty,
      preserveSkillFactor: this.preserveSkillFactor,
      logAdjustments: this.logAdjustments,
      seasonDetector: this.seasonDetector.getConfiguration()
    };
  }

  /**
   * Update configuration
   * @param {Object} config - New configuration options
   */
  updateConfiguration(config) {
    if (config.interYearVariance !== undefined) {
      this.interYearVariance = config.interYearVariance;
    }
    if (config.maxUncertainty !== undefined) {
      this.maxUncertainty = config.maxUncertainty;
    }
    if (config.minUncertainty !== undefined) {
      this.minUncertainty = config.minUncertainty;
    }
    if (config.preserveSkillFactor !== undefined) {
      this.preserveSkillFactor = config.preserveSkillFactor;
    }
    if (config.logAdjustments !== undefined) {
      this.logAdjustments = config.logAdjustments;
    }
    if (config.seasonDetector) {
      this.seasonDetector.updateConfiguration(config.seasonDetector);
    }

    logger.info('Updated InterYearUncertaintyManager configuration', config);
  }
}

module.exports = InterYearUncertaintyManager;