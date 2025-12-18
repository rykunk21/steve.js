const BaseRepository = require('./BaseRepository');
const logger = require('../../utils/logger');

/**
 * Repository for team data management
 * Stores team information, StatBroadcast GIDs, and statistical representations
 * Enhanced with caching and posterior distribution validation
 */
class TeamRepository extends BaseRepository {
  constructor() {
    super('teams');
    // In-memory cache for frequently accessed posteriors
    this.posteriorCache = new Map();
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Save or update a team
   * @param {Object} team - Team data
   * @returns {Promise<Object>} - Database result
   */
  async saveTeam(team) {
    try {
      // Check if team exists by ESPN ID or StatBroadcast GID
      let existing = await this.getTeamByEspnId(team.teamId);
      
      if (!existing) {
        // Also check by StatBroadcast GID in case ESPN ID changed
        existing = await this.getTeamByStatBroadcastGid(team.statbroadcastGid);
      }

      const data = {
        team_id: team.teamId,
        statbroadcast_gid: team.statbroadcastGid,
        team_name: team.teamName,
        sport: team.sport || 'mens-college-basketball',
        conference: team.conference || null,
        statistical_representation: team.statisticalRepresentation 
          ? JSON.stringify(team.statisticalRepresentation) 
          : null,
        player_roster: team.playerRoster 
          ? JSON.stringify(team.playerRoster) 
          : null,
        updated_at: new Date().toISOString()
      };

      if (existing) {
        // Update existing team (use team_id as primary key)
        return await this.update(team.teamId, data, 'team_id');
      } else {
        // Create new team
        return await this.create(data);
      }
    } catch (error) {
      logger.error('Failed to save team', {
        teamId: team.teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get team by ESPN ID
   * @param {string} espnId - ESPN team ID
   * @returns {Promise<Object|null>} - Team object or null
   */
  async getTeamByEspnId(espnId) {
    try {
      const row = await this.findById(espnId, 'team_id');
      
      if (!row) return null;

      return this.mapRowToObject(row);
    } catch (error) {
      logger.error('Failed to get team by ESPN ID', {
        espnId,
        error: error.message
      });
      throw error;
    }
  }
  /**
   * Get team by StatBroadcast GID
   * @param {string} gid - StatBroadcast GID
   * @returns {Promise<Object|null>} - Team object or null
   */
  async getTeamByStatBroadcastGid(gid) {
    try {
      const row = await this.findOneBy({ statbroadcast_gid: gid });
      
      if (!row) return null;

      return this.mapRowToObject(row);
    } catch (error) {
      logger.error('Failed to get team by StatBroadcast GID', {
        gid,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update statistical representation for a team
   * @param {string} teamId - Team ID
   * @param {Object} representation - Statistical representation object
   * @returns {Promise<Object>} - Database result
   */
  async updateStatisticalRepresentation(teamId, representation) {
    try {
      return await this.update(
        teamId,
        { 
          statistical_representation: JSON.stringify(representation),
          updated_at: new Date().toISOString()
        },
        'team_id'
      );
    } catch (error) {
      logger.error('Failed to update statistical representation', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Map database row to object with camelCase properties
   * @param {Object} row - Database row
   * @returns {Object} - Mapped object
   */
  mapRowToObject(row) {
    return {
      teamId: row.team_id,
      statbroadcastGid: row.statbroadcast_gid,
      teamName: row.team_name,
      sport: row.sport,
      conference: row.conference,
      statisticalRepresentation: row.statistical_representation,
      playerRoster: row.player_roster,
      lastSynced: row.last_synced,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get team posterior latent distribution from database with caching
   * @param {string} teamId - Team ID
   * @returns {Promise<Object|null>} - Posterior distribution {mu, sigma, games_processed, last_season, last_updated, model_version} or null
   */
  async getTeamEncodingFromDb(teamId) {
    try {
      // Check cache first
      const cached = this.getCachedPosterior(teamId);
      if (cached) {
        return cached;
      }

      const team = await this.getTeamByEspnId(teamId);
      
      if (!team || !team.statisticalRepresentation) {
        return null;
      }

      const representation = JSON.parse(team.statisticalRepresentation);
      
      // Validate posterior format
      const posterior = this.validateAndExtractPosterior(representation);
      
      if (posterior) {
        // Cache the result
        this.cachePosterior(teamId, posterior);
        return posterior;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get team encoding from database', {
        teamId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Save team posterior latent distribution to database
   * @param {string} teamId - Team ID
   * @param {Object} posterior - Posterior distribution {mu, sigma, games_processed, last_season, model_version}
   * @returns {Promise<Object>} - Database result
   */
  async saveTeamEncodingToDb(teamId, posterior) {
    try {
      // Validate input
      if (!posterior.mu || !posterior.sigma || !Array.isArray(posterior.mu) || !Array.isArray(posterior.sigma)) {
        throw new Error('Invalid posterior format: mu and sigma must be arrays');
      }

      if (posterior.mu.length !== posterior.sigma.length) {
        throw new Error('Posterior mu and sigma must have same dimensions');
      }

      // Ensure team exists first
      let team = await this.getTeamByEspnId(teamId);
      
      if (!team) {
        // Create minimal team record if it doesn't exist
        await this.saveTeam({
          teamId: teamId,
          statbroadcastGid: teamId, // Use teamId as fallback
          teamName: `Team ${teamId}`,
          sport: 'mens-college-basketball'
        });
      }

      // Create posterior representation with versioning and timestamps
      const posteriorData = {
        mu: posterior.mu,
        sigma: posterior.sigma,
        games_processed: posterior.games_processed || 0,
        last_season: posterior.last_season || null,
        last_updated: new Date().toISOString(),
        model_version: posterior.model_version || 'v1.0',
        type: 'bayesian_posterior'
      };

      // Save the posterior distribution
      const result = await this.updateStatisticalRepresentation(teamId, posteriorData);
      
      // Invalidate cache for this team
      this.clearPosteriorCache(teamId);
      
      return result;
    } catch (error) {
      logger.error('Failed to save team encoding to database', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get team latent distribution (VAE encoding) - Legacy method for backward compatibility
   * @param {string} teamId - Team ID
   * @returns {Promise<Object|null>} - Team distribution {mu, sigma} or null
   */
  async getTeamDistribution(teamId) {
    const posterior = await this.getTeamEncodingFromDb(teamId);
    if (posterior) {
      return {
        mu: posterior.mu,
        sigma: posterior.sigma
      };
    }
    return null;
  }

  /**
   * Save team latent distribution (VAE encoding) - Legacy method for backward compatibility
   * @param {string} teamId - Team ID
   * @param {Object} distribution - Distribution {mu, sigma}
   * @returns {Promise<Object>} - Database result
   */
  async saveTeamDistribution(teamId, distribution) {
    return await this.saveTeamEncodingToDb(teamId, {
      mu: distribution.mu,
      sigma: distribution.sigma,
      games_processed: 0,
      last_season: null,
      model_version: 'v1.0'
    });
  }

  /**
   * Update posterior after game processing
   * @param {string} teamId - Team ID
   * @param {Object} updatedPosterior - Updated posterior {mu, sigma}
   * @param {string} season - Current season (e.g., "2023-24")
   * @returns {Promise<Object>} - Database result
   */
  async updatePosteriorAfterGame(teamId, updatedPosterior, season) {
    try {
      const currentPosterior = await this.getTeamEncodingFromDb(teamId);
      
      if (!currentPosterior) {
        throw new Error(`No existing posterior found for team ${teamId}`);
      }

      const newPosterior = {
        mu: updatedPosterior.mu,
        sigma: updatedPosterior.sigma,
        games_processed: (currentPosterior.games_processed || 0) + 1,
        last_season: season,
        model_version: currentPosterior.model_version || 'v1.0'
      };

      return await this.saveTeamEncodingToDb(teamId, newPosterior);
    } catch (error) {
      logger.error('Failed to update posterior after game', {
        teamId,
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all teams with posterior distributions for a given season
   * @param {string} season - Season identifier (e.g., "2023-24")
   * @returns {Promise<Array>} - Array of teams with posteriors
   */
  async getTeamsWithPosteriors(season = null) {
    try {
      const query = `
        SELECT team_id, team_name, statistical_representation, updated_at
        FROM teams 
        WHERE statistical_representation IS NOT NULL
        ${season ? "AND json_extract(statistical_representation, '$.last_season') = ?" : ""}
        ORDER BY updated_at DESC
      `;
      
      const params = season ? [season] : [];
      const rows = await this.db.all(query, params);
      
      return rows.map(row => {
        const representation = JSON.parse(row.statistical_representation);
        return {
          teamId: row.team_id,
          teamName: row.team_name,
          posterior: {
            mu: representation.mu,
            sigma: representation.sigma,
            games_processed: representation.games_processed || 0,
            last_season: representation.last_season,
            last_updated: representation.last_updated,
            model_version: representation.model_version || 'v1.0'
          },
          updatedAt: row.updated_at
        };
      });
    } catch (error) {
      logger.error('Failed to get teams with posteriors', {
        season,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if team has valid posterior distribution
   * @param {string} teamId - Team ID
   * @returns {Promise<boolean>} - True if team has valid posterior
   */
  async hasValidPosterior(teamId) {
    try {
      const posterior = await this.getTeamEncodingFromDb(teamId);
      return posterior !== null && 
             Array.isArray(posterior.mu) && 
             Array.isArray(posterior.sigma) &&
             posterior.mu.length === posterior.sigma.length &&
             posterior.mu.length > 0;
    } catch (error) {
      logger.error('Failed to check valid posterior', {
        teamId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Validate and extract posterior distribution from representation
   * @param {Object} representation - Statistical representation object
   * @returns {Object|null} - Valid posterior or null
   */
  validateAndExtractPosterior(representation) {
    try {
      // Check if it's in the new posterior format
      if (representation.type === 'bayesian_posterior') {
        if (this.isValidPosteriorFormat(representation)) {
          return {
            mu: representation.mu,
            sigma: representation.sigma,
            games_processed: representation.games_processed || 0,
            last_season: representation.last_season || null,
            last_updated: representation.last_updated || null,
            model_version: representation.model_version || 'v1.0',
            type: representation.type
          };
        }
      }
      
      // Check if it's in legacy format (mu, sigma arrays)
      if (representation.mu && representation.sigma && 
          Array.isArray(representation.mu) && Array.isArray(representation.sigma)) {
        
        if (representation.mu.length === representation.sigma.length && representation.mu.length > 0) {
          // Convert legacy format to new format
          return {
            mu: representation.mu,
            sigma: representation.sigma,
            games_processed: representation.games_processed || 0,
            last_season: representation.last_season || null,
            last_updated: representation.last_updated || new Date().toISOString(),
            model_version: representation.model_version || 'v1.0',
            type: 'bayesian_posterior'
          };
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to validate posterior format', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Validate posterior distribution format
   * @param {Object} posterior - Posterior distribution
   * @returns {boolean} - True if valid
   */
  isValidPosteriorFormat(posterior) {
    try {
      // Check required fields
      if (!posterior.mu || !posterior.sigma || !posterior.type || !posterior.model_version) {
        return false;
      }

      // Check arrays
      if (!Array.isArray(posterior.mu) || !Array.isArray(posterior.sigma)) {
        return false;
      }

      // Check dimensions match
      if (posterior.mu.length !== posterior.sigma.length) {
        return false;
      }

      // Check dimensions are reasonable (should be 16 for InfoNCE)
      if (posterior.mu.length === 0 || posterior.mu.length > 100) {
        return false;
      }

      // Check values are numeric
      const allNumeric = posterior.mu.every(val => typeof val === 'number' && !isNaN(val)) &&
                        posterior.sigma.every(val => typeof val === 'number' && !isNaN(val) && val >= 0);

      if (!allNumeric) {
        return false;
      }

      // Check type is correct
      if (posterior.type !== 'bayesian_posterior') {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get cached posterior distribution
   * @param {string} teamId - Team ID
   * @returns {Object|null} - Cached posterior or null
   */
  getCachedPosterior(teamId) {
    const cached = this.posteriorCache.get(teamId);
    
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.cacheTimeout) {
      this.posteriorCache.delete(teamId);
      return null;
    }

    return cached.data;
  }

  /**
   * Cache posterior distribution
   * @param {string} teamId - Team ID
   * @param {Object} posterior - Posterior distribution
   */
  cachePosterior(teamId, posterior) {
    this.posteriorCache.set(teamId, {
      data: posterior,
      timestamp: Date.now()
    });

    // Limit cache size to prevent memory issues
    if (this.posteriorCache.size > 1000) {
      // Remove oldest entries
      const entries = Array.from(this.posteriorCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest 100 entries
      for (let i = 0; i < 100; i++) {
        this.posteriorCache.delete(entries[i][0]);
      }
    }
  }

  /**
   * Clear posterior cache
   * @param {string} teamId - Team ID (optional, clears all if not provided)
   */
  clearPosteriorCache(teamId = null) {
    if (teamId) {
      this.posteriorCache.delete(teamId);
    } else {
      this.posteriorCache.clear();
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    return {
      size: this.posteriorCache.size,
      timeout: this.cacheTimeout,
      entries: Array.from(this.posteriorCache.keys())
    };
  }

  /**
   * Batch load multiple team posteriors with caching
   * @param {Array<string>} teamIds - Array of team IDs
   * @returns {Promise<Map<string, Object>>} - Map of teamId to posterior
   */
  async batchLoadPosteriors(teamIds) {
    try {
      const results = new Map();
      const uncachedIds = [];

      // Check cache for each team
      for (const teamId of teamIds) {
        const cached = this.getCachedPosterior(teamId);
        if (cached) {
          results.set(teamId, cached);
        } else {
          uncachedIds.push(teamId);
        }
      }

      // Load uncached teams from database
      if (uncachedIds.length > 0) {
        const query = `
          SELECT team_id, statistical_representation
          FROM teams 
          WHERE team_id IN (${uncachedIds.map(() => '?').join(',')})
          AND statistical_representation IS NOT NULL
        `;
        
        const rows = await this.db.all(query, uncachedIds);
        
        for (const row of rows) {
          try {
            const representation = JSON.parse(row.statistical_representation);
            const posterior = this.validateAndExtractPosterior(representation);
            
            if (posterior) {
              this.cachePosterior(row.team_id, posterior);
              results.set(row.team_id, posterior);
            }
          } catch (error) {
            logger.error('Failed to parse team representation in batch load', {
              teamId: row.team_id,
              error: error.message
            });
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to batch load posteriors', {
        teamIds,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update player roster for a team
   * @param {string} teamId - Team ID
   * @param {Array} roster - Player roster array
   * @returns {Promise<Object>} - Database result
   */
  async updatePlayerRoster(teamId, roster) {
    try {
      return await this.update(
        teamId,
        { 
          player_roster: JSON.stringify(roster),
          updated_at: new Date().toISOString()
        },
        'team_id'
      );
    } catch (error) {
      logger.error('Failed to update player roster', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get teams by sport
   * @param {string} sport - Sport name
   * @returns {Promise<Array>} - Array of teams
   */
  async getTeamsBySport(sport) {
    try {
      const rows = await this.findBy({ sport });
      return rows.map(row => this.mapRowToObject(row));
    } catch (error) {
      logger.error('Failed to get teams by sport', {
        sport,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update last synced timestamp for a team
   * @param {string} teamId - Team ID
   * @returns {Promise<Object>} - Database result
   */
  async updateLastSynced(teamId) {
    try {
      return await this.update(
        teamId,
        { 
          last_synced: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        'team_id'
      );
    } catch (error) {
      logger.error('Failed to update last synced', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = TeamRepository;