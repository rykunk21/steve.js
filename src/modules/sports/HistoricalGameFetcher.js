const StatBroadcastClient = require('./StatBroadcastClient');
const XMLGameParser = require('./XMLGameParser');
const logger = require('../../utils/logger');

/**
 * Fetches historical game data from StatBroadcast
 * Orchestrates schedule fetching, game XML retrieval, and parsing
 */
class HistoricalGameFetcher {
  /**
   * @param {StatBroadcastClient} client - StatBroadcast client instance
   * @param {XMLGameParser} parser - XML parser instance
   * @param {Object} options - Configuration options
   * @param {number} options.minRequestInterval - Minimum time between requests (ms)
   * @param {number} options.maxRetries - Maximum retry attempts for failed requests
   * @param {number} options.retryDelay - Initial delay for exponential backoff (ms)
   */
  constructor(client = null, parser = null, options = {}) {
    this.client = client || new StatBroadcastClient();
    this.parser = parser || new XMLGameParser();
    this.lastRequestTime = 0;
    this.minRequestInterval = options.minRequestInterval || 1000; // 1 second between requests
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.gameCache = new Map(); // Cache for game IDs within a session
    this.scheduleCache = new Map(); // Cache for team schedules
  }

  /**
   * Rate limiting: wait if needed before making request
   * @private
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Retry a function with exponential backoff
   * @private
   * @param {Function} fn - Function to retry
   * @param {string} operation - Description of operation for logging
   * @returns {Promise<*>} - Result of function
   */
  async retryWithBackoff(fn, operation) {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Don't retry on certain errors (invalid GID, 404, etc.)
        if (this.isNonRetryableError(error)) {
          logger.debug('Non-retryable error encountered', {
            operation,
            error: error.message
          });
          throw error;
        }
        
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          logger.warn('Operation failed, retrying', {
            operation,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delay,
            error: error.message
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    logger.error('Operation failed after all retries', {
      operation,
      attempts: this.maxRetries + 1,
      error: lastError.message
    });
    
    throw lastError;
  }

  /**
   * Check if an error should not be retried
   * @private
   * @param {Error} error - Error to check
   * @returns {boolean} - True if error should not be retried
   */
  isNonRetryableError(error) {
    const message = error.message.toLowerCase();
    
    // Don't retry on 404, invalid GID, redirects, or parsing errors
    return (
      message.includes('404') ||
      message.includes('invalid resource') ||
      message.includes('redirect') ||
      message.includes('parsing') ||
      message.includes('invalid xml')
    );
  }

  /**
   * Fetch team schedule from StatBroadcast with retry logic
   * @param {string} teamGid - StatBroadcast team GID
   * @param {Object} options - Filter options
   * @param {string} options.startDate - Start date filter (YYYY-MM-DD)
   * @param {string} options.endDate - End date filter (YYYY-MM-DD)
   * @param {boolean} options.useCache - Use cached schedule if available
   * @returns {Promise<Array>} - Array of game objects
   */
  async fetchTeamSchedule(teamGid, options = {}) {
    const { useCache = true, ...filterOptions } = options;
    
    // Check cache first
    const cacheKey = `${teamGid}-${JSON.stringify(filterOptions)}`;
    if (useCache && this.scheduleCache.has(cacheKey)) {
      logger.debug('Using cached schedule', { teamGid });
      return this.scheduleCache.get(cacheKey);
    }

    try {
      await this.rateLimit();

      logger.info('Fetching team schedule', { teamGid, options: filterOptions });

      const schedule = await this.retryWithBackoff(
        () => this.client.getTeamSchedule(teamGid, filterOptions),
        `fetch schedule for ${teamGid}`
      );

      logger.info('Team schedule fetched', {
        teamGid,
        gameCount: schedule.length
      });

      // Cache the result
      this.scheduleCache.set(cacheKey, schedule);

      return schedule;

    } catch (error) {
      logger.error('Failed to fetch team schedule after retries', {
        teamGid,
        error: error.message,
        maxRetries: this.maxRetries
      });
      throw error;
    }
  }

  /**
   * Extract game IDs from schedule response
   * Handles multiple response formats from StatBroadcast
   * @param {Array|Object} schedule - Schedule array or object from StatBroadcast
   * @returns {Array<string>} - Array of game IDs
   */
  parseGameIds(schedule) {
    // Handle array format
    if (Array.isArray(schedule)) {
      const gameIds = schedule
        .filter(game => game && game.gameId)
        .map(game => String(game.gameId));

      logger.debug('Parsed game IDs from schedule array', {
        totalGames: schedule.length,
        validGameIds: gameIds.length
      });

      return gameIds;
    }

    // Handle object format (e.g., { games: [...] })
    if (schedule && typeof schedule === 'object') {
      // Try common property names
      const possibleArrays = [
        schedule.games,
        schedule.schedule,
        schedule.events,
        schedule.data
      ];

      for (const arr of possibleArrays) {
        if (Array.isArray(arr)) {
          logger.debug('Found games array in object format', {
            property: Object.keys(schedule).find(k => schedule[k] === arr)
          });
          return this.parseGameIds(arr);
        }
      }
    }

    logger.warn('Invalid schedule format, expected array or object with games', {
      type: typeof schedule,
      isArray: Array.isArray(schedule)
    });
    
    return [];
  }

  /**
   * Construct XML archive URL from game ID
   * @param {string|number} gameId - StatBroadcast game ID
   * @returns {string} - XML archive URL
   */
  constructXMLArchiveURL(gameId) {
    return `http://archive.statbroadcast.com/${gameId}.xml`;
  }

  /**
   * Fetch game XML from archive with retry logic
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<string>} - XML content
   */
  async fetchGameXML(gameId) {
    try {
      await this.rateLimit();

      logger.debug('Fetching game XML', { gameId });

      const xml = await this.retryWithBackoff(
        () => this.client.fetchGameXML(gameId),
        `fetch XML for game ${gameId}`
      );

      logger.debug('Game XML fetched', {
        gameId,
        size: xml.length
      });

      return xml;

    } catch (error) {
      logger.error('Failed to fetch game XML after retries', {
        gameId,
        error: error.message,
        maxRetries: this.maxRetries
      });
      throw error;
    }
  }

  /**
   * Fetch and parse a complete game
   * @param {string} gameId - StatBroadcast game ID
   * @returns {Promise<Object>} - Parsed game data
   */
  async fetchAndParseGame(gameId) {
    try {
      logger.debug('Fetching and parsing game', { gameId });

      // Fetch XML
      const xml = await this.fetchGameXML(gameId);

      // Parse XML
      const parsedGame = await this.parser.parseGameXML(xml);

      logger.debug('Game fetched and parsed successfully', {
        gameId,
        hasMetadata: !!parsedGame.metadata,
        hasTeams: !!parsedGame.teams,
        playCount: parsedGame.playByPlay?.length || 0
      });

      return parsedGame;

    } catch (error) {
      logger.error('Failed to fetch and parse game', {
        gameId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Fetch multiple games with rate limiting
   * @param {Array<string>} gameIds - Array of game IDs
   * @param {Object} options - Options
   * @param {boolean} options.continueOnError - Continue processing if a game fails
   * @param {Function} options.onProgress - Progress callback (current, total, gameId)
   * @returns {Promise<Array>} - Array of parsed games
   */
  async fetchMultipleGames(gameIds, options = {}) {
    const { continueOnError = false, onProgress = null } = options;
    const results = [];
    const errors = [];

    logger.info('Fetching multiple games', {
      totalGames: gameIds.length,
      continueOnError
    });

    for (let i = 0; i < gameIds.length; i++) {
      const gameId = gameIds[i];
      
      try {
        const game = await this.fetchAndParseGame(gameId);
        results.push(game);

        logger.debug('Game processed successfully', {
          gameId,
          progress: `${results.length}/${gameIds.length}`,
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

        logger.error('Failed to process game', {
          ...errorInfo,
          continueOnError
        });

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

    logger.info('Multiple games fetch complete', {
      requested: gameIds.length,
      successful: results.length,
      failed: errors.length,
      errorSummary: errors.length > 0 ? errors.map(e => e.gameId).join(', ') : 'none'
    });

    return results;
  }

  /**
   * Fetch all games for a team
   * @param {string} teamGid - StatBroadcast team GID
   * @param {Object} options - Options
   * @param {string} options.startDate - Start date filter
   * @param {string} options.endDate - End date filter
   * @param {boolean} options.continueOnError - Continue on individual game errors
   * @returns {Promise<Array>} - Array of parsed games
   */
  async fetchAllTeamGames(teamGid, options = {}) {
    try {
      logger.info('Fetching all games for team', { teamGid, options });

      // Fetch schedule
      const schedule = await this.fetchTeamSchedule(teamGid, {
        startDate: options.startDate,
        endDate: options.endDate
      });

      // Extract game IDs
      const gameIds = this.parseGameIds(schedule);

      if (gameIds.length === 0) {
        logger.warn('No games found for team', { teamGid });
        return [];
      }

      // Fetch and parse all games
      const games = await this.fetchMultipleGames(gameIds, {
        continueOnError: options.continueOnError !== false // Default to true
      });

      logger.info('All team games fetched', {
        teamGid,
        totalGames: games.length
      });

      return games;

    } catch (error) {
      logger.error('Failed to fetch all team games', {
        teamGid,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Clear all caches
   * @param {string} type - Cache type to clear ('game', 'schedule', or 'all')
   */
  clearCache(type = 'all') {
    if (type === 'game' || type === 'all') {
      this.gameCache.clear();
      logger.debug('Game cache cleared');
    }
    
    if (type === 'schedule' || type === 'all') {
      this.scheduleCache.clear();
      logger.debug('Schedule cache cleared');
    }
  }

  /**
   * Get cached game IDs for a team
   * @param {string} teamGid - Team GID
   * @returns {Array|null} - Cached game IDs or null
   */
  getCachedGameIds(teamGid) {
    return this.gameCache.get(teamGid) || null;
  }

  /**
   * Cache game IDs for a team
   * @param {string} teamGid - Team GID
   * @param {Array} gameIds - Game IDs to cache
   */
  cacheGameIds(teamGid, gameIds) {
    this.gameCache.set(teamGid, gameIds);
    logger.debug('Game IDs cached', {
      teamGid,
      count: gameIds.length
    });
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    return {
      gameCache: {
        size: this.gameCache.size,
        teams: Array.from(this.gameCache.keys())
      },
      scheduleCache: {
        size: this.scheduleCache.size
      }
    };
  }
}

module.exports = HistoricalGameFetcher;
