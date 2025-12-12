/**
 * BettingThread model for tracking created betting threads
 */
class BettingThread {
  constructor(data = {}) {
    this.id = data.id || null;
    this.guildId = data.guildId || data.guild_id || null;
    this.sport = data.sport || null;
    this.gameId = data.gameId || data.game_id || null;
    this.threadId = data.threadId || data.thread_id || null;
    this.channelId = data.channelId || data.channel_id || null;
    this.gameName = data.gameName || data.game_name || null;
    this.gameDate = data.gameDate || data.game_date || null;
    this.createdAt = data.createdAt || data.created_at || new Date();
    this.updatedAt = data.updatedAt || data.updated_at || new Date();
    this.isActive = data.isActive !== undefined ? data.isActive : (data.is_active !== undefined ? data.is_active : true);
  }

  /**
   * Convert to database format
   */
  toDatabase() {
    return {
      guild_id: this.guildId,
      sport: this.sport,
      game_id: this.gameId,
      thread_id: this.threadId,
      channel_id: this.channelId,
      game_name: this.gameName,
      game_date: this.gameDate,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
      is_active: this.isActive
    };
  }

  /**
   * Create from database row
   */
  static fromDatabase(row) {
    return new BettingThread({
      id: row.id,
      guild_id: row.guild_id,
      sport: row.sport,
      game_id: row.game_id,
      thread_id: row.thread_id,
      channel_id: row.channel_id,
      game_name: row.game_name,
      game_date: row.game_date,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_active: row.is_active
    });
  }

  /**
   * Validate the betting thread data
   */
  validate() {
    const errors = [];

    if (!this.guildId) {
      errors.push('Guild ID is required');
    }

    if (!this.sport) {
      errors.push('Sport is required');
    }

    if (!this.gameId) {
      errors.push('Game ID is required');
    }

    if (!this.threadId) {
      errors.push('Thread ID is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get unique key for this betting thread
   */
  getKey() {
    return `${this.guildId}_${this.sport}_${this.gameId}`;
  }
}

module.exports = BettingThread;