#!/usr/bin/env node

/**
 * Fetch historical games for teams using StatBroadcast archive
 * For each team GID, scrapes archive page and fetches game XMLs
 * Run with: node scripts/fetch-team-games.js [--team=duke] [--limit=10]
 */

const puppeteer = require('puppeteer');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const HistoricalGameRepository = require('../src/database/repositories/HistoricalGameRepository');
const XMLGameParser = require('../src/modules/sports/XMLGameParser');
const axios = require('axios');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    team: null,
    limit: null,
    season: '2024-25' // Current season
  };

  args.forEach(arg => {
    if (arg.startsWith('--team=')) {
      options.team = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--season=')) {
      options.season = arg.split('=')[1];
    }
  });

  return options;
}

/**
 * Scrape game IDs from team schedule page
 */
async function scrapeTeamArchive(gid, season) {
  let browser;
  
  try {
    logger.info('Scraping team schedule', { gid, season });
    
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    const url = `https://www.statbroadcast.com/events/schedule.php?gid=${gid}`;
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Save HTML for debugging
    const htmlContent = await page.content();
    const fs = require('fs');
    const path = require('path');
    const htmlPath = path.join(__dirname, '../temp/statbroadcast-schedule-' + gid + '.html');
    fs.writeFileSync(htmlPath, htmlContent);
    logger.info('Saved schedule HTML', { path: htmlPath });
    
    // Extract game links from table
    const gameIds = await page.evaluate(() => {
      const results = [];
      
      // Look for all links that might contain game IDs
      // StatBroadcast uses various URL patterns for games
      const allLinks = document.querySelectorAll('a[href]');
      
      allLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        // Look for boxscore, recap, or direct game links
        // Game IDs are typically 7+ digit numbers
        if (href.includes('boxscore') || href.includes('recap') || href.includes('statbroadcast.com')) {
          const match = href.match(/(\d{7,})/);
          if (match) {
            const gameId = match[1];
            const text = link.textContent.trim();
            
            // Avoid duplicates
            if (!results.find(r => r.gameId === gameId)) {
              results.push({
                gameId: gameId,
                text: text,
                href: href
              });
            }
          }
        });
      });
      
      return results;
    });
    
    await browser.close();
    
    logger.info('Scraped game IDs from schedule', {
      gid,
      gamesFound: gameIds.length
    });
    
    return gameIds;
    
  } catch (error) {
    logger.error('Failed to scrape team schedule', {
      gid,
      error: error.message
    });
    
    if (browser) {
      await browser.close();
    }
    
    return [];
  }
}

/**
 * Fetch and parse game XML
 */
async function fetchGameXML(gameId) {
  try {
    const url = `http://archive.statbroadcast.com/${gameId}.xml`;
    
    logger.debug('Fetching game XML', { gameId, url });
    
    const response = await axios.get(url, {
      timeout: 10000,
      validateStatus: (status) => status === 200
    });
    
    return response.data;
    
  } catch (error) {
    logger.warn('Failed to fetch game XML', {
      gameId,
      error: error.message
    });
    return null;
  }
}

/**
 * Process games for a team
 */
async function processTeamGames(team, options) {
  const xmlParser = new XMLGameParser();
  const historicalGameRepo = new HistoricalGameRepository();
  
  logger.info('Processing games for team', {
    teamName: team.teamName,
    gid: team.statbroadcastGid
  });
  
  // Scrape archive page
  const gameIds = await scrapeTeamArchive(team.statbroadcastGid, options.season);
  
  if (gameIds.length === 0) {
    logger.warn('No games found for team', { teamName: team.teamName });
    return { processed: 0, failed: 0 };
  }
  
  // Limit if specified
  const gamesToProcess = options.limit 
    ? gameIds.slice(0, options.limit) 
    : gameIds;
  
  logger.info('Processing games', {
    teamName: team.teamName,
    totalGames: gameIds.length,
    processing: gamesToProcess.length
  });
  
  let processed = 0;
  let failed = 0;
  
  for (const game of gamesToProcess) {
    try {
      // Check if already processed
      const existing = await historicalGameRepo.findById(game.gameId);
      if (existing) {
        logger.debug('Game already processed, skipping', { gameId: game.gameId });
        continue;
      }
      
      // Fetch XML
      const xmlData = await fetchGameXML(game.gameId);
      if (!xmlData) {
        failed++;
        continue;
      }
      
      // Parse XML
      const parsedGame = xmlParser.parseGameXML(xmlData);
      if (!parsedGame || !parsedGame.metadata) {
        logger.warn('Failed to parse game XML', { gameId: game.gameId });
        failed++;
        continue;
      }
      
      // Save to database
      await historicalGameRepo.saveGameWithStatBroadcast(
        game.gameId,
        game.gameId,
        parsedGame
      );
      
      processed++;
      logger.info('Processed game', {
        gameId: game.gameId,
        homeTeam: parsedGame.metadata.home,
        awayTeam: parsedGame.metadata.visitor,
        date: parsedGame.metadata.date
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      logger.error('Failed to process game', {
        gameId: game.gameId,
        error: error.message
      });
      failed++;
    }
  }
  
  return { processed, failed };
}

/**
 * Main function
 */
async function main() {
  try {
    logger.info('Starting team games fetch...');
    
    const options = parseArgs();
    
    // Initialize database
    await dbConnection.initialize();
    
    const teamRepo = new TeamRepository();
    
    // Get teams to process
    let teams;
    if (options.team) {
      // Process specific team
      const team = await teamRepo.getTeamByStatBroadcastGid(options.team);
      if (!team) {
        console.error(`Team not found: ${options.team}`);
        process.exit(1);
      }
      teams = [team];
    } else {
      // Process all teams
      teams = await teamRepo.getTeamsBySport('mens-college-basketball');
    }
    
    logger.info('Processing teams', { count: teams.length });
    
    let totalProcessed = 0;
    let totalFailed = 0;
    
    for (const team of teams) {
      const result = await processTeamGames(team, options);
      totalProcessed += result.processed;
      totalFailed += result.failed;
    }
    
    console.log('\n=== Summary ===');
    console.log(`Teams processed: ${teams.length}`);
    console.log(`Games processed: ${totalProcessed}`);
    console.log(`Games failed: ${totalFailed}`);
    
    await dbConnection.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('Script failed:', error);
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = main;
