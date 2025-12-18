#!/usr/bin/env node

/**
 * Script to seed the teams table with StatBroadcast GIDs
 */

const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

// Sample teams for seeding - this would normally come from a data source
const sampleTeams = [
  { team_id: '150', statbroadcast_gid: 'duke', team_name: 'Duke Blue Devils', sport: 'mens-college-basketball', conference: 'ACC' },
  { team_id: '153', statbroadcast_gid: 'unc', team_name: 'North Carolina Tar Heels', sport: 'mens-college-basketball', conference: 'ACC' },
  { team_id: '120', statbroadcast_gid: 'uk', team_name: 'Kentucky Wildcats', sport: 'mens-college-basketball', conference: 'SEC' },
  { team_id: '96', statbroadcast_gid: 'gonz', team_name: 'Gonzaga Bulldogs', sport: 'mens-college-basketball', conference: 'WCC' }
];

async function seedTeams() {
  try {
    await dbConnection.initialize();
    
    logger.info('Seeding teams table...');
    
    for (const team of sampleTeams) {
      try {
        await dbConnection.run(
          `INSERT OR REPLACE INTO teams (team_id, statbroadcast_gid, team_name, sport, conference) 
           VALUES (?, ?, ?, ?, ?)`,
          [team.team_id, team.statbroadcast_gid, team.team_name, team.sport, team.conference]
        );
        logger.info(`Seeded team: ${team.team_name}`);
      } catch (error) {
        logger.error(`Failed to seed team ${team.team_name}:`, error.message);
      }
    }
    
    const teamCount = await dbConnection.get('SELECT COUNT(*) as count FROM teams');
    logger.info(`Teams table seeded successfully. Total teams: ${teamCount.count}`);
    
    process.exit(0);
  } catch (error) {
    logger.error('Failed to seed teams', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  seedTeams();
}

module.exports = { seedTeams };