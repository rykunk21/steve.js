/**
 * Migration: Add team_color_overrides column to server_config table
 * This allows admins to manually set team colors for spread bars
 */

async function migrate(dbConnection) {
  try {
    // Check if column already exists
    const tableInfo = await dbConnection.all("PRAGMA table_info(server_config)");
    const hasColumn = tableInfo.some(col => col.name === 'team_color_overrides');
    
    if (!hasColumn) {
      // Add team_color_overrides column as JSON text
      await dbConnection.run(`
        ALTER TABLE server_config 
        ADD COLUMN team_color_overrides TEXT DEFAULT '{}'
      `);
      
      console.log('✅ Added team_color_overrides column to server_config table');
    } else {
      console.log('ℹ️  team_color_overrides column already exists');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

module.exports = { migrate };
