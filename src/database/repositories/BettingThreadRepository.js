const BaseRepository = require('./BaseRepository');
const BettingThread = require('../models/BettingThread');

/**
 * Repository for managing betting threads in the database
 */
class BettingThreadRepository extends BaseRepository {
  constructor() {
    super();
    this.tableName = 'betting_threads';
  }

  /**
   * Create the betting_threads table
   */
  async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        sport TEXT NOT NULL,
        game_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        channel_id TEXT,
        game_name TEXT,
        game_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT 1,
        UNIQUE(guild_id, sport, game_id)
      )
    `;

    await this.executeQuery(sql);
    
    // Create indexes for better performance
    await this.executeQuery(`
      CREATE INDEX IF NOT EXISTS idx_betting_threads_guild_sport 
      ON ${this.tableName}(guild_id, sport)
    `);
    
    await this.executeQuery(`
      CREATE INDEX IF NOT EXISTS idx_betting_threads_thread_id 
      ON ${this.tableName}(thread_id)
    `);
  }

  /**
   * Create a new betting thread record
   * @param {BettingThread} bettingThread - Betting thread to create
   * @returns {Promise<BettingThread>} - Created betting thread with ID
   */
  async create(bettingThread) {
    const validation = bettingThread.validate();
    if (!validation.isValid) {
      throw new Error(`Invalid betting thread: ${validation.errors.join(', ')}`);
    }

    const data = bettingThread.toDatabase();
    data.updated_at = new Date().toISOString();

    const sql = `
      INSERT OR REPLACE INTO ${this.tableName} 
      (guild_id, sport, game_id, thread_id, channel_id, game_name, game_date, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      data.guild_id,
      data.sport,
      data.game_id,
      data.thread_id,
      data.channel_id,
      data.game_name,
      data.game_date,
      data.created_at,
      data.updated_at,
      data.is_active
    ];

    const result = await this.executeQuery(sql, params);
    bettingThread.id = result.lastID;
    
    return bettingThread;
  }

  /**
   * Find betting thread by guild, sport, and game ID
   * @param {string} guildId - Guild ID
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @returns {Promise<BettingThread|null>} - Betting thread or null
   */
  async findByGame(guildId, sport, gameId) {
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE guild_id = ? AND sport = ? AND game_id = ? AND is_active = 1
    `;
    
    const row = await this.getOne(sql, [guildId, sport, gameId]);
    return row ? BettingThread.fromDatabase(row) : null;
  }

  /**
   * Find betting thread by thread ID
   * @param {string} threadId - Discord thread ID
   * @returns {Promise<BettingThread|null>} - Betting thread or null
   */
  async findByThreadId(threadId) {
    const sql = `
      SELECT * FROM ${this.tableName} 
      WHERE thread_id = ? AND is_active = 1
    `;
    
    const row = await this.getOne(sql, [threadId]);
    return row ? BettingThread.fromDatabase(row) : null;
  }

  /**
   * Get all active betting threads for a guild and sport
   * @param {string} guildId - Guild ID
   * @param {string} sport - Sport key (optional)
   * @returns {Promise<BettingThread[]>} - Array of betting threads
   */
  async findByGuildAndSport(guildId, sport = null) {
    let sql = `
      SELECT * FROM ${this.tableName} 
      WHERE guild_id = ? AND is_active = 1
    `;
    const params = [guildId];

    if (sport) {
      sql += ' AND sport = ?';
      params.push(sport);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = await this.getAll(sql, params);
    return rows.map(row => BettingThread.fromDatabase(row));
  }

  /**
   * Mark betting thread as inactive (soft delete)
   * @param {string} guildId - Guild ID
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @returns {Promise<boolean>} - Whether deletion was successful
   */
  async deactivate(guildId, sport, gameId) {
    const sql = `
      UPDATE ${this.tableName} 
      SET is_active = 0, updated_at = ? 
      WHERE guild_id = ? AND sport = ? AND game_id = ?
    `;
    
    const result = await this.executeQuery(sql, [
      new Date().toISOString(),
      guildId,
      sport,
      gameId
    ]);
    
    return result.changes > 0;
  }

  /**
   * Mark betting thread as inactive by thread ID
   * @param {string} threadId - Discord thread ID
   * @returns {Promise<boolean>} - Whether deletion was successful
   */
  async deactivateByThreadId(threadId) {
    const sql = `
      UPDATE ${this.tableName} 
      SET is_active = 0, updated_at = ? 
      WHERE thread_id = ?
    `;
    
    const result = await this.executeQuery(sql, [
      new Date().toISOString(),
      threadId
    ]);
    
    return result.changes > 0;
  }

  /**
   * Check if a betting thread exists for a game
   * @param {string} guildId - Guild ID
   * @param {string} sport - Sport key
   * @param {string} gameId - Game ID
   * @returns {Promise<boolean>} - Whether thread exists
   */
  async exists(guildId, sport, gameId) {
    const thread = await this.findByGame(guildId, sport, gameId);
    return !!thread;
  }

  /**
   * Get thread statistics for a guild
   * @param {string} guildId - Guild ID
   * @returns {Promise<Object>} - Thread statistics
   */
  async getStats(guildId) {
    const sql = `
      SELECT 
        sport,
        COUNT(*) as total_threads,
        COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_threads
      FROM ${this.tableName} 
      WHERE guild_id = ?
      GROUP BY sport
    `;
    
    const rows = await this.getAll(sql, [guildId]);
    
    const stats = {
      totalThreads: 0,
      activeThreads: 0,
      bySport: {}
    };

    rows.forEach(row => {
      stats.totalThreads += row.total_threads;
      stats.activeThreads += row.active_threads;
      stats.bySport[row.sport] = {
        total: row.total_threads,
        active: row.active_threads
      };
    });

    return stats;
  }

  /**
   * Clean up old inactive threads (hard delete)
   * @param {number} daysOld - Delete threads older than this many days
   * @returns {Promise<number>} - Number of threads deleted
   */
  async cleanupOldThreads(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const sql = `
      DELETE FROM ${this.tableName} 
      WHERE is_active = 0 AND updated_at < ?
    `;
    
    const result = await this.executeQuery(sql, [cutoffDate.toISOString()]);
    return result.changes;
  }
}

module.exports = BettingThreadRepository;