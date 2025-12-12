#!/usr/bin/env node

/**
 * Seed teams table with multi-sport entries from statbroadcast-gids.json
 * 
 * This creates team entries for all major sports using the basketball GIDs
 * as the base, dramatically speeding up the populate-game-ids script by
 * reducing XML lookups.
 */

const fs = require('fs');
const path = require('path');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

// Common college sports that use StatBroadcast
const SPORTS = [
  'mens-college-basketball',
  'womens-college-basketball',
  'college-football',
  'mens-soccer',
  'womens-soccer',
  'womens-volleyball',
  'mens-ice-hockey',
  'womens-ice-hockey',
  'college-baseball',
  'college-softball',
  'mens-tennis',
  'womens-tennis',
  'mens-tennis',
  'womens-tennis'
];

function generateTeamId(teamName, sport) {
  const nameSlug = teamName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  const sportSlug = sport
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  return `${nameSlug}-${sportSlug}`;
}

async function seedMultiSportTeams() {
  try {
    logger.info('Starting multi-sport team seeding...');
    
    await dbConnection.initialize();
    
    // Load basketball teams
    const gidsFile = path.join(__dirname, '../data/statbroadcast-gids.json');
    const gidsData = JSON.parse(fs.readFileSync(gidsFile, 'utf8'));
    
    logger.info(`Loaded ${gidsData.length} basketball teams`);
    
    let created = 0;
    let skipped = 0;
    let failed = 0;
    
    // For each basketball team, create entries for all sports
    for (const team of gidsData) {
      for (const sport of SPORTS) {
        const teamId = generateTeamId(team.teamName, sport);
        
        try {
          // Check if already exists
          const existing = await dbConnection.get(
            'SELECT team_id FROM teams WHERE statbroadcast_gid = ? AND sport = ?',
            [team.statbroadcastGid, sport]
          );
          
          if (existing) {
            skipped++;
            continue;
          }
          
          // Insert team
          await dbConnection.run(
            `INSERT INTO teams (team_id, statbroadcast_gid, team_name, sport, created_at, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [teamId, team.statbroadcastGid, team.teamName, sport]
          );
          
          created++;
          
          if (created % 100 === 0) {
            logger.info(`Progress: ${created} created, ${skipped} skipped`);
          }
          
        } catch (error) {
          if (error.message.includes('UNIQUE constraint')) {
            skipped++;
          } else {
            logger.error(`Failed to create ${team.teamName} (${sport}):`, error.message);
            failed++;
          }
        }
      }
    }
    
    logger.info('Multi-sport team seeding complete');
    logger.info(`Created: ${created}, Skipped: ${skipped}, Failed: ${failed}`);
    
    await dbConnection.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  seedMultiSportTeams();
}

module.exports = seedMultiSportTeams;
