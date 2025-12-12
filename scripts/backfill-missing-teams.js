#!/usr/bin/env node

/**
 * Backfill missing teams in game_ids table by fetching XML metadata
 * 
 * This script:
 * 1. Finds all games with NULL home_team_id or away_team_id
 * 2. Fetches XML to get team GIDs
 * 3. Updates the game record with the missing team
 */

const axios = require('axios');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

/**
 * Fetch game metadata from XML
 */
async function fetchGameMetadata(gameId) {
  try {
    const url = `http://archive.statbroadcast.com/${gameId}.xml`;
    const response = await axios.get(url, { timeout: 15000 });
    const xml = response.data;
    
    const homeNameMatch = xml.match(/<venue[^>]*homename="([^"]+)"/);
    const awayNameMatch = xml.match(/<venue[^>]*visname="([^"]+)"/);
    const homeGidMatch = xml.match(/<venue[^>]*homeid="([^"]+)"/);
    const awayGidMatch = xml.match(/<venue[^>]*visid="([^"]+)"/);
    
    if (!homeNameMatch || !awayNameMatch) {
      return null;
    }
    
    return {
      homeTeamName: homeNameMatch[1],
      awayTeamName: awayNameMatch[1],
      homeGid: homeGidMatch ? homeGidMatch[1] : null,
      awayGid: awayGidMatch ? awayGidMatch[1] : null
    };
  } catch (error) {
    logger.warn(`Failed to fetch metadata for game ${gameId}:`, error.message);
    return null;
  }
}

/**
 * Find or create team
 */
async function findOrCreateTeam(teamName, gid, sport) {
  if (!gid) return null;
  
  // Check if team exists
  let team = await dbConnection.get(
    'SELECT team_id FROM teams WHERE statbroadcast_gid = ? AND sport = ?',
    [gid, sport]
  );
  
  if (team) return team.team_id;
  
  // Check by team_id (same school, different GID)
  const teamId = generateTeamId(teamName, sport);
  team = await dbConnection.get(
    'SELECT team_id FROM teams WHERE team_id = ?',
    [teamId]
  );
  
  if (team) return team.team_id;
  
  // Create new team
  try {
    await dbConnection.run(
      `INSERT INTO teams (team_id, statbroadcast_gid, team_name, sport, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [teamId, gid, teamName, sport]
    );
    logger.info(`Created team: ${teamName} (${gid}) for ${sport}`);
    return teamId;
  } catch (error) {
    logger.error(`Failed to create team ${teamName}:`, error.message);
    return null;
  }
}

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

async function main() {
  try {
    logger.info('Starting backfill of missing teams...');
    await dbConnection.initialize();
    
    // Get all incomplete games
    const incompleteGames = await dbConnection.all(`
      SELECT game_id, sport, home_team_id, away_team_id
      FROM game_ids
      WHERE home_team_id IS NULL OR away_team_id IS NULL
      ORDER BY game_id
    `);
    
    logger.info(`Found ${incompleteGames.length} incomplete games`);
    
    let updated = 0;
    let failed = 0;
    let skipped = 0;
    
    for (let i = 0; i < incompleteGames.length; i++) {
      const game = incompleteGames[i];
      
      if ((i + 1) % 100 === 0) {
        logger.info(`Progress: ${i + 1}/${incompleteGames.length} (${updated} updated, ${failed} failed, ${skipped} skipped)`);
      }
      
      // Fetch metadata
      const metadata = await fetchGameMetadata(game.game_id);
      
      if (!metadata) {
        failed++;
        continue;
      }
      
      // Determine which team is missing
      let teamToAdd = null;
      let isHome = false;
      
      if (!game.home_team_id && metadata.homeGid) {
        teamToAdd = await findOrCreateTeam(metadata.homeTeamName, metadata.homeGid, game.sport);
        isHome = true;
      } else if (!game.away_team_id && metadata.awayGid) {
        teamToAdd = await findOrCreateTeam(metadata.awayTeamName, metadata.awayGid, game.sport);
        isHome = false;
      }
      
      if (teamToAdd) {
        const field = isHome ? 'home_team_id' : 'away_team_id';
        await dbConnection.run(
          `UPDATE game_ids SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE game_id = ?`,
          [teamToAdd, game.game_id]
        );
        updated++;
      } else {
        skipped++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    logger.info('Backfill complete');
    logger.info(`Updated: ${updated}, Failed: ${failed}, Skipped: ${skipped}`);
    
    await dbConnection.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('Backfill failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
