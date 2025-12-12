const logger = require('../../utils/logger');

/**
 * Migration to make expires_at column nullable in lobbies table
 * This allows for indefinite lobbies that are managed by voice activity
 */
async function migrate(db) {
  try {
    logger.info('Starting migration: Make expires_at nullable');

    // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
    
    // 1. Create new table with correct schema
    await db.run(`
      CREATE TABLE IF NOT EXISTS lobbies_new (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        leader_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        voice_channel_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disbanded', 'expired')),
        FOREIGN KEY (guild_id) REFERENCES server_config(guild_id)
      )
    `);

    // 2. Copy data from old table to new table
    await db.run(`
      INSERT INTO lobbies_new (id, guild_id, leader_id, game_type, voice_channel_id, created_at, expires_at, status)
      SELECT id, guild_id, leader_id, game_type, voice_channel_id, created_at, expires_at, status
      FROM lobbies
    `);

    // 3. Drop old table
    await db.run('DROP TABLE lobbies');

    // 4. Rename new table
    await db.run('ALTER TABLE lobbies_new RENAME TO lobbies');

    // 5. Recreate indexes
    await db.run('CREATE INDEX IF NOT EXISTS idx_lobbies_guild_id ON lobbies(guild_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_lobbies_leader_id ON lobbies(leader_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_lobbies_expires_at ON lobbies(expires_at)');

    logger.info('Migration completed: expires_at is now nullable');
    return true;
  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  }
}

module.exports = { migrate };