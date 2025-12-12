#!/usr/bin/env node

/**
 * Test VAE-NN system with real teams from the database
 * 
 * This script tests the VAE-NN system using actual teams that exist in the database
 * to verify that the system works when proper team data is available.
 */

const path = require('path');
const logger = require('../src/utils/logger');

/**
 * Test VAE-NN system with real database teams
 */
async function testVAENNWithRealTeams() {
  const startTime = Date.now();
  let dbConnection = null;
  
  try {
    logger.info('Testing VAE-NN system with real database teams');
    
    // Step 1: Initialize database connection
    logger.info('Initializing database connection...');
    dbConnection = require('../src/database/connection');
    await dbConnection.initialize();
    logger.info('Database connection initialized successfully');
    
    // Step 2: Initialize components
    const TeamRepository = require('../src/database/repositories/TeamRepository');
    const BettingRecommendationEngine = require('../src/modules/sports/BettingRecommendationEngine');
    const VAEFeedbackTrainer = require('../src/modules/sports/VAEFeedbackTrainer');
    const VariationalAutoencoder = require('../src/modules/sports/VariationalAutoencoder');
    const TransitionProbabilityNN = require('../src/modules/sports/TransitionProbabilityNN');
    
    const teamRepository = new TeamRepository();
    
    // Step 3: Get real teams from database
    logger.info('Loading teams from database...');
    const allTeams = await teamRepository.getTeamsBySport('mens-college-basketball');
    logger.info(`Found ${allTeams.length} teams in database`);
    
    // Find teams with statistical representations
    const teamsWithStats = allTeams.filter(team => team.statisticalRepresentation);
    logger.info(`Found ${teamsWithStats.length} teams with statistical representations`);
    
    if (teamsWithStats.length < 2) {
      throw new Error('Need at least 2 teams with statistical representations to test');
    }
    
    // Pick two teams for testing (e.g., Duke and UNC if available)
    let homeTeam = teamsWithStats.find(t => t.teamName.toLowerCase().includes('duke'));
    let awayTeam = teamsWithStats.find(t => t.teamName.toLowerCase().includes('carolina') && t.teamName.toLowerCase().includes('north'));
    
    // Fallback to first two teams if Duke/UNC not found
    if (!homeTeam || !awayTeam) {
      homeTeam = teamsWithStats[0];
      awayTeam = teamsWithStats[1];
    }
    
    logger.info('Selected teams for testing:', {
      homeTeam: { id: homeTeam.teamId, name: homeTeam.teamName },
      awayTeam: { id: awayTeam.teamId, name: awayTeam.teamName }
    });
    
    // Step 4: Parse statistical representations to verify format
    let homeStats = null;
    let awayStats = null;
    
    try {
      homeStats = JSON.parse(homeTeam.statisticalRepresentation);
      awayStats = JSON.parse(awayTeam.statisticalRepresentation);
      
      logger.info('Team statistical representations parsed successfully:', {
        homeTeam: {
          hasMu: Array.isArray(homeStats.mu),
          hasSigma: Array.isArray(homeStats.sigma),
          muLength: homeStats.mu?.length,
          sigmaLength: homeStats.sigma?.length,
          gamesProcessed: homeStats.games_processed,
          lastSeason: homeStats.last_season
        },
        awayTeam: {
          hasMu: Array.isArray(awayStats.mu),
          hasSigma: Array.isArray(awayStats.sigma),
          muLength: awayStats.mu?.length,
          sigmaLength: awayStats.sigma?.length,
          gamesProcessed: awayStats.games_processed,
          lastSeason: awayStats.last_season
        }
      });
      
    } catch (error) {
      logger.error('Failed to parse statistical representations:', error.message);
      throw new Error('Invalid statistical representation format in database');
    }
    
    // Step 5: Initialize VAE-NN system
    logger.info('Initializing VAE-NN system...');
    const vae = new VariationalAutoencoder(80, 16);
    const transitionNN = new TransitionProbabilityNN(10);
    
    const vaeNNSystem = new VAEFeedbackTrainer(vae, transitionNN, {
      feedbackThreshold: 0.5,
      initialAlpha: 0.1,
      alphaDecayRate: 0.99
    });
    
    // Step 6: Initialize betting recommendation engine
    const recommendationEngine = new BettingRecommendationEngine({
      vaeNNSystem: vaeNNSystem,
      teamRepository: teamRepository,
      espnClient: null, // Not needed for this test
      preferVAENN: true,
      includeUncertaintyMetrics: true,
      iterations: 1000
    });
    
    logger.info('VAE-NN system initialized successfully');
    
    // Step 7: Create mock game data using database team IDs
    const mockGameData = {
      id: 'test_game_001',
      sport: 'ncaa_basketball',
      date: new Date(),
      neutralSite: false,
      teams: {
        home: {
          id: homeTeam.teamId, // Use database team ID format
          name: homeTeam.teamName,
          abbreviation: homeTeam.teamName.split(' ').pop(), // Simple abbreviation
          logo: null
        },
        away: {
          id: awayTeam.teamId, // Use database team ID format
          name: awayTeam.teamName,
          abbreviation: awayTeam.teamName.split(' ').pop(), // Simple abbreviation
          logo: null
        }
      },
      venue: 'Test Arena'
    };
    
    logger.info('Created mock game data:', {
      matchup: `${mockGameData.teams.away.name} @ ${mockGameData.teams.home.name}`,
      homeTeamId: mockGameData.teams.home.id,
      awayTeamId: mockGameData.teams.away.id
    });
    
    // Step 8: Create default betting odds
    const bettingOdds = {
      homeMoneyline: -150,
      awayMoneyline: +130,
      spreadLine: -3.5,
      homeSpreadOdds: -110,
      awaySpreadOdds: -110,
      totalLine: 145.5,
      overOdds: -110,
      underOdds: -110,
      source: 'test',
      scrapedAt: new Date(),
      getDisplaySummary: function() {
        return {
          moneyline: { home: '-150', away: '+130' },
          spread: { line: '-3.5', homeOdds: '-110', awayOdds: '-110' },
          total: { line: '145.5', overOdds: '-110', underOdds: '-110' },
          metadata: { source: 'Test', scrapedAt: new Date(), isStale: false }
        };
      }
    };
    
    // Step 9: Generate recommendation using VAE-NN system
    logger.info('Generating VAE-NN recommendation...');
    const recStartTime = Date.now();
    const recommendation = await recommendationEngine.generateRecommendation(mockGameData, bettingOdds);
    const recDuration = Date.now() - recStartTime;
    
    const totalDuration = Date.now() - startTime;
    
    // Step 10: Display comprehensive results
    displayRealTeamTestResults({
      homeTeam,
      awayTeam,
      homeStats,
      awayStats,
      mockGameData,
      recommendation,
      processingTimeMs: recDuration,
      totalDurationMs: totalDuration
    });
    
    return {
      success: true,
      vaeNNUsed: recommendation.method === 'VAE-NN',
      recommendation: recommendation,
      teamsFound: true,
      teamsHaveStats: true
    };
    
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    logger.error('Failed to test VAE-NN system with real teams', {
      error: error.message,
      stack: error.stack,
      durationMs: totalDuration
    });
    
    return {
      success: false,
      error: error.message,
      vaeNNUsed: false
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
 * Display comprehensive test results
 */
function displayRealTeamTestResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log('🧠 VAE-NN SYSTEM TEST WITH REAL TEAMS');
  console.log('='.repeat(80));
  
  console.log(`\n🏀 TEST MATCHUP:`);
  console.log(`   ${results.awayTeam.teamName} @ ${results.homeTeam.teamName}`);
  console.log(`   Venue: ${results.mockGameData.venue}`);
  
  console.log(`\n📊 TEAM DATA VERIFICATION:`);
  console.log(`   Home Team: ${results.homeTeam.teamName}`);
  console.log(`     • Database ID: ${results.homeTeam.teamId}`);
  console.log(`     • Has μ vector: ${Array.isArray(results.homeStats.mu)} (${results.homeStats.mu?.length} dims)`);
  console.log(`     • Has σ vector: ${Array.isArray(results.homeStats.sigma)} (${results.homeStats.sigma?.length} dims)`);
  console.log(`     • Games Processed: ${results.homeStats.games_processed || 0}`);
  console.log(`     • Last Season: ${results.homeStats.last_season || 'N/A'}`);
  
  console.log(`   Away Team: ${results.awayTeam.teamName}`);
  console.log(`     • Database ID: ${results.awayTeam.teamId}`);
  console.log(`     • Has μ vector: ${Array.isArray(results.awayStats.mu)} (${results.awayStats.mu?.length} dims)`);
  console.log(`     • Has σ vector: ${Array.isArray(results.awayStats.sigma)} (${results.awayStats.sigma?.length} dims)`);
  console.log(`     • Games Processed: ${results.awayStats.games_processed || 0}`);
  console.log(`     • Last Season: ${results.awayStats.last_season || 'N/A'}`);
  
  const r = results.recommendation;
  console.log(`\n🎯 VAE-NN RECOMMENDATION:`);
  console.log(`   Method: ${r.method} ${r.method === 'VAE-NN' ? '🧠' : '📊'}`);
  console.log(`   Pick: ${r.pick}`);
  console.log(`   Reasoning: ${r.reasoning}`);
  
  if (r.warning) {
    console.log(`   ⚠️  Warning: ${r.warning}`);
  }
  
  if (r.simulationData) {
    console.log(`\n📈 SIMULATION RESULTS:`);
    console.log(`   Iterations: ${r.simulationData.iterations?.toLocaleString() || 'N/A'}`);
    console.log(`   Home Win Prob: ${r.simulationData.homeWinProb || 'N/A'}`);
    console.log(`   Away Win Prob: ${r.simulationData.awayWinProb || 'N/A'}`);
    console.log(`   Avg Home Score: ${r.simulationData.avgHomeScore || 'N/A'}`);
    console.log(`   Avg Away Score: ${r.simulationData.avgAwayScore || 'N/A'}`);
    console.log(`   Avg Margin: ${r.simulationData.avgMargin || 'N/A'}`);
    
    if (r.simulationData.predictionConfidence) {
      console.log(`   Prediction Confidence: ${r.simulationData.predictionConfidence}`);
    }
    
    if (r.simulationData.expectedValue) {
      console.log(`   Expected Value: ${r.simulationData.expectedValue}`);
    }
  }
  
  if (r.uncertaintyMetrics) {
    console.log(`\n🎲 UNCERTAINTY METRICS:`);
    console.log(`   ${r.uncertaintyMetrics.homeTeam.name}:`);
    console.log(`     • Uncertainty: ${r.uncertaintyMetrics.homeTeam.uncertainty}`);
    console.log(`     • Games Processed: ${r.uncertaintyMetrics.homeTeam.gamesProcessed}`);
    console.log(`     • Last Season: ${r.uncertaintyMetrics.homeTeam.lastSeason}`);
    
    console.log(`   ${r.uncertaintyMetrics.awayTeam.name}:`);
    console.log(`     • Uncertainty: ${r.uncertaintyMetrics.awayTeam.uncertainty}`);
    console.log(`     • Games Processed: ${r.uncertaintyMetrics.awayTeam.gamesProcessed}`);
    console.log(`     • Last Season: ${r.uncertaintyMetrics.awayTeam.lastSeason}`);
    
    console.log(`   Overall Confidence: ${r.uncertaintyMetrics.predictionConfidence} (${r.uncertaintyMetrics.confidenceLevel})`);
  }
  
  if (r.dataSource) {
    console.log(`   📡 Data Source: ${r.dataSource}`);
  }
  
  console.log(`\n⚡ PERFORMANCE:`);
  console.log(`   Processing Time: ${results.processingTimeMs}ms`);
  console.log(`   Total Time: ${(results.totalDurationMs / 1000).toFixed(1)}s`);
  
  console.log('\n' + '='.repeat(80));
  
  // Provide analysis
  if (r.method === 'VAE-NN') {
    console.log('✅ SUCCESS: VAE-NN system is working correctly!');
    console.log('   • Teams found in database with proper IDs');
    console.log('   • Statistical representations loaded successfully');
    console.log('   • VAE-NN system generated predictions with uncertainty metrics');
    console.log('   • MCMC simulation completed with enhanced probabilities');
  } else {
    console.log('❌ ISSUE: VAE-NN system fell back to traditional method');
    console.log('   • Check team ID format compatibility');
    console.log('   • Verify statistical representation format');
    console.log('   • Review VAE-NN system initialization');
  }
  
  console.log('='.repeat(80) + '\n');
}

// Run the script if called directly
if (require.main === module) {
  testVAENNWithRealTeams()
    .then(result => {
      if (result.success) {
        console.log(`\n✅ Real team test completed successfully`);
        console.log(`   VAE-NN Used: ${result.vaeNNUsed ? 'Yes 🧠' : 'No 📊'}`);
        console.log(`   Teams Found: ${result.teamsFound ? 'Yes' : 'No'}`);
        console.log(`   Teams Have Stats: ${result.teamsHaveStats ? 'Yes' : 'No'}`);
        
        if (result.vaeNNUsed) {
          console.log('\n🎉 VAE-NN SYSTEM IS WORKING CORRECTLY!');
          process.exit(0);
        } else {
          console.log('\n⚠️  VAE-NN system available but not used - check logs for details');
          process.exit(1);
        }
      } else {
        console.error(`\n❌ Real team test failed: ${result.error}`);
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
  testVAENNWithRealTeams,
  displayRealTeamTestResults
};