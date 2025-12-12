const logger = require('../../utils/logger');

/**
 * Computes ground truth transition probabilities from play-by-play data
 * Used for training the MLP model and validating predictions
 */
class TransitionProbabilityComputer {
  constructor() {
    this.PROBABILITY_TOLERANCE = 0.0001; // Tolerance for floating point comparison
  }

  /**
   * Count possession outcomes from play-by-play data for a specific team
   * @param {Array} playByPlay - Array of play objects
   * @param {string} teamId - Team identifier
   * @param {string} vh - 'V' for visitor or 'H' for home
   * @returns {Object} - Counts of each possession outcome
   */
  countPossessionOutcomes(playByPlay, teamId, vh) {
    const counts = {
      twoPointMakes: 0,
      twoPointMisses: 0,
      threePointMakes: 0,
      threePointMisses: 0,
      freeThrowMakes: 0,
      freeThrowMisses: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      turnovers: 0
    };

    if (!playByPlay || playByPlay.length === 0) {
      return counts;
    }

    for (const play of playByPlay) {
      // Only count plays for the specified team
      if (play.team !== teamId || play.vh !== vh) {
        continue;
      }

      // Count based on action and type
      if (play.action === 'GOOD') {
        if (play.type === '3PTR') {
          counts.threePointMakes++;
        } else if (play.type === 'FT') {
          counts.freeThrowMakes++;
        } else if (['LAYUP', 'JUMPER', 'DUNK', 'TIPIN', 'HOOK'].includes(play.type)) {
          counts.twoPointMakes++;
        }
      } else if (play.action === 'MISS') {
        if (play.type === '3PTR') {
          counts.threePointMisses++;
        } else if (play.type === 'FT') {
          counts.freeThrowMisses++;
        } else if (['LAYUP', 'JUMPER', 'DUNK', 'TIPIN', 'HOOK'].includes(play.type)) {
          counts.twoPointMisses++;
        }
      } else if (play.action === 'REBOUND') {
        if (play.type === 'OFF') {
          counts.offensiveRebounds++;
        } else if (play.type === 'DEF') {
          counts.defensiveRebounds++;
        }
      } else if (play.action === 'TURNOVER') {
        counts.turnovers++;
      }
    }

    return counts;
  }

  /**
   * Calculate empirical transition probabilities from possession outcome counts
   * @param {Object} counts - Counts of each possession outcome
   * @returns {Object} - Transition probabilities
   */
  calculateTransitionProbabilities(counts) {
    // Calculate total possessions (excluding defensive rebounds as they don't end possessions for the team)
    const totalPossessions = counts.twoPointMakes + counts.twoPointMisses +
                            counts.threePointMakes + counts.threePointMisses +
                            counts.freeThrowMakes + counts.freeThrowMisses +
                            counts.offensiveRebounds + counts.turnovers;

    // Handle edge case of zero possessions
    if (totalPossessions === 0) {
      return {
        twoPointMakeProb: 0,
        twoPointMissProb: 0,
        threePointMakeProb: 0,
        threePointMissProb: 0,
        freeThrowMakeProb: 0,
        freeThrowMissProb: 0,
        offensiveReboundProb: 0,
        turnoverProb: 0
      };
    }

    // Calculate raw probabilities
    const probabilities = {
      twoPointMakeProb: counts.twoPointMakes / totalPossessions,
      twoPointMissProb: counts.twoPointMisses / totalPossessions,
      threePointMakeProb: counts.threePointMakes / totalPossessions,
      threePointMissProb: counts.threePointMisses / totalPossessions,
      freeThrowMakeProb: counts.freeThrowMakes / totalPossessions,
      freeThrowMissProb: counts.freeThrowMisses / totalPossessions,
      offensiveReboundProb: counts.offensiveRebounds / totalPossessions,
      turnoverProb: counts.turnovers / totalPossessions
    };

    // Normalize to ensure sum = 1.0 (handle floating point errors)
    const sum = probabilities.twoPointMakeProb + probabilities.twoPointMissProb +
                probabilities.threePointMakeProb + probabilities.threePointMissProb +
                probabilities.freeThrowMakeProb + probabilities.freeThrowMissProb +
                probabilities.offensiveReboundProb + probabilities.turnoverProb;

    if (sum > 0 && Math.abs(sum - 1.0) > this.PROBABILITY_TOLERANCE) {
      // Normalize all probabilities
      probabilities.twoPointMakeProb /= sum;
      probabilities.twoPointMissProb /= sum;
      probabilities.threePointMakeProb /= sum;
      probabilities.threePointMissProb /= sum;
      probabilities.freeThrowMakeProb /= sum;
      probabilities.freeThrowMissProb /= sum;
      probabilities.offensiveReboundProb /= sum;
      probabilities.turnoverProb /= sum;
    }

    return probabilities;
  }

  /**
   * Compute transition probabilities for both teams from complete game data
   * @param {Object} gameData - Parsed game data with playByPlay and teams
   * @returns {Object} - Transition probabilities for visitor and home teams
   */
  computeTransitionProbabilities(gameData) {
    try {
      if (!gameData || !gameData.teams) {
        throw new Error('Invalid game data: missing teams information');
      }

      const { playByPlay, teams } = gameData;

      if (!teams.visitor || !teams.home) {
        throw new Error('Invalid game data: missing visitor or home team');
      }

      // Count possession outcomes for visitor team
      const visitorCounts = this.countPossessionOutcomes(
        playByPlay,
        teams.visitor.id,
        'V'
      );

      // Count possession outcomes for home team
      const homeCounts = this.countPossessionOutcomes(
        playByPlay,
        teams.home.id,
        'H'
      );

      // Calculate probabilities for both teams
      const visitorProbs = this.calculateTransitionProbabilities(visitorCounts);
      const homeProbs = this.calculateTransitionProbabilities(homeCounts);

      logger.debug('Computed transition probabilities', {
        visitor: teams.visitor.name,
        home: teams.home.name,
        visitorPossessions: visitorCounts.twoPointMakes + visitorCounts.twoPointMisses +
                           visitorCounts.threePointMakes + visitorCounts.threePointMisses +
                           visitorCounts.freeThrowMakes + visitorCounts.freeThrowMisses +
                           visitorCounts.offensiveRebounds + visitorCounts.turnovers,
        homePossessions: homeCounts.twoPointMakes + homeCounts.twoPointMisses +
                        homeCounts.threePointMakes + homeCounts.threePointMisses +
                        homeCounts.freeThrowMakes + homeCounts.freeThrowMisses +
                        homeCounts.offensiveRebounds + homeCounts.turnovers
      });

      return {
        visitor: visitorProbs,
        home: homeProbs
      };

    } catch (error) {
      logger.error('Failed to compute transition probabilities', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Validate that probabilities are valid (sum to 1.0, all non-negative, all <= 1.0)
   * @param {Object} probabilities - Probability object to validate
   * @returns {boolean} - True if valid, false otherwise
   */
  validateProbabilities(probabilities) {
    const probs = [
      probabilities.twoPointMakeProb,
      probabilities.twoPointMissProb,
      probabilities.threePointMakeProb,
      probabilities.threePointMissProb,
      probabilities.freeThrowMakeProb,
      probabilities.freeThrowMissProb,
      probabilities.offensiveReboundProb,
      probabilities.turnoverProb
    ];

    // Check all probabilities are non-negative and <= 1.0
    for (const prob of probs) {
      if (prob < 0 || prob > 1.0) {
        return false;
      }
    }

    // Check sum is approximately 1.0 (allow for floating point errors)
    const sum = probs.reduce((acc, prob) => acc + prob, 0);
    
    if (Math.abs(sum - 1.0) > this.PROBABILITY_TOLERANCE) {
      return false;
    }

    return true;
  }
}

module.exports = TransitionProbabilityComputer;
