const HistoricalGameFetcher = require('./HistoricalGameFetcher');
const TeamRepository = require('../../database/repositories/TeamRepository');
const OnlineLearningOrchestrator = require('./OnlineLearningOrchestrator');
const dbConnection = require('../../database/connection');
const logger = require('../../utils/logger');

/**
 * Incremental Game Discovery Service
 * 
 * Continuously discovers and processes new games:
 * 1. Check for new games not in game_ids table
 * 2. Fetch new game IDs from StatBroadcast archive for all teams
 * 3. Add new games to game_ids table with processed=false
 * 4. Enable daily/scheduled execution for continuous updates
 * 5. Process new games through VAE-NN system as they become available
 * 6. Log update statistics (new games found, teams updated, model improvements)
 */
class IncrementalGameDiscovery {
  constructor(options = {}) {
    this.teamRepository = new TeamRepository();
    this.historicalGameFetcher = new HistoricalGameFetcher();
    this.onlineLearningOrchestrator = new OnlineLearningOrchestrator();
    
    // Discovery parameters
    this.maxGamesPerRun = options.maxGamesPerRun || 50; // Limit games per discovery run
    this.rateLimitDelay = options.rateLimitDelay || 1000; // 1 second between requests
    this.maxRetries = options.maxRetries || 3;
    this.discoveryTimeout = options.discoveryTimeout || 300000; // 5 minutes timeout
    
    // Processing parameters
    this.autoProcessNewGames = options.autoProcessNewGames !== false; // Default true
    this.maxProcessingGames = options.maxProcessingGames || 10; // Max games to process per run
    
    // Statistics tracking
    this.discoveryStats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalNewGames: 0,
      totalProcessedGames: 0,
      averageDiscoveryTime: 0,
      totalDiscoveryTime: 0,
      lastRunTime: null,
      errors: []
    };

    // State management
    this.isRunning = false;
    this.shouldStop = false;
    this.currentRun = null;

    logger.info('Initialized IncrementalGameDiscovery', {
      maxGamesPerRun: this.maxGamesPerRun,
      rateLimitDelay: this.rateLimitDelay,
      autoProcessNewGames: this.autoProcessNewGames,
      maxProcessingGames: this.maxProcessingGames
    });
  }

  /**
   * Run incremental game discovery process
   * @param {Object} options - Discovery options
   * @returns {Promise<Object>} - Discovery results
   */
  async runDiscovery(options = {}) {
    if (this.isRunning) {
      throw new Error('Discovery is already running');
    }

    const startTime = Date.now();
    this.isRunning = true;
    this.shouldStop = false;
    
    const runId = `discovery_${Date.now()}`;
    this.currentRun = runId;

    try {
      logger.info('Starting incremental game discovery', {
        runId,
        maxGamesPerRun: this.maxGamesPerRun,
        autoProcessNewGames: this.autoProcessNewGames
      });

      // Step 1: Get all teams from database
      const teams = await this.getActiveTeams();
      
      if (teams.length === 0) {
        logger.warn('No active teams found for game discovery');
        return this.getRunResults(startTime, { newGames: 0, processedGames: 0 });
      }

      // Step 2: Discover new games for all teams
      const discoveryResult = await this.discoverNewGamesForTeams(teams, options);
      
      if (this.shouldStop) {
        logger.info('Discovery stopped by user request');
        return this.getRunResults(startTime, discoveryResult);
      }

      // Step 3: Process new games if auto-processing is enabled
      let processingResult = { processedGames: 0, processingErrors: [] };
      
      if (this.autoProcessNewGames && discoveryResult.newGames > 0) {
        processingResult = await this.processNewGames(options);
      }

      // Step 4: Update statistics
      const runTime = Date.now() - startTime;
      this.updateDiscoveryStats(discoveryResult, processingResult, runTime, true);

      const results = this.getRunResults(startTime, {
        ...discoveryResult,
        ...processingResult
      });

      logger.info('Incremental game discovery completed', {
        runId,
        runTime,
        newGames: discoveryResult.newGames,
        processedGames: processingResult.processedGames,
        teamsUpdated: discoveryResult.teamsUpdated
      });

      return results;

    } catch (error) {
      const runTime = Date.now() - startTime;
      this.updateDiscoveryStats({}, {}, runTime, false);
      
      this.discoveryStats.errors.push({
        runId,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      logger.error('Incremental game discovery failed', {
        runId,
        error: error.message,
        runTime
      });

      throw error;

    } finally {
      this.isRunning = false;
      this.currentRun = null;
    }
  }

  /**
   * Discover new games for all teams
   * @param {Array} teams - Array of team objects
   * @param {Object} options - Discovery options
   * @returns {Promise<Object>} - Discovery results
   */
  async discoverNewGamesForTeams(teams, options = {}) {
    const {
      startDate = null,
      endDate = null,
      onTeamProgress = null
    } = options;

    let totalNewGames = 0;
    let teamsUpdated = 0;
    const teamResults = [];
    const errors = [];

    logger.info('Discovering games for teams', {
      teamCount: teams.length,
      startDate,
      endDate
    });

    for (let i = 0; i < teams.length && !this.shouldStop; i++) {
      const team = teams[i];
      
      try {
        logger.debug('Discovering games for team', {
          teamId: team.team_id,
          teamName: team.team_name,
          statbroadcastGid: team.statbroadcast_gid,
          progress: `${i + 1}/${teams.length}`
        });

        // Get existing game IDs for this team
        const existingGameIds = await this.getExistingGameIdsForTeam(team.team_id);
        
        // Fetch game schedule from StatBroadcast
        const schedule = await this.historicalGameFetcher.fetchTeamSchedule(
          team.statbroadcast_gid,
          { startDate, endDate }
        );
        
        // Extract game IDs from schedule
        const fetchedGameIds = schedule.map(game => game.gameId).filter(id => id);

        // Find new games (not in database)
        const newGameIds = fetchedGameIds.filter(gameId => !existingGameIds.includes(gameId));
        
        if (newGameIds.length > 0) {
          // Add new games to database
          const addedGames = await this.addNewGamesToDatabase(newGameIds, team);
          totalNewGames += addedGames;
          teamsUpdated++;
          
          logger.info('Added new games for team', {
            teamId: team.team_id,
            teamName: team.team_name,
            newGames: addedGames,
            totalFetched: fetchedGameIds.length
          });
        }

        teamResults.push({
          teamId: team.team_id,
          teamName: team.team_name,
          existingGames: existingGameIds.length,
          fetchedGames: fetchedGameIds.length,
          newGames: newGameIds.length
        });

        // Progress callback
        if (onTeamProgress) {
          await onTeamProgress(i + 1, teams.length, {
            teamId: team.team_id,
            newGames: newGameIds.length
          });
        }

        // Rate limiting
        if (i < teams.length - 1) {
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
        }

      } catch (error) {
        errors.push({
          teamId: team.team_id,
          teamName: team.team_name,
          error: error.message
        });

        logger.error('Failed to discover games for team', {
          teamId: team.team_id,
          teamName: team.team_name,
          error: error.message
        });

        // Continue with other teams
      }
    }

    return {
      newGames: totalNewGames,
      teamsUpdated,
      teamResults,
      errors
    };
  }

  /**
   * Process newly discovered games through VAE-NN system
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing results
   */
  async processNewGames(options = {}) {
    try {
      logger.info('Processing newly discovered games');

      // Get unprocessed games (limit to maxProcessingGames)
      const unprocessedGames = await this.getUnprocessedGames(this.maxProcessingGames);
      
      if (unprocessedGames.length === 0) {
        logger.info('No unprocessed games found');
        return { processedGames: 0, processingErrors: [] };
      }

      logger.info('Found unprocessed games for processing', {
        count: unprocessedGames.length,
        maxProcessing: this.maxProcessingGames
      });

      // Process games through online learning orchestrator
      const processingResult = await this.onlineLearningOrchestrator.startOnlineLearning({
        maxGames: unprocessedGames.length,
        onProgress: (current, total, result) => {
          logger.debug('Processing game progress', {
            current,
            total,
            gameId: result.gameId
          });
        },
        onError: (error, gameInfo, index) => {
          logger.warn('Game processing error', {
            gameId: gameInfo.game_id,
            index,
            error: error.message
          });
        }
      });

      return {
        processedGames: processingResult.summary.successfulGames,
        processingErrors: processingResult.errors || []
      };

    } catch (error) {
      logger.error('Failed to process new games', {
        error: error.message
      });
      
      return {
        processedGames: 0,
        processingErrors: [{ error: error.message }]
      };
    }
  }

  /**
   * Get active teams from database
   * @returns {Promise<Array>} - Array of team objects
   */
  async getActiveTeams() {
    try {
      const teams = await this.teamRepository.findAll();
      
      // Filter teams that have StatBroadcast GIDs
      const activeTeams = teams.filter(team => 
        team.statbroadcast_gid && 
        team.sport === 'mens-college-basketball'
      );

      logger.debug('Retrieved active teams', {
        totalTeams: teams.length,
        activeTeams: activeTeams.length
      });

      return activeTeams;

    } catch (error) {
      logger.error('Failed to get active teams', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get existing game IDs for a team from database
   * @param {string} teamId - Team ID
   * @returns {Promise<Array>} - Array of existing game IDs
   */
  async getExistingGameIdsForTeam(teamId) {
    try {
      const sql = `
        SELECT DISTINCT game_id 
        FROM game_ids 
        WHERE (home_team_id = ? OR away_team_id = ?) 
        AND sport = 'mens-college-basketball'
      `;
      
      const rows = await dbConnection.all(sql, [teamId, teamId]);
      return rows.map(row => row.game_id);

    } catch (error) {
      logger.error('Failed to get existing game IDs for team', {
        teamId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Add new games to database
   * @param {Array} gameIds - Array of new game IDs
   * @param {Object} team - Team object
   * @returns {Promise<number>} - Number of games added
   */
  async addNewGamesToDatabase(gameIds, team) {
    let addedCount = 0;

    for (const gameId of gameIds) {
      try {
        // For now, we'll add games with minimal information
        // The actual team assignments will be determined when processing
        await dbConnection.run(`
          INSERT OR IGNORE INTO game_ids (
            game_id, 
            sport, 
            home_team_id, 
            away_team_id, 
            game_date, 
            processed, 
            created_at, 
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          gameId,
          'mens-college-basketball',
          null, // Will be determined during processing
          null, // Will be determined during processing
          this.extractDateFromGameId(gameId), // Attempt to extract date
          0, // Not processed
          new Date().toISOString(),
          new Date().toISOString()
        ]);

        addedCount++;

      } catch (error) {
        logger.warn('Failed to add game to database', {
          gameId,
          teamId: team.team_id,
          error: error.message
        });
      }
    }

    return addedCount;
  }

  /**
   * Extract date from game ID (if possible)
   * @param {string} gameId - Game ID
   * @returns {string} - Date string or current date
   */
  extractDateFromGameId(gameId) {
    // StatBroadcast game IDs sometimes contain date information
    // This is a best-effort extraction
    try {
      // Look for date patterns in game ID
      const dateMatch = gameId.match(/(\d{4})(\d{2})(\d{2})/);
      if (dateMatch) {
        const [, year, month, day] = dateMatch;
        return `${year}-${month}-${day}`;
      }
    } catch (error) {
      // Ignore extraction errors
    }

    // Default to current date
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get unprocessed games from database
   * @param {number} limit - Maximum number of games to retrieve
   * @returns {Promise<Array>} - Array of unprocessed games
   */
  async getUnprocessedGames(limit) {
    try {
      const sql = `
        SELECT game_id, game_date, home_team_id, away_team_id 
        FROM game_ids 
        WHERE processed = 0 AND sport = 'mens-college-basketball'
        ORDER BY game_date ASC, game_id ASC
        LIMIT ?
      `;
      
      const rows = await dbConnection.all(sql, [limit]);
      
      logger.debug('Retrieved unprocessed games', {
        count: rows.length,
        limit
      });

      return rows;

    } catch (error) {
      logger.error('Failed to get unprocessed games', {
        error: error.message,
        limit
      });
      return [];
    }
  }

  /**
   * Update discovery statistics
   * @param {Object} discoveryResult - Discovery result
   * @param {Object} processingResult - Processing result
   * @param {number} runTime - Run time in milliseconds
   * @param {boolean} success - Whether run was successful
   */
  updateDiscoveryStats(discoveryResult, processingResult, runTime, success) {
    this.discoveryStats.totalRuns++;
    
    if (success) {
      this.discoveryStats.successfulRuns++;
    } else {
      this.discoveryStats.failedRuns++;
    }
    
    this.discoveryStats.totalNewGames += discoveryResult.newGames || 0;
    this.discoveryStats.totalProcessedGames += processingResult.processedGames || 0;
    this.discoveryStats.totalDiscoveryTime += runTime;
    this.discoveryStats.averageDiscoveryTime = this.discoveryStats.totalDiscoveryTime / this.discoveryStats.totalRuns;
    this.discoveryStats.lastRunTime = new Date().toISOString();
  }

  /**
   * Get run results summary
   * @param {number} startTime - Start time
   * @param {Object} results - Results data
   * @returns {Object} - Run results
   */
  getRunResults(startTime, results) {
    const runTime = Date.now() - startTime;
    
    return {
      runId: this.currentRun,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
      runTime,
      results: {
        newGames: results.newGames || 0,
        processedGames: results.processedGames || 0,
        teamsUpdated: results.teamsUpdated || 0,
        teamResults: results.teamResults || [],
        errors: results.errors || [],
        processingErrors: results.processingErrors || []
      },
      statistics: this.getDiscoveryStats()
    };
  }

  /**
   * Schedule periodic discovery runs
   * @param {number} intervalMs - Interval in milliseconds
   * @param {Object} options - Discovery options
   * @returns {Object} - Scheduler object with stop method
   */
  schedulePeriodicDiscovery(intervalMs, options = {}) {
    logger.info('Scheduling periodic game discovery', {
      intervalMs,
      intervalHours: (intervalMs / (1000 * 60 * 60)).toFixed(1)
    });

    const intervalId = setInterval(async () => {
      try {
        if (!this.isRunning) {
          logger.info('Running scheduled game discovery');
          await this.runDiscovery(options);
        } else {
          logger.warn('Skipping scheduled discovery - already running');
        }
      } catch (error) {
        logger.error('Scheduled discovery failed', {
          error: error.message
        });
      }
    }, intervalMs);

    return {
      stop: () => {
        clearInterval(intervalId);
        logger.info('Stopped periodic game discovery');
      }
    };
  }

  /**
   * Stop current discovery run
   */
  stop() {
    logger.info('Stopping incremental game discovery');
    this.shouldStop = true;
  }

  /**
   * Check if discovery is currently running
   * @returns {boolean} - Whether discovery is running
   */
  isDiscoveryRunning() {
    return this.isRunning;
  }

  /**
   * Get discovery statistics
   * @returns {Object} - Discovery statistics
   */
  getDiscoveryStats() {
    return {
      ...this.discoveryStats,
      successRate: this.discoveryStats.totalRuns > 0 
        ? (this.discoveryStats.successfulRuns / this.discoveryStats.totalRuns) * 100 
        : 0
    };
  }

  /**
   * Reset discovery statistics
   */
  resetStats() {
    this.discoveryStats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalNewGames: 0,
      totalProcessedGames: 0,
      averageDiscoveryTime: 0,
      totalDiscoveryTime: 0,
      lastRunTime: null,
      errors: []
    };
    
    logger.debug('Discovery statistics reset');
  }

  /**
   * Close resources
   * @returns {Promise<void>}
   */
  async close() {
    try {
      this.stop();
      await this.onlineLearningOrchestrator.close();
      logger.info('IncrementalGameDiscovery resources closed');
    } catch (error) {
      logger.error('Error closing IncrementalGameDiscovery resources', {
        error: error.message
      });
    }
  }
}

module.exports = IncrementalGameDiscovery;