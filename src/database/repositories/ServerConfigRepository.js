const BaseRepository = require('./BaseRepository');
const ServerConfig = require('../models/ServerConfig');

/**
 * Repository for server configuration operations
 */
class ServerConfigRepository extends BaseRepository {
  constructor() {
    super('server_config');
  }

  /**
   * Get server configuration by guild ID
   */
  async getByGuildId(guildId) {
    const row = await this.findById(guildId, 'guild_id');
    return row ? new ServerConfig(row) : null;
  }

  /**
   * Create or update server configuration
   */
  async saveConfig(serverConfig) {
    const validation = serverConfig.validate();
    if (!validation.isValid) {
      throw new Error(`Invalid server config: ${validation.errors.join(', ')}`);
    }

    const data = {
      ...serverConfig.toDatabase(),
      updated_at: new Date().toISOString()
    };

    return await this.upsert(data, 'guild_id');
  }

  /**
   * Set sports channel for a guild
   */
  async setSportsChannel(guildId, league, channelId) {
    const config = await this.getByGuildId(guildId) || new ServerConfig({ guildId });
    
    if (!config.setSportsChannel(league, channelId)) {
      throw new Error(`Invalid league: ${league}`);
    }

    return await this.saveConfig(config);
  }

  /**
   * Get sports channel for a guild and league
   */
  async getSportsChannel(guildId, league) {
    const config = await this.getByGuildId(guildId);
    return config ? config.getSportsChannel(league) : null;
  }

  /**
   * Update lobby settings for a guild
   */
  async updateLobbySettings(guildId, settings) {
    const config = await this.getByGuildId(guildId) || new ServerConfig({ guildId });
    
    if (settings.duration !== undefined) {
      config.lobbySettings.duration = settings.duration;
    }
    
    if (settings.maxSize !== undefined) {
      config.lobbySettings.maxSize = settings.maxSize;
    }

    return await this.saveConfig(config);
  }

  /**
   * Get all configured guilds
   */
  async getAllConfiguredGuilds() {
    const rows = await this.findAll('guild_id');
    return rows.map(row => new ServerConfig(row));
  }

  /**
   * Get guilds with sports channels configured
   */
  async getGuildsWithSportsChannels() {
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE nfl_channel_id IS NOT NULL 
         OR nba_channel_id IS NOT NULL 
         OR nhl_channel_id IS NOT NULL 
         OR ncaa_channel_id IS NOT NULL
    `;
    
    const rows = await this.query(sql);
    return rows.map(row => new ServerConfig(row));
  }

  /**
   * Get guilds configured for a specific league
   */
  async getGuildsForLeague(league) {
    const columnMap = {
      nfl: 'nfl_channel_id',
      nba: 'nba_channel_id',
      nhl: 'nhl_channel_id',
      ncaa: 'ncaa_channel_id'
    };

    const column = columnMap[league.toLowerCase()];
    if (!column) {
      throw new Error(`Invalid league: ${league}`);
    }

    const sql = `SELECT * FROM ${this.tableName} WHERE ${column} IS NOT NULL`;
    const rows = await this.query(sql);
    return rows.map(row => new ServerConfig(row));
  }

  /**
   * Remove sports channel configuration
   */
  async removeSportsChannel(guildId, league) {
    const config = await this.getByGuildId(guildId);
    if (!config) {
      return false;
    }

    if (config.setSportsChannel(league, null)) {
      await this.saveConfig(config);
      return true;
    }

    return false;
  }

  /**
   * Delete server configuration
   */
  async deleteConfig(guildId) {
    return await this.delete(guildId, 'guild_id');
  }

  /**
   * Get lobby settings for a guild
   */
  async getLobbySettings(guildId) {
    const config = await this.getByGuildId(guildId);
    return config ? config.lobbySettings : {
      duration: 60,
      maxSize: 10
    };
  }

  /**
   * Check if guild has any configuration
   */
  async hasConfiguration(guildId) {
    return await this.exists({ guild_id: guildId });
  }

  /**
   * Set team color override for a guild
   * @param {string} guildId - Guild ID
   * @param {string} teamAbbrev - Team abbreviation
   * @param {string} colorName - Color name
   */
  async setTeamColorOverride(guildId, teamAbbrev, colorName) {
    const config = await this.getByGuildId(guildId) || new ServerConfig({ guildId });
    config.setTeamColorOverride(teamAbbrev, colorName);
    return await this.saveConfig(config);
  }

  /**
   * Get team color override for a guild
   * @param {string} guildId - Guild ID
   * @param {string} teamAbbrev - Team abbreviation
   * @returns {string|null} - Color name or null
   */
  async getTeamColorOverride(guildId, teamAbbrev) {
    const config = await this.getByGuildId(guildId);
    return config ? config.getTeamColorOverride(teamAbbrev) : null;
  }

  /**
   * Remove team color override for a guild
   * @param {string} guildId - Guild ID
   * @param {string} teamAbbrev - Team abbreviation
   */
  async removeTeamColorOverride(guildId, teamAbbrev) {
    const config = await this.getByGuildId(guildId);
    if (config) {
      config.removeTeamColorOverride(teamAbbrev);
      return await this.saveConfig(config);
    }
    return false;
  }

  /**
   * Get all team color overrides for a guild
   * @param {string} guildId - Guild ID
   * @returns {Object} - Team color overrides map
   */
  async getAllTeamColorOverrides(guildId) {
    const config = await this.getByGuildId(guildId);
    return config ? config.getAllTeamColorOverrides() : {};
  }
}

module.exports = ServerConfigRepository;