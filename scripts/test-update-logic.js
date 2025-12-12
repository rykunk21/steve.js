#!/usr/bin/env node

/**
 * Test script to verify the update logic works
 * 
 * This will:
 * 1. Find a game between Duke and UNC (both in our DB)
 * 2. Delete that game
 * 3. Process Duke's archive (inserts game with Duke, away=NULL)
 * 4. Process UNC's archive (updates game with UNC)
 * 5. Verify both teams are filled
 */

const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

async function main() {
  try {
    await dbConnection.initialize();
    
    console.log('\n=== Test: Update Logic for Duplicate Games ===\n');
    
    // Step 1: Find a Duke vs UNC game
    const dukeUncGame = await dbConnection.get(`
      SELECT g.game_id, g.sport, g.game_date,
             ht.team_name as home_team, ht.statbroadcast_gid as home_gid,
             at.team_name as away_team, at.statbroadcast_gid as away_gid
      FROM game_ids g
      LEFT JOIN teams ht ON g.home_team_id = ht.team_id
      LEFT JOIN teams at ON g.away_team_id = at.team_id
      WHERE (ht.statbroadcast_gid = 'duke' OR at.statbroadcast_gid = 'duke')
        AND (ht.statbroadcast_gid = 'unc' OR at.statbroadcast_gid = 'unc')
        AND g.sport = 'mens-college-basketball'
      LIMIT 1
    `);
    
    if (!dukeUncGame) {
      console.log('❌ No Duke vs UNC game found in database');
      console.log('Let\'s find any game with both teams in our DB...\n');
      
      // Find any game where both teams exist
      const anyGame = await dbConnection.get(`
        SELECT g.game_id, g.sport, g.game_date,
               ht.team_name as home_team, ht.statbroadcast_gid as home_gid
        FROM game_ids g
        JOIN teams ht ON g.home_team_id = ht.team_id
        WHERE g.sport = 'mens-college-basketball'
        LIMIT 1
      `);
      
      if (!anyGame) {
        console.log('❌ No suitable game found');
        process.exit(1);
      }
      
      console.log(`Found game: ${anyGame.game_id}`);
      console.log(`  Home: ${anyGame.home_team} (${anyGame.home_gid})`);
      console.log(`  Date: ${anyGame.game_date}`);
      console.log(`  Sport: ${anyGame.sport}\n`);
      
      // Use this game for testing
      console.log('We\'ll test with this game by:');
      console.log('1. Deleting it');
      console.log('2. Running populate script with --team=' + anyGame.home_gid);
      console.log('3. Checking if it gets inserted\n');
      
      console.log(`Run these commands:`);
      console.log(`  sqlite3 data/bot.db "DELETE FROM game_ids WHERE game_id = '${anyGame.game_id}'"`);
      console.log(`  node scripts/populate-game-ids.js --team=${anyGame.home_gid} --reset-progress`);
      console.log(`  sqlite3 data/bot.db "SELECT * FROM game_ids WHERE game_id = '${anyGame.game_id}'"`);
      
      process.exit(0);
    }
    
    console.log(`✅ Found Duke vs UNC game: ${dukeUncGame.game_id}`);
    console.log(`  Home: ${dukeUncGame.home_team} (${dukeUncGame.home_gid})`);
    console.log(`  Away: ${dukeUncGame.away_team} (${dukeUncGame.away_gid})`);
    console.log(`  Date: ${dukeUncGame.game_date}`);
    console.log(`  Sport: ${dukeUncGame.sport}\n`);
    
    // Step 2: Delete the game
    console.log('Step 1: Deleting game...');
    await dbConnection.run('DELETE FROM game_ids WHERE game_id = ?', [dukeUncGame.game_id]);
    console.log('✅ Game deleted\n');
    
    // Step 3: Verify it's gone
    const check1 = await dbConnection.get('SELECT * FROM game_ids WHERE game_id = ?', [dukeUncGame.game_id]);
    if (check1) {
      console.log('❌ Game still exists!');
      process.exit(1);
    }
    console.log('✅ Verified game is deleted\n');
    
    console.log('Step 2: Now run these commands to test:\n');
    console.log(`  # Process Duke (should INSERT with away=NULL)`);
    console.log(`  node scripts/populate-game-ids.js --team=duke --reset-progress\n`);
    console.log(`  # Check the game`);
    console.log(`  sqlite3 data/bot.db "SELECT g.*, ht.team_name as home, at.team_name as away FROM game_ids g LEFT JOIN teams ht ON g.home_team_id=ht.team_id LEFT JOIN teams at ON g.away_team_id=at.team_id WHERE g.game_id='${dukeUncGame.game_id}'"\n`);
    console.log(`  # Process UNC (should UPDATE with away=UNC)`);
    console.log(`  node scripts/populate-game-ids.js --team=unc --reset-progress\n`);
    console.log(`  # Check the game again`);
    console.log(`  sqlite3 data/bot.db "SELECT g.*, ht.team_name as home, at.team_name as away FROM game_ids g LEFT JOIN teams ht ON g.home_team_id=ht.team_id LEFT JOIN teams at ON g.away_team_id=at.team_id WHERE g.game_id='${dukeUncGame.game_id}'"\n`);
    
    await dbConnection.close();
    
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
