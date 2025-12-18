const logger = require('../../utils/logger');

/**
 * Team Representation Manager for InfoNCE VAE-NN Architecture
 * 
 * Manages team representation retrieval with the new architecture:
 * - Loads posterior distributions from database as primary source
 * - Falls back to frozen encoder for new teams
 * - Validates posteriors remain in InfoNCE space
 * - Provides unified interface for team representation access
 */
class TeamRepresentationManager {
  constructor(teamRepository, frozenEncoder, options = {}) {
    this.teamRepo = teamRepository;
    this.frozenEncoder = frozenEncoder; // FrozenVAEEncoder instance
    
    // Configuration
    this.latentDim = options.latentDim || 16;
    this.defaultUncertainty = options.defaultUncertainty || 1.0;
    this.validateInfoNCEStructure = options.validateInfoNCEStructure !== false;
    this.enableFallback = options.enableFallback !== false;
    
    // Caching for performance
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 300000; // 5 minutes
    
    logger.info('Initialized TeamRepresentationManager', {
      latentDim: this.latentDim,
      defaultUncertainty: this.defaultUncertainty,
      validateInfoNCEStructure: this.validateInfoNCEStructure,
      enableFallback: this.enableFallback,
      cacheTimeout: this.cacheTimeout
    });
  }

  /**
   * Get team representation (posterior distribution or fallback encoding)
   * 
   * @param {string} teamId - Team ID
   * @param {Array} gameFeatures - Game features for fallback encoding (optional)
   * @returns {Promise<Object>} - Team representation {mu, sigma, source, games_processed}
   */
  async getTeamRepresentation(teamId, gameFeatures = null) {
    try {
      // Check cache first
      const cacheKey = `team_${teamId}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        logger.debug('Retrieved team representation from cache', { teamId });
        return cached.representation;
      }

      // Try to load posterior distribution from database
      const posterior = await this.teamRepo.getTeamEncodingFromDb(teamId);
      
      if (posterior && this.isValidPosterior(posterior)) {
        const representation = {
          mu: posterior.mu,
          sigma: posterior.sigma,
          source: 'posterior',
          games_processed: posterior.games_processed || 0,
          last_updated: posterior.last_updated,
          model_version: posterior.model_version
        };
        
        // Cache the result
        this.cache.set(cacheKey, {
          representation,
          timestamp: Date.now()
        });
        
        logger.debug('Retrieved team representation from database', {
          teamId,
          gamesProcessed: representation.games_processed,
          source: 'posterior'
        });
        
        return representation;
      }

      // Fallback to frozen encoder if enabled and game features provided
      if (this.enableFallback && gameFeatures && this.frozenEncoder) {
        logger.info('Using frozen encoder fallback for team representation', { teamId });
        
        const encoding = await this.frozenEncoder.encode(gameFeatures);
        const representation = {
          mu: encoding.mu,
          sigma: encoding.sigma || new Array(this.latentDim).fill(this.defaultUncertainty),
          source: 'frozen_encoder',
          games_processed: 0,
          last_updated: new Date().toISOString(),
          model_version: 'fallback'
        };
        
        // Don't cache fallback representations as they should be replaced with posteriors
        return representation;
      }

      // No representation available
      if (posterior) {
        logger.warn('Invalid posterior distribution found', {
          teamId,
          posteriorStructure: Object.keys(posterior)
        });
      }
      
      throw new Error(`No valid team representation found for ${teamId}`);

    } catch (error) {
      logger.error('Failed to get team representation', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get team representations for both teams in a game
   * 
   * @param {string} homeTeamId - Home team ID
   * @param {string} awayTeamId - Away team ID
   * @param {Object} gameFeatures - Game features for fallback (optional)
   * @returns {Promise<Object>} - {home: representation, away: representation}
   */
  async getGameTeamRepresentations(homeTeamId, awayTeamId, gameFeatures = null) {
    try {
      const [homeRep, awayRep] = await Promise.all([
        this.getTeamRepresentation(homeTeamId, gameFeatures?.home),
        this.getTeamRepresentation(awayTeamId, gameFeatures?.away)
      ]);

      logger.debug('Retrieved game team representations', {
        homeTeamId,
        awayTeamId,
        homeSource: homeRep.source,
        awaySource: awayRep.source,
        homeGames: homeRep.games_processed,
        awayGames: awayRep.games_processed
      });

      return {
        home: homeRep,
        away: awayRep
      };

    } catch (error) {
      logger.error('Failed to get game team representations', {
        homeTeamId,
        awayTeamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Initialize team representation for new team
   * 
   * @param {string} teamId - Team ID
   * @param {Array} initialFeatures - Initial game features for encoding (optional)
   * @returns {Promise<Object>} - Initial team representation
   */
  async initializeTeamRepresentation(teamId, initialFeatures = null) {
    try {
      let initialRepresentation;

      if (initialFeatures && this.frozenEncoder) {
        // Use frozen encoder to create initial representation
        const encoding = await this.frozenEncoder.encode(initialFeatures);
        initialRepresentation = {
          mu: encoding.mu,
          sigma: encoding.sigma || new Array(this.latentDim).fill(this.defaultUncertainty),
          games_processed: 0,
          last_season: this.getCurrentSeason(),
          model_version: 'v1.0'
        };
      } else {
        // Use default initialization
        initialRepresentation = {
          mu: new Array(this.latentDim).fill(0.0),
          sigma: new Array(this.latentDim).fill(this.defaultUncertainty),
          games_processed: 0,
          last_season: this.getCurrentSeason(),
          model_version: 'v1.0'
        };
      }

      // Save to database
      await this.teamRepo.saveTeamEncodingToDb(teamId, initialRepresentation);

      // Clear cache for this team
      this.cache.delete(`team_${teamId}`);

      logger.info('Initialized team representation', {
        teamId,
        source: initialFeatures ? 'frozen_encoder' : 'default',
        latentDim: this.latentDim
      });

      return {
        ...initialRepresentation,
        source: 'initialized'
      };

    } catch (error) {
      logger.error('Failed to initialize team representation', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate that posterior distribution is valid
   * 
   * @param {Object} posterior - Posterior distribution to validate
   * @returns {boolean} - True if valid
   */
  isValidPosterior(posterior) {
    if (!posterior || typeof posterior !== 'object') {
      return false;
    }

    // Check required fields
    if (!Array.isArray(posterior.mu) || !Array.isArray(posterior.sigma)) {
      return false;
    }

    // Check dimensions
    if (posterior.mu.length !== this.latentDim || posterior.sigma.length !== this.latentDim) {
      return false;
    }

    // Check for valid values
    for (let i = 0; i < this.latentDim; i++) {
      if (!isFinite(posterior.mu[i]) || !isFinite(posterior.sigma[i])) {
        return false;
      }
      
      if (posterior.sigma[i] <= 0) {
        return false;
      }
    }

    // InfoNCE structure validation
    if (this.validateInfoNCEStructure) {
      return this.validateInfoNCEStructureInternal(posterior);
    }

    return true;
  }

  /**
   * Validate InfoNCE structure preservation
   * 
   * @param {Object} posterior - Posterior distribution
   * @returns {boolean} - True if structure is preserved
   */
  validateInfoNCEStructureInternal(posterior) {
    // Check for reasonable value ranges (InfoNCE latents should be bounded)
    const maxAbsValue = 5.0; // Reasonable bound for InfoNCE latents
    const maxUncertainty = 3.0; // Reasonable bound for uncertainty

    for (let i = 0; i < posterior.mu.length; i++) {
      if (Math.abs(posterior.mu[i]) > maxAbsValue) {
        logger.warn('Posterior mu value outside InfoNCE bounds', {
          dimension: i,
          value: posterior.mu[i],
          maxBound: maxAbsValue
        });
        return false;
      }

      if (posterior.sigma[i] > maxUncertainty) {
        logger.warn('Posterior sigma value too high', {
          dimension: i,
          value: posterior.sigma[i],
          maxBound: maxUncertainty
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Update team representation cache after posterior update
   * 
   * @param {string} teamId - Team ID
   * @param {Object} updatedPosterior - Updated posterior distribution
   */
  updateCache(teamId, updatedPosterior) {
    const cacheKey = `team_${teamId}`;
    const representation = {
      mu: updatedPosterior.mu,
      sigma: updatedPosterior.sigma,
      source: 'posterior',
      games_processed: updatedPosterior.games_processed || 0,
      last_updated: updatedPosterior.last_updated,
      model_version: updatedPosterior.model_version
    };

    this.cache.set(cacheKey, {
      representation,
      timestamp: Date.now()
    });

    logger.debug('Updated team representation cache', {
      teamId,
      gamesProcessed: representation.games_processed
    });
  }

  /**
   * Clear cache for specific team or all teams
   * 
   * @param {string} teamId - Team ID (optional, clears all if not provided)
   */
  clearCache(teamId = null) {
    if (teamId) {
      this.cache.delete(`team_${teamId}`);
      logger.debug('Cleared cache for team', { teamId });
    } else {
      this.cache.clear();
      logger.debug('Cleared all team representation cache');
    }
  }

  /**
   * Get cache statistics
   * 
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp < this.cacheTimeout) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      cacheTimeout: this.cacheTimeout
    };
  }

  /**
   * Clean expired cache entries
   */
  cleanExpiredCache() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.cacheTimeout) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned expired cache entries', { cleanedCount });
    }
  }

  /**
   * Get current season string
   * 
   * @returns {string} - Current season (e.g., "2023-24")
   */
  getCurrentSeason() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // JavaScript months are 0-indexed

    // Basketball season spans two calendar years
    if (month >= 11) {
      return `${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `${year - 1}-${year.toString().slice(-2)}`;
    }
  }

  /**
   * Get configuration
   * 
   * @returns {Object} - Configuration object
   */
  getConfiguration() {
    return {
      latentDim: this.latentDim,
      defaultUncertainty: this.defaultUncertainty,
      validateInfoNCEStructure: this.validateInfoNCEStructure,
      enableFallback: this.enableFallback,
      cacheTimeout: this.cacheTimeout,
      cacheStats: this.getCacheStats()
    };
  }

  /**
   * Update configuration
   * 
   * @param {Object} config - New configuration parameters
   */
  updateConfiguration(config) {
    if (config.defaultUncertainty !== undefined) {
      this.defaultUncertainty = config.defaultUncertainty;
    }
    if (config.validateInfoNCEStructure !== undefined) {
      this.validateInfoNCEStructure = config.validateInfoNCEStructure;
    }
    if (config.enableFallback !== undefined) {
      this.enableFallback = config.enableFallback;
    }
    if (config.cacheTimeout !== undefined) {
      this.cacheTimeout = config.cacheTimeout;
      // Clear cache if timeout changed
      this.clearCache();
    }

    logger.info('Updated TeamRepresentationManager configuration', config);
  }
}

module.exports = TeamRepresentationManager;