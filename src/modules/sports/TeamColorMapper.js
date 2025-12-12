const logger = require('../../utils/logger');

/**
 * Maps team identifiers to Discord emoji colors for visual distinction
 */
class TeamColorMapper {
  constructor() {
    // Available Discord color square emojis
    this.discordColors = {
      red: '🟥',
      orange: '🟧',
      yellow: '🟨',
      green: '🟩',
      blue: '🟦',
      purple: '🟪',
      brown: '🟫',
      white: '⬜',
      black: '⬛'
    };

    // RGB values for each Discord color (for distance calculation)
    this.colorRGB = {
      red: [255, 0, 0],
      orange: [255, 165, 0],
      yellow: [255, 255, 0],
      green: [0, 255, 0],
      blue: [0, 0, 255],
      purple: [128, 0, 128],
      brown: [165, 42, 42],
      white: [255, 255, 255],
      black: [0, 0, 0]
    };

    // Predefined team color mappings for common teams
    this.teamColorMap = this.buildTeamColorMap();
  }

  /**
   * Build predefined team color map for common teams
   * @returns {Object} - Team abbreviation to color name mapping
   */
  buildTeamColorMap() {
    return {
      // NFL Teams
      'ARI': 'red', 'ATL': 'red', 'BAL': 'purple', 'BUF': 'blue',
      'CAR': 'blue', 'CHI': 'orange', 'CIN': 'orange', 'CLE': 'brown',
      'DAL': 'blue', 'DEN': 'orange', 'DET': 'blue', 'GB': 'green',
      'HOU': 'red', 'IND': 'blue', 'JAX': 'blue', 'JAC': 'blue',
      'KC': 'red', 'LAC': 'blue', 'LAR': 'blue', 'LA': 'blue',
      'LV': 'black', 'MIA': 'blue', 'MIN': 'purple', 'NE': 'blue',
      'NO': 'yellow', 'NYG': 'blue', 'NYJ': 'green', 'PHI': 'green',
      'PIT': 'yellow', 'SF': 'red', 'SEA': 'blue', 'TB': 'red',
      'TEN': 'blue', 'WAS': 'red',

      // NBA Teams
      'ATL': 'red', 'BOS': 'green', 'BKN': 'black', 'CHA': 'blue',
      'CHI': 'red', 'CLE': 'red', 'DAL': 'blue', 'DEN': 'blue',
      'DET': 'blue', 'GSW': 'blue', 'HOU': 'red', 'IND': 'blue',
      'LAC': 'blue', 'LAL': 'purple', 'MEM': 'blue', 'MIA': 'red',
      'MIL': 'green', 'MIN': 'blue', 'NOP': 'blue', 'NYK': 'blue',
      'OKC': 'blue', 'ORL': 'blue', 'PHI': 'blue', 'PHX': 'purple',
      'POR': 'red', 'SAC': 'purple', 'SAS': 'black', 'TOR': 'red',
      'UTA': 'blue', 'WAS': 'blue',

      // NHL Teams
      'ANA': 'orange', 'ARI': 'red', 'BOS': 'yellow', 'BUF': 'blue',
      'CGY': 'red', 'CAR': 'red', 'CHI': 'red', 'COL': 'red',
      'CBJ': 'blue', 'DAL': 'green', 'DET': 'red', 'EDM': 'orange',
      'FLA': 'red', 'LAK': 'black', 'MIN': 'green', 'MTL': 'red',
      'NSH': 'yellow', 'NJD': 'red', 'NYI': 'blue', 'NYR': 'blue',
      'OTT': 'red', 'PHI': 'orange', 'PIT': 'yellow', 'SJS': 'blue',
      'SEA': 'blue', 'STL': 'blue', 'TBL': 'blue', 'TOR': 'blue',
      'VAN': 'blue', 'VGK': 'yellow', 'WPG': 'blue', 'WSH': 'red',

      // NCAA Basketball (common teams)
      'ARIZ': 'red', 'DUKE': 'blue', 'UNC': 'blue', 'KU': 'blue',
      'UK': 'blue', 'UCLA': 'blue', 'GONZ': 'blue', 'VILL': 'blue',
      'UVA': 'orange', 'MSU': 'green', 'MICH': 'blue', 'OSU': 'red',
      'WISC': 'red', 'PURDUE': 'yellow', 'ILL': 'orange', 'IU': 'red',
      'MARQ': 'blue', 'CREI': 'blue', 'CONN': 'blue', 'SYR': 'orange',
      'NOVA': 'blue', 'GTWN': 'blue', 'PROV': 'black', 'HALL': 'blue',
      'STJN': 'red', 'BUTL': 'blue', 'XAV': 'blue', 'WAKE': 'yellow',
      'FSU': 'red', 'MIA': 'orange', 'VT': 'orange', 'CLEM': 'orange',
      'NCST': 'red', 'PITT': 'blue', 'LOU': 'red', 'ND': 'blue',
      'TENN': 'orange', 'AUB': 'orange', 'ALA': 'red', 'ARK': 'red',
      'FLA': 'blue', 'UGA': 'red', 'LSU': 'purple', 'MISS': 'blue',
      'MSST': 'red', 'SC': 'red', 'TEX': 'orange', 'OKLA': 'red',
      'KSU': 'purple', 'ISU': 'red', 'TTU': 'red', 'TCU': 'purple',
      'BAY': 'green', 'WVU': 'blue', 'HOUS': 'red', 'CINN': 'red',
      'MEMPH': 'blue', 'SMU': 'red', 'TULN': 'green', 'UCF': 'yellow',
      'TEMP': 'red', 'SDSU': 'red', 'UNLV': 'red', 'NEV': 'blue',
      'FRES': 'red', 'SJSU': 'blue', 'COLO': 'yellow', 'UTAH': 'red',
      'ORST': 'orange', 'ORE': 'green', 'WASH': 'purple', 'WSU': 'red',
      'CAL': 'blue', 'STAN': 'red', 'USC': 'red', 'ASU': 'red'
    };
  }

  /**
   * Get Discord emoji color for a team (async version)
   * @param {Object} team - Team object with name, abbreviation, and optional color
   * @param {boolean} isHome - Whether this is the home team
   * @param {string} guildId - Guild ID for checking server-wide overrides
   * @returns {Promise<string>} - Discord emoji (e.g., '🟥')
   */
  async getTeamColorAsync(team, isHome = false, guildId = null) {
    try {
      // 0. Check for server-wide color override (highest priority)
      if (guildId && team.abbreviation) {
        const overrideColor = await this.getTeamColorOverrideAsync(guildId, team.abbreviation);
        if (overrideColor) {
          return this.discordColors[overrideColor];
        }
      }

      // 1. Try to get color from ESPN API hex code
      if (team.color) {
        const colorName = this.mapHexToDiscordColor(team.color);
        return this.discordColors[colorName];
      }

      // 2. Try predefined team color map
      if (team.abbreviation) {
        const abbrev = team.abbreviation.toUpperCase();
        if (this.teamColorMap[abbrev]) {
          return this.discordColors[this.teamColorMap[abbrev]];
        }
      }

      // 3. Default fallback colors
      return isHome ? this.discordColors.red : this.discordColors.blue;

    } catch (error) {
      logger.warn('Failed to get team color', {
        team: team.abbreviation || team.name,
        error: error.message
      });
      return isHome ? this.discordColors.red : this.discordColors.blue;
    }
  }

  /**
   * Get Discord emoji color for a team (sync version with cache)
   * @param {Object} team - Team object with name, abbreviation, and optional color
   * @param {boolean} isHome - Whether this is the home team
   * @param {string} guildId - Guild ID for checking server-wide overrides
   * @returns {string} - Discord emoji (e.g., '🟥')
   */
  getTeamColor(team, isHome = false, guildId = null) {
    try {
      // 0. Check for server-wide color override (highest priority)
      if (guildId && team.abbreviation) {
        const overrideColor = this.getTeamColorOverride(guildId, team.abbreviation);
        if (overrideColor) {
          return this.discordColors[overrideColor];
        }
      }

      // 1. Try to get color from ESPN API hex code
      if (team.color) {
        const colorName = this.mapHexToDiscordColor(team.color);
        return this.discordColors[colorName];
      }

      // 2. Try predefined team color map
      if (team.abbreviation) {
        const abbrev = team.abbreviation.toUpperCase();
        if (this.teamColorMap[abbrev]) {
          return this.discordColors[this.teamColorMap[abbrev]];
        }
      }

      // 3. Default fallback colors
      return isHome ? this.discordColors.red : this.discordColors.blue;

    } catch (error) {
      logger.warn('Failed to get team color', {
        team: team.abbreviation || team.name,
        error: error.message
      });
      return isHome ? this.discordColors.red : this.discordColors.blue;
    }
  }

  /**
   * Get team color override from server configuration (cached)
   * @param {string} guildId - Guild ID
   * @param {string} teamAbbrev - Team abbreviation
   * @returns {string|null} - Color name or null if no override
   */
  getTeamColorOverride(guildId, teamAbbrev) {
    try {
      // Use cached config if available
      if (!this.configCache) {
        this.configCache = new Map();
      }

      // Check cache first
      if (this.configCache.has(guildId)) {
        const config = this.configCache.get(guildId);
        if (config && config.teamColorOverrides) {
          const abbrev = teamAbbrev.toUpperCase();
          return config.teamColorOverrides[abbrev] || null;
        }
        return null;
      }

      // If not in cache, we can't block here (would need async)
      // So we'll fetch it in the background and return null for now
      this.fetchConfigAsync(guildId);
      return null;

    } catch (error) {
      logger.warn('Failed to get team color override', {
        guildId,
        teamAbbrev,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get team color override from database (async)
   * @param {string} guildId - Guild ID
   * @param {string} teamAbbrev - Team abbreviation
   * @returns {Promise<string|null>} - Color name or null if no override
   */
  async getTeamColorOverrideAsync(guildId, teamAbbrev) {
    try {
      const ServerConfigRepository = require('../../database/repositories/ServerConfigRepository');
      const configRepo = new ServerConfigRepository();
      
      const config = await configRepo.getByGuildId(guildId);
      
      if (config && config.teamColorOverrides) {
        const abbrev = teamAbbrev.toUpperCase();
        return config.teamColorOverrides[abbrev] || null;
      }
      
      return null;

    } catch (error) {
      logger.warn('Failed to get team color override', {
        guildId,
        teamAbbrev,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Fetch config asynchronously and cache it
   * @param {string} guildId - Guild ID
   */
  async fetchConfigAsync(guildId) {
    try {
      const ServerConfigRepository = require('../../database/repositories/ServerConfigRepository');
      const configRepo = new ServerConfigRepository();
      
      const config = await configRepo.getByGuildId(guildId);
      
      if (!this.configCache) {
        this.configCache = new Map();
      }
      
      this.configCache.set(guildId, config);
      
      // Cache expires after 5 minutes
      setTimeout(() => {
        this.configCache.delete(guildId);
      }, 5 * 60 * 1000);

    } catch (error) {
      logger.warn('Failed to fetch config for caching', {
        guildId,
        error: error.message
      });
    }
  }

  /**
   * Clear config cache for a guild (call this when config changes)
   * @param {string} guildId - Guild ID
   */
  clearConfigCache(guildId) {
    if (this.configCache) {
      this.configCache.delete(guildId);
    }
  }

  /**
   * Map hex color to closest Discord emoji color
   * @param {string} hexColor - Hex color code (e.g., '#CC0000')
   * @returns {string} - Color name (e.g., 'red')
   */
  mapHexToDiscordColor(hexColor) {
    // Remove # if present
    const hex = hexColor.replace('#', '');
    
    // Convert hex to RGB
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    // Find closest Discord color using Euclidean distance
    let minDistance = Infinity;
    let closestColor = 'blue';

    for (const [colorName, rgb] of Object.entries(this.colorRGB)) {
      const distance = Math.sqrt(
        Math.pow(r - rgb[0], 2) +
        Math.pow(g - rgb[1], 2) +
        Math.pow(b - rgb[2], 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestColor = colorName;
      }
    }

    return closestColor;
  }

  /**
   * Ensure two team colors have sufficient contrast
   * @param {string} awayColor - Away team emoji
   * @param {string} homeColor - Home team emoji
   * @returns {Object} - Adjusted colors { awayColor, homeColor }
   */
  ensureColorContrast(awayColor, homeColor) {
    // If colors are the same, use default contrasting colors
    if (awayColor === homeColor) {
      return {
        awayColor: this.discordColors.blue,
        homeColor: this.discordColors.red
      };
    }

    return { awayColor, homeColor };
  }

  /**
   * Get team colors for both teams with contrast ensured (async version)
   * @param {Object} awayTeam - Away team object
   * @param {Object} homeTeam - Home team object
   * @param {string} guildId - Guild ID for checking server-wide overrides
   * @returns {Promise<Object>} - { awayColor, homeColor }
   */
  async getTeamColorsAsync(awayTeam, homeTeam, guildId = null) {
    const awayColor = await this.getTeamColorAsync(awayTeam, false, guildId);
    const homeColor = await this.getTeamColorAsync(homeTeam, true, guildId);
    
    return this.ensureColorContrast(awayColor, homeColor);
  }

  /**
   * Get team colors for both teams with contrast ensured (sync version with cache)
   * @param {Object} awayTeam - Away team object
   * @param {Object} homeTeam - Home team object
   * @param {string} guildId - Guild ID for checking server-wide overrides
   * @returns {Object} - { awayColor, homeColor }
   */
  getTeamColors(awayTeam, homeTeam, guildId = null) {
    const awayColor = this.getTeamColor(awayTeam, false, guildId);
    const homeColor = this.getTeamColor(homeTeam, true, guildId);
    
    return this.ensureColorContrast(awayColor, homeColor);
  }
}

module.exports = TeamColorMapper;
