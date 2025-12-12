/**
 * Script to fetch StatBroadcast schedule data for test fixtures using Puppeteer
 * This ensures we get the fully rendered HTML with dynamically loaded table data
 * Usage: node scripts/fetch-schedule-fixture.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function fetchScheduleWithPuppeteer(gid) {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Set a reasonable viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    const url = `https://www.statbroadcast.com/events/schedule.php?gid=${gid}`;
    console.log(`Navigating to ${url}...`);
    
    // Navigate and wait for network to be idle
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    console.log('Waiting for table to load...');
    
    // Wait for the DataTable to be initialized and populated
    // The table has id="eventCalendar" and should have tbody with rows
    await page.waitForSelector('#eventCalendar tbody tr', {
      timeout: 15000
    });
    
    // Give it a bit more time to ensure all data is loaded
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get the fully rendered HTML
    const html = await page.content();
    
    // Count how many game rows we got
    const rowCount = await page.evaluate(() => {
      return document.querySelectorAll('#eventCalendar tbody tr').length;
    });
    
    console.log(`✓ Table loaded with ${rowCount} game rows`);
    
    return html;
    
  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    console.log('Fetching Michigan State schedule with Puppeteer...');
    const msuSchedule = await fetchScheduleWithPuppeteer('msu');
    
    // Save to fixtures
    const fixturePath = path.join(__dirname, '../tests/fixtures/statbroadcast-msu-schedule.html');
    fs.writeFileSync(fixturePath, msuSchedule);
    
    console.log(`✓ Saved MSU schedule to ${fixturePath}`);
    console.log(`  Size: ${(msuSchedule.length / 1024).toFixed(2)} KB`);
    
    // Parse out some game IDs for reference
    const gameIdMatches = msuSchedule.match(/statmonitr\.php\?id=(\d+)/g);
    if (gameIdMatches) {
      const gameIds = gameIdMatches
        .map(m => m.match(/id=(\d+)/)[1])
        .filter((id, index, self) => self.indexOf(id) === index) // unique
        .slice(0, 10); // First 10 games
      
      console.log('\nSample game IDs found:');
      gameIds.forEach(id => console.log(`  - ${id}`));
    }
    
    console.log('\n✓ Fixture created successfully with dynamically loaded data!');
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
