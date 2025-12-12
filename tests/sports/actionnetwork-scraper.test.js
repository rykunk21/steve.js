const ActionNetworkScraper = require('../src/modules/sports/ActionNetworkScraper');
const BettingSnapshot = require('../src/database/models/BettingSnapshot');

/**
 * Test script to verify ActionNetwork scraping for NCAA Basketball
 */
async function testNCAABasketballOdds() {
  console.log('🏀 Testing ActionNetwork Odds Scraping for NCAA Basketball...\n');
  
  const scraper = new ActionNetworkScraper();
  
  try {
    console.log('📡 Scraping odds from ActionNetwork...');
    const snapshots = await scraper.scrapeOdds('ncaa_basketball');
    await scraper.cleanup();
    
    console.log(`\n✅ Successfully scraped ${snapshots.length} games\n`);
    
    if (snapshots.length === 0) {
      console.log('⚠️  No games found! ActionNetwork may not have NCAA basketball odds today.');
      return;
    }
    
    // Show first 10 games
    console.log('📋 Sample of scraped games:');
    snapshots.slice(0, 10).forEach((snapshot, index) => {
      console.log(`\n${index + 1}. Game ID: ${snapshot.gameId}`);
      console.log(`   Sport: ${snapshot.sport}`);
      
      const summary = snapshot.getDisplaySummary();
      console.log(`   Moneyline: Away ${summary.moneyline.away} | Home ${summary.moneyline.home}`);
      console.log(`   Spread: ${summary.spread.line} (Away ${summary.spread.awayOdds} | Home ${summary.spread.homeOdds})`);
      console.log(`   Total: ${summary.total.line} (Over ${summary.total.overOdds} | Under ${summary.total.underOdds})`);
    });
    
    if (snapshots.length > 10) {
      console.log(`\n... and ${snapshots.length - 10} more games`);
    }
    
    // Test matching with a sample game
    console.log('\n\n🔍 Testing team name matching...');
    console.log('Sample game IDs from ActionNetwork:');
    snapshots.slice(0, 5).forEach(s => {
      console.log(`  - ${s.gameId}`);
    });
    
    console.log('\n💡 To match with ESPN games, the team abbreviations need to align.');
    console.log('   ESPN format: "Notre Dame Fighting Irish @ Kansas Jayhawks"');
    console.log('   ActionNetwork format: "notre_dame_at_kansas" or similar');
    
  } catch (error) {
    console.error('\n❌ Error scraping odds:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the test
testNCAABasketballOdds()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
