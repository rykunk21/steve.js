#!/usr/bin/env node

/**
 * Scrape StatBroadcast GIDs for NCAA Basketball teams
 * Fetches team list from https://www.statbroadcast.com/events/
 * Run with: node scripts/scrape-statbroadcast-gids.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');

async function scrapeStatBroadcastGids() {
  let browser;
  
  try {
    logger.info('Starting StatBroadcast GID scraper...');
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Navigate to StatBroadcast events page
    logger.info('Navigating to StatBroadcast events page...');
    await page.goto('https://www.statbroadcast.com/events/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Save raw HTML for analysis
    const htmlContent = await page.content();
    const htmlPath = path.join(__dirname, '../temp/statbroadcast-events-page.html');
    fs.writeFileSync(htmlPath, htmlContent);
    logger.info(`Saved raw HTML to ${htmlPath}`);
    
    // Wait for the list selector to load (with longer timeout)
    try {
      await page.waitForSelector('#list', { timeout: 5000 });
    } catch (e) {
      logger.warn('Could not find #list, trying alternative selectors...');
    }
    
    logger.info('Extracting team GIDs...');
    
    // Extract all team links and GIDs
    const teams = await page.evaluate(() => {
      const results = [];
      
      // Find all links with statmonitr.php?gid= (individual schools)
      const schoolLinks = document.querySelectorAll('a[href*="statmonitr.php?gid="]');
      
      console.log(`Found ${schoolLinks.length} school links`);
      
      schoolLinks.forEach(link => {
        const href = link.getAttribute('href');
        
        // Find the school-name div within this link
        const schoolNameDiv = link.querySelector('.school-name');
        
        if (schoolNameDiv) {
          const teamName = schoolNameDiv.textContent.trim();
          
          // Extract GID from URL (e.g., statmonitr.php?gid=umich)
          const gidMatch = href.match(/gid=([^&]+)/);
          
          if (gidMatch && teamName && teamName.length > 0) {
            // Filter out non-team entries
            if (teamName !== 'bd Global' && teamName !== 'Demos') {
              results.push({
                teamName: teamName,
                statbroadcastGid: gidMatch[1],
                sport: 'mens-college-basketball'
              });
            }
          }
        }
      });
      
      console.log(`Extracted ${results.length} teams`);
      
      return results;
    });
    
    logger.info(`Found ${teams.length} teams with GIDs`);
    
    // Sort teams alphabetically by name
    teams.sort((a, b) => a.teamName.localeCompare(b.teamName));
    
    // Save to JSON file
    const outputPath = path.join(__dirname, '../data/statbroadcast-gids.json');
    fs.writeFileSync(outputPath, JSON.stringify(teams, null, 2));
    
    logger.info(`Saved GIDs to ${outputPath}`);
    
    // Print summary
    console.log('\n=== StatBroadcast GID Summary ===');
    console.log(`Total teams found: ${teams.length}`);
    console.log('\nSample teams:');
    teams.slice(0, 10).forEach(team => {
      console.log(`  ${team.teamName} -> ${team.statbroadcastGid}`);
    });
    
    if (teams.length > 10) {
      console.log(`  ... and ${teams.length - 10} more`);
    }
    
    console.log(`\nFull list saved to: ${outputPath}`);
    
    await browser.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('Failed to scrape StatBroadcast GIDs:', error);
    
    if (browser) {
      await browser.close();
    }
    
    process.exit(1);
  }
}

// Run scraper if this file is executed directly
if (require.main === module) {
  scrapeStatBroadcastGids();
}

module.exports = scrapeStatBroadcastGids;
