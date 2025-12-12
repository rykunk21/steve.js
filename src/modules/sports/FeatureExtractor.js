const logger = require('../../utils/logger');

/**
 * Extracts team statistical features for neural network input
 * Computes normalized feature vectors from game statistics
 */
class FeatureExtractor {
  constructor() {
    // Normalization bounds for features (min, max)
    this.bounds = {
      offensiveEfficiency: [80, 120],
      defensiveEfficiency: [80, 120],
      pace: [60, 80],
      effectiveFieldGoalPct: [0.40, 0.60],
      freeThrowRate: [0.15, 0.35],
      threePointRate: [0.25, 0.45],
      turnoverRate: [0.10, 0.25],
      offensiveReboundRate: [0.20, 0.40],
      defensiveReboundRate: [0.60, 0.80],
      assistRate: [0.40, 0.65],
      stealRate: [0.05, 0.15],
      blockRate: [0.05, 0.15],
      recentForm: [0.0, 1.0]
    };
  }

  /**
   * Extract feature vector from team statistics
   * @param {Array} teamGames - Array of historical games for the team
   * @param {string} teamId - Team ID
   * @param {number} recentN - Number of recent games for form calculation
   * @returns {Array} - Normalized feature vector (15 dimensions)
   */
  extractFeatures(teamGames, teamId, recentN = 5) {
    if (!teamGames || teamGames.length === 0) {
      logger.warn('No games available for feature extraction', { teamId });
      return this.getDefaultFeatures();
    }

    // Calculate aggregate statistics
    const offensiveEff = this.calculateOffensiveEfficiency(teamGames, teamId);
    const defensiveEff = this.calculateDefensiveEfficiency(teamGames, teamId);
    const pace = this.calculatePace(teamGames, teamId);
    const efgPct = this.calculateEffectiveFieldGoalPct(teamGames, teamId);
    const ftRate = this.calculateFreeThrowRate(teamGames, teamId);
    const threeRate = this.calculateThreePointRate(teamGames, teamId);
    const toRate = this.calculateTurnoverRate(teamGames, teamId);
    const orebRate = this.calculateOffensiveReboundRate(teamGames, teamId);
    const drebRate = this.calculateDefensiveReboundRate(teamGames, teamId);
    const astRate = this.calculateAssistRate(teamGames, teamId);
    const stlRate = this.calculateStealRate(teamGames, teamId);
    const blkRate = this.calculateBlockRate(teamGames, teamId);
    
    // Calculate recent form (weighted average of last N games)
    const recentForm = this.calculateRecentForm(teamGames, teamId, recentN);

    // Build raw feature vector
    const rawFeatures = {
      offensiveEfficiency: offensiveEff,
      defensiveEfficiency: defensiveEff,
      pace: pace,
      effectiveFieldGoalPct: efgPct,
      freeThrowRate: ftRate,
      threePointRate: threeRate,
      turnoverRate: toRate,
      offensiveReboundRate: orebRate,
      defensiveReboundRate: drebRate,
      assistRate: astRate,
      stealRate: stlRate,
      blockRate: blkRate,
      recentFormWinPct: recentForm.winPct,
      recentFormAvgMargin: recentForm.avgMargin,
      recentFormMomentum: recentForm.momentum
    };

    // Normalize features to [0, 1] range
    const normalizedFeatures = this.normalizeFeatures(rawFeatures);

    logger.debug('Extracted features for team', {
      teamId,
      gamesCount: teamGames.length,
      offensiveEff: offensiveEff.toFixed(2),
      defensiveEff: defensiveEff.toFixed(2),
      recentForm: recentForm.winPct.toFixed(2)
    });

    return normalizedFeatures;
  }

  /**
   * Calculate offensive efficiency (points per 100 possessions)
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - Offensive efficiency
   */
  calculateOffensiveEfficiency(games, teamId) {
    let totalPoints = 0;
    let totalPossessions = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const points = isHome ? game.homeScore : game.awayScore;
      const possessions = this.estimatePossessions(game, isHome);

      totalPoints += points;
      totalPossessions += possessions;
    }

    if (totalPossessions === 0) return 100;
    return (totalPoints / totalPossessions) * 100;
  }

  /**
   * Calculate defensive efficiency (opponent points per 100 possessions)
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - Defensive efficiency
   */
  calculateDefensiveEfficiency(games, teamId) {
    let totalOpponentPoints = 0;
    let totalPossessions = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const opponentPoints = isHome ? game.awayScore : game.homeScore;
      const possessions = this.estimatePossessions(game, !isHome);

      totalOpponentPoints += opponentPoints;
      totalPossessions += possessions;
    }

    if (totalPossessions === 0) return 100;
    return (totalOpponentPoints / totalPossessions) * 100;
  }

  /**
   * Calculate pace (possessions per game)
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - Pace
   */
  calculatePace(games, teamId) {
    let totalPossessions = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      totalPossessions += this.estimatePossessions(game, isHome);
    }

    if (games.length === 0) return 70;
    return totalPossessions / games.length;
  }

  /**
   * Estimate possessions for a team in a game
   * Formula: FGA + 0.44 * FTA - OREB + TO
   * @param {Object} game - Game object
   * @param {boolean} isHome - Whether team is home
   * @returns {number} - Estimated possessions
   */
  estimatePossessions(game, isHome) {
    // If we have actual possession count from StatBroadcast, use it
    if (game.possessionCount) {
      return game.possessionCount;
    }

    // Otherwise estimate from box score
    // Simplified estimation: (FGA + 0.44 * FTA + TO) / 2
    // Since we don't have detailed box scores in all games, use score-based estimation
    const teamScore = isHome ? game.homeScore : game.awayScore;
    const oppScore = isHome ? game.awayScore : game.homeScore;
    const totalScore = teamScore + oppScore;

    // Estimate possessions from total score (average ~1.0 point per possession)
    return totalScore / 2;
  }

  /**
   * Calculate effective field goal percentage
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - eFG%
   */
  calculateEffectiveFieldGoalPct(games, teamId) {
    let totalEfg = 0;
    let count = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const efg = isHome ? game.homeFieldGoalPct : game.awayFieldGoalPct;
      
      if (efg !== null && efg !== undefined) {
        totalEfg += efg;
        count++;
      }
    }

    if (count === 0) return 0.50;
    return totalEfg / count;
  }

  /**
   * Calculate free throw rate (FTA / FGA)
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - FT rate
   */
  calculateFreeThrowRate(games, teamId) {
    // Estimate from free throw percentage (proxy)
    let totalFtPct = 0;
    let count = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const ftPct = isHome ? game.homeFreeThrowPct : game.awayFreeThrowPct;
      
      if (ftPct !== null && ftPct !== undefined) {
        totalFtPct += ftPct;
        count++;
      }
    }

    if (count === 0) return 0.25;
    // Convert FT% to FT rate estimate
    return (totalFtPct / count) * 0.35;
  }

  /**
   * Calculate three-point rate (3PA / FGA)
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - 3PT rate
   */
  calculateThreePointRate(games, teamId) {
    let totalThreePct = 0;
    let count = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const threePct = isHome ? game.homeThreePointPct : game.awayThreePointPct;
      
      if (threePct !== null && threePct !== undefined) {
        totalThreePct += threePct;
        count++;
      }
    }

    if (count === 0) return 0.35;
    return totalThreePct / count;
  }

  /**
   * Calculate turnover rate
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - TO rate
   */
  calculateTurnoverRate(games, teamId) {
    let totalTurnovers = 0;
    let totalPossessions = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const turnovers = isHome ? game.homeTurnovers : game.awayTurnovers;
      const possessions = this.estimatePossessions(game, isHome);

      if (turnovers !== null && turnovers !== undefined) {
        totalTurnovers += turnovers;
        totalPossessions += possessions;
      }
    }

    if (totalPossessions === 0) return 0.15;
    return totalTurnovers / totalPossessions;
  }

  /**
   * Calculate offensive rebound rate
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - OREB rate
   */
  calculateOffensiveReboundRate(games, teamId) {
    let totalRebounds = 0;
    let count = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const rebounds = isHome ? game.homeRebounds : game.awayRebounds;
      
      if (rebounds !== null && rebounds !== undefined) {
        totalRebounds += rebounds;
        count++;
      }
    }

    if (count === 0) return 0.30;
    // Estimate OREB rate from total rebounds (typically ~30% of total)
    return (totalRebounds / count) / 100;
  }

  /**
   * Calculate defensive rebound rate
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - DREB rate
   */
  calculateDefensiveReboundRate(games, teamId) {
    let totalRebounds = 0;
    let count = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const rebounds = isHome ? game.homeRebounds : game.awayRebounds;
      
      if (rebounds !== null && rebounds !== undefined) {
        totalRebounds += rebounds;
        count++;
      }
    }

    if (count === 0) return 0.70;
    // Estimate DREB rate from total rebounds (typically ~70% of total)
    return (totalRebounds / count) / 50;
  }

  /**
   * Calculate assist rate
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - AST rate
   */
  calculateAssistRate(games, teamId) {
    let totalAssists = 0;
    let totalPossessions = 0;

    for (const game of games) {
      const isHome = game.homeTeamId === teamId;
      const assists = isHome ? game.homeAssists : game.awayAssists;
      const possessions = this.estimatePossessions(game, isHome);

      if (assists !== null && assists !== undefined) {
        totalAssists += assists;
        totalPossessions += possessions;
      }
    }

    if (totalPossessions === 0) return 0.50;
    return totalAssists / totalPossessions;
  }

  /**
   * Calculate steal rate
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - STL rate
   */
  calculateStealRate(games, teamId) {
    // Estimate from turnovers forced (proxy)
    return 0.10; // Default estimate
  }

  /**
   * Calculate block rate
   * @param {Array} games - Team games
   * @param {string} teamId - Team ID
   * @returns {number} - BLK rate
   */
  calculateBlockRate(games, teamId) {
    // Estimate from defensive efficiency (proxy)
    return 0.08; // Default estimate
  }

  /**
   * Calculate recent form metrics
   * @param {Array} games - Team games (sorted by date)
   * @param {string} teamId - Team ID
   * @param {number} n - Number of recent games
   * @returns {Object} - Recent form metrics
   */
  calculateRecentForm(games, teamId, n = 5) {
    // Get last N games
    const recentGames = games.slice(-n);

    if (recentGames.length === 0) {
      return { winPct: 0.5, avgMargin: 0, momentum: 0 };
    }

    let wins = 0;
    let totalMargin = 0;
    const margins = [];

    for (const game of recentGames) {
      const isHome = game.homeTeamId === teamId;
      const teamScore = isHome ? game.homeScore : game.awayScore;
      const oppScore = isHome ? game.awayScore : game.homeScore;
      const margin = teamScore - oppScore;

      if (margin > 0) wins++;
      totalMargin += margin;
      margins.push(margin);
    }

    const winPct = wins / recentGames.length;
    const avgMargin = totalMargin / recentGames.length;

    // Calculate momentum (trend in margins)
    let momentum = 0;
    if (margins.length >= 2) {
      // Simple linear trend: compare first half to second half
      const firstHalf = margins.slice(0, Math.floor(margins.length / 2));
      const secondHalf = margins.slice(Math.floor(margins.length / 2));
      
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      
      momentum = (secondAvg - firstAvg) / 20; // Normalize to roughly [-1, 1]
    }

    return {
      winPct,
      avgMargin,
      momentum: Math.max(-1, Math.min(1, momentum))
    };
  }

  /**
   * Normalize features to [0, 1] range
   * @param {Object} rawFeatures - Raw feature values
   * @returns {Array} - Normalized feature vector
   */
  normalizeFeatures(rawFeatures) {
    const normalized = [];

    // Normalize each feature using min-max normalization
    for (const [key, value] of Object.entries(rawFeatures)) {
      const bounds = this.bounds[key];
      
      if (bounds) {
        const [min, max] = bounds;
        const normalizedValue = (value - min) / (max - min);
        // Clamp to [0, 1]
        normalized.push(Math.max(0, Math.min(1, normalizedValue)));
      } else {
        // For features without bounds (like recent form), assume already in [0, 1]
        normalized.push(Math.max(0, Math.min(1, value)));
      }
    }

    return normalized;
  }

  /**
   * Get default feature vector when no data is available
   * @returns {Array} - Default feature vector (all 0.5)
   */
  getDefaultFeatures() {
    // Return neutral features (all 0.5 = middle of normalized range)
    return new Array(15).fill(0.5);
  }

  /**
   * Get feature dimension count
   * @returns {number} - Number of features
   */
  getFeatureDimension() {
    return 15;
  }
}

module.exports = FeatureExtractor;
