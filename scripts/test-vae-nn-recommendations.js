#!/usr/bin/env node

/**
 * Test VAE-NN betting recommendations (without ActionNetwork scraping)
 * 
 * This is a simplified version of task 4.3 that focuses on testing the VAE-NN system
 * without the time-consuming ActionNetwork scraping.
 */

const path = require('path');
const logger = require('../src/utils/logger');

// Import required modules
const ESPNAPIClient = require('../src/modules/sports/ESPNAPIClient');
const BettingRecommendationEngine = require('../src/modules/sports/BettingRecommendationEngine');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const VAEFeedbackTrainer = require('../src/modules/sports/VAEFeedbackTrainer');
const VariationalAutoencoder = require('../src/modules/sports/VariationalAutoencoder');
const TransitionProbabilityNN = require('../src/modules/sports/TransitionProbabilityNN');

/**
 * Test VAE-NN betting recommendations
 */
async function testVAENNRecommendations() {
  const startTime = Date.now();
  
  try {
    logger.info('Testing VAE-NN betting recommendations system');
    
    // Initialize components
    const espnClient = new ESPNAPIClient();
    const teamRepository = new TeamRepository();
    
    // Initialize VAE-NN system
    logger.info('Initializing VAE-NN system...');
    const vae = new VariationalAutoencoder(80, 16); // inputDim, latentDim
    const transitionNN = new TransitionProbabilityNN(10); // gameContextDim
    
    const vaeNNSystem = new VAEFeedbackTrainer(vae, transitionNN, {
      feedbackThreshold: 0.5,
      initialAlpha: 0.1,
      alphaDecayRate: 0.99
    });
    
    // Initialize betting recommendation engine with VAE-NN system
    const recommendationEngine = new BettingRecommendationEngine({
      vaeNNSystem: vaeNNSystem,
      teamRepository: teamRepository,
      espnClient: espnClient,
      preferVAENN: true,
      includeUncertaintyMetrics: true,
      iterations: 1000 // Reduced for testing
    });
    
    logger.info('VAE-NN system initialized successfully');
    
    // Step 1: Fetch today's NCAA basketball games from ESPN API
    logger.info('Fetching today\'s NCAA basketball games from ESPN API...');
    const todaysGames = await espnClient.getTodaysGames('ncaa_basketball');
    
    if (!todaysGames || todaysGames.length === 0) {
      logger.info('No NCAA basketball games found for today');
      return {
        success: true,
        gamesProcessed: 0,
        recommendations: [],
        message: 'No games scheduled for today'
      };
    }
    
    logger.info(`Found ${todaysGames.length} NCAA basketball games for today`);
    
    // Step 2: Test with first 3 games only
    const gamesToTest = todaysGames.slice(0, 3);
    logger.info(`Testing with ${gamesToTest.length} games`);
    
    // Step 3: Generate recommendations using VAE-NN system
    const recommendations = [];
    let successCount = 0;
    let vaeNNUsedCount = 0;
    
    for (const game of gamesToTest) {
      try {
        logger.info(`Processing game: ${game.shortName || game.name}`, {
          gameId: game.id,
          homeTeam: game.teams?.home?.abbreviation,
          awayTeam: game.teams?.away?.abbreviation
        });
        
        // Format game data for recommendation engine
        const gameData = {
          id: game.id,
          sport: 'ncaa_basketball',
          date: new Date(game.date),
          neutralSite: game.neutralSite || false,
          teams: {
            home: {
              id: game.teams?.home?.id,
              name: game.teams?.home?.name,
              abbreviation: game.teams?.home?.abbreviation,
              logo: game.teams?.home?.logo
            },
            away: {
              id: game.teams?.away?.id,
              name: game.teams?.away?.name,
              abbreviation: game.teams?.away?.abbreviation,
              logo: game.teams?.away?.logo
            }
          },
          venue: game.venue,
          conferenceGame: game.teams?.home?.conferenceId === game.teams?.away?.conferenceId
        };
        
        // Use default betting odds
        const bettingOdds = getDefaultBettingOdds();
        
        // Generate recommendation using VAE-NN system
        const recStartTime = Date.now();
        const recommendation = await recommendationEngine.generateRecommendation(gameData, bettingOdds);
        const recDuration = Date.now() - recStartTime;
        
        // Track if VAE-NN was actually used
        if (recommendation.method === 'VAE-NN') {
          vaeNNUsedCount++;
        }
        
        const gameRecommendation = {
          gameId: game.id,
          matchup: `${gameData.teams.away.abbreviation} @ ${gameData.teams.home.abbreviation}`,
          gameTime: game.date,
          venue: game.venue,
          recommendation: recommendation,
          processingTimeMs: recDuration
        };
        
        recommendations.push(gameRecommendation);
        successCount++;
        
        logger.info(`Generated recommendation for ${gameRecommendation.matchup}`, {
          method: recommendation.method,
          hasPick: !!recommendation.pick,
          hasUncertaintyMetrics: !!recommendation.uncertaintyMetrics,
          processingTimeMs: recDuration
        });
        
      } catch (error) {
        logger.error(`Failed to generate recommendation for game ${game.id}`, {
          gameId: game.id,
          error: error.message,
          stack: error.stack
        });
        
        // Add failed recommendation
        recommendations.push({
          gameId: game.id,
          matchup: `${game.teams?.away?.abbreviation || 'TBD'} @ ${game.teams?.home?.abbreviation || 'TBD'}`,
          gameTime: game.date,
          recommendation: {
            pick: 'Error generating recommendation',
            reasoning: `Failed to process: ${error.message}`,
            method: 'Error',
            error: true
          },
          processingTimeMs: 0
        });
      }
    }
    
    const totalDuration = Date.now() - startTime;
    
    // Display results
    displayTestResults(recommendations, {
      totalGames: gamesToTest.length,
      successCount,
      vaeNNUsedCount,
      totalDurationMs: totalDuration
    });
    
    logger.info('VAE-NN betting recommendations test completed', {
      totalGames: gamesToTest.length,
      successfulRecommendations: successCount,
      vaeNNRecommendations: vaeNNUsedCount,
      fallbackRecommendations: successCount - vaeNNUsedCount,
      totalDurationMs: totalDuration
    });
    
    return {
      success: true,
      gamesProcessed: gamesToTest.length,
      recommendations: recommendations,
      stats: {
        successCount,
        vaeNNUsedCount,
        fallbackCount: successCount - vaeNNUsedCount,
        totalDurationMs: totalDuration
      }
    };
    
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    logger.error('Failed to test VAE-NN betting recommendations', {
      error: error.message,
      stack: error.stack,
      durationMs: totalDuration
    });
    
    return {
      success: false,
      error: error.message,
      gamesProcessed: 0,
      recommendations: []
    };
  }
}

/**
 * Display test results
 * @param {Array} recommendations - Array of game recommendations
 * @param {Object} stats - Processing statistics
 */
function displayTestResults(recommendations, stats) {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 VAE-NN BETTING RECOMMENDATIONS TEST');
  console.log('='.repeat(80));
  
  console.log(`\n📊 TEST SUMMARY:`);
  console.log(`   Games Tested: ${stats.totalGames}`);
  console.log(`   Successful Recommendations: ${stats.successCount}`);
  console.log(`   VAE-NN Enhanced: ${stats.vaeNNUsedCount}`);
  console.log(`   Fallback Method: ${stats.successCount - stats.vaeNNUsedCount}`);
  console.log(`   Total Processing Time: ${(stats.totalDurationMs / 1000).toFixed(1)}s`);
  
  // Display each recommendation
  recommendations.forEach((rec, index) => {
    console.log(`\n${index + 1}. ${rec.matchup}`);
    console.log(`   🕐 ${new Date(rec.gameTime).toLocaleTimeString()}`);
    if (rec.venue) console.log(`   📍 ${rec.venue}`);
    
    const r = rec.recommendation;
    
    if (r.error) {
      console.log(`   ❌ Error: ${r.reasoning}`);
    } else {
      console.log(`   🎯 Pick: ${r.pick}`);
      console.log(`   📊 Method: ${r.method}`);
      console.log(`   💭 Reasoning: ${r.reasoning}`);
      
      if (r.simulationData) {
        console.log(`   📈 Simulation:`);
        console.log(`      • Iterations: ${r.simulationData.iterations?.toLocaleString() || 'N/A'}`);
        console.log(`      • Home Win Prob: ${r.simulationData.homeWinProb || 'N/A'}`);
        console.log(`      • Away Win Prob: ${r.simulationData.awayWinProb || 'N/A'}`);
        
        if (r.simulationData.predictionConfidence) {
          console.log(`      • Prediction Confidence: ${r.simulationData.predictionConfidence}`);
        }
      }
      
      if (r.uncertaintyMetrics) {
        console.log(`   🎲 Uncertainty Metrics:`);
        console.log(`      • ${r.uncertaintyMetrics.homeTeam.name}: ${r.uncertaintyMetrics.homeTeam.uncertainty} (${r.uncertaintyMetrics.homeTeam.gamesProcessed} games)`);
        console.log(`      • ${r.uncertaintyMetrics.awayTeam.name}: ${r.uncertaintyMetrics.awayTeam.uncertainty} (${r.uncertaintyMetrics.awayTeam.gamesProcessed} games)`);
        console.log(`      • Overall Confidence: ${r.uncertaintyMetrics.predictionConfidence} (${r.uncertaintyMetrics.confidenceLevel})`);
      }
      
      if (r.dataSource) {
        console.log(`   📡 Data Source: ${r.dataSource}`);
      }
      
      console.log(`   ⚡ Processing Time: ${rec.processingTimeMs}ms`);
    }
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ VAE-NN system test completed successfully');
  console.log('='.repeat(80) + '\n');
}

/**
 * Get default betting odds when real odds are not available
 * @returns {Object} - Default betting odds
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
        moneyline: {
          home: '-110',
          away: '-110'
        },
        spread: {
          line: 'PICK\'EM',
          homeOdds: '-110',
          awayOdds: '-110'
        },
        total: {
          line: '140',
          overOdds: '-110',
          underOdds: '-110'
        },
        metadata: {
          source: 'Default',
          scrapedAt: new Date(),
          isStale: false
        }
      };
    }
  };
}

// Run the script if called directly
if (require.main === module) {
  testVAENNRecommendations()
    .then(result => {
      if (result.success) {
        console.log(`\n✅ Successfully tested VAE-NN system with ${result.gamesProcessed} games`);
        process.exit(0);
      } else {
        console.error(`\n❌ VAE-NN test failed: ${result.error}`);
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
  testVAENNRecommendations,
  displayTestResults,
  getDefaultBettingOdds
};