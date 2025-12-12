const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * Client for interacting with sports APIs to fetch game data
 * Supports NFL, NBA, NHL, and NCAA sports
 */
class SportsAPIClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.SPORTS_API_KEY;
    this.baseUrl = config.baseUrl || process.env.SPORTS_API_BASE_URL || 'https://api.the-odds-api.com/v4';
    this.timeout = config.timeout || 10000; // 10 seconds
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000; // 1 second
    
    // Cache for API responses
    this.cache = new Map();
    this.cacheTimeout = config.cacheTimeout || 300000; // 5 minutes
    
    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = config.minRequestInterval || 1000; // 1 second between requests
    
    // Supported sports mapping
    this.supportedSports = {
      'nfl': 'americanfootball_nfl',
      'nba': 'basketball_nba', 
      'nhl': 'icehockey_nhl',
      'ncaa_football': 'americanfootball_ncaaf',
      'ncaa_basketball': 'basketball_ncaab'
    };

    // Initialize cache hit/miss tracking
    this.cacheHits = 0;
    this.cacheMisses = 0;

    this.validateConfig();
  }

  /**
   * Validate API configuration
   */
  validateConfig() {
    if (!this.apiKey || this.apiKey === 'your_sports_api_key_here') {
      logger.warn('Sports API key not configured. Sports functionality will be limited.');
    }
    
    if (!this.baseUrl) {
      throw new Error('Sports API base URL is required');
    }
  }

  /**
   * Get upcoming games for a specific sport
   * @param {string} sport - Sport key (nfl, nba, nhl, ncaa_football, ncaa_basketball)
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Array of game objects
   */
  async getUpcomingGames(sport, options = {}) {
    try {
      const sportKey = this.supportedSports[sport.toLowerCase()];
      if (!sportKey) {
        throw new Error(`Unsupported sport: ${sport}. Supported sports: ${Object.keys(this.supportedSports).join(', ')}`);
      }

      const cacheKey = `upcoming_${sport}_${JSON.stringify(options)}`;
      const cachedData = this.getFromCache(cacheKey);
      if (cachedData) {
        logger.debug('Returning cached upcoming games data', { sport, cacheKey });
        return cachedData;
      }

      await this.enforceRateLimit();

      const params = {
        apiKey: this.apiKey,
        regions: options.regions || 'us',
        markets: options.markets || 'h2h', // head-to-head (moneyline)
        oddsFormat: options.oddsFormat || 'american',
        dateFormat: options.dateFormat || 'iso'
      };

      const url = `${this.baseUrl}/sports/${sportKey}/odds`;
      
      logger.info('Fetching upcoming games from sports API', {
        sport,
        sportKey,
        url: url.replace(this.apiKey, '[REDACTED]')
      });

      const response = await this.makeRequest(url, { params });
      const games = this.normalizeGameData(response.data, sport);
      
      // Cache the results
      this.setCache(cacheKey, games);
      
      logger.info('Successfully fetched upcoming games', {
        sport,
        gameCount: games.length
      });

      return games;
      
    } catch (error) {
      logger.error('Failed to fetch upcoming games', {
        sport,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get live game scores and status
   * @param {string} sport - Sport key
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Array of live game objects
   */
  async getLiveGames(sport, options = {}) {
    try {
      const sportKey = this.supportedSports[sport.toLowerCase()];
      if (!sportKey) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      const cacheKey = `live_${sport}_${JSON.stringify(options)}`;
      const cachedData = this.getFromCache(cacheKey);
      if (cachedData) {
        logger.debug('Returning cached live games data', { sport, cacheKey });
        return cachedData;
      }

      await this.enforceRateLimit();

      const params = {
        apiKey: this.apiKey,
        regions: options.regions || 'us',
        markets: options.markets || 'h2h',
        oddsFormat: options.oddsFormat || 'american',
        dateFormat: options.dateFormat || 'iso'
      };

      const url = `${this.baseUrl}/sports/${sportKey}/scores`;
      
      logger.info('Fetching live games from sports API', {
        sport,
        sportKey,
        url: url.replace(this.apiKey, '[REDACTED]')
      });

      const response = await this.makeRequest(url, { params });
      const games = this.normalizeGameData(response.data, sport);
      
      // Cache with shorter timeout for live data
      this.setCache(cacheKey, games, 30000); // 30 seconds for live data
      
      logger.info('Successfully fetched live games', {
        sport,
        gameCount: games.length
      });

      return games;
      
    } catch (error) {
      logger.error('Failed to fetch live games', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get available sports
   * @returns {Promise<Array>} - Array of available sports
   */
  async getAvailableSports() {
    try {
      const cacheKey = 'available_sports';
      const cachedData = this.getFromCache(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      await this.enforceRateLimit();

      const url = `${this.baseUrl}/sports`;
      const params = { apiKey: this.apiKey };

      logger.info('Fetching available sports from API');

      const response = await this.makeRequest(url, { params });
      
      // Filter to only supported sports
      const availableSports = response.data.filter(sport => 
        Object.values(this.supportedSports).includes(sport.key)
      );

      this.setCache(cacheKey, availableSports, 3600000); // Cache for 1 hour
      
      logger.info('Successfully fetched available sports', {
        totalSports: response.data.length,
        supportedSports: availableSports.length
      });

      return availableSports;
      
    } catch (error) {
      logger.error('Failed to fetch available sports', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Make HTTP request with retry logic
   * @param {string} url - Request URL
   * @param {Object} config - Axios config
   * @returns {Promise<Object>} - Response data
   */
  async makeRequest(url, config = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await axios({
          url,
          timeout: this.timeout,
          ...config
        });

        if (response.status === 200) {
          return response;
        }
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        
      } catch (error) {
        lastError = error;
        
        logger.warn('API request failed', {
          attempt,
          maxAttempts: this.retryAttempts,
          url: url.replace(this.apiKey || '', '[REDACTED]'),
          error: error.message
        });

        // Don't retry on authentication errors
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new Error('API authentication failed. Check your API key.');
        }

        // Don't retry on client errors (4xx)
        if (error.response?.status >= 400 && error.response?.status < 500) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Normalize game data from API response
   * @param {Array} rawGames - Raw game data from API
   * @param {string} sport - Sport type
   * @returns {Array} - Normalized game objects
   */
  normalizeGameData(rawGames, sport) {
    if (!Array.isArray(rawGames)) {
      logger.warn('Invalid game data format received', { rawGames });
      return [];
    }

    return rawGames.map(game => {
      try {
        return {
          id: game.id,
          sport: sport,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          commenceTime: new Date(game.commence_time),
          completed: game.completed || false,
          scores: game.scores || null,
          lastUpdate: game.last_update ? new Date(game.last_update) : null,
          bookmakers: game.bookmakers || [],
          // Additional normalized fields
          displayName: `${game.away_team} @ ${game.home_team}`,
          status: this.determineGameStatus(game),
          odds: this.extractOdds(game.bookmakers)
        };
      } catch (error) {
        logger.warn('Failed to normalize game data', {
          gameId: game.id,
          error: error.message
        });
        return null;
      }
    }).filter(game => game !== null);
  }

  /**
   * Determine game status from API data
   * @param {Object} game - Raw game object
   * @returns {string} - Game status
   */
  determineGameStatus(game) {
    if (game.completed) {
      return 'completed';
    }
    
    const now = new Date();
    const gameTime = new Date(game.commence_time);
    
    if (gameTime > now) {
      return 'scheduled';
    }
    
    // If game time has passed but not marked completed, assume in progress
    return 'in_progress';
  }

  /**
   * Extract odds from bookmakers data
   * @param {Array} bookmakers - Bookmakers array
   * @returns {Object} - Simplified odds object
   */
  extractOdds(bookmakers) {
    if (!Array.isArray(bookmakers) || bookmakers.length === 0) {
      return null;
    }

    // Use first bookmaker's odds as default
    const firstBookmaker = bookmakers[0];
    const h2hMarket = firstBookmaker.markets?.find(market => market.key === 'h2h');
    
    if (!h2hMarket || !h2hMarket.outcomes) {
      return null;
    }

    const odds = {};
    h2hMarket.outcomes.forEach(outcome => {
      odds[outcome.name] = outcome.price;
    });

    return {
      bookmaker: firstBookmaker.title,
      odds: odds,
      lastUpdate: firstBookmaker.last_update
    };
  }

  /**
   * Enforce rate limiting between requests
   */
  async enforceRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      logger.debug('Rate limiting: waiting before next request', { waitTime });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Get data from cache
   * @param {string} key - Cache key
   * @returns {*} - Cached data or null
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      this.cacheMisses++;
      return null;
    }

    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      this.cacheMisses++;
      return null;
    }

    this.cacheHits++;
    return cached.data;
  }

  /**
   * Set data in cache
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   * @param {number} timeout - Cache timeout in milliseconds
   */
  setCache(key, data, timeout = this.cacheTimeout) {
    this.cache.set(key, {
      data: data,
      expiry: Date.now() + timeout
    });
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this.cache.clear();
    logger.info('Sports API cache cleared');
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [key, cached] of this.cache.entries()) {
      if (now > cached.expiry) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      cacheHitRate: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0
    };
  }

  /**
   * Test API connectivity
   * @returns {Promise<boolean>} - Whether API is accessible
   */
  async testConnection() {
    try {
      await this.getAvailableSports();
      logger.info('Sports API connection test successful');
      return true;
    } catch (error) {
      logger.error('Sports API connection test failed', {
        error: error.message
      });
      return false;
    }
  }
}

module.exports = SportsAPIClient;