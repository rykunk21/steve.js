const logger = require('../../utils/logger');

/**
 * Monte Carlo Markov Chain simulator for game outcomes
 * Runs thousands of simulations to estimate win probabilities and score distributions
 * Supports both traditional transition matrices and MLP-generated probabilities
 */
class MCMCSimulator {
  constructor(iterations = 10000, onlineLearner = null, teamRepository = null) {
    this.iterations = iterations;
    this.onlineLearner = onlineLearner;
    this.teamRepository = teamRepository;
    this.useGenerativeModel = false; // Flag to track data source
  }

  /**
   * Run Monte Carlo simulation for a game
   * @param {Object} transitionMatrix - Transition matrix from TransitionMatrixBuilder or MLP
   * @param {Object} gameContext - Optional game context for MLP generation
   * @returns {Object} - Simulation results with probabilities and distributions
   */
  async simulate(transitionMatrix, gameContext = null) {
    // Try to use generative model if available
    let matrix = transitionMatrix;
    let dataSource = transitionMatrix.dataSource || 'traditional';

    if (this.onlineLearner && gameContext) {
      try {
        logger.debug('Attempting to use generative model for simulation');
        
        const generatedMatrix = await this.onlineLearner.predict(
          gameContext.homeTeamId,
          gameContext.awayTeamId,
          {
            gameDate: gameContext.gameDate,
            isNeutralSite: gameContext.isNeutralSite,
            seasonStartDate: gameContext.seasonStartDate
          },
          gameContext.sport,
          gameContext.season
        );

        // Add metadata from original matrix
        generatedMatrix.sport = transitionMatrix.sport;
        generatedMatrix.possessions = transitionMatrix.possessions || 70;
        generatedMatrix.dataSource = 'mlp_generated';

        matrix = generatedMatrix;
        dataSource = 'mlp_generated';
        this.useGenerativeModel = true;

        logger.info('Using MLP-generated transition probabilities', {
          homeTeamId: gameContext.homeTeamId,
          awayTeamId: gameContext.awayTeamId
        });

      } catch (error) {
        logger.warn('Failed to use generative model, falling back to traditional', {
          error: error.message
        });
        this.useGenerativeModel = false;
      }
    } else {
      this.useGenerativeModel = false;
    }

    const results = {
      homeWins: 0,
      awayWins: 0,
      ties: 0,
      homeScores: [],
      awayScores: [],
      margins: []
    };

    logger.debug('Starting MCMC simulation', {
      iterations: this.iterations,
      sport: matrix.sport,
      possessions: matrix.possessions,
      dataSource
    });

    // Run simulations
    for (let i = 0; i < this.iterations; i++) {
      const outcome = this.simulateGame(matrix);
      
      results.homeScores.push(outcome.homeScore);
      results.awayScores.push(outcome.awayScore);
      results.margins.push(outcome.homeScore - outcome.awayScore);
      
      if (outcome.homeScore > outcome.awayScore) {
        results.homeWins++;
      } else if (outcome.awayScore > outcome.homeScore) {
        results.awayWins++;
      } else {
        results.ties++;
      }
    }

    // Calculate statistics
    const simulationResults = {
      homeWinProb: results.homeWins / this.iterations,
      awayWinProb: results.awayWins / this.iterations,
      tieProb: results.ties / this.iterations,
      avgHomeScore: this.mean(results.homeScores),
      avgAwayScore: this.mean(results.awayScores),
      avgMargin: this.mean(results.margins),
      marginStdDev: this.stdDev(results.margins),
      homeScores: results.homeScores,
      awayScores: results.awayScores,
      margins: results.margins,
      iterations: this.iterations,
      dataSource: dataSource,
      usedGenerativeModel: this.useGenerativeModel
    };

    logger.info('MCMC simulation completed', {
      iterations: this.iterations,
      homeWinProb: (simulationResults.homeWinProb * 100).toFixed(1) + '%',
      avgHomeScore: simulationResults.avgHomeScore.toFixed(1),
      avgAwayScore: simulationResults.avgAwayScore.toFixed(1),
      avgMargin: simulationResults.avgMargin.toFixed(1),
      dataSource
    });

    return simulationResults;
  }

  /**
   * Simulate a single game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome with scores
   */
  simulateGame(matrix) {
    const sport = matrix.sport;

    if (sport === 'ncaa_basketball' || sport === 'nba') {
      return this.simulateBasketballGame(matrix);
    } else if (sport === 'nfl' || sport === 'ncaa_football') {
      return this.simulateFootballGame(matrix);
    } else if (sport === 'nhl') {
      return this.simulateHockeyGame(matrix);
    }

    throw new Error(`Unsupported sport for simulation: ${sport}`);
  }

  /**
   * Simulate a basketball game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome
   */
  simulateBasketballGame(matrix) {
    let homeScore = 0;
    let awayScore = 0;

    const possessions = Math.round(matrix.possessions);

    // Simulate each possession
    for (let i = 0; i < possessions; i++) {
      // Home possession
      if (Math.random() < matrix.home.scoreProb) {
        homeScore += this.simulateBasketballPossessionPoints(matrix.home);
      }

      // Away possession
      if (Math.random() < matrix.away.scoreProb) {
        awayScore += this.simulateBasketballPossessionPoints(matrix.away);
      }
    }

    return { homeScore, awayScore };
  }

  /**
   * Simulate points scored on a basketball possession
   * @param {Object} teamMatrix - Team transition matrix
   * @returns {number} - Points scored (0, 1, 2, or 3)
   */
  simulateBasketballPossessionPoints(teamMatrix) {
    const rand = Math.random();

    // Determine shot type
    if (rand < teamMatrix.twoPointProb) {
      return 2; // 2-point shot
    } else if (rand < teamMatrix.twoPointProb + teamMatrix.threePointProb) {
      return 3; // 3-point shot
    } else if (rand < teamMatrix.twoPointProb + teamMatrix.threePointProb + teamMatrix.freeThrowProb) {
      // Free throws (1-2 points)
      const ftMakes = Math.random() < teamMatrix.freeThrowPct ? 1 : 0;
      const ftMakes2 = Math.random() < teamMatrix.freeThrowPct ? 1 : 0;
      return ftMakes + ftMakes2;
    }

    return 0; // Miss or turnover
  }

  /**
   * Simulate a football game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome
   */
  simulateFootballGame(matrix) {
    let homeScore = 0;
    let awayScore = 0;

    const possessions = Math.round(matrix.possessions);

    // Simulate each possession
    for (let i = 0; i < possessions; i++) {
      // Home possession
      if (Math.random() < matrix.home.scoreProb) {
        homeScore += this.simulateFootballPossessionPoints(matrix.home);
      }

      // Away possession
      if (Math.random() < matrix.away.scoreProb) {
        awayScore += this.simulateFootballPossessionPoints(matrix.away);
      }
    }

    return { homeScore, awayScore };
  }

  /**
   * Simulate points scored on a football possession
   * @param {Object} teamMatrix - Team transition matrix
   * @returns {number} - Points scored (0, 2, 3, 6, or 7)
   */
  simulateFootballPossessionPoints(teamMatrix) {
    const rand = Math.random();

    // Determine scoring type
    if (rand < teamMatrix.touchdownProb) {
      // Touchdown (6 points) + extra point attempt
      const extraPoint = Math.random() < 0.95 ? 1 : 0; // 95% XP success rate
      return 6 + extraPoint;
    } else if (rand < teamMatrix.touchdownProb + teamMatrix.fieldGoalProb) {
      return 3; // Field goal
    } else if (rand < teamMatrix.touchdownProb + teamMatrix.fieldGoalProb + teamMatrix.safetyProb) {
      return 2; // Safety
    }

    return 0; // No score
  }

  /**
   * Simulate a hockey game
   * @param {Object} matrix - Transition matrix
   * @returns {Object} - Game outcome
   */
  simulateHockeyGame(matrix) {
    let homeScore = 0;
    let awayScore = 0;

    const possessions = Math.round(matrix.possessions);

    // Simulate each possession (shot attempt)
    for (let i = 0; i < possessions; i++) {
      // Home possession
      if (Math.random() < matrix.home.scoreProb) {
        homeScore += 1; // Goal
      }

      // Away possession
      if (Math.random() < matrix.away.scoreProb) {
        awayScore += 1; // Goal
      }
    }

    return { homeScore, awayScore };
  }

  /**
   * Calculate mean of an array
   * @param {Array} arr - Array of numbers
   * @returns {number} - Mean value
   */
  mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate standard deviation of an array
   * @param {Array} arr - Array of numbers
   * @returns {number} - Standard deviation
   */
  stdDev(arr) {
    if (arr.length === 0) return 0;
    const avg = this.mean(arr);
    const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  /**
   * Calculate percentile from array
   * @param {Array} arr - Sorted array of numbers
   * @param {number} percentile - Percentile to calculate (0-100)
   * @returns {number} - Percentile value
   */
  percentile(arr, percentile) {
    if (arr.length === 0) return 0;
    
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
}

module.exports = MCMCSimulator;
