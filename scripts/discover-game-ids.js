#!/usr/bin/env node

/**
 * Discover game IDs from StatBroadcast archive - Version 3
 * Directly calls the DataTables AJAX endpoint to get all game data
 */

const axios = require('axios');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { team: null };
  args.forEach(arg => {
    if (arg.startsWith('--team=')) {
      options.team = arg.split('=')[1];
    }
  });
  return options;
}

/**
 * Fetch all game IDs for a team by directly calling the DataTables AJAX endpoint
 */
async function fetchGameIdsForTeam(gid) {
  try {
    logger.info(`Fetching game IDs for team: ${gid}`);
    
    // The DataTables AJAX endpoint URL
    // We need to get the hash from the page first, or try without it
    const baseUrl = 'https://www.statbroadcast.com/scripts/_archive.php';
    
    const gameIds = [];
    let start = 0;
    const length = 100; // Fetch 100 records at a time
    let totalRecords = null;
    
    while (totalRecords === null || start < totalRecords) {
      const params = {
        draw: 1,
        start: start,
        length: length,
        'columns[0][data]': 0,
        'columns[0][name]': '',
        'columns[0][searchable]': 'true',
        'columns[0][orderable]': 'true',
        'columns[0][search][value]': '',
        'columns[0][search][regex]': 'false',
        'columns[1][data]': 1,
        'columns[1][name]': '',
        'columns[1][searchable]': 'true',
        'columns[1][orderable]': 'false',
        'columns[1][search][value]': '',
        'columns[1][search][regex]': 'false',
        'columns[2][data]': 2,
        'columns[2][name]': '',
        'columns[2][searchable]': 'true',
        'columns[2][orderable]': 'false',
        'columns[2][search][value]': '',
        'columns[2][search][regex]': 'false',
        'columns[3][data]': 3,
        'columns[3][name]': '',
        'columns[3][searchable]': 'true',
        'columns[3][orderable]': 'false',
        'columns[3][search][value]': '',
        'columns[3][search][regex]': 'false',
        'order[0][column]': 0,
        'order[0][dir]': 'desc',
        'search[value]': '',
        'search[regex]': 'false',
        gid: gid,
        conf: '',
        tourn: '',
        sports: 'M;bbgame', // Men's Basketball
        startdate: '',
        enddate: '',
        members: '',
        champonly: 0
      };
      
      logger.debug(`Fetching records ${start} to ${start + length} for ${gid}`);
      
      const response = await axios.get(baseUrl, {
        params: params,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': `https://www.statbroadcast.com/events/archive.php?gid=${gid}`
        }
      });
      
      const data = response.data;
      
      if (!data || !data.data) {
        logger.warn(`No data returned for ${gid} at offset ${start}`);
        break;
      }
      
      // Set total records on first request
      if (totalRecords === null) {
        totalRecords = data.recordsFiltered || data.recordsTotal || 0;
        logger.info(`Total records for ${gid}: ${totalRecords}`);
      }
      
      // Extract game IDs from this batch
      data.data.forEach(row => {
        if (row.length >= 4) {
          const linkHtml = row[3];
          // Extract game ID from link HTML
          const match = linkHtml.match(/id=(\d+)/);
          if (match) {
            gameIds.push(match[1]);
          }
        }
      });
      
      logger.info(`Fetched ${gameIds.length}/${totalRecords} game IDs for ${gid}`);
      
      // Move to next batch
      start += length;
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const uniqueGameIds = [...new Set(gameIds)];
    logger.info(`Found ${uniqueGameIds.length} unique games for ${gid}`);
    
    return uniqueGameIds.map(id => ({ gameId: id }));
    
  } catch (error) {
    logger.error(`Failed to fetch game IDs for ${gid}:`, error.message);
    return [];
  }
}

async function fetchGameMetadata(gameId) {
  try {
    const url = `http://archive.statbroadcast.com/${gameId}.xml`;
    const response = await axios.get(url, { timeout: 10000, validateStatus: (status) => status === 200 });
    
    const xml = response.data;
    const homeMatch = xml.match(/<venue[^>]*homeid="([^"]+)"[^>]*homename="([^"]+)"/);
    const awayMatch = xml.match(/<venue[^>]*visid="([^"]+)"[^>]*visname="([^"]+)"/);
    const dateMatch = xml.match(/<venue[^>]*date="([^"]+)"/);
    
    if (!homeMatch || !awayMatch || !dateMatch) {
      return null;
    }
    
    return {
      homeTeam: homeMatch[2],
      awayTeam: awayMatch[2],
      gameDate: dateMatch[1]
    };
  } catch (error) {
    logger.warn(`Failed to fetch metadata for game ${gameId}:`, error.message);
    return null;
  }
}

async function findTeamIdByName(teamName) {
  let team = await dbConnection.get(
    'SELECT team_id FROM teams WHERE LOWER(team_name) = LOWER(?)',
    [teamName]
  );
  
  if (team) return team.team_id;
  
  team = await dbConnection.get(
    'SELECT team_id FROM teams WHERE LOWER(team_name) LIKE LOWER(?)',
    [`%${teamName}%`]
  );
  
  return team ? team.team_id : null;
}

async function processTeam(team) {
  logger.info(`Processing team: ${team.team_name} (${team.statbroadcast_gid})`);
  
  const games = await fetchGameIdsForTeam(team.statbroadcast_gid);
  
  if (games.length === 0) {
    logger.warn(`No games found for ${team.team_name}`);
    return { discovered: 0, inserted: 0, skipped: 0, failed: 0 };
  }
  
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const game of games) {
    try {
      const existing = await dbConnection.get(
        'SELECT game_id FROM game_ids WHERE game_id = ?',
        [game.gameId]
      );
      
      if (existing) {
        skipped++;
        continue;
      }
      
      const metadata = await fetchGameMetadata(game.gameId);
      
      if (!metadata) {
        logger.warn(`No metadata for game ${game.gameId}, using placeholder`);
        await dbConnection.run(
          `INSERT INTO game_ids (game_id, sport, home_team_id, away_team_id, game_date, processed)
           VALUES (?, ?, ?, ?, ?, 0)`,
          [game.gameId, team.sport, team.team_id, team.team_id, '2024-01-01']
        );
        inserted++;
        failed++;
        continue;
      }
      
      const homeTeamId = await findTeamIdByName(metadata.homeTeam) || team.team_id;
      const awayTeamId = await findTeamIdByName(metadata.awayTeam) || team.team_id;
      
      await dbConnection.run(
        `INSERT INTO game_ids (game_id, sport, home_team_id, away_team_id, game_date, processed)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [game.gameId, team.sport, homeTeamId, awayTeamId, metadata.gameDate]
      );
      
      inserted++;
      
      if (inserted % 25 === 0) {
        logger.info(`Progress: ${inserted}/${games.length} for ${team.team_name}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      logger.error(`Failed to process game ${game.gameId}:`, error.message);
      failed++;
    }
  }
  
  return { discovered: games.length, inserted, skipped, failed };
}

async function main() {
  try {
    logger.info('Starting game ID discovery...');
    
    const options = parseArgs();
    await dbConnection.initialize();
    
    let teams;
    if (options.team) {
      const team = await dbConnection.get(
        'SELECT team_id, statbroadcast_gid, team_name, sport FROM teams WHERE statbroadcast_gid = ?',
        [options.team]
      );
      
      if (!team) {
        console.error(`Team not found: ${options.team}`);
        process.exit(1);
      }
      teams = [team];
    } else {
      teams = await dbConnection.all(
        'SELECT team_id, statbroadcast_gid, team_name, sport FROM teams ORDER BY team_name'
      );
    }
    
    logger.info(`Processing ${teams.length} teams`);
    
    let totalDiscovered = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      logger.info(`[${i + 1}/${teams.length}] Processing ${team.team_name}`);
      
      const result = await processTeam(team);
      
      totalDiscovered += result.discovered;
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
      
      logger.info(`Team ${team.team_name} complete: ${result.inserted} inserted, ${result.skipped} skipped, ${result.failed} failed`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Game ID Discovery Complete');
    console.log('='.repeat(60));
    console.log(`Teams processed: ${teams.length}`);
    console.log(`Games discovered: ${totalDiscovered}`);
    console.log(`Games inserted: ${totalInserted}`);
    console.log(`Games skipped (duplicates): ${totalSkipped}`);
    console.log(`Games failed: ${totalFailed}`);
    console.log('='.repeat(60));
    
    const countResult = await dbConnection.get('SELECT COUNT(*) as count FROM game_ids');
    console.log(`\nTotal games in database: ${countResult.count}`);
    
    await dbConnection.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('Script failed:', error);
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
