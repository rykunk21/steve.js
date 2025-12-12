/**
 * Lobby Model
 * Represents a gaming lobby with voice channel
 */
class Lobby {
  constructor(data = {}) {
    this.id = data.id;
    this.guildId = data.guild_id || data.guildId;
    this.leaderId = data.leader_id || data.leaderId;
    this.gameType = data.game_type || data.gameType;
    this.voiceChannelId = data.voice_channel_id || data.voiceChannelId;
    this.createdAt = data.created_at || data.createdAt;
    this.expiresAt = data.expires_at || data.expiresAt;
    this.status = data.status || 'active';
    this.members = new Set(data.members || []);
  }

  /**
   * Generate a user-friendly lobby ID based on leader and game name
   */
  static generateId(leaderId, gameType) {
    // Sanitize game name for ID usage
    const sanitizedGame = gameType
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric
      .substring(0, 20); // Limit length
    
    return `${leaderId}-${sanitizedGame}`;
  }

  /**
   * Create a new lobby instance
   */
  static create(guildId, leaderId, gameType, durationMinutes = null) {
    const expiresAt = durationMinutes ? 
      new Date(Date.now() + (durationMinutes * 60 * 1000)).toISOString() : 
      null; // Indefinite duration

    const lobby = new Lobby({
      id: Lobby.generateId(leaderId, gameType),
      guildId,
      leaderId,
      gameType,
      createdAt: new Date().toISOString(),
      expiresAt,
      status: 'active'
    });

    // Add leader as first member
    lobby.addMember(leaderId);
    
    return lobby;
  }

  /**
   * Validate lobby data
   */
  validate() {
    const errors = [];

    if (!this.id) {
      errors.push('Lobby ID is required');
    }

    if (!this.guildId) {
      errors.push('Guild ID is required');
    }

    if (!this.leaderId) {
      errors.push('Leader ID is required');
    }

    if (!this.gameType || this.gameType.trim().length === 0) {
      errors.push('Game type is required');
    }

    if (this.gameType && this.gameType.length > 100) {
      errors.push('Game type must be 100 characters or less');
    }

    if (!['active', 'disbanded', 'expired'].includes(this.status)) {
      errors.push('Invalid lobby status');
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
      id: this.id,
      guild_id: this.guildId,
      leader_id: this.leaderId,
      game_type: this.gameType,
      voice_channel_id: this.voiceChannelId,
      created_at: this.createdAt,
      expires_at: this.expiresAt,
      status: this.status
    };
  }

  /**
   * Add a member to the lobby
   */
  addMember(userId) {
    if (!this.isActive()) {
      return false;
    }
    
    this.members.add(userId);
    return true;
  }

  /**
   * Remove a member from the lobby
   */
  removeMember(userId) {
    return this.members.delete(userId);
  }

  /**
   * Check if user is a member
   */
  hasMember(userId) {
    return this.members.has(userId);
  }

  /**
   * Get member count
   */
  getMemberCount() {
    return this.members.size;
  }

  /**
   * Get all member IDs as array
   */
  getMemberIds() {
    return Array.from(this.members);
  }

  /**
   * Check if user is the leader
   */
  isLeader(userId) {
    return this.leaderId === userId;
  }

  /**
   * Transfer leadership to another member
   */
  transferLeadership(newLeaderId) {
    if (!this.hasMember(newLeaderId)) {
      return false;
    }
    
    this.leaderId = newLeaderId;
    return true;
  }

  /**
   * Check if lobby is active
   */
  isActive() {
    return this.status === 'active' && !this.isExpired();
  }

  /**
   * Check if lobby is expired
   */
  isExpired() {
    // If no expiration time set, lobby never expires
    if (!this.expiresAt) {
      return false;
    }
    return new Date() > new Date(this.expiresAt);
  }

  /**
   * Disband the lobby
   */
  disband() {
    this.status = 'disbanded';
  }

  /**
   * Mark lobby as expired
   */
  expire() {
    this.status = 'expired';
  }

  /**
   * Extend lobby expiration time
   */
  extend(additionalMinutes) {
    if (!this.isActive()) {
      return false;
    }
    
    const currentExpiry = new Date(this.expiresAt);
    const newExpiry = new Date(currentExpiry.getTime() + (additionalMinutes * 60 * 1000));
    this.expiresAt = newExpiry.toISOString();
    
    return true;
  }

  /**
   * Get time remaining in minutes
   */
  getTimeRemaining() {
    // If no expiration time set, return null (indefinite)
    if (!this.expiresAt) {
      return null;
    }

    const now = new Date();
    const expiry = new Date(this.expiresAt);
    const diffMs = expiry.getTime() - now.getTime();
    
    if (diffMs <= 0) {
      return 0;
    }
    
    return Math.ceil(diffMs / (1000 * 60));
  }

  /**
   * Get lobby display name
   */
  getDisplayName() {
    return `${this.gameType} Lobby`;
  }

  /**
   * Generate lobby ID from user ID and game name (for lookups)
   */
  static getLobbyIdFromGame(userId, gameType) {
    return Lobby.generateId(userId, gameType);
  }
}

module.exports = Lobby;