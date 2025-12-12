#!/usr/bin/env node

/**
 * Discover game IDs from StatBroadcast archive - Version 2
 * Uses network interception to capture AJAX responses
 */

const puppeteer = require('puppeteer');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');
const axios = require('axios');

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

async function scrapeTeamArchive(browser, gid) {
  let page;
  
  try {
    logger.info(`Scraping archive for team: ${gid}`);
    
    page = await browser.newPage();
    
    const url = `https://www.statbroadcast.com/events/archive.php?gid=${gid}`;
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for sports dropdown
    await page.waitForSelector('#sports', { timeout: 10000 });
    
    // Select Men's Basketball
    await page.select('#sports', 'M;bbgame');
    
    // Wait for table to reload
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Wait for table
    await page.waitForSelector('#archiveTable', { timeout: 10000 });
    
    // Override window.open to capture URLs when buttons are clicked
    await page.evaluateOnNewDocument(() => {
      window.capturedUrls = [];
      window.open = function(url, name, specs) {
        window.capturedUrls.push(url);
        return {
          closed: false,
          close: () => {},
          focus: () => {},
          location: { href: url }
        };
      };
    });
    
    // Extract game IDs by clicking all buttons and capturing window.open calls
    const gameIds = await page.evaluate(() => {
      // Reset captured URLs
      window.capturedUrls = [];
      
      // Override window.open
      const originalOpen = window.open;
      window.open = function(url, name, specs) {
        window.capturedUrls.push(url);
        return {
          closed: false,
          close: () => {},
          focus: () => {},
          location: { href: url }
        };
      };
      
      // Find all link buttons in the table
      const buttons = document.querySelectorAll('#archiveTable button.linkbtn');
      
      // Click each button to trigger window.open
      buttons.forEach(button => {
        button.click();
      });
      
      // Extract game IDs from captured URLs
      const gameIds = [];
      window.capturedUrls.forEach(url => {
        const match = url.match(/id=(\d+)/);
        if (match) {
          gameIds.push(match[1]);
        }
      });
      
      // Restore original window.open
      window.open = originalOpen;
      
      return gameIds;
    });
    
    // If we only got the first page, we need to paginate through all pages
    const totalPages = await page.evaluate(() => {
      const pagination = document.querySelector('#archiveTable_paginate');
      if (!pagination) return 1;
      
      const pageButtons = pagination.querySelectorAll('.paginate_button.page-item:not(.previous):not(.next):not(.disabled)');
      let maxPage = 1;
      
      pageButtons.forEach(button => {
        const pageNum = parseInt(button.textContent.trim());
        if (!isNaN(pageNum) && pageNum > maxPage) {
          maxPage = pageNum;
        }
      });
      
      return maxPage;
    });
    
    logger.info(`Found ${totalPages} pages for ${gid}`);
    
    let allGameIds = [...gameIds];
    
    // If there are multiple pages, click through them
    if (totalPages > 1) {
      for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
        logger.debug(`Scraping page ${pageNum}/${totalPages} for ${gid}`);
        
        // Click next button
        try {
          await page.click('#archiveTable_next a');
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Extract game IDs from this page
          const pageGameIds = await page.evaluate(() => {
            window.capturedUrls = [];
            
            const buttons = document.querySelectorAll('#archiveTable button.linkbtn');
            buttons.forEach(button => button.click());
            
            const gameIds = [];
            window.capturedUrls.forEach(url => {
              const match = url.match(/id=(\d+)/);
              if (match) {
                gameIds.push(match[1]);
              }
            });
            
            return gameIds;
          });
          
          allGameIds = allGameIds.concat(pageGameIds);
          
        } catch (error) {
          logger.warn(`Failed to navigate to page ${pageNum} for ${gid}:`, error.message);
          break;
        }
      }
    }
    
    await page.close();
    
    const uniqueGameIds = [...new Set(allGameIds)];
    logger.info(`Found ${uniqueGameIds.length} unique games for ${gid}`);
    
    return uniqueGameIds.map(id => ({ gameId: id }));
    
  } catch (error) {
    logger.error(`Failed to scrape archive for ${gid}:`, error.message);
    if (page) await page.close();
    return [];
  }
}

async function fetchGameMetadata(gameId) {
  try {
    const url = `http://archive.statbroadcast.com/${gameId}.xml`;
    const response = await axios.get(url, { timeout: 10000, validateStatus: (status) => status === 200 });
    
    const xml = response.data;
    const homeMatch = xml.match(/<home[^>]*name="([^"]+)"/);
    const awayMatch = xml.match(/<visitor[^>]*name="([^"]+)"/);
    const dateMatch = xml.match(/<game[^>]*date="([^"]+)"/);
    
    if (!homeMatch || !awayMatch || !dateMatch) {
      return null;
    }
    
    return {
      homeTeam: homeMatch[1],
      awayTeam: awayMatch[1],
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

async function processTeam(browser, team) {
  logger.info(`Processing team: ${team.team_name} (${team.statbroadcast_gid})`);
  
  const games = await scrapeTeamArchive(browser, team.statbroadcast_gid);
  
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
      
      if (inserted % 10 === 0) {
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
  let browser;
  
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
    
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    let totalDiscovered = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      logger.info(`[${i + 1}/${teams.length}] Processing ${team.team_name}`);
      
      const result = await processTeam(browser, team);
      
      totalDiscovered += result.discovered;
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
      
      logger.info(`Team ${team.team_name} complete: ${result.inserted} inserted, ${result.skipped} skipped, ${result.failed} failed`);
    }
    
    await browser.close();
    
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
    
    if (browser) await browser.close();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
