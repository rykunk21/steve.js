const TeamStatisticsAggregator = require('./TeamStatisticsAggregator');
const TransitionMatrixBuilder = require('./TransitionMatrixBuilder');
const MCMCSimulator = require('./MCMCSimulator');
const EVCalculator = require('./EVCalculator');
const logger = require('../../utils/logger');

/**
 * Main betting recommendation engine
 * Coordinates MCMC simulation and EV calculation to generate betting recommendations
 */
class BettingRecommendationEngine {
  constructor(config = {}) {
    this.statsAggregator = new TeamStatisticsAggregator(config);
    this.matrixBuilder = new TransitionMatrixBuilder();
    this.simulator = new MCMCSimulator(config.iterations || 10000);
    this.evCalculator = new EVCalculator(config);
  }

  /**
   * Generate betting recommendation for a game
   * @param {Object} gameData - Game data with team information
   * @param {Object} bettingOdds - Current betting odds (BettingSnapshot format)
   * @returns {Promise<Object>} - Recommendation with pick, reasoning, and opportunities
   */
  async generateRecommendation(gameData, bettingOdds) {
    try {
      logger.info('Generating betting recommendation', {
        gameId: gameData.id,
        sport: gameData.sport,
        matchup: `${gameData.teams.away?.abbreviation} @ ${gameData.teams.home?.abbreviation}`
      });

      // 1. Get team statistics
      const teamStats = await this.statsAggregator.getMatchupStatistics(gameData);

      // Check if we have sufficient statistics
      if (!teamStats.home || !teamStats.away) {
        logger.warn('Insufficient team statistics for MCMC simulation, using fallback', {
          gameId: gameData.id,
          hasHomeStats: !!teamStats.home,
          hasAwayStats: !!teamStats.away
        });
        
        return this.generateFallbackRecommendation(gameData, bettingOdds);
      }

      // 2. Build transition matrix
      const isNeutralSite = gameData.neutralSite || false;
      const matrix = this.matrixBuilder.buildMatrix(
        teamStats.home,
        teamStats.away,
        gameData.sport,
        isNeutralSite
      );

      // 3. Run MCMC simulation
      const simulationResults = this.simulator.simulate(matrix);

      // 4. Calculate EV for all markets
      const opportunities = this.evCalculator.calculateEV(
        simulationResults,
        bettingOdds,
        gameData
      );

      // 5. Generate recommendation
      const recommendation = this.formatRecommendation(
        opportunities,
        simulationResults,
        gameData,
        bettingOdds
      );

      logger.info('Generated MCMC-based recommendation', {
        gameId: gameData.id,
        opportunitiesFound: opportunities.length,
        hasPick: !!recommendation.pick
      });

      return recommendation;

    } catch (error) {
      logger.error('Failed to generate betting recommendation', {
        gameId: gameData.id,
        error: error.message,
        stack: error.stack
      });

      // Fallback to simple recommendation
      return this.generateFallbackRecommendation(gameData, bettingOdds);
    }
  }

  /**
   * Format recommendation from opportunities and simulation results
   * @param {Array} opportunities - Betting opportunities
   * @param {Object} simulationResults - MCMC simulation results
   * @param {Object} gameData - Game data
   * @param {Object} bettingOdds - Betting odds
   * @returns {Object} - Formatted recommendation
   */
  formatRecommendation(opportunities, simulationResults, gameData, bettingOdds) {
    // Sort opportunities by EV
    const sortedOpportunities = this.evCalculator.sortByEV(opportunities);

    // No positive EV opportunities found
    if (sortedOpportunities.length === 0) {
      return {
        pick: 'No value opportunities detected',
        reasoning: 'All bets priced efficiently by the market. Simulated probabilities align with implied odds.',
        method: 'MCMC',
        simulationData: {
          homeWinProb: `${(simulationResults.homeWinProb * 100).toFixed(1)}%`,
          awayWinProb: `${(simulationResults.awayWinProb * 100).toFixed(1)}%`,
          avgMargin: simulationResults.avgMargin.toFixed(1),
          iterations: simulationResults.iterations,
          avgHomeScore: simulationResults.avgHomeScore.toFixed(1),
          avgAwayScore: simulationResults.avgAwayScore.toFixed(1)
        },
        allOpportunities: []
      };
    }

    // Get best opportunity
    const best = sortedOpportunities[0];

    // Generate reasoning
    const reasoning = this.generateReasoning(best, simulationResults);

    return {
      pick: best.pick,
      reasoning: reasoning,
      method: 'MCMC',
      simulationData: {
        simulatedProb: `${(best.simulatedProb * 100).toFixed(1)}%`,
        impliedProb: `${(best.impliedProb * 100).toFixed(1)}%`,
        expectedValue: `+${best.evPercent}%`,
        confidence: best.confidence,
        iterations: simulationResults.iterations,
        avgMargin: simulationResults.avgMargin.toFixed(1),
        homeWinProb: `${(simulationResults.homeWinProb * 100).toFixed(1)}%`,
        awayWinProb: `${(simulationResults.awayWinProb * 100).toFixed(1)}%`
      },
      allOpportunities: this.evCalculator.formatOpportunities(sortedOpportunities)
    };
  }

  /**
   * Generate reasoning text for a betting opportunity
   * @param {Object} opportunity - Betting opportunity
   * @param {Object} simulationResults - Simulation results
   * @returns {string} - Reasoning text
   */
  generateReasoning(opportunity, simulationResults) {
    const simProb = (opportunity.simulatedProb * 100).toFixed(1);
    const impProb = (opportunity.impliedProb * 100).toFixed(1);
    const ev = opportunity.evPercent;

    let reasoning = `MCMC simulation (${simulationResults.iterations.toLocaleString()} iterations) suggests ${simProb}% probability vs ${impProb}% implied by odds. `;
    reasoning += `Expected value: +${ev}%. `;

    // Add context based on bet type
    if (opportunity.type === 'moneyline') {
      reasoning += `Model favors ${opportunity.team} to win outright.`;
    } else if (opportunity.type === 'spread') {
      reasoning += `Model suggests ${opportunity.team} will cover the ${opportunity.spread} spread.`;
    } else if (opportunity.type === 'total') {
      reasoning += `Projected total score suggests ${opportunity.side} ${opportunity.total} is favorable.`;
    }

    // Add confidence qualifier
    if (opportunity.confidence === 'Very High' || opportunity.confidence === 'High') {
      reasoning += ` High confidence bet.`;
    }

    return reasoning;
  }

  /**
   * Generate fallback recommendation when MCMC simulation is not available
   * Uses simple line movement analysis
   * @param {Object} gameData - Game data
   * @param {Object} bettingOdds - Betting odds
   * @returns {Object} - Fallback recommendation
   */
  generateFallbackRecommendation(gameData, bettingOdds) {
    logger.info('Using fallback recommendation method', {
      gameId: gameData.id
    });

    const recommendations = [];

    // Analyze moneyline for underdog value
    if (bettingOdds.homeMoneyline && bettingOdds.awayMoneyline) {
      const homeOdds = bettingOdds.homeMoneyline;
      const awayOdds = bettingOdds.awayMoneyline;

      // Look for underdog value (positive odds between +100 and +250)
      if (awayOdds > 0 && awayOdds <= 250) {
        recommendations.push({
          type: 'moneyline',
          pick: `${gameData.teams.away.abbreviation} ML +${awayOdds}`,
          value: awayOdds / 100,
          reasoning: `Away underdog at +${awayOdds} offers potential value. Risk $100 to win $${awayOdds}.`
        });
      }

      if (homeOdds > 0 && homeOdds <= 250) {
        recommendations.push({
          type: 'moneyline',
          pick: `${gameData.teams.home.abbreviation} ML +${homeOdds}`,
          value: homeOdds / 100,
          reasoning: `Home underdog at +${homeOdds} offers potential value. Risk $100 to win $${homeOdds}.`
        });
      }
    }

    // Default: no strong recommendation
    if (recommendations.length === 0) {
      return {
        pick: 'No strong recommendation',
        reasoning: 'Insufficient data for MCMC simulation. Monitor line movement for value opportunities.',
        method: 'Fallback',
        warning: 'Team statistics unavailable - using fallback analysis',
        simulationData: null,
        allOpportunities: []
      };
    }

    // Sort by value and return best
    recommendations.sort((a, b) => b.value - a.value);
    const best = recommendations[0];

    return {
      pick: best.pick,
      reasoning: best.reasoning,
      method: 'Fallback',
      warning: 'Team statistics unavailable - using fallback analysis',
      simulationData: null,
      allOpportunities: recommendations.map(r => ({
        pick: r.pick,
        type: r.type,
        reasoning: r.reasoning
      }))
    };
  }

  /**
   * Get simulation statistics for a game (without generating recommendation)
   * Useful for analysis and debugging
   * @param {Object} gameData - Game data
   * @returns {Promise<Object|null>} - Simulation results or null
   */
  async getSimulationStatistics(gameData) {
    try {
      const teamStats = await this.statsAggregator.getMatchupStatistics(gameData);

      if (!teamStats.home || !teamStats.away) {
        return null;
      }

      const isNeutralSite = gameData.neutralSite || false;
      const matrix = this.matrixBuilder.buildMatrix(
        teamStats.home,
        teamStats.away,
        gameData.sport,
        isNeutralSite
      );

      const simulationResults = this.simulator.simulate(matrix);

      return {
        homeWinProb: simulationResults.homeWinProb,
        awayWinProb: simulationResults.awayWinProb,
        avgHomeScore: simulationResults.avgHomeScore,
        avgAwayScore: simulationResults.avgAwayScore,
        avgMargin: simulationResults.avgMargin,
        marginStdDev: simulationResults.marginStdDev,
        iterations: simulationResults.iterations
      };

    } catch (error) {
      logger.error('Failed to get simulation statistics', {
        gameId: gameData.id,
        error: error.message
      });
      return null;
    }
  }
}

module.exports = BettingRecommendationEngine;
