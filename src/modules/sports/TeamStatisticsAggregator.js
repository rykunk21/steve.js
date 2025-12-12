const axios = require('axios');
const logger = require('../../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Aggregates and caches team performance statistics from ESPN
 * Used for MCMC simulation and betting recommendations
 */
class TeamStatisticsAggregator {
  constructor(config = {}) {
    this.cacheDir = config.cacheDir || path.join(process.cwd(), 'data', 'team-stats-cache');
    this.cacheTimeout = config.cacheTimeout || 86400000; // 24 hours
    this.baseUrl = 'https://sports.core.api.espn.com/v2/sports';
    this.timeout = config.timeout || 15000;
    
    this.initializeCache();
  }

  /**
   * Initialize cache directory
   */
  async initializeCache() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      logger.debug('Team statistics cache directory initialized', { cacheDir: this.cacheDir });
    } catch (error) {
      logger.error('Failed to initialize team stats cache directory', { error: error.message });
    }
  }

  /**
   * Get team statistics for a specific team
   * @param {string} sport - Sport key (nfl, nba, nhl, ncaa_basketball, ncaa_football)
   * @param {string} teamId - ESPN team ID
   * @param {string} season - Season year (e.g., "2025")
   * @returns {Promise<Object|null>} - Team statistics or null
   */
  async getTeamStatistics(sport, teamId, season = null) {
    try {
      // Use current year if season not provided
      if (!season) {
        season = new Date().getFullYear().toString();
      }

      // Check cache first
      const cached = await this.getCachedStats(sport, teamId, season);
      if (cached) {
        return cached;
      }

      // Fetch from ESPN API
      const stats = await this.fetchTeamStatistics(sport, teamId, season);
      
      if (stats) {
        // Cache the results
        await this.cacheStats(sport, teamId, season, stats);
      }

      return stats;

    } catch (error) {
      logger.error('Failed to get team statistics', {
        sport,
        teamId,
        season,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Fetch team statistics from ESPN API
   * @param {string} sport - Sport key
   * @param {string} teamId - ESPN team ID
   * @param {string} season - Season year
   * @returns {Promise<Object|null>} - Team statistics
   */
  async fetchTeamStatistics(sport, teamId, season) {
    try {
      const sportConfig = this.getSportConfig(sport);
      if (!sportConfig) {
        throw new Error(`Unsupported sport: ${sport}`);
      }

      // Construct team statistics URL
      const statsUrl = `${this.baseUrl}/${sportConfig.id}/leagues/${sportConfig.league}/seasons/${season}/teams/${teamId}/statistics`;

      logger.debug('Fetching team statistics from ESPN', {
        sport,
        teamId,
        season,
        statsUrl
      });

      const response = await axios({
        url: statsUrl,
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.data || !response.data.splits) {
        logger.warn('No statistics data available from ESPN', { sport, teamId, season });
        return null;
      }

      // Parse and normalize statistics
      const stats = this.parseESPNStatistics(response.data, sport);

      logger.info('Successfully fetched team statistics', {
        sport,
        teamId,
        season,
        hasStats: !!stats
      });

      return stats;

    } catch (error) {
      logger.warn('Failed to fetch team statistics from ESPN', {
        sport,
        teamId,
        season,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Parse ESPN statistics response into normalized format
   * @param {Object} espnData - Raw ESPN statistics data
   * @param {string} sport - Sport key
   * @returns {Object} - Normalized statistics
   */
  parseESPNStatistics(espnData, sport) {
    const stats = {
      offensiveEfficiency: null,
      defensiveEfficiency: null,
      pace: null,
      effectiveFieldGoalPct: null,
      turnoverRate: null,
      offensiveReboundRate: null,
      freeThrowRate: null,
      recentForm: [],
      homeAdvantage: 3.5, // Default home advantage
      lastUpdated: new Date()
    };

    try {
      // ESPN provides statistics in splits (categories)
      const splits = espnData.splits?.categories || [];

      // Extract relevant statistics based on sport
      if (sport === 'ncaa_basketball' || sport === 'nba') {
        stats.offensiveEfficiency = this.findStat(splits, 'offensiveEfficiency', 'pointsPerGame') || 100;
        stats.defensiveEfficiency = this.findStat(splits, 'defensiveEfficiency', 'oppPointsPerGame') || 100;
        stats.pace = this.findStat(splits, 'pace', 'possessions') || 70;
        stats.effectiveFieldGoalPct = this.findStat(splits, 'effectiveFieldGoalPct', 'fieldGoalPct') || 0.45;
        stats.turnoverRate = this.findStat(splits, 'turnoverRate', 'turnovers') || 0.15;
        stats.offensiveReboundRate = this.findStat(splits, 'offensiveReboundRate', 'offensiveRebounds') || 0.30;
        stats.freeThrowRate = this.findStat(splits, 'freeThrowRate', 'freeThrowPct') || 0.70;
      } else if (sport === 'nfl' || sport === 'ncaa_football') {
        stats.offensiveEfficiency = this.findStat(splits, 'pointsPerGame', 'totalYards') || 20;
        stats.defensiveEfficiency = this.findStat(splits, 'oppPointsPerGame', 'oppTotalYards') || 20;
        stats.pace = this.findStat(splits, 'playsPerGame', 'totalPlays') || 65;
        stats.effectiveFieldGoalPct = this.findStat(splits, 'thirdDownPct', 'completionPct') || 0.40;
        stats.turnoverRate = this.findStat(splits, 'turnoversLost', 'interceptions') || 1.0;
        stats.offensiveReboundRate = this.findStat(splits, 'rushingYardsPerGame', 'rushingAttempts') || 100;
        stats.freeThrowRate = this.findStat(splits, 'redZonePct', 'scoringPct') || 0.50;
      } else if (sport === 'nhl') {
        stats.offensiveEfficiency = this.findStat(splits, 'goalsPerGame', 'shotsPerGame') || 3.0;
        stats.defensiveEfficiency = this.findStat(splits, 'oppGoalsPerGame', 'oppShotsPerGame') || 3.0;
        stats.pace = this.findStat(splits, 'shotsPerGame', 'totalShots') || 30;
        stats.effectiveFieldGoalPct = this.findStat(splits, 'shootingPct', 'savePct') || 0.10;
        stats.turnoverRate = this.findStat(splits, 'giveaways', 'turnovers') || 10;
        stats.offensiveReboundRate = this.findStat(splits, 'powerPlayPct', 'powerPlayGoals') || 0.20;
        stats.freeThrowRate = this.findStat(splits, 'penaltyKillPct', 'shortHandedGoals') || 0.80;
      }

      // Extract recent form from record if available
      if (espnData.record) {
        stats.recentForm = this.parseRecentForm(espnData.record);
      }

    } catch (error) {
      logger.warn('Failed to parse ESPN statistics', {
        sport,
        error: error.message
      });
    }

    return stats;
  }

  /**
   * Find a statistic value from ESPN splits
   * @param {Array} splits - ESPN statistics splits
   * @param {string} primaryName - Primary stat name to look for
   * @param {string} fallbackName - Fallback stat name
   * @returns {number|null} - Stat value or null
   */
  findStat(splits, primaryName, fallbackName) {
    for (const category of splits) {
      const stats = category.stats || [];
      
      // Try primary name
      let stat = stats.find(s => s.name === primaryName || s.abbreviation === primaryName);
      if (stat && stat.value !== undefined) {
        return parseFloat(stat.value);
      }

      // Try fallback name
      stat = stats.find(s => s.name === fallbackName || s.abbreviation === fallbackName);
      if (stat && stat.value !== undefined) {
        return parseFloat(stat.value);
      }
    }

    return null;
  }

  /**
   * Parse recent form from team record
   * @param {Object} record - ESPN team record
   * @returns {Array} - Recent form array (1=win, 0=loss)
   */
  parseRecentForm(record) {
    // Default to neutral form if no data
    const defaultForm = [1, 0, 1, 0, 1];

    try {
      // ESPN may provide recent games or streak information
      if (record.items && Array.isArray(record.items)) {
        return record.items.slice(0, 5).map(game => {
          return game.result === 'W' ? 1 : 0;
        });
      }

      // Calculate from overall record
      if (record.wins !== undefined && record.losses !== undefined) {
        const totalGames = record.wins + record.losses;
        const winPct = totalGames > 0 ? record.wins / totalGames : 0.5;
        
        // Generate form based on win percentage
        return Array(5).fill(0).map(() => Math.random() < winPct ? 1 : 0);
      }

    } catch (error) {
      logger.debug('Failed to parse recent form', { error: error.message });
    }

    return defaultForm;
  }

  /**
   * Get sport configuration
   * @param {string} sport - Sport key
   * @returns {Object|null} - Sport configuration
   */
  getSportConfig(sport) {
    const configs = {
      'nfl': { id: 'football', league: 'nfl' },
      'nba': { id: 'basketball', league: 'nba' },
      'nhl': { id: 'hockey', league: 'nhl' },
      'ncaa_basketball': { id: 'basketball', league: 'mens-college-basketball' },
      'ncaa_football': { id: 'football', league: 'college-football' }
    };

    return configs[sport] || null;
  }

  /**
   * Get cached statistics
   * @param {string} sport - Sport key
   * @param {string} teamId - Team ID
   * @param {string} season - Season year
   * @returns {Promise<Object|null>} - Cached stats or null
   */
  async getCachedStats(sport, teamId, season) {
    try {
      const cacheFile = path.join(this.cacheDir, `${sport}_${teamId}_${season}.json`);
      const data = await fs.readFile(cacheFile, 'utf8');
      const cached = JSON.parse(data);

      // Check if cache is still valid
      if (Date.now() - new Date(cached.lastUpdated).getTime() < this.cacheTimeout) {
        logger.debug('Using cached team statistics', { sport, teamId, season });
        return cached;
      }

    } catch (error) {
      // Cache miss is expected, don't log as error
      logger.debug('No valid cached team statistics', { sport, teamId, season });
    }

    return null;
  }

  /**
   * Cache team statistics
   * @param {string} sport - Sport key
   * @param {string} teamId - Team ID
   * @param {string} season - Season year
   * @param {Object} stats - Statistics to cache
   */
  async cacheStats(sport, teamId, season, stats) {
    try {
      const cacheFile = path.join(this.cacheDir, `${sport}_${teamId}_${season}.json`);
      await fs.writeFile(cacheFile, JSON.stringify(stats, null, 2));
      
      logger.debug('Cached team statistics', { sport, teamId, season });
    } catch (error) {
      logger.warn('Failed to cache team statistics', {
        sport,
        teamId,
        season,
        error: error.message
      });
    }
  }

  /**
   * Get statistics for both teams in a matchup
   * @param {Object} gameData - Game data with team information
   * @returns {Promise<Object>} - { home: stats, away: stats }
   */
  async getMatchupStatistics(gameData) {
    const season = new Date(gameData.date).getFullYear().toString();

    const [homeStats, awayStats] = await Promise.all([
      this.getTeamStatistics(gameData.sport, gameData.teams.home.id, season),
      this.getTeamStatistics(gameData.sport, gameData.teams.away.id, season)
    ]);

    return {
      home: homeStats,
      away: awayStats
    };
  }
}

module.exports = TeamStatisticsAggregator;
