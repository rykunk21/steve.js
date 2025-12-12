const logger = require('../../utils/logger');

/**
 * Service for reconciling and backfilling missed games
 * Compares ESPN games to processed games and fetches missing data from StatBroadcast
 */
class GameReconciliationService {
  constructor(
    historicalGameRepository,
    reconciliationLogRepository,
    teamRepository,
    gameIdDiscoveryService,
    statBroadcastClient,
    xmlGameParser,
    espnAPIClient,
    modelUpdateOrchestrator = null
  ) {
    this.historicalGameRepo = historicalGameRepository;
    this.reconciliationLogRepo = reconciliationLogRepository;
    this.teamRepo = teamRepository;
    this.gameIdDiscoveryService = gameIdDiscoveryService;
    this.statBroadcastClient = statBroadcastClient;
    this.xmlGameParser = xmlGameParser;
    this.espnAPIClient = espnAPIClient;
    this.modelUpdateOrchestrator = modelUpdateOrchestrator;
    
    // Rate limiting for batch operations
    this.batchDelayMs = 1000; // 1 second between games
    
    // Model update configuration
    this.modelUpdateConfig = {
      enabled: true,
      batchSize: 10, // Update model after every N games
      accumulateGradients: true
    };

    // Accumulated updates for batch processing
    this.accumulatedUpdates = [];
  }

  /**
   * Reconcile games for a specific date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {string} triggeredBy - Who/what triggered this reconciliation
   * @returns {Promise<Object>} - Reconciliation results
   */
  async reconcileGames(startDate, endDate, triggeredBy = 'manual') {
    let reconciliationId = null;

    try {
      // Start reconciliation log
      const logResult = await this.reconciliationLogRepo.startReconciliation({
        dateRangeStart: startDate.toISOString().split('T')[0],
        dateRangeEnd: endDate.toISOString().split('T')[0],
        triggeredBy
      });

      reconciliationId = logResult.id;

      logger.info('Starting game reconciliation', {
        reconciliationId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        triggeredBy
      });

      // Fetch ESPN games for date range
      const espnGames = await this.espnAPIClient.getGamesByDateRange(startDate, endDate);

      // Fetch processed games from historical DB
      const processedGames = await this.historicalGameRepo.getGamesByDateRange(startDate, endDate);

      // Identify missing games
      const missingGames = this.identifyMissingGames(espnGames, processedGames);

      logger.info('Identified missing games', {
        reconciliationId,
        totalEspnGames: espnGames.length,
        processedGames: processedGames.length,
        missingGames: missingGames.length
      });

      // Backfill missing games
      const backfillResult = await this.backfillBatch(missingGames);

      // Complete reconciliation log
      await this.reconciliationLogRepo.completeReconciliation(reconciliationId, {
        gamesFound: espnGames.length,
        gamesProcessed: backfillResult.processed,
        gamesFailed: backfillResult.failed,
        dataSources: 'ESPN,StatBroadcast'
      });

      const result = {
        reconciliationId,
        gamesFound: espnGames.length,
        missingGames: missingGames.length,
        processed: backfillResult.processed,
        failed: backfillResult.failed,
        details: backfillResult.details
      };

      logger.info('Completed game reconciliation', result);

      return result;

    } catch (error) {
      logger.error('Reconciliation failed', {
        reconciliationId,
        error: error.message,
        stack: error.stack
      });

      if (reconciliationId) {
        await this.reconciliationLogRepo.failReconciliation(
          reconciliationId,
          error.message
        );
      }

      throw error;
    }
  }

  /**
   * Reconcile games from the last N days
   * @param {number} days - Number of days to look back
   * @param {string} triggeredBy - Who/what triggered this reconciliation
   * @returns {Promise<Object>} - Reconciliation results
   */
  async reconcileRecentGames(days = 7, triggeredBy = 'startup') {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    logger.info('Reconciling recent games', {
      days,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      triggeredBy
    });

    return await this.reconcileGames(startDate, endDate, triggeredBy);
  }

  /**
   * Identify games that are in ESPN but not in historical database
   * @param {Array} espnGames - Games from ESPN API
   * @param {Array} processedGames - Games already in historical DB
   * @returns {Array} - Missing games
   */
  identifyMissingGames(espnGames, processedGames) {
    const processedIds = new Set(processedGames.map(game => game.id));
    
    const missing = espnGames.filter(game => !processedIds.has(game.id));

    logger.debug('Identified missing games', {
      espnTotal: espnGames.length,
      processedTotal: processedGames.length,
      missing: missing.length
    });

    return missing;
  }

  /**
   * Backfill a single game
   * @param {Object} espnGame - ESPN game object
   * @param {string} xmlData - Optional pre-fetched XML data
   * @returns {Promise<Object>} - Backfill result
   */
  async backfillGame(espnGame, xmlData = null) {
    try {
      logger.info('Backfilling game', {
        espnGameId: espnGame.id,
        homeTeam: espnGame.homeTeam?.name,
        awayTeam: espnGame.awayTeam?.name,
        date: espnGame.date
      });

      // Step 1: Discover StatBroadcast game ID
      const discovery = await this._discoverStatBroadcastId(espnGame);
      if (!discovery.success) {
        return discovery;
      }

      const statbroadcastGameId = discovery.statbroadcastGameId;

      // Step 2: Fetch and parse XML data
      const parsedGame = await this._fetchAndParseXML(
        espnGame.id, 
        statbroadcastGameId,
        xmlData
      );
      if (!parsedGame.success) {
        return parsedGame;
      }

      // Step 3: Save to historical database
      const saveResult = await this._saveGameToDatabase(
        espnGame, 
        statbroadcastGameId, 
        parsedGame.data
      );

      if (!saveResult.success) {
        return saveResult;
      }

      // Step 4: Trigger model update if enabled
      if (this.modelUpdateConfig.enabled && this.modelUpdateOrchestrator) {
        await this._triggerModelUpdate(
          espnGame,
          parsedGame.xmlData,
          parsedGame.data
        );
      }

      logger.info('Successfully backfilled game', {
        espnGameId: espnGame.id,
        statbroadcastGameId,
        homeScore: parsedGame.data.teams.home?.score,
        awayScore: parsedGame.data.teams.visitor?.score
      });

      return {
        success: true,
        espnGameId: espnGame.id,
        statbroadcastGameId,
        confidence: discovery.confidence
      };

    } catch (error) {
      logger.error('Unexpected error backfilling game', {
        espnGameId: espnGame.id,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        espnGameId: espnGame.id,
        reason: `Unexpected error: ${error.message}`
      };
    }
  }

  /**
   * Discover StatBroadcast game ID for an ESPN game
   * @private
   * @param {Object} espnGame - ESPN game object
   * @returns {Promise<Object>} - Discovery result
   */
  async _discoverStatBroadcastId(espnGame) {
    const discovery = await this.gameIdDiscoveryService.discoverGameId(espnGame);

    if (!discovery || !discovery.statbroadcastGameId) {
      logger.warn('StatBroadcast ID not found for game', {
        espnGameId: espnGame.id
      });

      return {
        success: false,
        espnGameId: espnGame.id,
        reason: 'StatBroadcast ID not found'
      };
    }

    return {
      success: true,
      statbroadcastGameId: discovery.statbroadcastGameId,
      confidence: discovery.confidence
    };
  }

  /**
   * Fetch and parse XML data from StatBroadcast
   * @private
   * @param {string} espnGameId - ESPN game ID
   * @param {string} statbroadcastGameId - StatBroadcast game ID
   * @param {string} preloadedXmlData - Optional pre-fetched XML data
   * @returns {Promise<Object>} - Parse result
   */
  async _fetchAndParseXML(espnGameId, statbroadcastGameId, preloadedXmlData = null) {
    // Fetch XML if not provided
    let xmlData = preloadedXmlData;
    
    if (!xmlData) {
      try {
        xmlData = await this.statBroadcastClient.fetchGameXML(statbroadcastGameId);
      } catch (error) {
        logger.error('Failed to fetch XML for game', {
          espnGameId,
          statbroadcastGameId,
          error: error.message
        });

        return {
          success: false,
          espnGameId,
          statbroadcastGameId,
          reason: `Failed to fetch XML: ${error.message}`
        };
      }
    }

    // Parse XML
    try {
      const parsedGame = await this.xmlGameParser.parseGameXML(xmlData);
      return {
        success: true,
        data: parsedGame,
        xmlData: xmlData // Include XML for model updates
      };
    } catch (error) {
      logger.error('Failed to parse XML for game', {
        espnGameId,
        statbroadcastGameId,
        error: error.message
      });

      return {
        success: false,
        espnGameId,
        statbroadcastGameId,
        reason: `Failed to parse XML: ${error.message}`
      };
    }
  }

  /**
   * Save game data to historical database
   * @private
   * @param {Object} espnGame - ESPN game object
   * @param {string} statbroadcastGameId - StatBroadcast game ID
   * @param {Object} parsedGame - Parsed game data
   * @returns {Promise<Object>} - Save result
   */
  async _saveGameToDatabase(espnGame, statbroadcastGameId, parsedGame) {
    const gameData = {
      game_id: espnGame.id,
      espn_game_id: espnGame.id,
      statbroadcast_game_id: statbroadcastGameId,
      sport: 'mens-college-basketball',
      season: new Date(espnGame.date).getFullYear(),
      game_date: espnGame.date,
      home_team: espnGame.homeTeam?.id || parsedGame.metadata.homeId,
      away_team: espnGame.awayTeam?.id || parsedGame.metadata.visitorId,
      home_score: parsedGame.teams.home?.score || 0,
      away_score: parsedGame.teams.visitor?.score || 0,
      is_neutral_site: parsedGame.metadata.neutralGame === 'Y',
      data_source: 'statbroadcast',
      has_play_by_play: true,
      processed_at: new Date().toISOString(),
      backfilled: true,
      backfill_date: new Date().toISOString(),
      raw_data: JSON.stringify(parsedGame)
    };

    try {
      await this.historicalGameRepo.saveGame(gameData);
      return { success: true };
    } catch (error) {
      // Check if it's a duplicate error
      if (this._isDuplicateError(error)) {
        logger.info('Game already exists in database, skipping', {
          espnGameId: espnGame.id
        });

        return {
          success: false,
          espnGameId: espnGame.id,
          statbroadcastGameId,
          reason: 'Duplicate game (already in database)'
        };
      }

      throw error;
    }
  }

  /**
   * Check if error is a duplicate constraint error
   * @private
   * @param {Error} error - Error object
   * @returns {boolean} - True if duplicate error
   */
  _isDuplicateError(error) {
    return error.message.includes('UNIQUE constraint') || 
           error.message.includes('already exists');
  }

  /**
   * Backfill multiple games with rate limiting
   * @param {Array} games - Array of ESPN game objects
   * @returns {Promise<Object>} - Batch backfill results
   */
  async backfillBatch(games) {
    const results = {
      processed: 0,
      failed: 0,
      details: []
    };

    for (let i = 0; i < games.length; i++) {
      const game = games[i];

      // Backfill the game
      const result = await this.backfillGame(game);

      if (result.success) {
        results.processed++;
      } else {
        results.failed++;
      }

      results.details.push(result);

      // Rate limiting: wait between games (except for last game)
      if (i < games.length - 1) {
        await this.delay(this.batchDelayMs);
      }
    }

    logger.info('Batch backfill completed', {
      total: games.length,
      processed: results.processed,
      failed: results.failed
    });

    return results;
  }

  /**
   * Trigger model update for a backfilled game
   * @private
   * @param {Object} espnGame - ESPN game object
   * @param {string} xmlData - XML data
   * @param {Object} parsedGame - Parsed game data
   */
  async _triggerModelUpdate(espnGame, xmlData, parsedGame) {
    try {
      const gameMetadata = {
        gameId: espnGame.id,
        homeTeamId: espnGame.homeTeam?.id || parsedGame.metadata.homeId,
        awayTeamId: espnGame.awayTeam?.id || parsedGame.metadata.visitorId,
        gameDate: espnGame.date,
        isNeutralSite: parsedGame.metadata.neutralGame === 'Y',
        sport: 'mens-college-basketball',
        season: new Date(espnGame.date).getFullYear()
      };

      if (this.modelUpdateConfig.accumulateGradients) {
        // Accumulate for batch processing
        this.accumulatedUpdates.push({
          gameId: espnGame.id,
          xmlData,
          metadata: gameMetadata
        });

        logger.debug('Accumulated game for batch model update', {
          gameId: espnGame.id,
          accumulatedCount: this.accumulatedUpdates.length
        });

        // Process batch if we've reached batch size
        if (this.accumulatedUpdates.length >= this.modelUpdateConfig.batchSize) {
          await this._processBatchModelUpdates();
        }
      } else {
        // Immediate update
        await this.modelUpdateOrchestrator.updateFromCompletedGame(
          espnGame.id,
          xmlData,
          gameMetadata
        );

        logger.info('Triggered immediate model update', {
          gameId: espnGame.id
        });
      }
    } catch (error) {
      logger.error('Failed to trigger model update', {
        gameId: espnGame.id,
        error: error.message
      });
      // Don't fail the backfill if model update fails
    }
  }

  /**
   * Process accumulated model updates in batch
   * @private
   */
  async _processBatchModelUpdates() {
    if (this.accumulatedUpdates.length === 0) {
      return;
    }

    logger.info('Processing batch model updates', {
      batchSize: this.accumulatedUpdates.length
    });

    try {
      const result = await this.modelUpdateOrchestrator.batchUpdateFromGames(
        this.accumulatedUpdates
      );

      logger.info('Batch model updates completed', {
        total: result.total,
        successful: result.successful,
        failed: result.failed
      });

      // Clear accumulated updates
      this.accumulatedUpdates = [];

    } catch (error) {
      logger.error('Batch model update failed', {
        error: error.message,
        batchSize: this.accumulatedUpdates.length
      });

      // Clear accumulated updates even on failure
      this.accumulatedUpdates = [];
    }
  }

  /**
   * Flush any remaining accumulated updates
   */
  async flushModelUpdates() {
    if (this.accumulatedUpdates.length > 0) {
      logger.info('Flushing remaining model updates', {
        count: this.accumulatedUpdates.length
      });

      await this._processBatchModelUpdates();
    }
  }

  /**
   * Configure model updates
   * @param {Object} config - Model update configuration
   */
  configureModelUpdates(config) {
    this.modelUpdateConfig = { ...this.modelUpdateConfig, ...config };
    logger.info('Updated model update configuration', this.modelUpdateConfig);
  }

  /**
   * Delay helper for rate limiting
   * @private
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = GameReconciliationService;
