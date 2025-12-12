#!/usr/bin/env node

/**
 * VAE Loss Diagnostic Script
 * 
 * Analyzes VAE loss components and identifies sources of instability
 */

const VAEFeatureExtractor = require('../src/modules/sports/VAEFeatureExtractor');
const VariationalAutoencoder = require('../src/modules/sports/VariationalAutoencoder');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

class VAELossDiagnostic {
  constructor() {
    this.featureExtractor = new VAEFeatureExtractor();
    this.vae = new VariationalAutoencoder(88, 16);
  }

  async diagnose() {
    try {
      console.log('🔍 VAE Loss Diagnostic Analysis');
      console.log('================================\n');

      await dbConnection.initialize();

      // Get a sample of processed games
      const sampleGames = await dbConnection.all(`
        SELECT game_id FROM game_ids 
        WHERE processed = 1 AND sport = 'mens-college-basketball'
        ORDER BY game_date ASC 
        LIMIT 5
      `);

      if (sampleGames.length === 0) {
        console.log('❌ No processed games found for analysis');
        return;
      }

      console.log(`📊 Analyzing ${sampleGames.length} sample games...\n`);

      for (let i = 0; i < sampleGames.length; i++) {
        const gameId = sampleGames[i].game_id;
        console.log(`🎮 Game ${i + 1}: ${gameId}`);
        
        try {
          // Extract features
          const gameData = await this.featureExtractor.processGame(gameId);
          const homeFeatures = this.convertFeaturesToArray(gameData.features.home);
          
          // Analyze feature distribution
          this.analyzeFeatures(homeFeatures, 'Home Team');
          
          // Test VAE forward pass
          const vaeResult = this.vae.forward(homeFeatures);
          this.analyzeVAEOutput(vaeResult, homeFeatures);
          
          console.log('─'.repeat(60));
          
        } catch (error) {
          console.log(`❌ Error processing game ${gameId}: ${error.message}`);
        }
      }

      // Test VAE stability over multiple iterations
      console.log('\n🔄 Testing VAE Training Stability...');
      await this.testTrainingStability();

    } catch (error) {
      console.error('❌ Diagnostic failed:', error.message);
    }
  }

  analyzeFeatures(features, label) {
    const stats = this.calculateStats(features);
    
    console.log(`  📈 ${label} Features (${features.length} dims):`);
    console.log(`    Min: ${stats.min.toFixed(4)}, Max: ${stats.max.toFixed(4)}`);
    console.log(`    Mean: ${stats.mean.toFixed(4)}, Std: ${stats.std.toFixed(4)}`);
    console.log(`    Zeros: ${stats.zeros}/${features.length} (${(stats.zeros/features.length*100).toFixed(1)}%)`);
    console.log(`    Out of [0,1]: ${stats.outOfRange}/${features.length} (${(stats.outOfRange/features.length*100).toFixed(1)}%)`);
  }

  analyzeVAEOutput(vaeResult, originalInput) {
    const { reconstruction, mu, logVar } = vaeResult;
    
    // Analyze latent space
    const muStats = this.calculateStats(mu);
    const logVarStats = this.calculateStats(logVar);
    const sigmaStats = this.calculateStats(logVar.map(lv => Math.exp(0.5 * lv)));
    
    console.log(`  🧠 Latent Space Analysis:`);
    console.log(`    μ - Min: ${muStats.min.toFixed(4)}, Max: ${muStats.max.toFixed(4)}, Mean: ${muStats.mean.toFixed(4)}`);
    console.log(`    log(σ²) - Min: ${logVarStats.min.toFixed(4)}, Max: ${logVarStats.max.toFixed(4)}, Mean: ${logVarStats.mean.toFixed(4)}`);
    console.log(`    σ - Min: ${sigmaStats.min.toFixed(4)}, Max: ${sigmaStats.max.toFixed(4)}, Mean: ${sigmaStats.mean.toFixed(4)}`);
    
    // Check for exploding values
    const explodingLogVar = logVar.some(lv => lv > 10);
    const explodingSigma = sigmaStats.max > 100;
    
    if (explodingLogVar) console.log(`    ⚠️  WARNING: Exploding log variance detected!`);
    if (explodingSigma) console.log(`    ⚠️  WARNING: Exploding sigma detected!`);
    
    // Analyze reconstruction
    const reconStats = this.calculateStats(reconstruction);
    console.log(`  🔄 Reconstruction Analysis:`);
    console.log(`    Min: ${reconStats.min.toFixed(4)}, Max: ${reconStats.max.toFixed(4)}, Mean: ${reconStats.mean.toFixed(4)}`);
    
    // Calculate loss components
    const lossInfo = this.vae.computeLoss(originalInput, reconstruction, mu, logVar, 0);
    console.log(`  📉 Loss Components:`);
    console.log(`    Reconstruction: ${lossInfo.reconstructionLoss.toFixed(4)}`);
    console.log(`    KL Divergence: ${lossInfo.klLoss.toFixed(4)}`);
    console.log(`    Total VAE: ${lossInfo.vaeLoss.toFixed(4)}`);
    
    // Check for problematic loss values
    if (lossInfo.reconstructionLoss > 100) {
      console.log(`    ⚠️  WARNING: Very high reconstruction loss!`);
    }
    if (lossInfo.klLoss > 50) {
      console.log(`    ⚠️  WARNING: Very high KL divergence!`);
    }
  }

  async testTrainingStability() {
    // Create synthetic test data
    const testInput = new Array(88).fill(0).map(() => Math.random());
    
    console.log('  🧪 Testing with synthetic data...');
    
    const losses = [];
    for (let i = 0; i < 10; i++) {
      const result = this.vae.forward(testInput);
      const lossInfo = this.vae.computeLoss(testInput, result.reconstruction, result.mu, result.logVar, 0);
      losses.push(lossInfo.vaeLoss);
      
      // Simulate training step
      this.vae.backward(testInput, 0);
      
      console.log(`    Iteration ${i + 1}: VAE Loss = ${lossInfo.vaeLoss.toFixed(4)}`);
    }
    
    // Analyze loss stability
    const lossStats = this.calculateStats(losses);
    console.log(`\n  📊 Loss Stability Analysis:`);
    console.log(`    Loss Range: ${lossStats.min.toFixed(4)} - ${lossStats.max.toFixed(4)}`);
    console.log(`    Loss Std Dev: ${lossStats.std.toFixed(4)}`);
    console.log(`    Coefficient of Variation: ${(lossStats.std / lossStats.mean * 100).toFixed(1)}%`);
    
    if (lossStats.std / lossStats.mean > 0.5) {
      console.log(`    ⚠️  WARNING: High loss instability detected!`);
    }
  }

  calculateStats(array) {
    const min = Math.min(...array);
    const max = Math.max(...array);
    const mean = array.reduce((sum, val) => sum + val, 0) / array.length;
    const variance = array.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / array.length;
    const std = Math.sqrt(variance);
    const zeros = array.filter(val => val === 0).length;
    const outOfRange = array.filter(val => val < 0 || val > 1).length;
    
    return { min, max, mean, std, zeros, outOfRange };
  }

  convertFeaturesToArray(features) {
    // Same conversion as in OnlineLearningOrchestrator
    return [
      // Basic shooting stats (9)
      features.fgm || 0, features.fga || 0, features.fgPct || 0,
      features.fg3m || 0, features.fg3a || 0, features.fg3Pct || 0,
      features.ftm || 0, features.fta || 0, features.ftPct || 0,
      
      // Rebounding stats (3)
      features.rebounds || 0, features.offensiveRebounds || 0, features.defensiveRebounds || 0,
      
      // Other basic stats (7)
      features.assists || 0, features.turnovers || 0, features.steals || 0,
      features.blocks || 0, features.personalFouls || 0, features.technicalFouls || 0,
      features.points || 0,
      
      // Advanced metrics (10)
      features.pointsInPaint || 0, features.fastBreakPoints || 0, features.secondChancePoints || 0,
      features.pointsOffTurnovers || 0, features.benchPoints || 0, features.possessionCount || 0,
      features.ties || 0, features.leads || 0, features.largestLead || 0, features.biggestRun || 0,
      
      // Derived metrics (3)
      features.effectiveFgPct || 0, features.trueShootingPct || 0, features.turnoverRate || 0,
      
      // Player-level features (20)
      features.avgPlayerMinutes || 0, features.avgPlayerPlusMinus || 0, features.avgPlayerEfficiency || 0,
      features.topPlayerMinutes || 0, features.topPlayerPoints || 0, features.topPlayerRebounds || 0,
      features.topPlayerAssists || 0, features.playersUsed || 0, features.starterMinutes || 0,
      features.benchMinutes || 0, features.benchContribution || 0, features.starterEfficiency || 0,
      features.benchEfficiency || 0, features.depthScore || 0, features.minuteDistribution || 0,
      features.topPlayerUsage || 0, features.balanceScore || 0, features.clutchPerformance || 0,
      features.experienceLevel || 0, features.versatilityScore || 0,
      
      // Lineup features (15)
      features.startingLineupMinutes || 0, features.startingLineupPoints || 0, features.startingLineupEfficiency || 0,
      features.benchContribution || 0, features.benchMinutes || 0, features.benchPoints || 0,
      features.rotationDepth || 0, features.minutesDistribution || 0, features.lineupBalance || 0,
      features.substitutionRate || 0, features.depthUtilization || 0, features.starterDominance || 0,
      features.lineupVersatility || 0, features.benchImpact || 0, features.rotationEfficiency || 0,
      
      // Context features (8)
      features.isNeutralSite || 0, features.isPostseason || 0, features.gameLength || 0,
      features.paceOfPlay || 0, features.competitiveBalance || 0, features.gameFlow || 0,
      features.intensityLevel || 0, features.gameContext || 0,
      
      // Shooting distribution features (8)
      features.twoPointAttemptRate || 0, features.threePointAttemptRate || 0, features.freeThrowRate || 0,
      features.twoPointAccuracy || 0, features.threePointAccuracy || 0, features.freeThrowAccuracy || 0,
      features.shotSelection || 0, features.shootingEfficiency || 0,
      
      // Defensive features (5)
      features.opponentFgPctAllowed || 0, features.opponentFg3PctAllowed || 0,
      features.defensiveReboundingPct || 0, features.pointsInPaintAllowed || 0,
      features.defensiveEfficiency || 0
    ];
  }
}

// CLI interface
async function main() {
  const diagnostic = new VAELossDiagnostic();
  
  try {
    await diagnostic.diagnose();
    process.exit(0);
  } catch (error) {
    console.error('❌ Diagnostic failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = VAELossDiagnostic;