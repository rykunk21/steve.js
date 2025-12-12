const ESPNAPIClient = require('../src/modules/sports/ESPNAPIClient');

/**
 * Test the full game log flow for NCAA Basketball
 */
async function testGameLogFlow() {
  console.log('🏀 Testing Game Log Manager Flow for NCAA Basketball\n');
  
  const espnClient = new ESPNAPIClient();
  
  try {
    console.log('📡 Fetching games via getUpcomingGames (same method used by update-game-logs)...\n');
    
    const games = await espnClient.getUpcomingGames('ncaa_basketball');
    
    console.log(`✅ Successfully fetched ${games.length} games\n`);
    
    // Filter to today's games (same logic as GameLogManager)
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    
    const todaysGames = games.filter(game => {
      const gameDate = new Date(game.date);
      return gameDate >= todayStart && gameDate < todayEnd;
    });
    
    console.log(`📊 Statistics:`);
    console.log(`   Total games fetched: ${games.length}`);
    console.log(`   Games for today: ${todaysGames.length}`);
    console.log(`   Games on other days: ${games.length - todaysGames.length}\n`);
    
    // Show sample games in the format they'll appear in Discord
    console.log('📋 Sample games (as they will appear in Discord):\n');
    todaysGames.slice(0, 10).forEach((game, index) => {
      const gameTime = new Date(game.date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });
      
      const awayTeam = game.teams.away?.abbreviation || game.teams.away?.name || 'TBD';
      const homeTeam = game.teams.home?.abbreviation || game.teams.home?.name || 'TBD';
      
      console.log(`   ${index + 1}. ${awayTeam} @ ${homeTeam} - ${gameTime}`);
      console.log(`      Display: ${game.displayName}`);
      console.log(`      ID: ${game.id}`);
      console.log(`      URL: ${game.espnUrl}\n`);
    });
    
    if (todaysGames.length > 10) {
      console.log(`   ... and ${todaysGames.length - 10} more games\n`);
    }
    
    console.log('✅ Game Log Manager flow test completed successfully!');
    console.log('\n🎯 This is exactly what will be displayed when you run:');
    console.log('   /update-game-logs sport:NCAA Basketball\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testGameLogFlow()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
