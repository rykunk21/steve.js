const HistoricalGameFetcher = require('./HistoricalGameFetcher');
const BasketballScheduleFetcher = require('./BasketballScheduleFetcher');
const TransitionProbabilityComputer = require('./TransitionProbabilityComputer');
const TeamRepository = require('../../database/repositories/TeamRepository');
const logger = require('../../utils/logger');

/**
 * Training Data Pipeline
 * Orchestrates fetching historical games and computing transition probabilities
 * for MLP model training
 */
class TrainingDataPipeline {
  /**
   * @param {HistoricalGameFetcher} fetcher - Historical game fetcher instance
   * @param {TransitionProbabilityComputer} computer - Transition probability computer instance
   * @param {TeamRepository} teamRepo - Team repository instance
   * @param {BasketballScheduleFetcher} basketballFetcher - Basketball schedule fetcher instance
   */
  constructor(fetcher = null, computer = null, teamRepo = null, basketballFetcher = null) {
    this.fetcher = fetcher || new HistoricalGameFetcher();
    this.computer = computer || new TransitionProbabilityComputer();
    this.teamRepo = teamRepo || new TeamRepository();
    this.basketballFetcher = basketballFetcher || new BasketballScheduleFetcher();
  }

  /**
   * Fetch game IDs from all teams in the database
   * @param {Object} options - Options
   * @param {string} options.sport - Sport to filter teams (default: 'mens-college-basketball')
   * @param {string} options.startDate - Start date filter (YYYY-MM-DD)
   * @param {string} options.endDate - End date filter (YYYY-MM-DD)
   * @param {boolean} options.continueOnError - Continue if a team fails (default: true)
   * @param {boolean} options.basketballOnly - Use Puppeteer to filter for basketball only (default: true)
   * @returns {Promise<Object>} - Map of teamGid -> gameIds array
   */
  async fetchAllTeamGames(options = {}) {
    const {
      sport = 'mens-college-basketball',
      startDate = null,
      endDate = null,
      continueOnError = true,
      basketballOnly = true
    } = options;

    try {
      logger.info('Fetching game IDs from all teams', { 
        sport, 
        startDate, 
        endDate,
        basketballOnly 
      });

      // Get all teams for the sport
      const teams = await this.teamRepo.getTeamsBySport(sport);

      logger.info('Teams loaded', { count: teams.length });

      const allGameIds = {};
      const errors = [];

      // Fetch schedule for each team
      for (const team of teams) {
        try {
          logger.debug('Fetching schedule for team', {
            teamGid: team.statbroadcastGid,
            teamName: team.teamName
          });

          let gameIds = [];

          if (basketballOnly) {
            // Use Puppeteer to fetch basketball-only schedule
            const schedule = await this.basketballFetcher.getBasketballSchedule(
              team.statbroadcastGid,
              { startDate, endDate }
            );
            
            // Extract game IDs from schedule
            gameIds = schedule.map(game => game.gameId);
          } else {
            // Use regular fetcher (all sports)
            const schedule = await this.fetcher.fetchTeamSchedule(
              team.statbroadcastGid,
              { startDate, endDate }
            );

            // Parse game IDs from schedule
            gameIds = this.fetcher.parseGameIds(schedule);
          }

          allGameIds[team.statbroadcastGid] = gameIds;

          logger.info('Team schedule fetched', {
            teamGid: team.statbroadcastGid,
            teamName: team.teamName,
            gameCount: gameIds.length
          });

        } catch (error) {
          const errorInfo = {
            teamGid: team.statbroadcastGid,
            teamName: team.teamName,
            error: error.message
          };

          errors.push(errorInfo);

          logger.error('Failed to fetch team schedule', errorInfo);

          if (!continueOnError) {
            throw error;
          }
          // Continue to next team if continueOnError is true
        }
      }

      logger.info('All team schedules fetched', {
        teamsProcessed: Object.keys(allGameIds).length,
        totalTeams: teams.length,
        errors: errors.length
      });

      // Close Puppeteer browser if it was used
      if (basketballOnly) {
        await this.basketballFetcher.closeBrowser();
      }

      return allGameIds;

    } catch (error) {
      logger.error('Failed to fetch all team games', {
        error: error.message,
        stack: error.stack
      });
      
      // Ensure browser is closed on error
      if (options.basketballOnly !== false) {
        try {
          await this.basketballFetcher.closeBrowser();
        } catch (closeError) {
          // Ignore close errors
        }
      }
      
      throw error;
    }
  }

  /**
   * Process a single game: fetch XML, parse, and compute transition probabilities
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<Object>} - Game data with transition probabilities
   */
  async processGame(gameId) {
    try {
      logger.debug('Processing game', { gameId });

      // Fetch and parse game XML
      const gameData = await this.fetcher.fetchAndParseGame(gameId);

      // Compute transition probabilities from play-by-play
      const transitionProbabilities = this.computer.computeTransitionProbabilities(gameData);

      logger.debug('Game processed successfully', {
        gameId,
        visitor: gameData.teams?.visitor?.name,
        home: gameData.teams?.home?.name
      });

      return {
        gameId: gameData.metadata.gameId,
        gameData,
        transitionProbabilities
      };

    } catch (error) {
      logger.error('Failed to process game', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Build training dataset from a list of game IDs
   * @param {Array<string>} gameIds - Array of game IDs to process
   * @param {Object} options - Options
   * @param {boolean} options.continueOnError - Continue if a game fails (default: true)
   * @param {Function} options.onProgress - Progress callback (current, total, gameId, error)
   * @returns {Promise<Array>} - Array of processed games with transition probabilities
   */
  async buildTrainingDataset(gameIds, options = {}) {
    const {
      continueOnError = true,
      onProgress = null
    } = options;

    try {
      logger.info('Building training dataset', {
        totalGames: gameIds.length,
        continueOnError
      });

      const dataset = [];
      const errors = [];

      for (let i = 0; i < gameIds.length; i++) {
        const gameId = gameIds[i];

        try {
          // Process game
          const processedGame = await this.processGame(gameId);
          dataset.push(processedGame);

          logger.debug('Game added to dataset', {
            gameId,
            progress: `${dataset.length}/${gameIds.length}`,
            index: i + 1
          });

          // Call progress callback if provided
          if (onProgress) {
            onProgress(i + 1, gameIds.length, gameId, null);
          }

        } catch (error) {
          const errorInfo = {
            gameId,
            error: error.message,
            index: i + 1
          };

          errors.push(errorInfo);

          logger.error('Failed to process game for dataset', errorInfo);

          // Call progress callback with error
          if (onProgress) {
            onProgress(i + 1, gameIds.length, gameId, error);
          }

          if (!continueOnError) {
            throw error;
          }
          // Continue to next game if continueOnError is true
        }
      }

      logger.info('Training dataset built', {
        requested: gameIds.length,
        successful: dataset.length,
        failed: errors.length
      });

      return dataset;

    } catch (error) {
      logger.error('Failed to build training dataset', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get statistics about the pipeline
   * @returns {Object} - Pipeline statistics
   */
  getStats() {
    return {
      cacheStats: this.fetcher.getCacheStats()
    };
  }

  /**
   * Clear all caches
   */
  clearCache() {
    this.fetcher.clearCache();
    logger.debug('Pipeline caches cleared');
  }
}

module.exports = TrainingDataPipeline;
