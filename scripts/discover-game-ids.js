#!/usr/bin/env node

/**
 * Discover game IDs from StatBroadcast archive
 * Fetches game IDs by directly calling the DataTables AJAX endpoint
 * 
 * Usage:
 *   node scripts/discover-game-ids.js                    # Process all teams
 *   node scripts/discover-game-ids.js --team=duke        # Process single team
 */

const axios = require('axios');
const puppeteer = require('puppeteer');
const qs = require('qs');
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
 * Capture live AJAX parameters from StatBroadcast archive page using Puppeteer
 * @param {string} gid - StatBroadcast GID (e.g., 'duke', 'msu')
 * @returns {Promise<{time: string, hash: string, body: object, headers: object}|null>}
 */
async function getLiveAjaxParams(gid) {
  let browser = null;
  try {
    logger.info(`Launching Puppeteer to capture AJAX params for ${gid}`);
    
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    let captured = null;
    
    // Intercept network requests to capture the AJAX call
    page.on('request', req => {
      const url = req.url();
      if (url.includes('_archive.php')) {
        const parsed = new URL(url);
        captured = {
          time: parsed.searchParams.get('time'),
          hash: parsed.searchParams.get('hash'),
          body: req.postData(),
          headers: req.headers()
        };
        logger.debug(`Captured AJAX params: time=${captured.time}, hash=${captured.hash}`);
      }
    });
    
    // Load the archive page and wait for the AJAX request to fire
    await page.goto(
      `https://www.statbroadcast.com/events/archive.php?gid=${gid}`,
      { waitUntil: 'networkidle2', timeout: 30000 }
    );
    
    await browser.close();
    browser = null;
    
    if (!captured || !captured.time || !captured.hash) {
      logger.error(`Failed to capture AJAX params for ${gid}`);
      return null;
    }
    
    return captured;
    
  } catch (error) {
    logger.error(`Puppeteer error for ${gid}:`, error.message);
    if (browser) {
      await browser.close();
    }
    return null;
  }
}

/**
 * Fetch all game IDs for a team using Puppeteer to capture live AJAX parameters
 * @param {string} gid - StatBroadcast GID (e.g., 'duke', 'msu')
 * @returns {Promise<Array<{gameId: string}>>} Array of game ID objects
**/
async function fetchGameIdsForTeam(gid) {
  try {
    logger.info(`Fetching game IDs for team: ${gid}`);

    // Step 1: Launch Puppeteer to capture the actual AJAX request
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    let capturedRequest = null;

    page.on('request', req => {
      const url = req.url();
      if (url.includes('_archive.php') && req.method() === 'POST') {
        capturedRequest = {
          url,
          body: req.postData(),
          headers: req.headers()
        };
        logger.debug(`Captured AJAX request: ${url}`);
      }
    });

    await page.goto(`https://www.statbroadcast.com/events/archive.php?gid=${gid}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await browser.close();

    if (!capturedRequest) {
      logger.error(`No AJAX request captured for ${gid}`);
      return [];
    }

    const baseBody = qs.parse(capturedRequest.body);
    logger.debug(`Captured POST body keys: ${Object.keys(baseBody).join(', ')}`);

    // Step 2: Paginate through records
    const gameIds = [];
    let start = 0;
    const length = 100;
    let totalRecords = null;

    while (totalRecords === null || start < totalRecords) {
      const body = {
        ...baseBody,
        draw: 1,
        start,
        length,
        gid,
        sports: 'M;bbgame',
      };

      logger.debug(`Fetching records ${start} to ${start + length} for ${gid}`);

      const response = await axios.post(
        capturedRequest.url, 
        qs.stringify(body),
        {
          headers: {
            ...capturedRequest.headers,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          timeout: 30000
        }
      );

      const data = response.data;
      logger.debug(`Raw response for ${gid}, offset ${start}: ${JSON.stringify(data).substring(0, 1000)}`);

      if (!data || !data.data) {
        logger.warn(`No data returned for ${gid} at offset ${start}`);
        break;
      }

      if (totalRecords === null) {
        totalRecords = data.recordsFiltered || data.recordsTotal || 0;
        logger.info(`Total records for ${gid}: ${totalRecords}`);
      }

      data.data.forEach(row => {
        if (row.eventlink && row.eventdate) {
          const match = row.eventlink.match(/id=(\d+)/);
          if (match) {
            // Convert MM/DD/YYYY to YYYY-MM-DD for SQLite DATE format
            const [month, day, year] = row.eventdate.split('/');
            const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            
            gameIds.push({
              gameId: match[1],
              eventDate: formattedDate,
              sport: row.sport || 'Unknown'
            });
          }
        }
      });

      start += length;
      await new Promise(resolve => setTimeout(resolve, 1000)); // rate limit
    }

    // Deduplicate by gameId
    const uniqueGames = Array.from(
      new Map(gameIds.map(game => [game.gameId, game])).values()
    );
    logger.info(`Found ${uniqueGames.length} unique games for ${gid}`);
    return uniqueGames;

  } catch (error) {
    logger.error(`Failed to fetch game IDs for ${gid}:`, error.message);
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data: ${JSON.stringify(error.response.data).substring(0, 500)}`);
    }
    return [];
  }
}

/**
 * Fetch game metadata from StatBroadcast XML archive
 * @param {string} gameId - Game ID
 * @returns {Promise<{homeTeam: string, awayTeam: string, gameDate: string}|null>}
 */
async function fetchGameMetadata(gameId) {
  try {
    const url = `http://archive.statbroadcast.com/${gameId}.xml`;
    const response = await axios.get(url, { 
      timeout: 10000, 
      validateStatus: (status) => status === 200 
    });
    
    const xml = response.data;
    
    // Parse XML to extract team names and date
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

/**
 * Find team ID by team name (fuzzy matching)
 * @param {string} teamName - Team name from XML
 * @returns {Promise<string|null>} Team ID or null
 */
async function findTeamIdByName(teamName) {
  // Try exact match first
  let team = await dbConnection.get(
    'SELECT team_id FROM teams WHERE LOWER(team_name) = LOWER(?)',
    [teamName]
  );
  
  if (team) return team.team_id;
  
  // Try partial match
  team = await dbConnection.get(
    'SELECT team_id FROM teams WHERE LOWER(team_name) LIKE LOWER(?)',
    [`%${teamName}%`]
  );
  
  return team ? team.team_id : null;
}

/**
 * Process a single team: fetch game IDs and store in database
 * @param {Object} team - Team object with team_id, statbroadcast_gid, team_name, sport
 * @returns {Promise<{discovered: number, inserted: number, skipped: number, failed: number}>}
 */
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
      // Check if game already exists
      const existing = await dbConnection.get(
        'SELECT game_id FROM game_ids WHERE game_id = ?',
        [game.gameId]
      );
      
      if (existing) {
        skipped++;
        continue;
      }
      
      // Use eventDate from AJAX response and placeholder team IDs
      // We'll fetch actual team names from XML later when processing games
      await dbConnection.run(
        `INSERT INTO game_ids (game_id, sport, home_team_id, away_team_id, game_date, processed)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [game.gameId, game.sport, team.team_id, team.team_id, game.eventDate]
      );
      
      inserted++;
      
      if (inserted % 100 === 0) {
        logger.info(`Progress: ${inserted}/${games.length} for ${team.team_name}`);
      }
      
    } catch (error) {
      logger.error(`Failed to process game ${game.gameId}:`, error.message);
      failed++;
    }
  }
  
  return { discovered: games.length, inserted, skipped, failed };
}

/**
 * Main function
 */
async function main() {
  try {
    logger.info('Starting game ID discovery...');
    
    const options = parseArgs();
    await dbConnection.initialize();
    
    // Get teams to process
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
    
    // Process each team
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
    
    // Print summary
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

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = main;
