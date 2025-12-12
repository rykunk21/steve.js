const logger = require('../../utils/logger');
const HistoricalGameRepository = require('../../database/repositories/HistoricalGameRepository');

/**
 * Opponent-Adjusted Metrics Calculator
 * Adjusts team performance metrics based on opponent quality
 * Implements Requirement 12: Opponent-adjusted performance metrics
 */
class OpponentAdjustedMetrics {
  constructor(dbConnection) {
    this.db = dbConnection;
    this.gameRepo = new HistoricalGameRepository(dbConnection);
    
    // Default league average rating
    this.leagueAverage = 100.0;
    
    // Convergence threshold for iterative algorithm
    this.convergenceThreshold = 0.1;
  }

  /**
   * Calculate strength of schedule for a team
   * Average rating of all opponents faced
   * 
   * @param {string} teamId - Team ID
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @param {Object} opponentRatings - Map of team ID to rating
   * @returns {Promise<number|null>} - Strength of schedule or null
   */
  async calculateStrengthOfSchedule(teamId, sport, season, opponentRatings) {
    try {
      // Get all games for the team
      const games = await this.gameRepo.getTeamGameHistory(teamId, season, 1000);

      if (games.length === 0) {
        return null;
      }

      // Calculate average opponent rating
      let totalRating = 0;
      let count = 0;

      for (const game of games) {
        const opponentId = game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;
        
        if (opponentRatings[opponentId]) {
          totalRating += opponentRatings[opponentId].rating;
          count++;
        }
      }

      if (count === 0) {
        return null;
      }

      const sos = totalRating / count;

      logger.debug('Calculated strength of schedule', {
        teamId,
        sport,
        season,
        sos: sos.toFixed(2),
        gamesPlayed: count
      });

      return sos;
    } catch (error) {
      logger.error('Failed to calculate strength of schedule', {
        teamId,
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Adjust team performance for opponent quality
   * Better performance against strong opponents is weighted more heavily
   * 
   * @param {Object} teamPerformance - Raw team performance metrics
   * @param {number} opponentStrength - Opponent's rating
   * @param {number} leagueAverage - League average rating
   * @returns {Object} - Adjusted performance metrics
   */
  adjustForOpponentQuality(teamPerformance, opponentStrength, leagueAverage = 100) {
    // Adjustment factor: how much stronger/weaker is opponent vs average
    const opponentFactor = opponentStrength / leagueAverage;

    // Offensive adjustment: scoring against strong defense is more impressive
    // If opponent is 110 (strong), factor = 1.1, so our offense looks better
    const adjustedOffensive = teamPerformance.offensiveRating * opponentFactor;

    // Defensive adjustment: allowing points to strong offense is less bad
    // If opponent is 110 (strong offense), factor = 1.1, so our defense looks better (lower is better)
    const adjustedDefensive = teamPerformance.defensiveRating / opponentFactor;

    return {
      offensiveRating: adjustedOffensive,
      defensiveRating: adjustedDefensive
    };
  }

  /**
   * Iteratively solve for true team ratings accounting for opponent quality
   * Uses iterative algorithm similar to PageRank
   * 
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @param {number} maxIterations - Maximum iterations
   * @returns {Promise<Object>} - Map of team ID to rating
   */
  async iterativeRatingCalculation(sport, season, maxIterations = 10) {
    try {
      // Get all games for the season
      const games = await this.gameRepo.getSeasonGames(sport, season);

      if (games.length === 0) {
        return {};
      }

      // Initialize all teams with league average rating
      const ratings = {};
      const teams = new Set();

      for (const game of games) {
        teams.add(game.homeTeamId);
        teams.add(game.awayTeamId);
      }

      for (const teamId of teams) {
        ratings[teamId] = this.leagueAverage;
      }

      // Iteratively update ratings
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const newRatings = { ...ratings };

        for (const teamId of teams) {
          const teamGames = games.filter(g => 
            g.homeTeamId === teamId || g.awayTeamId === teamId
          );

          if (teamGames.length === 0) continue;

          let totalAdjustedPerformance = 0;

          for (const game of teamGames) {
            const isHome = game.homeTeamId === teamId;
            const teamScore = isHome ? game.homeScore : game.awayScore;
            const oppScore = isHome ? game.awayScore : game.homeScore;
            const oppId = isHome ? game.awayTeamId : game.homeTeamId;
            const oppRating = ratings[oppId];

            // Calculate performance adjusted for opponent strength
            const margin = teamScore - oppScore;
            const homeAdj = isHome ? 3.5 : -3.5;
            const adjustedMargin = margin - homeAdj;

            // Weight by opponent strength
            const performanceRating = this.leagueAverage + adjustedMargin * (oppRating / this.leagueAverage);
            
            totalAdjustedPerformance += performanceRating;
          }

          newRatings[teamId] = totalAdjustedPerformance / teamGames.length;
        }

        // Check for convergence
        let maxChange = 0;
        for (const teamId of teams) {
          const change = Math.abs(newRatings[teamId] - ratings[teamId]);
          maxChange = Math.max(maxChange, change);
        }

        // Update ratings
        Object.assign(ratings, newRatings);

        if (maxChange < this.convergenceThreshold) {
          logger.debug('Iterative rating calculation converged', {
            sport,
            season,
            iteration: iteration + 1,
            maxChange: maxChange.toFixed(4)
          });
          break;
        }
      }

      logger.info('Completed iterative rating calculation', {
        sport,
        season,
        teams: teams.size,
        games: games.length
      });

      return ratings;
    } catch (error) {
      logger.error('Failed iterative rating calculation', {
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get both raw and opponent-adjusted ratings for a team
   * 
   * @param {string} teamId - Team ID
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @returns {Promise<Object>} - Raw and adjusted ratings
   */
  async getOpponentAdjustedRatings(teamId, sport, season) {
    try {
      // Get team's games
      const games = await this.gameRepo.getTeamGameHistory(teamId, season, 1000);

      if (games.length === 0) {
        return null;
      }

      // Calculate iterative ratings for all teams
      const allRatings = await this.iterativeRatingCalculation(sport, season);

      // Calculate raw performance
      let totalPoints = 0;
      let totalAllowed = 0;
      let gamesPlayed = 0;

      for (const game of games) {
        const isHome = game.homeTeamId === teamId;
        totalPoints += isHome ? game.homeScore : game.awayScore;
        totalAllowed += isHome ? game.awayScore : game.homeScore;
        gamesPlayed++;
      }

      const rawOffensive = (totalPoints / gamesPlayed / 85) * 100;
      const rawDefensive = (totalAllowed / gamesPlayed / 85) * 100;

      // Calculate strength of schedule
      const opponentRatings = {};
      for (const [id, rating] of Object.entries(allRatings)) {
        opponentRatings[id] = { rating };
      }

      const sos = await this.calculateStrengthOfSchedule(teamId, sport, season, opponentRatings);

      // Adjusted rating is the iterative rating
      const adjustedRating = allRatings[teamId] || this.leagueAverage;

      return {
        raw: {
          offensiveRating: rawOffensive,
          defensiveRating: rawDefensive
        },
        adjusted: {
          offensiveRating: adjustedRating,
          defensiveRating: 200 - adjustedRating // Inverse for defense
        },
        strengthOfSchedule: sos,
        gamesPlayed: gamesPlayed
      };
    } catch (error) {
      logger.error('Failed to get opponent-adjusted ratings', {
        teamId,
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Compare two teams head-to-head accounting for schedule difficulty
   * 
   * @param {string} team1Id - First team ID
   * @param {string} team2Id - Second team ID
   * @param {string} sport - Sport key
   * @param {number} season - Season year
   * @returns {Promise<Object>} - Head-to-head comparison
   */
  async compareTeamsHeadToHead(team1Id, team2Id, sport, season) {
    try {
      const team1Ratings = await this.getOpponentAdjustedRatings(team1Id, sport, season);
      const team2Ratings = await this.getOpponentAdjustedRatings(team2Id, sport, season);

      if (!team1Ratings || !team2Ratings) {
        throw new Error('Insufficient data for comparison');
      }

      // Project margin using adjusted ratings
      const team1Strength = team1Ratings.adjusted.offensiveRating - team1Ratings.adjusted.defensiveRating;
      const team2Strength = team2Ratings.adjusted.offensiveRating - team2Ratings.adjusted.defensiveRating;
      
      const projectedMargin = team1Strength - team2Strength;

      logger.info('Compared teams head-to-head', {
        team1Id,
        team2Id,
        sport,
        season,
        projectedMargin: projectedMargin.toFixed(2)
      });

      return {
        team1Raw: team1Ratings.raw,
        team1Adjusted: team1Ratings.adjusted,
        team1SOS: team1Ratings.strengthOfSchedule,
        team2Raw: team2Ratings.raw,
        team2Adjusted: team2Ratings.adjusted,
        team2SOS: team2Ratings.strengthOfSchedule,
        projectedMargin: projectedMargin
      };
    } catch (error) {
      logger.error('Failed to compare teams head-to-head', {
        team1Id,
        team2Id,
        sport,
        season,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = OpponentAdjustedMetrics;
