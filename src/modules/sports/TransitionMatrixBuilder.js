const logger = require('../../utils/logger');

/**
 * Builds game-specific transition probability matrices for MCMC simulation
 * Uses team statistics to create realistic game flow probabilities
 */
class TransitionMatrixBuilder {
  constructor() {
    // Sport-specific configuration
    this.sportConfigs = {
      'ncaa_basketball': {
        avgPossessions: 70,
        homeAdvantage: 3.5,
        possessionTypes: ['2pt', '3pt', 'ft', 'turnover', 'miss']
      },
      'nba': {
        avgPossessions: 100,
        homeAdvantage: 3.0,
        possessionTypes: ['2pt', '3pt', 'ft', 'turnover', 'miss']
      },
      'nfl': {
        avgPossessions: 12,
        homeAdvantage: 2.5,
        possessionTypes: ['td', 'fg', 'turnover', 'punt']
      },
      'ncaa_football': {
        avgPossessions: 12,
        homeAdvantage: 3.0,
        possessionTypes: ['td', 'fg', 'turnover', 'punt']
      },
      'nhl': {
        avgPossessions: 60,
        homeAdvantage: 0.5,
        possessionTypes: ['goal', 'shot', 'miss']
      }
    };
  }

  /**
   * Build transition matrix from StatBroadcast XML game data
   * Uses exact possession counts and shot distributions from play-by-play
   * @param {Object} gameData - Parsed XML game data from XMLGameParser
   * @param {string} sport - Sport key
   * @returns {Object} - Transition matrix with probabilities
   */
  buildFromStatBroadcastXML(gameData, sport) {
    const config = this.sportConfigs[sport];
    if (!config) {
      throw new Error(`Unsupported sport for transition matrix: ${sport}`);
    }

    // Extract team data from XML
    const homeTeam = gameData.teams.home;
    const awayTeam = gameData.teams.visitor;

    if (!homeTeam || !awayTeam) {
      throw new Error('Invalid game data: missing home or visitor team');
    }

    // Use exact possession count from XML (Requirement 18.9)
    const possessionCount = homeTeam.advancedMetrics.possessionCount || 
                           awayTeam.advancedMetrics.possessionCount ||
                           config.avgPossessions;

    // Determine if neutral site
    const isNeutralSite = gameData.metadata.neutralGame === 'Y';
    const homeAdj = isNeutralSite ? 0 : config.homeAdvantage;

    // Build transition probabilities from actual game statistics
    const matrix = {
      home: this.buildTeamTransitionsFromXML(homeTeam, awayTeam, sport, true, homeAdj),
      away: this.buildTeamTransitionsFromXML(awayTeam, homeTeam, sport, false, 0),
      possessions: possessionCount,
      homeAdvantage: homeAdj,
      sport: sport,
      dataSource: 'statbroadcast'
    };

    logger.debug('Built transition matrix from StatBroadcast XML', {
      sport,
      possessions: possessionCount,
      homeAdvantage: homeAdj,
      homeScore: homeTeam.score,
      awayScore: awayTeam.score
    });

    return matrix;
  }

  /**
   * Build team transition probabilities from StatBroadcast XML data
   * Extracts shot distribution, turnover rates, and rebound rates from actual game stats
   * @param {Object} offenseTeam - Offensive team data from XML
   * @param {Object} defenseTeam - Defensive team data from XML
   * @param {string} sport - Sport key
   * @param {boolean} isHome - Whether team is home
   * @param {number} homeAdj - Home advantage adjustment
   * @returns {Object} - Team-specific transition probabilities
   */
  buildTeamTransitionsFromXML(offenseTeam, defenseTeam, sport, isHome, homeAdj) {
    if (sport === 'ncaa_basketball' || sport === 'nba') {
      return this.buildBasketballTransitionsFromXML(offenseTeam, defenseTeam, homeAdj);
    }
    
    // For other sports, fall back to aggregate method
    throw new Error(`StatBroadcast XML parsing not yet implemented for sport: ${sport}`);
  }

  /**
   * Build basketball transition probabilities from StatBroadcast XML data
   * Uses actual shot distribution and game statistics (Requirement 18.9, 18.10)
   * Prefers StatBroadcast data over ESPN aggregate stats when available
   * 
   * @param {Object} offenseTeam - Offensive team data from XMLGameParser
   * @param {Object} defenseTeam - Defensive team data from XMLGameParser
   * @param {number} homeAdj - Home advantage adjustment
   * @returns {Object} - Basketball transitions with actual game probabilities
   */
  buildBasketballTransitionsFromXML(offenseTeam, defenseTeam, homeAdj) {
    const offenseStats = offenseTeam.stats;
    const defenseStats = defenseTeam.stats;
    const offenseAdvanced = offenseTeam.advancedMetrics;
    const offenseDerived = offenseTeam.derivedMetrics;

    // Extract shot distribution from actual game data (Requirement 18.10)
    const shotDistribution = this.extractShotDistribution(offenseStats);
    
    // Calculate turnover rate from exact possession count (Requirement 18.9)
    const possessions = offenseAdvanced.possessionCount || 70;
    const turnoverProb = this.calculateTurnoverRate(offenseStats.turnovers, possessions);

    // Calculate offensive rebound rate from actual rebounds
    const reboundProb = this.calculateReboundRate(
      offenseStats.offensiveRebounds,
      offenseStats.rebounds,
      defenseStats.rebounds
    );

    // Calculate expected points per possession from actual game result
    const expectedPPP = possessions > 0 ? offenseTeam.score / possessions : 1.0;

    return {
      scoreProb: offenseStats.fgPct / 100 || 0.50,
      twoPointProb: shotDistribution.twoPointRate,
      threePointProb: shotDistribution.threePointRate,
      freeThrowProb: shotDistribution.freeThrowRate,
      twoPointPct: shotDistribution.twoPointPct,
      threePointPct: shotDistribution.threePointPct,
      freeThrowPct: shotDistribution.freeThrowPct,
      turnoverProb: turnoverProb,
      reboundProb: reboundProb,
      expectedPoints: (expectedPPP * 100) + homeAdj,
      effectiveFgPct: offenseDerived.effectiveFgPct / 100,
      trueShootingPct: offenseDerived.trueShootingPct / 100
    };
  }

  /**
   * Extract shot distribution from team statistics
   * Calculates attempt rates and shooting percentages for different shot types
   * 
   * @param {Object} stats - Team statistics from XML
   * @returns {Object} - Shot distribution with rates and percentages
   */
  extractShotDistribution(stats) {
    const totalFGA = stats.fga;
    const fg3a = stats.fg3a;
    const fg2a = totalFGA - fg3a;
    
    // Calculate attempt rates (what percentage of shots are 2PT vs 3PT)
    const twoPointRate = totalFGA > 0 ? fg2a / totalFGA : 0.60;
    const threePointRate = totalFGA > 0 ? fg3a / totalFGA : 0.30;
    
    // Free throw rate (FTA per FGA)
    const freeThrowRate = totalFGA > 0 ? stats.fta / totalFGA : 0.10;

    // Calculate shooting percentages for each shot type
    const twoPointPct = fg2a > 0 ? (stats.fgm - stats.fg3m) / fg2a : 0.50;
    const threePointPct = stats.fg3Pct / 100 || 0.33;
    const freeThrowPct = stats.ftPct / 100 || 0.75;

    return {
      twoPointRate,
      threePointRate,
      freeThrowRate,
      twoPointPct,
      threePointPct,
      freeThrowPct
    };
  }

  /**
   * Calculate turnover rate from exact possession count
   * Uses StatBroadcast possession data instead of estimation
   * 
   * @param {number} turnovers - Number of turnovers
   * @param {number} possessions - Exact possession count from XML
   * @returns {number} - Turnover probability (0-1)
   */
  calculateTurnoverRate(turnovers, possessions) {
    if (possessions <= 0) {
      return 0.15; // Default fallback
    }
    return Math.min(0.50, turnovers / possessions); // Cap at 50%
  }

  /**
   * Calculate offensive rebound rate from actual game rebounds
   * 
   * @param {number} offensiveRebounds - Offensive rebounds
   * @param {number} teamRebounds - Total team rebounds
   * @param {number} opponentRebounds - Opponent rebounds
   * @returns {number} - Offensive rebound probability (0-1)
   */
  calculateReboundRate(offensiveRebounds, teamRebounds, opponentRebounds) {
    const totalRebounds = teamRebounds + opponentRebounds;
    if (totalRebounds <= 0) {
      return 0.30; // Default fallback
    }
    return Math.min(0.60, offensiveRebounds / totalRebounds); // Cap at 60%
  }

  /**
   * Build transition matrix for a specific game
   * @param {Object} homeTeamStats - Home team statistics
   * @param {Object} awayTeamStats - Away team statistics
   * @param {string} sport - Sport key
   * @param {boolean} isNeutralSite - Whether game is at neutral site
   * @returns {Object} - Transition matrix with probabilities
   */
  buildMatrix(homeTeamStats, awayTeamStats, sport, isNeutralSite = false) {
    const config = this.sportConfigs[sport];
    if (!config) {
      throw new Error(`Unsupported sport for transition matrix: ${sport}`);
    }

    // Calculate adjusted efficiencies
    const homeOffense = homeTeamStats.offensiveEfficiency || 100;
    const homeDefense = homeTeamStats.defensiveEfficiency || 100;
    const awayOffense = awayTeamStats.offensiveEfficiency || 100;
    const awayDefense = awayTeamStats.defensiveEfficiency || 100;

    // Apply home court advantage
    const homeAdj = isNeutralSite ? 0 : config.homeAdvantage;

    // Calculate expected scoring rates (points per possession)
    const homeExpectedPPP = this.calculatePointsPerPossession(
      homeOffense,
      awayDefense,
      homeTeamStats,
      sport
    );
    
    const awayExpectedPPP = this.calculatePointsPerPossession(
      awayOffense,
      homeDefense,
      awayTeamStats,
      sport
    );

    // Calculate pace (possessions per game)
    const homePace = homeTeamStats.pace || config.avgPossessions;
    const awayPace = awayTeamStats.pace || config.avgPossessions;
    const avgPace = (homePace + awayPace) / 2;

    // Build transition probabilities for each team
    const matrix = {
      home: this.buildTeamTransitions(homeTeamStats, awayTeamStats, sport, true, homeAdj),
      away: this.buildTeamTransitions(awayTeamStats, homeTeamStats, sport, false, 0),
      possessions: avgPace,
      homeAdvantage: homeAdj,
      sport: sport
    };

    logger.debug('Built transition matrix', {
      sport,
      possessions: avgPace,
      homeAdvantage: homeAdj,
      homeExpectedPPP: homeExpectedPPP.toFixed(2),
      awayExpectedPPP: awayExpectedPPP.toFixed(2)
    });

    return matrix;
  }

  /**
   * Calculate points per possession for a team
   * @param {number} offense - Offensive efficiency
   * @param {number} defense - Opponent defensive efficiency
   * @param {Object} teamStats - Team statistics
   * @param {string} sport - Sport key
   * @returns {number} - Expected points per possession
   */
  calculatePointsPerPossession(offense, defense, teamStats, sport) {
    if (sport === 'ncaa_basketball' || sport === 'nba') {
      // Basketball: use efficiency ratings
      const efficiency = (offense / 100) * (100 / defense);
      return efficiency;
    } else if (sport === 'nfl' || sport === 'ncaa_football') {
      // Football: points per game / possessions
      return offense / 12; // Approximate possessions per game
    } else if (sport === 'nhl') {
      // Hockey: goals per game
      return offense / 60; // Approximate shots per game
    }

    return 1.0;
  }

  /**
   * Build transition probabilities for a specific team
   * @param {Object} offenseStats - Offensive team statistics
   * @param {Object} defenseStats - Defensive team statistics
   * @param {string} sport - Sport key
   * @param {boolean} isHome - Whether team is home
   * @param {number} homeAdj - Home advantage adjustment
   * @returns {Object} - Team-specific transition probabilities
   */
  buildTeamTransitions(offenseStats, defenseStats, sport, isHome, homeAdj) {
    if (sport === 'ncaa_basketball' || sport === 'nba') {
      return this.buildBasketballTransitions(offenseStats, defenseStats, homeAdj);
    } else if (sport === 'nfl' || sport === 'ncaa_football') {
      return this.buildFootballTransitions(offenseStats, defenseStats, homeAdj);
    } else if (sport === 'nhl') {
      return this.buildHockeyTransitions(offenseStats, defenseStats, homeAdj);
    }

    throw new Error(`Unsupported sport: ${sport}`);
  }

  /**
   * Build basketball-specific transition probabilities
   * @param {Object} offenseStats - Offensive statistics
   * @param {Object} defenseStats - Defensive statistics
   * @param {number} homeAdj - Home advantage
   * @returns {Object} - Basketball transitions
   */
  buildBasketballTransitions(offenseStats, defenseStats, homeAdj) {
    const offensiveStrength = offenseStats.effectiveFieldGoalPct || 0.50;
    const defensiveStrength = 1 - (defenseStats.effectiveFieldGoalPct || 0.50);
    
    // Calculate base scoring probability
    const baseScoreProb = (offensiveStrength + defensiveStrength) / 2;
    
    // Adjust for recent form
    const recentWinPct = offenseStats.recentForm.reduce((a, b) => a + b, 0) / 5;
    const formBonus = (recentWinPct - 0.5) * 0.05; // ±2.5% based on form
    
    const scoreProb = Math.min(0.95, Math.max(0.05, baseScoreProb + formBonus));

    return {
      scoreProb: scoreProb,
      twoPointProb: 0.60, // 60% of made shots are 2-pointers
      threePointProb: 0.30, // 30% of made shots are 3-pointers
      freeThrowProb: 0.10, // 10% of possessions end in free throws
      turnoverProb: offenseStats.turnoverRate || 0.15,
      reboundProb: offenseStats.offensiveReboundRate || 0.30,
      freeThrowPct: offenseStats.freeThrowRate || 0.75,
      expectedPoints: (offenseStats.offensiveEfficiency || 100) + homeAdj
    };
  }

  /**
   * Build football-specific transition probabilities
   * @param {Object} offenseStats - Offensive statistics
   * @param {Object} defenseStats - Defensive statistics
   * @param {number} homeAdj - Home advantage
   * @returns {Object} - Football transitions
   */
  buildFootballTransitions(offenseStats, defenseStats, homeAdj) {
    const offensiveStrength = offenseStats.effectiveFieldGoalPct || 0.40; // Third down conversion
    const defensiveStrength = 1 - (defenseStats.effectiveFieldGoalPct || 0.40);
    
    const baseScoreProb = (offensiveStrength + defensiveStrength) / 2;
    
    // Adjust for recent form
    const recentWinPct = offenseStats.recentForm.reduce((a, b) => a + b, 0) / 5;
    const formBonus = (recentWinPct - 0.5) * 0.05;
    
    const scoreProb = Math.min(0.95, Math.max(0.05, baseScoreProb + formBonus));

    return {
      scoreProb: scoreProb,
      touchdownProb: 0.55, // 55% of scores are touchdowns
      fieldGoalProb: 0.35, // 35% of scores are field goals
      safetyProb: 0.01, // 1% of scores are safeties
      turnoverProb: (offenseStats.turnoverRate || 1.0) / 12, // Per possession
      puntProb: 0.40, // 40% of drives end in punts
      redZonePct: offenseStats.freeThrowRate || 0.55,
      expectedPoints: (offenseStats.offensiveEfficiency || 20) + homeAdj
    };
  }

  /**
   * Build hockey-specific transition probabilities
   * @param {Object} offenseStats - Offensive statistics
   * @param {Object} defenseStats - Defensive statistics
   * @param {number} homeAdj - Home advantage
   * @returns {Object} - Hockey transitions
   */
  buildHockeyTransitions(offenseStats, defenseStats, homeAdj) {
    const offensiveStrength = offenseStats.effectiveFieldGoalPct || 0.10; // Shooting percentage
    const defensiveStrength = 1 - (defenseStats.effectiveFieldGoalPct || 0.10);
    
    const baseScoreProb = (offensiveStrength + defensiveStrength) / 2;
    
    // Adjust for recent form
    const recentWinPct = offenseStats.recentForm.reduce((a, b) => a + b, 0) / 5;
    const formBonus = (recentWinPct - 0.5) * 0.02; // ±1% based on form
    
    const scoreProb = Math.min(0.50, Math.max(0.01, baseScoreProb + formBonus));

    return {
      scoreProb: scoreProb,
      goalProb: 1.0, // All scores are goals
      shotProb: 0.30, // 30% of possessions result in shots
      missProb: 0.60, // 60% of possessions miss the net
      turnoverProb: (offenseStats.turnoverRate || 10) / 60, // Per possession
      powerPlayProb: offenseStats.offensiveReboundRate || 0.20,
      savePct: 1 - (offenseStats.effectiveFieldGoalPct || 0.10),
      expectedPoints: (offenseStats.offensiveEfficiency || 3.0) + homeAdj
    };
  }

  /**
   * Calculate scoring probability based on team matchup
   * @param {Object} offense - Offensive team stats
   * @param {Object} defense - Defensive team stats
   * @returns {number} - Scoring probability (0-1)
   */
  calculateScoreProb(offense, defense) {
    const offensiveStrength = offense.effectiveFieldGoalPct || 0.50;
    const defensiveStrength = 1 - (defense.effectiveFieldGoalPct || 0.50);
    
    // Weight recent form
    const recentWinPct = offense.recentForm.reduce((a, b) => a + b, 0) / 5;
    const formBonus = (recentWinPct - 0.5) * 0.05; // ±2.5% based on form
    
    return Math.min(0.95, Math.max(0.05, 
      (offensiveStrength + defensiveStrength) / 2 + formBonus
    ));
  }
}

module.exports = TransitionMatrixBuilder;
