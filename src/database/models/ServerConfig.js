/**
 * Server Configuration Model
 * Represents bot configuration for a Discord server
 */
class ServerConfig {
  constructor(data = {}) {
    this.guildId = data.guild_id || data.guildId;
    this.sportsChannels = {
      nfl: data.nfl_channel_id || data.nflChannelId || null,
      nba: data.nba_channel_id || data.nbaChannelId || null,
      nhl: data.nhl_channel_id || data.nhlChannelId || null,
      ncaa: data.ncaa_channel_id || data.ncaaChannelId || null
    };
    this.lobbySettings = {
      duration: data.lobby_duration_minutes || data.lobbyDuration || 60,
      maxSize: data.max_lobby_size || data.maxLobbySize || 10
    };
    
    // Parse team color overrides from JSON string if needed
    if (typeof data.team_color_overrides === 'string') {
      try {
        this.teamColorOverrides = JSON.parse(data.team_color_overrides);
      } catch (error) {
        this.teamColorOverrides = {};
      }
    } else {
      this.teamColorOverrides = data.team_color_overrides || data.teamColorOverrides || {};
    }
    
    this.createdAt = data.created_at || data.createdAt;
    this.updatedAt = data.updated_at || data.updatedAt;
  }

  /**
   * Validate server configuration data
   */
  validate() {
    const errors = [];

    if (!this.guildId) {
      errors.push('Guild ID is required');
    }

    if (this.lobbySettings.duration < 5 || this.lobbySettings.duration > 1440) {
      errors.push('Lobby duration must be between 5 and 1440 minutes');
    }

    if (this.lobbySettings.maxSize < 2 || this.lobbySettings.maxSize > 50) {
      errors.push('Max lobby size must be between 2 and 50');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert to database format
   */
  toDatabase() {
    return {
      guild_id: this.guildId,
      nfl_channel_id: this.sportsChannels.nfl,
      nba_channel_id: this.sportsChannels.nba,
      nhl_channel_id: this.sportsChannels.nhl,
      ncaa_channel_id: this.sportsChannels.ncaa,
      lobby_duration_minutes: this.lobbySettings.duration,
      max_lobby_size: this.lobbySettings.maxSize,
      team_color_overrides: JSON.stringify(this.teamColorOverrides || {})
    };
  }

  /**
   * Get channel ID for a specific sport
   */
  getSportsChannel(league) {
    const normalizedLeague = league.toLowerCase();
    return this.sportsChannels[normalizedLeague] || null;
  }

  /**
   * Set channel ID for a specific sport
   */
  setSportsChannel(league, channelId) {
    const normalizedLeague = league.toLowerCase();
    if (['nfl', 'nba', 'nhl', 'ncaa'].includes(normalizedLeague)) {
      this.sportsChannels[normalizedLeague] = channelId;
      return true;
    }
    return false;
  }

  /**
   * Check if sports channels are configured
   */
  hasSportsChannels() {
    return Object.values(this.sportsChannels).some(channelId => channelId !== null);
  }

  /**
   * Get configured sports leagues
   */
  getConfiguredLeagues() {
    return Object.entries(this.sportsChannels)
      .filter(([league, channelId]) => channelId !== null)
      .map(([league]) => league);
  }

  /**
   * Get team color override
   * @param {string} teamAbbrev - Team abbreviation
   * @returns {string|null} - Color name or null
   */
  getTeamColorOverride(teamAbbrev) {
    if (!this.teamColorOverrides) {
      return null;
    }
    return this.teamColorOverrides[teamAbbrev.toUpperCase()] || null;
  }

  /**
   * Set team color override
   * @param {string} teamAbbrev - Team abbreviation
   * @param {string} colorName - Color name
   */
  setTeamColorOverride(teamAbbrev, colorName) {
    if (!this.teamColorOverrides) {
      this.teamColorOverrides = {};
    }
    this.teamColorOverrides[teamAbbrev.toUpperCase()] = colorName;
  }

  /**
   * Remove team color override
   * @param {string} teamAbbrev - Team abbreviation
   */
  removeTeamColorOverride(teamAbbrev) {
    if (this.teamColorOverrides) {
      delete this.teamColorOverrides[teamAbbrev.toUpperCase()];
    }
  }

  /**
   * Get all team color overrides
   * @returns {Object} - Team color overrides map
   */
  getAllTeamColorOverrides() {
    return this.teamColorOverrides || {};
  }
}

module.exports = ServerConfig;