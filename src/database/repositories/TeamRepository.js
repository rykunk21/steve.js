const BaseRepository = require('./BaseRepository');
const logger = require('../../utils/logger');

/**
 * Repository for team data management
 * Stores team information, StatBroadcast GIDs, and statistical representations
 */
class TeamRepository extends BaseRepository {
  constructor() {
    super('teams');
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
   * Get all teams for a sport
   * @param {string} sport - Sport identifier
   * @returns {Promise<Array>} - Array of team objects
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
   * Update last synced timestamp
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
}

module.exports = TeamRepository;
