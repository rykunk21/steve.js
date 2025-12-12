#!/usr/bin/env node

/**
 * Script to clear and reseed the teams table from statbroadcast-gids.json
 * 
 * This script:
 * 1. Clears all existing teams from the database
 * 2. Loads teams from data/statbroadcast-gids.json
 * 3. Creates team records with proper team_id, statbroadcast_gid, and team_name
 * 4. Initializes statistical_representation as NULL for all teams
 * 5. Logs seeding statistics
 */

const fs = require('fs');
const path = require('path');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

/**
 * Convert team name to team_id format (kebab-case)
 * Examples:
 *   "Duke" -> "duke"
 *   "North Carolina" -> "north-carolina"
 *   "Texas A&M" -> "texas-am"
 */
function teamNameToId(teamName) {
  return teamName
    .toLowerCase()
    .replace(/&/g, '') // Remove ampersands
    .replace(/[()]/g, '') // Remove parentheses
    .replace(/[.']/g, '') // Remove periods and apostrophes
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .trim();
}

async function reseedTeams() {
  try {
    logger.info('Starting teams table reseed...');
    
    // Initialize database connection
    await dbConnection.initialize();
    
    // Load teams from JSON file
    const gidsFilePath = path.join(__dirname, '../data/statbroadcast-gids.json');
    if (!fs.existsSync(gidsFilePath)) {
      throw new Error(`StatBroadcast GIDs file not found: ${gidsFilePath}`);
    }
    
    const teamsData = JSON.parse(fs.readFileSync(gidsFilePath, 'utf-8'));
    logger.info(`Loaded ${teamsData.length} teams from statbroadcast-gids.json`);
    
    // Clear existing teams table
    logger.info('Clearing existing teams table...');
    const deleteResult = await dbConnection.run('DELETE FROM teams');
    logger.info(`Deleted ${deleteResult.changes} existing teams`);
    
    // Insert new teams
    logger.info('Inserting teams...');
    let successCount = 0;
    let failureCount = 0;
    const failures = [];
    
    for (const team of teamsData) {
      try {
        const teamId = teamNameToId(team.teamName);
        
        await dbConnection.run(
          `INSERT INTO teams (team_id, statbroadcast_gid, team_name, sport, statistical_representation, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [teamId, team.statbroadcastGid, team.teamName, team.sport]
        );
        
        successCount++;
        
        if (successCount % 50 === 0) {
          logger.info(`Progress: ${successCount}/${teamsData.length} teams inserted`);
        }
      } catch (error) {
        failureCount++;
        failures.push({
          team: team.teamName,
          gid: team.statbroadcastGid,
          error: error.message
        });
        logger.error(`Failed to insert team ${team.teamName} (${team.statbroadcastGid}):`, error.message);
      }
    }
    
    // Log final statistics
    logger.info('='.repeat(60));
    logger.info('Teams table reseed completed');
    logger.info(`Total teams processed: ${teamsData.length}`);
    logger.info(`Successfully inserted: ${successCount}`);
    logger.info(`Failed: ${failureCount}`);
    logger.info('='.repeat(60));
    
    if (failures.length > 0) {
      logger.warn('Failed teams:');
      failures.forEach(f => {
        logger.warn(`  - ${f.team} (${f.gid}): ${f.error}`);
      });
    }
    
    // Verify the results
    const countResult = await dbConnection.get('SELECT COUNT(*) as count FROM teams');
    logger.info(`Verification: ${countResult.count} teams in database`);
    
    // Show sample of inserted teams
    const sampleTeams = await dbConnection.all(
      'SELECT team_id, statbroadcast_gid, team_name, statistical_representation FROM teams LIMIT 5'
    );
    logger.info('Sample teams:');
    sampleTeams.forEach(team => {
      logger.info(`  - ${team.team_name} (${team.team_id}) -> GID: ${team.statbroadcast_gid}, Features: ${team.statistical_representation || 'NULL'}`);
    });
    
    await dbConnection.close();
    process.exit(failureCount > 0 ? 1 : 0);
    
  } catch (error) {
    logger.error('Teams reseed failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  reseedTeams();
}

module.exports = reseedTeams;
