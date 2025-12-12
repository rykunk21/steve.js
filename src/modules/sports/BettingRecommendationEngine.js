const TeamStatisticsAggregator = require('./TeamStatisticsAggregator');
const TransitionMatrixBuilder = require('./TransitionMatrixBuilder');
const MCMCSimulator = require('./MCMCSimulator');
const EVCalculator = require('./EVCalculator');
const ESPNAPIClient = require('./ESPNAPIClient');
const TeamRepository = require('../../database/repositories/TeamRepository');
const logger = require('../../utils/logger');

/**
 * Main betting recommendation engine
 * Coordinates MCMC simulation and EV calculation to generate betting recommendations
 * Supports both traditional statistics and VAE-NN system for enhanced predictions
 */
class BettingRecommendationEngine {
  constructor(config = {}) {
    this.statsAggregator = new TeamStatisticsAggregator(config);
    this.matrixBuilder = new TransitionMatrixBuilder();
    this.simulator = new MCMCSimulator(config.iterations || 10000);
    this.evCalculator = new EVCalculator(config);
    
    // VAE-NN system components
    this.vaeNNSystem = config.vaeNNSystem || null;
    this.teamRepository = config.teamRepository || new TeamRepository();
    this.espnClient = config.espnClient || new ESPNAPIClient();
    
    // Configuration
    this.preferVAENN = config.preferVAENN !== false; // Default to true
    this.includeUncertaintyMetrics = config.includeUncertaintyMetrics !== false; // Default to true
    
    // Initialize VAE-NN system if provided
    if (this.vaeNNSystem && this.teamRepository) {
      this.simulator.setVAENNSystem(this.vaeNNSystem, this.teamRepository);
      logger.info('BettingRecommendationEngine initialized with VAE-NN system');
    }
  }

  /**
   * Generate betting recommendation for a game using VAE-NN system when available
   * @param {Object} gameData - Game data with team information
   * @param {Object} bettingOdds - Current betting odds (BettingSnapshot format)
   * @returns {Promise<Object>} - Recommendation with pick, reasoning, and opportunities
   */
  async generateRecommendation(gameData, bettingOdds) {
    try {
      logger.info('Generating betting recommendation', {
        gameId: gameData.id,
        sport: gameData.sport,
        matchup: `${gameData.teams.away?.abbreviation} @ ${gameData.teams.home?.abbreviation}`,
        vaeNNAvailable: this.simulator.checkVAENNAvailability().available
      });

      // Try VAE-NN system first if available and preferred
      if (this.preferVAENN && this.simulator.checkVAENNAvailability().available) {
        const vaeNNRecommendation = await this.generateVAENNRecommendation(gameData, bettingOdds);
        if (vaeNNRecommendation) {
          return vaeNNRecommendation;
        }
        
        logger.warn('VAE-NN recommendation failed, falling back to traditional method', {
          gameId: gameData.id
        });
      }

      // Fallback to traditional MCMC simulation
      return await this.generateTraditionalRecommendation(gameData, bettingOdds);

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
   * Generate recommendation using VAE-NN system
   * @param {Object} gameData - Game data with team information
   * @param {Object} bettingOdds - Current betting odds
   * @returns {Promise<Object|null>} - VAE-NN based recommendation or null if failed
   */
  async generateVAENNRecommendation(gameData, bettingOdds) {
    try {
      // Extract team IDs (ESPN format)
      const homeTeamId = gameData.teams.home?.id;
      const awayTeamId = gameData.teams.away?.id;

      if (!homeTeamId || !awayTeamId) {
        logger.warn('Missing team IDs for VAE-NN recommendation', {
          gameId: gameData.id,
          homeTeamId,
          awayTeamId
        });
        return null;
      }

      // Build game context features
      const gameContext = this.buildGameContext(gameData);

      // Run VAE-NN MCMC simulation
      const simulationResults = await this.simulator.simulateWithVAENN(
        homeTeamId,
        awayTeamId,
        gameContext
      );

      // Check if VAE-NN was actually used
      if (!simulationResults.usedVAENN) {
        logger.info('VAE-NN system not used, simulation fell back to traditional method', {
          gameId: gameData.id,
          dataSource: simulationResults.dataSource
        });
        return null;
      }

      // Calculate EV for all markets
      const opportunities = this.evCalculator.calculateEV(
        simulationResults,
        bettingOdds,
        gameData
      );

      // Generate recommendation with VAE-NN specific formatting
      const recommendation = this.formatVAENNRecommendation(
        opportunities,
        simulationResults,
        gameData,
        bettingOdds
      );

      logger.info('Generated VAE-NN based recommendation', {
        gameId: gameData.id,
        opportunitiesFound: opportunities.length,
        hasPick: !!recommendation.pick,
        homeUncertainty: simulationResults.uncertaintyMetrics?.homeTeamUncertainty,
        awayUncertainty: simulationResults.uncertaintyMetrics?.awayTeamUncertainty,
        predictionConfidence: simulationResults.uncertaintyMetrics?.predictionConfidence
      });

      return recommendation;

    } catch (error) {
      logger.error('Failed to generate VAE-NN recommendation', {
        gameId: gameData.id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Generate recommendation using traditional MCMC simulation
   * @param {Object} gameData - Game data with team information
   * @param {Object} bettingOdds - Current betting odds
   * @returns {Promise<Object>} - Traditional MCMC based recommendation
   */
  async generateTraditionalRecommendation(gameData, bettingOdds) {
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

    logger.info('Generated traditional MCMC-based recommendation', {
      gameId: gameData.id,
      opportunitiesFound: opportunities.length,
      hasPick: !!recommendation.pick
    });

    return recommendation;
  }

  /**
   * Build game context features for VAE-NN system
   * @param {Object} gameData - Game data
   * @returns {Object} - Game context object
   */
  buildGameContext(gameData) {
    const gameDate = new Date(gameData.date);
    const now = new Date();
    
    // Calculate season progress (assuming season starts in November)
    const seasonStart = new Date(gameDate.getFullYear(), 10, 1); // November 1st
    const seasonEnd = new Date(gameDate.getFullYear() + 1, 2, 31); // March 31st
    const seasonProgress = Math.min(1, Math.max(0, 
      (gameDate - seasonStart) / (seasonEnd - seasonStart)
    ));

    return {
      isNeutralSite: gameData.neutralSite || false,
      isPostseason: gameData.postseason || seasonProgress > 0.8,
      restDays: gameData.restDays || 1,
      travelDistance: gameData.travelDistance || 0,
      isConferenceGame: gameData.conferenceGame || false,
      isRivalryGame: gameData.rivalryGame || false,
      isTVGame: gameData.tvGame || true, // Most games are televised
      timeOfDay: gameDate.getHours(),
      dayOfWeek: gameDate.getDay(),
      seasonProgress: seasonProgress,
      sport: gameData.sport,
      possessions: gameData.expectedPossessions || (gameData.sport === 'ncaa_basketball' ? 70 : 100)
    };
  }

  /**
   * Format VAE-NN recommendation with uncertainty metrics
   * @param {Array} opportunities - Betting opportunities
   * @param {Object} simulationResults - VAE-NN MCMC simulation results
   * @param {Object} gameData - Game data
   * @param {Object} bettingOdds - Betting odds
   * @returns {Object} - Formatted VAE-NN recommendation
   */
  formatVAENNRecommendation(opportunities, simulationResults, gameData, bettingOdds) {
    // Sort opportunities by EV
    const sortedOpportunities = this.evCalculator.sortByEV(opportunities);
    const uncertaintyMetrics = simulationResults.uncertaintyMetrics;

    // No positive EV opportunities found
    if (sortedOpportunities.length === 0) {
      return {
        pick: 'No value opportunities detected',
        reasoning: 'All bets priced efficiently by the market. VAE-NN simulated probabilities align with implied odds.',
        method: 'VAE-NN',
        dataSource: simulationResults.dataSource,
        simulationData: {
          homeWinProb: `${(simulationResults.homeWinProb * 100).toFixed(1)}%`,
          awayWinProb: `${(simulationResults.awayWinProb * 100).toFixed(1)}%`,
          avgMargin: simulationResults.avgMargin.toFixed(1),
          iterations: simulationResults.iterations,
          avgHomeScore: simulationResults.avgHomeScore.toFixed(1),
          avgAwayScore: simulationResults.avgAwayScore.toFixed(1),
          predictionConfidence: uncertaintyMetrics ? `${(uncertaintyMetrics.predictionConfidence * 100).toFixed(1)}%` : 'N/A'
        },
        uncertaintyMetrics: this.includeUncertaintyMetrics ? this.formatUncertaintyMetrics(uncertaintyMetrics) : null,
        allOpportunities: []
      };
    }

    // Get best opportunity
    const best = sortedOpportunities[0];

    // Generate VAE-NN specific reasoning
    const reasoning = this.generateVAENNReasoning(best, simulationResults, uncertaintyMetrics);

    return {
      pick: best.pick,
      reasoning: reasoning,
      method: 'VAE-NN',
      dataSource: simulationResults.dataSource,
      simulationData: {
        simulatedProb: `${(best.simulatedProb * 100).toFixed(1)}%`,
        impliedProb: `${(best.impliedProb * 100).toFixed(1)}%`,
        expectedValue: `+${best.evPercent}%`,
        confidence: best.confidence,
        iterations: simulationResults.iterations,
        avgMargin: simulationResults.avgMargin.toFixed(1),
        homeWinProb: `${(simulationResults.homeWinProb * 100).toFixed(1)}%`,
        awayWinProb: `${(simulationResults.awayWinProb * 100).toFixed(1)}%`,
        predictionConfidence: uncertaintyMetrics ? `${(uncertaintyMetrics.predictionConfidence * 100).toFixed(1)}%` : 'N/A'
      },
      uncertaintyMetrics: this.includeUncertaintyMetrics ? this.formatUncertaintyMetrics(uncertaintyMetrics) : null,
      allOpportunities: this.evCalculator.formatOpportunities(sortedOpportunities)
    };
  }

  /**
   * Format uncertainty metrics for display
   * @param {Object} uncertaintyMetrics - Raw uncertainty metrics from VAE-NN
   * @returns {Object|null} - Formatted uncertainty metrics
   */
  formatUncertaintyMetrics(uncertaintyMetrics) {
    if (!uncertaintyMetrics) return null;

    return {
      homeTeam: {
        name: uncertaintyMetrics.homeTeamName,
        uncertainty: `${(uncertaintyMetrics.homeTeamUncertainty * 100).toFixed(1)}%`,
        gamesProcessed: uncertaintyMetrics.homeGamesProcessed,
        lastSeason: uncertaintyMetrics.homeLastSeason
      },
      awayTeam: {
        name: uncertaintyMetrics.awayTeamName,
        uncertainty: `${(uncertaintyMetrics.awayTeamUncertainty * 100).toFixed(1)}%`,
        gamesProcessed: uncertaintyMetrics.awayGamesProcessed,
        lastSeason: uncertaintyMetrics.awayLastSeason
      },
      predictionConfidence: `${(uncertaintyMetrics.predictionConfidence * 100).toFixed(1)}%`,
      confidenceLevel: this.getConfidenceLevel(uncertaintyMetrics.predictionConfidence)
    };
  }

  /**
   * Get confidence level description
   * @param {number} confidence - Confidence score (0-1)
   * @returns {string} - Confidence level description
   */
  getConfidenceLevel(confidence) {
    if (confidence >= 0.9) return 'Very High';
    if (confidence >= 0.8) return 'High';
    if (confidence >= 0.7) return 'Moderate';
    if (confidence >= 0.6) return 'Low';
    return 'Very Low';
  }

  /**
   * Generate VAE-NN specific reasoning text
   * @param {Object} opportunity - Betting opportunity
   * @param {Object} simulationResults - Simulation results
   * @param {Object} uncertaintyMetrics - Uncertainty metrics
   * @returns {string} - VAE-NN reasoning text
   */
  generateVAENNReasoning(opportunity, simulationResults, uncertaintyMetrics) {
    const simProb = (opportunity.simulatedProb * 100).toFixed(1);
    const impProb = (opportunity.impliedProb * 100).toFixed(1);
    const ev = opportunity.evPercent;
    const confidence = uncertaintyMetrics ? (uncertaintyMetrics.predictionConfidence * 100).toFixed(1) : 'N/A';

    let reasoning = `VAE-NN enhanced MCMC simulation (${simulationResults.iterations.toLocaleString()} iterations) suggests ${simProb}% probability vs ${impProb}% implied by odds. `;
    reasoning += `Expected value: +${ev}%. `;
    reasoning += `Model confidence: ${confidence}%. `;

    // Add context based on bet type
    if (opportunity.type === 'moneyline') {
      reasoning += `Neural network model favors ${opportunity.team} to win outright.`;
    } else if (opportunity.type === 'spread') {
      reasoning += `Model suggests ${opportunity.team} will cover the ${opportunity.spread} spread.`;
    } else if (opportunity.type === 'total') {
      reasoning += `Projected total score suggests ${opportunity.side} ${opportunity.total} is favorable.`;
    }

    // Add uncertainty context
    if (uncertaintyMetrics) {
      const avgUncertainty = (uncertaintyMetrics.homeTeamUncertainty + uncertaintyMetrics.awayTeamUncertainty) / 2;
      if (avgUncertainty > 0.3) {
        reasoning += ` Note: Higher team uncertainty due to limited recent data.`;
      } else if (avgUncertainty < 0.1) {
        reasoning += ` High confidence based on extensive team data.`;
      }
    }

    return reasoning;
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
   * Fetch today's NCAA basketball games and generate recommendations
   * @param {Object} bettingOddsMap - Map of game IDs to betting odds
   * @returns {Promise<Array>} - Array of game recommendations
   */
  async generateTodaysRecommendations(bettingOddsMap = {}) {
    try {
      logger.info('Fetching today\'s NCAA basketball games for recommendations');

      // Fetch today's games from ESPN API
      const todaysGames = await this.espnClient.getTodaysGames('mens-college-basketball');

      if (!todaysGames || todaysGames.length === 0) {
        logger.info('No NCAA basketball games found for today');
        return [];
      }

      logger.info(`Found ${todaysGames.length} games for today`);

      const recommendations = [];

      // Generate recommendations for each game
      for (const game of todaysGames) {
        try {
          const gameData = this.formatESPNGameData(game);
          const bettingOdds = bettingOddsMap[game.id] || this.getDefaultBettingOdds();

          const recommendation = await this.generateRecommendation(gameData, bettingOdds);
          
          recommendations.push({
            gameId: game.id,
            matchup: `${gameData.teams.away.abbreviation} @ ${gameData.teams.home.abbreviation}`,
            gameTime: gameData.date,
            recommendation: recommendation
          });

        } catch (error) {
          logger.error('Failed to generate recommendation for game', {
            gameId: game.id,
            error: error.message
          });
          
          // Add failed game with error info
          recommendations.push({
            gameId: game.id,
            matchup: `${game.competitions[0]?.competitors[1]?.team?.abbreviation || 'TBD'} @ ${game.competitions[0]?.competitors[0]?.team?.abbreviation || 'TBD'}`,
            gameTime: game.date,
            recommendation: {
              pick: 'Error generating recommendation',
              reasoning: `Failed to process game: ${error.message}`,
              method: 'Error',
              error: true
            }
          });
        }
      }

      logger.info(`Generated recommendations for ${recommendations.length} games`, {
        successful: recommendations.filter(r => !r.recommendation.error).length,
        failed: recommendations.filter(r => r.recommendation.error).length
      });

      return recommendations;

    } catch (error) {
      logger.error('Failed to generate today\'s recommendations', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Format ESPN game data for internal use
   * @param {Object} espnGame - ESPN game data
   * @returns {Object} - Formatted game data
   */
  formatESPNGameData(espnGame) {
    const competition = espnGame.competitions[0];
    const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
    const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

    return {
      id: espnGame.id,
      sport: 'ncaa_basketball',
      date: new Date(espnGame.date),
      neutralSite: competition.neutralSite || false,
      postseason: espnGame.season?.type === 3, // ESPN postseason type
      teams: {
        home: {
          id: homeTeam?.team?.id,
          name: homeTeam?.team?.displayName,
          abbreviation: homeTeam?.team?.abbreviation,
          logo: homeTeam?.team?.logo
        },
        away: {
          id: awayTeam?.team?.id,
          name: awayTeam?.team?.displayName,
          abbreviation: awayTeam?.team?.abbreviation,
          logo: awayTeam?.team?.logo
        }
      },
      venue: competition.venue?.fullName,
      conferenceGame: homeTeam?.team?.conferenceId === awayTeam?.team?.conferenceId
    };
  }

  /**
   * Get default betting odds when real odds are not available
   * @returns {Object} - Default betting odds
   */
  getDefaultBettingOdds() {
    return {
      homeMoneyline: -110,
      awayMoneyline: -110,
      spreadLine: 0,
      homeSpreadOdds: -110,
      awaySpreadOdds: -110,
      totalLine: 140,
      overOdds: -110,
      underOdds: -110
    };
  }

  /**
   * Set VAE-NN system for enhanced predictions
   * @param {Object} vaeNNSystem - VAE-NN system (VAEFeedbackTrainer)
   * @param {Object} teamRepository - Team repository (optional)
   */
  setVAENNSystem(vaeNNSystem, teamRepository = null) {
    this.vaeNNSystem = vaeNNSystem;
    
    if (teamRepository) {
      this.teamRepository = teamRepository;
    }
    
    this.simulator.setVAENNSystem(vaeNNSystem, this.teamRepository);
    
    logger.info('VAE-NN system set for BettingRecommendationEngine', {
      hasVAENN: !!this.vaeNNSystem,
      hasTeamRepository: !!this.teamRepository
    });
  }

  /**
   * Get simulation statistics for a game (without generating recommendation)
   * Supports both VAE-NN and traditional methods
   * @param {Object} gameData - Game data
   * @returns {Promise<Object|null>} - Simulation results or null
   */
  async getSimulationStatistics(gameData) {
    try {
      // Try VAE-NN first if available
      if (this.preferVAENN && this.simulator.checkVAENNAvailability().available) {
        const homeTeamId = gameData.teams.home?.id;
        const awayTeamId = gameData.teams.away?.id;

        if (homeTeamId && awayTeamId) {
          const gameContext = this.buildGameContext(gameData);
          const simulationResults = await this.simulator.simulateWithVAENN(
            homeTeamId,
            awayTeamId,
            gameContext
          );

          if (simulationResults.usedVAENN) {
            return {
              method: 'VAE-NN',
              dataSource: simulationResults.dataSource,
              homeWinProb: simulationResults.homeWinProb,
              awayWinProb: simulationResults.awayWinProb,
              avgHomeScore: simulationResults.avgHomeScore,
              avgAwayScore: simulationResults.avgAwayScore,
              avgMargin: simulationResults.avgMargin,
              marginStdDev: simulationResults.marginStdDev,
              iterations: simulationResults.iterations,
              uncertaintyMetrics: simulationResults.uncertaintyMetrics
            };
          }
        }
      }

      // Fallback to traditional method
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
        method: 'Traditional',
        dataSource: simulationResults.dataSource || 'traditional',
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

  /**
   * Get engine configuration and status
   * @returns {Object} - Configuration details
   */
  getConfiguration() {
    return {
      preferVAENN: this.preferVAENN,
      includeUncertaintyMetrics: this.includeUncertaintyMetrics,
      vaeNNAvailable: this.simulator.checkVAENNAvailability().available,
      simulatorConfig: this.simulator.getConfiguration(),
      evCalculatorConfig: this.evCalculator.getConfiguration ? this.evCalculator.getConfiguration() : {}
    };
  }
}

module.exports = BettingRecommendationEngine;
