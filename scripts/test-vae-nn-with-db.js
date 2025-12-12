#!/usr/bin/env node

/**
 * Test VAE-NN betting recommendations with proper database initialization
 * 
 * This script properly initializes the database connection and tests the VAE-NN system
 * in a realistic environment.
 */

const path = require('path');
const logger = require('../src/utils/logger');

// Database connection will be imported inside the function
const ESPNAPIClient = require('../src/modules/sports/ESPNAPIClient');
const BettingRecommendationEngine = require('../src/modules/sports/BettingRecommendationEngine');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const VAEFeedbackTrainer = require('../src/modules/sports/VAEFeedbackTrainer');
const VariationalAutoencoder = require('../src/modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('../src/modules/sports/TransitionProbabilityNN');

/**
 * Test VAE-NN system with proper database setup
 */
async function testVAENNWithDatabase() {
  const startTime = Date.now();
  let dbConnection = null;
  
  try {
    logger.info('Testing VAE-NN system with database initialization');
    
    // Step 1: Initialize database connection
    logger.info('Initializing database connection...');
    dbConnection = require('../src/database/connection');
    await dbConnection.initialize();
    logger.info('Database connection initialized successfully');
    
    // Step 2: Initialize components with database
    const espnClient = new ESPNAPIClient();
    const teamRepository = new TeamRepository();
    
    // Step 3: Check if we have any teams in the database
    logger.info('Checking existing teams in database...');
    const existingTeams = await teamRepository.getTeamsBySport('mens-college-basketball');
    logger.info(`Found ${existingTeams.length} teams in database`);
    
    if (existingTeams.length === 0) {
      logger.info('No teams found in database. This is expected for a fresh setup.');
      logger.info('The VAE-NN system will fall back to traditional methods.');
    } else {
      // Check if any teams have statistical representations
      const teamsWithStats = existingTeams.filter(team => team.statisticalRepresentation);
      logger.info(`Found ${teamsWithStats.length} teams with statistical representations`);
      
      if (teamsWithStats.length > 0) {
        // Show sample team data
        const sampleTeam = teamsWithStats[0];
        logger.info('Sample team with statistical representation:', {
          teamId: sampleTeam.teamId,
          teamName: sampleTeam.teamName,
          hasStats: !!sampleTeam.statisticalRepresentation
        });
      }
    }
    
    // Step 4: Initialize VAE-NN system
    logger.info('Initializing VAE-NN system...');
    const vae = new VariationalAutoencoder(80, 16); // inputDim, latentDim
    const transitionNN = new TransitionProbabilityNN(10); // gameContextDim
    
    const vaeNNSystem = new VAEFeedbackTrainer(vae, transitionNN, {
      feedbackThreshold: 0.5,
      initialAlpha: 0.1,
      alphaDecayRate: 0.99
    });
    
    // Step 5: Initialize betting recommendation engine
    const recommendationEngine = new BettingRecommendationEngine({
      vaeNNSystem: vaeNNSystem,
      teamRepository: teamRepository,
      espnClient: espnClient,
      preferVAENN: true,
      includeUncertaintyMetrics: true,
      iterations: 1000 // Reduced for testing
    });
    
    logger.info('VAE-NN system initialized successfully');
    
    // Step 6: Check VAE-NN availability
    const vaeNNStatus = recommendationEngine.getConfiguration();
    logger.info('VAE-NN system status:', {
      vaeNNAvailable: vaeNNStatus.vaeNNAvailable,
      preferVAENN: vaeNNStatus.preferVAENN,
      includeUncertaintyMetrics: vaeNNStatus.includeUncertaintyMetrics
    });
    
    // Step 7: Fetch today's games
    logger.info('Fetching today\'s NCAA basketball games...');
    const todaysGames = await espnClient.getTodaysGames('ncaa_basketball');
    
    if (!todaysGames || todaysGames.length === 0) {
      logger.info('No NCAA basketball games found for today');
      return {
        success: true,
        gamesProcessed: 0,
        recommendations: [],
        message: 'No games scheduled for today',
        databaseStatus: 'connected',
        teamsInDatabase: existingTeams.length
      };
    }
    
    logger.info(`Found ${todaysGames.length} NCAA basketball games for today`);
    
    // Step 8: Test with first game only
    const testGame = todaysGames[0];
    logger.info(`Testing with game: ${testGame.shortName || testGame.name}`, {
      gameId: testGame.id,
      homeTeam: testGame.teams?.home?.abbreviation,
      awayTeam: testGame.teams?.away?.abbreviation,
      homeTeamId: testGame.teams?.home?.id,
      awayTeamId: testGame.teams?.away?.id
    });
    
    // Step 9: Check if we have team data for this specific game
    let homeTeamData = null;
    let awayTeamData = null;
    
    if (testGame.teams?.home?.id) {
      try {
        homeTeamData = await teamRepository.getTeamByEspnId(testGame.teams.home.id);
        logger.info(`Home team data: ${homeTeamData ? 'Found' : 'Not found'}`, {
          teamId: testGame.teams.home.id,
          teamName: testGame.teams.home.name
        });
      } catch (error) {
        logger.warn('Error checking home team data:', error.message);
      }
    }
    
    if (testGame.teams?.away?.id) {
      try {
        awayTeamData = await teamRepository.getTeamByEspnId(testGame.teams.away.id);
        logger.info(`Away team data: ${awayTeamData ? 'Found' : 'Not found'}`, {
          teamId: testGame.teams.away.id,
          teamName: testGame.teams.away.name
        });
      } catch (error) {
        logger.warn('Error checking away team data:', error.message);
      }
    }
    
    // Step 10: Generate recommendation
    const gameData = {
      id: testGame.id,
      sport: 'ncaa_basketball',
      date: new Date(testGame.date),
      neutralSite: testGame.neutralSite || false,
      teams: {
        home: {
          id: testGame.teams?.home?.id,
          name: testGame.teams?.home?.name,
          abbreviation: testGame.teams?.home?.abbreviation,
          logo: testGame.teams?.home?.logo
        },
        away: {
          id: testGame.teams?.away?.id,
          name: testGame.teams?.away?.name,
          abbreviation: testGame.teams?.away?.abbreviation,
          logo: testGame.teams?.away?.logo
        }
      },
      venue: testGame.venue
    };
    
    const bettingOdds = getDefaultBettingOdds();
    
    logger.info('Generating recommendation with database-connected system...');
    const recStartTime = Date.now();
    const recommendation = await recommendationEngine.generateRecommendation(gameData, bettingOdds);
    const recDuration = Date.now() - recStartTime;
    
    const totalDuration = Date.now() - startTime;
    
    // Step 11: Display comprehensive results
    displayDatabaseTestResults({
      game: testGame,
      recommendation: recommendation,
      processingTimeMs: recDuration,
      totalDurationMs: totalDuration,
      databaseStatus: {
        connected: true,
        totalTeams: existingTeams.length,
        teamsWithStats: existingTeams.filter(t => t.statisticalRepresentation).length,
        homeTeamFound: !!homeTeamData,
        awayTeamFound: !!awayTeamData,
        homeTeamHasStats: homeTeamData?.statisticalRepresentation ? true : false,
        awayTeamHasStats: awayTeamData?.statisticalRepresentation ? true : false
      },
      vaeNNStatus: vaeNNStatus
    });
    
    return {
      success: true,
      gamesProcessed: 1,
      recommendation: recommendation,
      databaseStatus: 'connected',
      teamsInDatabase: existingTeams.length,
      vaeNNUsed: recommendation.method === 'VAE-NN'
    };
    
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    logger.error('Failed to test VAE-NN system with database', {
      error: error.message,
      stack: error.stack,
      durationMs: totalDuration
    });
    
    return {
      success: false,
      error: error.message,
      gamesProcessed: 0,
      databaseStatus: dbConnection?.isConnected ? 'connected' : 'failed'
    };
    
  } finally {
    // Clean up database connection
    if (dbConnection && dbConnection.isReady()) {
      try {
        await dbConnection.close();
        logger.info('Database connection closed');
      } catch (error) {
        logger.warn('Error closing database connection:', error.message);
      }
    }
  }
}

/**
 * Display comprehensive test results with database status
 */
function displayDatabaseTestResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 VAE-NN SYSTEM TEST WITH DATABASE');
  console.log('='.repeat(80));
  
  console.log(`\n📊 DATABASE STATUS:`);
  console.log(`   Connection: ${results.databaseStatus.connected ? '✅ Connected' : '❌ Failed'}`);
  console.log(`   Total Teams: ${results.databaseStatus.totalTeams}`);
  console.log(`   Teams with Stats: ${results.databaseStatus.teamsWithStats}`);
  console.log(`   Home Team Found: ${results.databaseStatus.homeTeamFound ? '✅' : '❌'}`);
  console.log(`   Away Team Found: ${results.databaseStatus.awayTeamFound ? '✅' : '❌'}`);
  console.log(`   Home Team Has Stats: ${results.databaseStatus.homeTeamHasStats ? '✅' : '❌'}`);
  console.log(`   Away Team Has Stats: ${results.databaseStatus.awayTeamHasStats ? '✅' : '❌'}`);
  
  console.log(`\n🧠 VAE-NN SYSTEM STATUS:`);
  console.log(`   VAE-NN Available: ${results.vaeNNStatus.vaeNNAvailable ? '✅' : '❌'}`);
  console.log(`   Prefer VAE-NN: ${results.vaeNNStatus.preferVAENN ? '✅' : '❌'}`);
  console.log(`   Include Uncertainty: ${results.vaeNNStatus.includeUncertaintyMetrics ? '✅' : '❌'}`);
  
  console.log(`\n🏀 GAME TEST RESULTS:`);
  console.log(`   Game: ${results.game.shortName || results.game.name}`);
  console.log(`   Venue: ${results.game.venue || 'N/A'}`);
  console.log(`   Time: ${new Date(results.game.date).toLocaleTimeString()}`);
  
  const r = results.recommendation;
  console.log(`\n🎯 RECOMMENDATION:`);
  console.log(`   Method: ${r.method} ${r.method === 'VAE-NN' ? '🧠' : '📊'}`);
  console.log(`   Pick: ${r.pick}`);
  console.log(`   Reasoning: ${r.reasoning}`);
  
  if (r.warning) {
    console.log(`   ⚠️  Warning: ${r.warning}`);
  }
  
  if (r.simulationData) {
    console.log(`\n📈 SIMULATION DATA:`);
    console.log(`   Iterations: ${r.simulationData.iterations?.toLocaleString() || 'N/A'}`);
    console.log(`   Home Win Prob: ${r.simulationData.homeWinProb || 'N/A'}`);
    console.log(`   Away Win Prob: ${r.simulationData.awayWinProb || 'N/A'}`);
    
    if (r.simulationData.predictionConfidence) {
      console.log(`   Prediction Confidence: ${r.simulationData.predictionConfidence}`);
    }
  }
  
  if (r.uncertaintyMetrics) {
    console.log(`\n🎲 UNCERTAINTY METRICS:`);
    console.log(`   ${r.uncertaintyMetrics.homeTeam.name}: ${r.uncertaintyMetrics.homeTeam.uncertainty}`);
    console.log(`   ${r.uncertaintyMetrics.awayTeam.name}: ${r.uncertaintyMetrics.awayTeam.uncertainty}`);
    console.log(`   Overall Confidence: ${r.uncertaintyMetrics.predictionConfidence}`);
  }
  
  if (r.dataSource) {
    console.log(`   📡 Data Source: ${r.dataSource}`);
  }
  
  console.log(`\n⚡ PERFORMANCE:`);
  console.log(`   Processing Time: ${results.processingTimeMs}ms`);
  console.log(`   Total Time: ${(results.totalDurationMs / 1000).toFixed(1)}s`);
  
  console.log('\n' + '='.repeat(80));
  
  // Provide guidance based on results
  if (results.databaseStatus.totalTeams === 0) {
    console.log('💡 NEXT STEPS: No teams found in database');
    console.log('   1. Run task 2.2: Clear and reseed teams table');
    console.log('   2. Run task 2.4: Populate game_ids table');
    console.log('   3. Run task 3.1: Initialize team latent distributions');
  } else if (results.databaseStatus.teamsWithStats === 0) {
    console.log('💡 NEXT STEPS: Teams found but no statistical representations');
    console.log('   1. Run task 3.1: Initialize team latent distributions');
    console.log('   2. Run task 3.2: Train VAE-NN system on historical games');
  } else if (!results.databaseStatus.homeTeamFound || !results.databaseStatus.awayTeamFound) {
    console.log('💡 NEXT STEPS: Game teams not found in database');
    console.log('   1. Check if ESPN team IDs match database team_id values');
    console.log('   2. May need to update team seeding process');
  } else if (!results.databaseStatus.homeTeamHasStats || !results.databaseStatus.awayTeamHasStats) {
    console.log('💡 NEXT STEPS: Game teams found but missing statistical representations');
    console.log('   1. Run VAE-NN training for these specific teams');
    console.log('   2. Check if teams have processed games in game_ids table');
  } else {
    console.log('✅ SYSTEM READY: All prerequisites met for VAE-NN recommendations');
  }
  
  console.log('='.repeat(80) + '\n');
}

/**
 * Get default betting odds
 */
function getDefaultBettingOdds() {
  return {
    homeMoneyline: -110,
    awayMoneyline: -110,
    spreadLine: 0,
    homeSpreadOdds: -110,
    awaySpreadOdds: -110,
    totalLine: 140,
    overOdds: -110,
    underOdds: -110,
    source: 'default',
    scrapedAt: new Date(),
    getDisplaySummary: function() {
      return {
        moneyline: { home: '-110', away: '-110' },
        spread: { line: 'PICK\'EM', homeOdds: '-110', awayOdds: '-110' },
        total: { line: '140', overOdds: '-110', underOdds: '-110' },
        metadata: { source: 'Default', scrapedAt: new Date(), isStale: false }
      };
    }
  };
}

// Run the script if called directly
if (require.main === module) {
  testVAENNWithDatabase()
    .then(result => {
      if (result.success) {
        console.log(`\n✅ Database test completed successfully`);
        console.log(`   Database Status: ${result.databaseStatus}`);
        console.log(`   Teams in Database: ${result.teamsInDatabase}`);
        console.log(`   VAE-NN Used: ${result.vaeNNUsed ? 'Yes' : 'No'}`);
        process.exit(0);
      } else {
        console.error(`\n❌ Database test failed: ${result.error}`);
        console.error(`   Database Status: ${result.databaseStatus}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 Unexpected error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = {
  testVAENNWithDatabase,
  displayDatabaseTestResults,
  getDefaultBettingOdds
};