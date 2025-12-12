const BaseRepository = require('./BaseRepository');
const Lobby = require('../models/Lobby');

/**
 * Repository for lobby operations
 */
class LobbyRepository extends BaseRepository {
  constructor() {
    super('lobbies');
  }

  /**
   * Create a new lobby
   */
  async createLobby(guildId, leaderId, gameType, durationMinutes = null) {
    const lobby = Lobby.create(guildId, leaderId, gameType, durationMinutes);
    
    const validation = lobby.validate();
    if (!validation.isValid) {
      throw new Error(`Invalid lobby data: ${validation.errors.join(', ')}`);
    }

    // Create lobby record
    await this.create(lobby.toDatabase());

    // Add leader as first member
    await this.addMember(lobby.id, leaderId);

    return lobby;
  }

  /**
   * Get lobby by ID with members
   */
  async getLobbyById(lobbyId) {
    const lobbyRow = await this.findById(lobbyId);
    if (!lobbyRow) {
      return null;
    }

    const lobby = new Lobby(lobbyRow);
    
    // Load members
    const members = await this.getLobbyMembers(lobbyId);
    lobby.members = new Set(members.map(m => m.user_id));

    return lobby;
  }

  /**
   * Get active lobbies for a guild
   */
  async getActiveLobbysByGuild(guildId) {
    const rows = await this.findBy(
      { guild_id: guildId, status: 'active' },
      'created_at DESC'
    );

    const lobbies = [];
    for (const row of rows) {
      const lobby = new Lobby(row);
      
      // Skip expired lobbies
      if (lobby.isExpired()) {
        await this.expireLobby(lobby.id);
        continue;
      }

      // Load members
      const members = await this.getLobbyMembers(lobby.id);
      lobby.members = new Set(members.map(m => m.user_id));
      
      lobbies.push(lobby);
    }

    return lobbies;
  }

  /**
   * Get lobbies by leader
   */
  async getLobbiesByLeader(leaderId) {
    const rows = await this.findBy(
      { leader_id: leaderId, status: 'active' },
      'created_at DESC'
    );

    const lobbies = [];
    for (const row of rows) {
      const lobby = new Lobby(row);
      
      if (!lobby.isExpired()) {
        const members = await this.getLobbyMembers(lobby.id);
        lobby.members = new Set(members.map(m => m.user_id));
        lobbies.push(lobby);
      }
    }

    return lobbies;
  }

  /**
   * Get lobbies where user is a member
   */
  async getLobbiesByMember(userId) {
    const sql = `
      SELECT l.* FROM ${this.tableName} l
      INNER JOIN lobby_members lm ON l.id = lm.lobby_id
      WHERE lm.user_id = ? AND l.status = 'active'
      ORDER BY l.created_at DESC
    `;

    const rows = await this.query(sql, [userId]);
    const lobbies = [];

    for (const row of rows) {
      const lobby = new Lobby(row);
      
      if (!lobby.isExpired()) {
        const members = await this.getLobbyMembers(lobby.id);
        lobby.members = new Set(members.map(m => m.user_id));
        lobbies.push(lobby);
      }
    }

    return lobbies;
  }

  /**
   * Add member to lobby
   */
  async addMember(lobbyId, userId) {
    try {
      await this.db.run(
        'INSERT OR IGNORE INTO lobby_members (lobby_id, user_id) VALUES (?, ?)',
        [lobbyId, userId]
      );
      return true;
    } catch (error) {
      throw new Error(`Failed to add member to lobby: ${error.message}`);
    }
  }

  /**
   * Remove member from lobby
   */
  async removeMember(lobbyId, userId) {
    try {
      const result = await this.db.run(
        'DELETE FROM lobby_members WHERE lobby_id = ? AND user_id = ?',
        [lobbyId, userId]
      );
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to remove member from lobby: ${error.message}`);
    }
  }

  /**
   * Get lobby members
   */
  async getLobbyMembers(lobbyId) {
    return await this.db.all(
      'SELECT * FROM lobby_members WHERE lobby_id = ? ORDER BY joined_at',
      [lobbyId]
    );
  }

  /**
   * Update lobby voice channel
   */
  async updateVoiceChannel(lobbyId, voiceChannelId) {
    return await this.update(lobbyId, { voice_channel_id: voiceChannelId });
  }

  /**
   * Transfer lobby leadership
   */
  async transferLeadership(lobbyId, newLeaderId) {
    const lobby = await this.getLobbyById(lobbyId);
    if (!lobby || !lobby.hasMember(newLeaderId)) {
      return false;
    }

    await this.update(lobbyId, { leader_id: newLeaderId });
    return true;
  }

  /**
   * Disband lobby
   */
  async disbandLobby(lobbyId) {
    await this.update(lobbyId, { 
      status: 'disbanded'
    });

    // Remove all members
    await this.db.run('DELETE FROM lobby_members WHERE lobby_id = ?', [lobbyId]);
    
    return true;
  }

  /**
   * Expire lobby
   */
  async expireLobby(lobbyId) {
    await this.update(lobbyId, { 
      status: 'expired'
    });

    return true;
  }

  /**
   * Extend lobby expiration
   */
  async extendLobby(lobbyId, additionalMinutes) {
    const lobby = await this.getLobbyById(lobbyId);
    if (!lobby || !lobby.isActive()) {
      return false;
    }

    const currentExpiry = new Date(lobby.expiresAt);
    const newExpiry = new Date(currentExpiry.getTime() + (additionalMinutes * 60 * 1000));

    await this.update(lobbyId, { 
      expires_at: newExpiry.toISOString()
    });

    return true;
  }

  /**
   * Get expired lobbies for cleanup
   */
  async getExpiredLobbies() {
    const now = new Date().toISOString();
    const rows = await this.findBy({ status: 'active' });
    
    return rows
      .map(row => new Lobby(row))
      .filter(lobby => lobby.isExpired());
  }

  /**
   * Cleanup expired lobbies
   */
  async cleanupExpiredLobbies() {
    const expiredLobbies = await this.getExpiredLobbies();
    let cleanedCount = 0;

    for (const lobby of expiredLobbies) {
      await this.expireLobby(lobby.id);
      cleanedCount++;
    }

    return cleanedCount;
  }

  /**
   * Get lobby statistics for a guild
   */
  async getLobbyStats(guildId) {
    const sql = `
      SELECT 
        COUNT(*) as total_lobbies,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_lobbies,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_lobbies,
        COUNT(CASE WHEN status = 'disbanded' THEN 1 END) as disbanded_lobbies
      FROM ${this.tableName} 
      WHERE guild_id = ?
    `;

    const result = await this.db.get(sql, [guildId]);
    return result;
  }

  /**
   * Check if user can create more lobbies
   */
  async canUserCreateLobby(userId, maxLobbiesPerUser = 3) {
    const activeLobbies = await this.getLobbiesByLeader(userId);
    return activeLobbies.length < maxLobbiesPerUser;
  }

  /**
   * Get lobby by voice channel ID
   */
  async getLobbyByVoiceChannel(voiceChannelId) {
    const row = await this.findOneBy({ 
      voice_channel_id: voiceChannelId, 
      status: 'active' 
    });

    if (!row) {
      return null;
    }

    const lobby = new Lobby(row);
    const members = await this.getLobbyMembers(lobby.id);
    lobby.members = new Set(members.map(m => m.user_id));

    return lobby;
  }
}

module.exports = LobbyRepository;