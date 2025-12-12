#!/usr/bin/env node

/**
 * Generate betting recommendations using VAE-NN system
 * 
 * This script implements task 4.3:
 * - Fetch today's NCAA basketball games from ESPN API
 * - Load team latent distributions from teams.statistical_representation
 * - Run MCMC simulations for each game using VAE-NN system
 * - Calculate expected value for betting opportunities
 * - Display recommendations with simulation details (iterations, confidence, data source, team uncertainty)
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
const ActionNetworkScraper = require('../src/modules/sports/ActionNetworkScraper');

/**
 * Main function to generate VAE-NN betting recommendations
 */
async function generateVAENNBettingRecommendations() {
  const startTime = Date.now();
  
  try {
    logger.info('Starting VAE-NN betting recommendations generation');
    
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
      iterations: 10000
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
    
    // Step 2: Get betting odds for games (optional - can work without odds)
    logger.info('Fetching betting odds from ActionNetwork...');
    let bettingOddsMap = {};
    
    try {
      const scraper = new ActionNetworkScraper();
      const snapshots = await scraper.scrapeOdds('ncaa_basketball');
      await scraper.cleanup();
      
      // Create map of game IDs to betting snapshots
      snapshots.forEach(snapshot => {
        // Try to match snapshots to ESPN games by team names
        const matchingGame = todaysGames.find(game => {
          if (!game.teams?.home?.abbreviation || !game.teams?.away?.abbreviation) return false;
          
          const gameKey = `${game.teams.away.abbreviation}_at_${game.teams.home.abbreviation}`.toLowerCase();
          const snapshotKey = snapshot.gameId.toLowerCase();
          
          return gameKey === snapshotKey || 
                 gameKey.replace(/[^a-z]/g, '') === snapshotKey.replace(/[^a-z]/g, '');
        });
        
        if (matchingGame) {
          bettingOddsMap[matchingGame.id] = snapshot;
        }
      });
      
      logger.info(`Matched betting odds for ${Object.keys(bettingOddsMap).length} games`);
      
    } catch (oddsError) {
      logger.warn('Failed to fetch betting odds, continuing without odds data', {
        error: oddsError.message
      });
    }
    
    // Step 3: Generate recommendations for each game using VAE-NN system
    logger.info('Generating VAE-NN betting recommendations...');
    const recommendations = [];
    let successCount = 0;
    let vaeNNUsedCount = 0;
    
    for (const game of todaysGames) {
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
        
        // Get betting odds for this game (or use defaults)
        const bettingOdds = bettingOddsMap[game.id] || getDefaultBettingOdds();
        
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
          processingTimeMs: recDuration,
          hasBettingOdds: !!bettingOddsMap[game.id]
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
          processingTimeMs: 0,
          hasBettingOdds: false
        });
      }
    }
    
    const totalDuration = Date.now() - startTime;
    
    // Step 4: Display comprehensive results
    displayRecommendationResults(recommendations, {
      totalGames: todaysGames.length,
      successCount,
      vaeNNUsedCount,
      totalDurationMs: totalDuration,
      avgProcessingTimeMs: successCount > 0 ? recommendations
        .filter(r => !r.recommendation.error)
        .reduce((sum, r) => sum + r.processingTimeMs, 0) / successCount : 0
    });
    
    logger.info('VAE-NN betting recommendations generation completed', {
      totalGames: todaysGames.length,
      successfulRecommendations: successCount,
      vaeNNRecommendations: vaeNNUsedCount,
      fallbackRecommendations: successCount - vaeNNUsedCount,
      totalDurationMs: totalDuration
    });
    
    return {
      success: true,
      gamesProcessed: todaysGames.length,
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
    
    logger.error('Failed to generate VAE-NN betting recommendations', {
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
 * Display comprehensive recommendation results
 * @param {Array} recommendations - Array of game recommendations
 * @param {Object} stats - Processing statistics
 */
function displayRecommendationResults(recommendations, stats) {
  console.log('\n' + '='.repeat(80));
  console.log('🏀 NCAA BASKETBALL BETTING RECOMMENDATIONS (VAE-NN ENHANCED)');
  console.log('='.repeat(80));
  
  console.log(`\n📊 SUMMARY:`);
  console.log(`   Total Games: ${stats.totalGames}`);
  console.log(`   Successful Recommendations: ${stats.successCount}`);
  console.log(`   VAE-NN Enhanced: ${stats.vaeNNUsedCount}`);
  console.log(`   Fallback Method: ${stats.successCount - stats.vaeNNUsedCount}`);
  console.log(`   Total Processing Time: ${(stats.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`   Average Time per Game: ${stats.avgProcessingTimeMs.toFixed(0)}ms`);
  
  // Group recommendations by method
  const vaeNNRecs = recommendations.filter(r => r.recommendation.method === 'VAE-NN');
  const fallbackRecs = recommendations.filter(r => r.recommendation.method !== 'VAE-NN' && !r.recommendation.error);
  const errorRecs = recommendations.filter(r => r.recommendation.error);
  
  // Display VAE-NN enhanced recommendations
  if (vaeNNRecs.length > 0) {
    console.log(`\n🧠 VAE-NN ENHANCED RECOMMENDATIONS (${vaeNNRecs.length}):`);
    console.log('-'.repeat(80));
    
    vaeNNRecs.forEach((rec, index) => {
      console.log(`\n${index + 1}. ${rec.matchup}`);
      console.log(`   🕐 ${new Date(rec.gameTime).toLocaleTimeString()}`);
      if (rec.venue) console.log(`   📍 ${rec.venue}`);
      
      const r = rec.recommendation;
      console.log(`   🎯 Pick: ${r.pick}`);
      console.log(`   💭 Reasoning: ${r.reasoning}`);
      
      if (r.simulationData) {
        console.log(`   📈 Simulation:`);
        console.log(`      • Iterations: ${r.simulationData.iterations?.toLocaleString() || 'N/A'}`);
        console.log(`      • Home Win Prob: ${r.simulationData.homeWinProb || 'N/A'}`);
        console.log(`      • Away Win Prob: ${r.simulationData.awayWinProb || 'N/A'}`);
        console.log(`      • Prediction Confidence: ${r.simulationData.predictionConfidence || 'N/A'}`);
        
        if (r.simulationData.expectedValue) {
          console.log(`      • Expected Value: ${r.simulationData.expectedValue}`);
        }
      }
      
      if (r.uncertaintyMetrics) {
        console.log(`   🎲 Uncertainty Metrics:`);
        console.log(`      • ${r.uncertaintyMetrics.homeTeam.name}: ${r.uncertaintyMetrics.homeTeam.uncertainty} (${r.uncertaintyMetrics.homeTeam.gamesProcessed} games)`);
        console.log(`      • ${r.uncertaintyMetrics.awayTeam.name}: ${r.uncertaintyMetrics.awayTeam.uncertainty} (${r.uncertaintyMetrics.awayTeam.gamesProcessed} games)`);
        console.log(`      • Overall Confidence: ${r.uncertaintyMetrics.predictionConfidence} (${r.uncertaintyMetrics.confidenceLevel})`);
      }
      
      console.log(`   ⚡ Processing: ${rec.processingTimeMs}ms | Odds: ${rec.hasBettingOdds ? 'Available' : 'Default'}`);
    });
  }
  
  // Display fallback recommendations
  if (fallbackRecs.length > 0) {
    console.log(`\n📊 FALLBACK RECOMMENDATIONS (${fallbackRecs.length}):`);
    console.log('-'.repeat(80));
    
    fallbackRecs.forEach((rec, index) => {
      console.log(`\n${index + 1}. ${rec.matchup}`);
      console.log(`   🕐 ${new Date(rec.gameTime).toLocaleTimeString()}`);
      console.log(`   🎯 Pick: ${rec.recommendation.pick}`);
      console.log(`   💭 Reasoning: ${rec.recommendation.reasoning}`);
      console.log(`   📊 Method: ${rec.recommendation.method}`);
      
      if (rec.recommendation.warning) {
        console.log(`   ⚠️  Warning: ${rec.recommendation.warning}`);
      }
    });
  }
  
  // Display errors
  if (errorRecs.length > 0) {
    console.log(`\n❌ FAILED RECOMMENDATIONS (${errorRecs.length}):`);
    console.log('-'.repeat(80));
    
    errorRecs.forEach((rec, index) => {
      console.log(`\n${index + 1}. ${rec.matchup}`);
      console.log(`   ❌ Error: ${rec.recommendation.reasoning}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('💡 Note: VAE-NN recommendations include team uncertainty and prediction confidence');
  console.log('📊 Higher uncertainty indicates less reliable predictions (new season, limited data)');
  console.log('🎯 Expected Value (EV) shows potential profit percentage for positive bets');
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
  generateVAENNBettingRecommendations()
    .then(result => {
      if (result.success) {
        console.log(`\n✅ Successfully generated recommendations for ${result.gamesProcessed} games`);
        process.exit(0);
      } else {
        console.error(`\n❌ Failed to generate recommendations: ${result.error}`);
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
  generateVAENNBettingRecommendations,
  displayRecommendationResults,
  getDefaultBettingOdds
};