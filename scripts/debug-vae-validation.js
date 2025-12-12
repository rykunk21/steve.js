#!/usr/bin/env node

/**
 * Debug VAE-NN Validation Issues
 * 
 * This script helps debug the specific issues we're seeing:
 * 1. Only 1 game analyzed instead of 2
 * 2. Lower than expected overall scores
 * 3. System performance thresholds
 */

const VAESystemValidator = require('./validate-vae-nn-system');

class ValidationDebugger {
  constructor() {
    this.validator = new VAESystemValidator();
  }

  async debugGameAnalysis() {
    console.log('\n=== DEBUGGING GAME ANALYSIS ===');
    
    // Mock the same data as our test
    const mockGames = [
      {
        game_id: 'game1',
        game_date: '2024-03-15',
        home_team_id: 'duke',
        away_team_id: 'unc'
      },
      {
        game_id: 'game2', 
        game_date: '2024-03-16',
        home_team_id: 'msu',
        away_team_id: 'uk'
      }
    ];

    const mockTeams = [
      {
        team_id: 'duke',
        statistical_representation: JSON.stringify({
          mu: [0.2, -0.1, 0.8, 0.3, -0.5, 0.1, 0.4, -0.2, 0.6, -0.3, 0.0, 0.5, -0.1, 0.3, 0.2, -0.4],
          sigma: [0.8, 0.9, 0.7, 0.85, 0.95, 0.75, 0.8, 0.9, 0.7, 0.85, 0.8, 0.75, 0.9, 0.8, 0.85, 0.9],
          games_processed: 3
        })
      },
      {
        team_id: 'unc',
        statistical_representation: JSON.stringify({
          mu: [-0.3, 0.4, -0.6, 0.2, 0.7, -0.1, 0.5, 0.3, -0.4, 0.1, 0.6, -0.2, 0.4, -0.3, 0.2, 0.5],
          sigma: [0.6, 0.7, 0.8, 0.65, 0.75, 0.7, 0.6, 0.8, 0.65, 0.7, 0.75, 0.6, 0.8, 0.7, 0.65, 0.75],
          games_processed: 8
        })
      },
      {
        team_id: 'msu',
        statistical_representation: JSON.stringify({
          mu: [2.1, -1.8, 3.2, -2.5, 1.9, 2.8, -1.6, 2.3, -2.1, 1.7, 2.4, -1.9, 2.6, -2.2, 1.8, 2.0],
          sigma: [1.2, 1.5, 1.8, 1.3, 1.6, 1.4, 1.7, 1.2, 1.5, 1.8, 1.3, 1.6, 1.4, 1.7, 1.2, 1.5],
          games_processed: 2
        })
      },
      {
        team_id: 'uk',
        statistical_representation: JSON.stringify({
          mu: [0.1, 0.2, -0.1, 0.3, 0.0, 0.2, -0.1, 0.1, 0.3, -0.2, 0.1, 0.2, 0.0, -0.1, 0.2, 0.1],
          sigma: [0.3, 0.25, 0.35, 0.28, 0.32, 0.27, 0.3, 0.25, 0.35, 0.28, 0.32, 0.27, 0.3, 0.25, 0.35, 0.28],
          games_processed: 15
        })
      }
    ];

    const mockGameData = {
      metadata: { neutralGame: 'N', postseason: 'N', date: '2024-03-15' },
      teams: {
        home: { name: 'Duke', score: 78 },
        visitor: { name: 'UNC', score: 82 }
      },
      transitionProbabilities: {
        home: {
          twoPointMakeProb: 0.42,
          twoPointMissProb: 0.31,
          threePointMakeProb: 0.15,
          threePointMissProb: 0.08,
          freeThrowMakeProb: 0.025,
          freeThrowMissProb: 0.008,
          offensiveReboundProb: 0.007,
          turnoverProb: 0.0
        },
        visitor: {
          twoPointMakeProb: 0.46,
          twoPointMissProb: 0.29,
          threePointMakeProb: 0.13,
          threePointMissProb: 0.09,
          freeThrowMakeProb: 0.02,
          freeThrowMissProb: 0.005,
          offensiveReboundProb: 0.005,
          turnoverProb: 0.0
        }
      }
    };

    // Simulate the validation process step by step
    console.log('Step 1: Processing games...');
    const predictions = [];
    const errors = [];

    for (let i = 0; i < mockGames.length; i++) {
      const gameInfo = mockGames[i];
      console.log(`\nProcessing game ${i + 1}: ${gameInfo.game_id} (${gameInfo.home_team_id} vs ${gameInfo.away_team_id})`);
      
      try {
        // Simulate feature extraction
        console.log('  - Extracting game features...');
        const gameData = mockGameData; // Simulated
        
        // Simulate team lookup
        console.log('  - Looking up team distributions...');
        const homeTeam = mockTeams.find(t => t.team_id === gameInfo.home_team_id);
        const awayTeam = mockTeams.find(t => t.team_id === gameInfo.away_team_id);
        
        console.log(`  - Home team (${gameInfo.home_team_id}): ${homeTeam ? 'FOUND' : 'NOT FOUND'}`);
        console.log(`  - Away team (${gameInfo.away_team_id}): ${awayTeam ? 'FOUND' : 'NOT FOUND'}`);
        
        if (!homeTeam?.statistical_representation || !awayTeam?.statistical_representation) {
          console.log('  - SKIPPING: Missing team data');
          continue;
        }
        
        const homeDistribution = JSON.parse(homeTeam.statistical_representation);
        const awayDistribution = JSON.parse(awayTeam.statistical_representation);
        
        console.log(`  - Home team games processed: ${homeDistribution.games_processed}`);
        console.log(`  - Away team games processed: ${awayDistribution.games_processed}`);
        
        // Simulate predictions
        console.log('  - Generating predictions...');
        const homePrediction = [0.38, 0.35, 0.12, 0.10, 0.03, 0.01, 0.01, 0.0];
        const awayPrediction = [0.43, 0.32, 0.11, 0.11, 0.025, 0.008, 0.007, 0.0];
        
        // Calculate errors
        const homeActual = [0.42, 0.31, 0.15, 0.08, 0.025, 0.008, 0.007, 0.0];
        const awayActual = [0.46, 0.29, 0.13, 0.09, 0.02, 0.005, 0.005, 0.0];
        
        const homeError = this.calculatePredictionError(homePrediction, homeActual);
        const awayError = this.calculatePredictionError(awayPrediction, awayActual);
        
        console.log(`  - Home prediction error (MAE): ${homeError.mae.toFixed(4)}`);
        console.log(`  - Away prediction error (MAE): ${awayError.mae.toFixed(4)}`);
        
        predictions.push({
          gameId: gameInfo.game_id,
          gameDate: gameInfo.game_date,
          home: { teamId: gameInfo.home_team_id, error: homeError },
          away: { teamId: gameInfo.away_team_id, error: awayError }
        });
        
        console.log('  - SUCCESS: Game processed');
        
      } catch (error) {
        console.log(`  - ERROR: ${error.message}`);
        errors.push({ gameId: gameInfo.game_id, error: error.message });
      }
    }
    
    console.log(`\nSUMMARY:`);
    console.log(`- Games processed: ${predictions.length}`);
    console.log(`- Games with errors: ${errors.length}`);
    
    if (predictions.length > 0) {
      const allErrors = predictions.flatMap(p => [p.home.error, p.away.error]);
      const meanAbsoluteError = allErrors.reduce((sum, err) => sum + err.mae, 0) / allErrors.length;
      console.log(`- Overall MAE: ${meanAbsoluteError.toFixed(4)}`);
      console.log(`- Acceptable threshold: 0.1`);
      console.log(`- Excellent threshold: 0.05`);
      console.log(`- Performance: ${meanAbsoluteError < 0.05 ? 'EXCELLENT' : meanAbsoluteError < 0.1 ? 'ACCEPTABLE' : 'POOR'}`);
    }
    
    return { predictions, errors };
  }

  async debugTeamDistributions() {
    console.log('\n=== DEBUGGING TEAM DISTRIBUTIONS ===');
    
    const mockTeams = [
      {
        team_id: 'duke',
        team_name: 'Duke Blue Devils',
        statistical_representation: JSON.stringify({
          mu: [0.2, -0.1, 0.8, 0.3, -0.5, 0.1, 0.4, -0.2, 0.6, -0.3, 0.0, 0.5, -0.1, 0.3, 0.2, -0.4],
          sigma: [0.8, 0.9, 0.7, 0.85, 0.95, 0.75, 0.8, 0.9, 0.7, 0.85, 0.8, 0.75, 0.9, 0.8, 0.85, 0.9], // High uncertainty
          games_processed: 3
        })
      },
      {
        team_id: 'unc',
        statistical_representation: JSON.stringify({
          mu: [-0.3, 0.4, -0.6, 0.2, 0.7, -0.1, 0.5, 0.3, -0.4, 0.1, 0.6, -0.2, 0.4, -0.3, 0.2, 0.5],
          sigma: [0.6, 0.7, 0.8, 0.65, 0.75, 0.7, 0.6, 0.8, 0.65, 0.7, 0.75, 0.6, 0.8, 0.7, 0.65, 0.75], // Moderate uncertainty
          games_processed: 8
        })
      },
      {
        team_id: 'msu',
        statistical_representation: JSON.stringify({
          mu: [2.1, -1.8, 3.2, -2.5, 1.9, 2.8, -1.6, 2.3, -2.1, 1.7, 2.4, -1.9, 2.6, -2.2, 1.8, 2.0], // Extreme values
          sigma: [1.2, 1.5, 1.8, 1.3, 1.6, 1.4, 1.7, 1.2, 1.5, 1.8, 1.3, 1.6, 1.4, 1.7, 1.2, 1.5], // Very high uncertainty
          games_processed: 2
        })
      },
      {
        team_id: 'uk',
        statistical_representation: JSON.stringify({
          mu: [0.1, 0.2, -0.1, 0.3, 0.0, 0.2, -0.1, 0.1, 0.3, -0.2, 0.1, 0.2, 0.0, -0.1, 0.2, 0.1],
          sigma: [0.3, 0.25, 0.35, 0.28, 0.32, 0.27, 0.3, 0.25, 0.35, 0.28, 0.32, 0.27, 0.3, 0.25, 0.35, 0.28], // Good uncertainty
          games_processed: 15
        })
      }
    ];

    const teamAnalyses = [];
    const distributionIssues = [];
    const minGames = 5;

    for (const team of mockTeams) {
      console.log(`\nAnalyzing team: ${team.team_name} (${team.team_id})`);
      
      try {
        const distribution = JSON.parse(team.statistical_representation);
        
        // Validate structure
        if (!distribution.mu || !distribution.sigma || !Array.isArray(distribution.mu) || !Array.isArray(distribution.sigma)) {
          console.log('  - ERROR: Invalid structure');
          distributionIssues.push({ teamId: team.team_id, issue: 'invalid_structure' });
          continue;
        }

        // Check dimensions
        if (distribution.mu.length !== 16 || distribution.sigma.length !== 16) {
          console.log(`  - ERROR: Wrong dimensions (mu: ${distribution.mu.length}, sigma: ${distribution.sigma.length})`);
          distributionIssues.push({ teamId: team.team_id, issue: 'wrong_dimensions' });
          continue;
        }

        // Analyze μ values
        const muStats = this.calculateArrayStats(distribution.mu);
        const sigmaStats = this.calculateArrayStats(distribution.sigma);
        
        console.log(`  - μ stats: mean=${muStats.mean.toFixed(3)}, range=[${muStats.min.toFixed(3)}, ${muStats.max.toFixed(3)}]`);
        console.log(`  - σ stats: mean=${sigmaStats.mean.toFixed(3)}, range=[${sigmaStats.min.toFixed(3)}, ${sigmaStats.max.toFixed(3)}]`);
        console.log(`  - Games processed: ${distribution.games_processed}`);

        // Check for issues
        const extremeMu = distribution.mu.some(val => Math.abs(val) > 5);
        const negativeSigma = distribution.sigma.some(val => val <= 0);
        const extremeSigma = distribution.sigma.some(val => val > 10 || val < 0.01);
        
        const expectedSigmaRange = this.calculateExpectedSigmaRange(distribution.games_processed);
        const sigmaInRange = sigmaStats.mean >= expectedSigmaRange.min && sigmaStats.mean <= expectedSigmaRange.max;
        
        console.log(`  - Expected σ range: [${expectedSigmaRange.min.toFixed(3)}, ${expectedSigmaRange.max.toFixed(3)}]`);
        console.log(`  - σ in expected range: ${sigmaInRange}`);

        const issues = [];
        if (extremeMu) issues.push('Extreme μ values');
        if (negativeSigma) issues.push('Negative σ values');
        if (extremeSigma) issues.push('Extreme σ values');
        if (!sigmaInRange) issues.push('σ outside expected range');
        if (distribution.games_processed < minGames) issues.push('Insufficient games');

        console.log(`  - Issues: ${issues.length > 0 ? issues.join(', ') : 'None'}`);
        console.log(`  - Health status: ${issues.length === 0 ? 'HEALTHY' : 'ISSUES'}`);

        teamAnalyses.push({
          teamId: team.team_id,
          teamName: team.team_name,
          gameCount: distribution.games_processed,
          distribution: { mu: muStats, sigma: sigmaStats },
          issues,
          healthy: issues.length === 0
        });

      } catch (error) {
        console.log(`  - ERROR: ${error.message}`);
        distributionIssues.push({ teamId: team.team_id, issue: 'parse_error' });
      }
    }

    const validTeams = teamAnalyses.filter(t => t.gameCount >= minGames);
    const healthyTeams = validTeams.filter(t => t.healthy);
    const healthyPercentage = validTeams.length > 0 ? (healthyTeams.length / validTeams.length) * 100 : 0;

    console.log(`\nSUMMARY:`);
    console.log(`- Teams analyzed: ${mockTeams.length}`);
    console.log(`- Valid teams (>=${minGames} games): ${validTeams.length}`);
    console.log(`- Healthy teams: ${healthyTeams.length}`);
    console.log(`- Healthy percentage: ${healthyPercentage.toFixed(1)}%`);
    console.log(`- Distribution issues: ${distributionIssues.length}`);
    console.log(`- Performance: ${healthyPercentage > 80 ? 'EXCELLENT' : healthyPercentage > 60 ? 'GOOD' : 'POOR'}`);

    return { teamAnalyses, distributionIssues, healthyPercentage };
  }

  async debugScoring() {
    console.log('\n=== DEBUGGING SCORING SYSTEM ===');
    
    // Simulate different performance scenarios
    const scenarios = [
      {
        name: 'Excellent System',
        predictionAccuracy: { summary: { excellent: true, acceptable: true }, metrics: { meanAbsoluteError: 0.03 } },
        teamDistributions: { summary: { healthyPercentage: 90, sigmaDecayingProperly: true } },
        feedbackLoop: { summary: { effective: true, stable: true } },
        systemConvergence: { summary: { converging: true, systemStable: true } }
      },
      {
        name: 'Good System',
        predictionAccuracy: { summary: { excellent: false, acceptable: true }, metrics: { meanAbsoluteError: 0.08 } },
        teamDistributions: { summary: { healthyPercentage: 75, sigmaDecayingProperly: true } },
        feedbackLoop: { summary: { effective: true, stable: false } },
        systemConvergence: { summary: { converging: true, systemStable: false } }
      },
      {
        name: 'Early Stage System',
        predictionAccuracy: { summary: { excellent: false, acceptable: false }, metrics: { meanAbsoluteError: 0.15 } },
        teamDistributions: { summary: { healthyPercentage: 40, sigmaDecayingProperly: false } },
        feedbackLoop: { summary: { effective: false, stable: false } },
        systemConvergence: { summary: { converging: true, systemStable: false } }
      },
      {
        name: 'Poor System',
        predictionAccuracy: { summary: { excellent: false, acceptable: false }, metrics: { meanAbsoluteError: 0.25 } },
        teamDistributions: { summary: { healthyPercentage: 20, sigmaDecayingProperly: false } },
        feedbackLoop: { summary: { effective: false, stable: false } },
        systemConvergence: { summary: { converging: false, systemStable: false } }
      }
    ];

    for (const scenario of scenarios) {
      console.log(`\n--- ${scenario.name} ---`);
      
      let totalScore = 0;
      let scoredSections = 0;
      const criticalIssues = [];

      // Score prediction accuracy (25 points)
      const accuracy = scenario.predictionAccuracy;
      let predictionScore = 0;
      if (accuracy.summary.excellent) {
        predictionScore = 25;
      } else if (accuracy.summary.acceptable) {
        predictionScore = 15;
      } else {
        predictionScore = 5;
        criticalIssues.push('Poor prediction accuracy detected');
      }
      totalScore += predictionScore;
      scoredSections++;
      console.log(`  Prediction Accuracy: ${predictionScore}/25 (MAE: ${accuracy.metrics.meanAbsoluteError})`);

      // Score team distributions (25 points)
      const distributions = scenario.teamDistributions;
      let distributionScore = 0;
      if (distributions.summary.healthyPercentage > 80 && distributions.summary.sigmaDecayingProperly) {
        distributionScore = 25;
      } else if (distributions.summary.healthyPercentage > 60) {
        distributionScore = 15;
      } else {
        distributionScore = 5;
        criticalIssues.push('Team distributions showing issues');
      }
      totalScore += distributionScore;
      scoredSections++;
      console.log(`  Team Distributions: ${distributionScore}/25 (${distributions.summary.healthyPercentage}% healthy)`);

      // Score feedback loop (25 points)
      const feedback = scenario.feedbackLoop;
      let feedbackScore = 0;
      if (feedback.summary.effective && feedback.summary.stable) {
        feedbackScore = 25;
      } else if (feedback.summary.effective || feedback.summary.stable) {
        feedbackScore = 15;
      } else {
        feedbackScore = 5;
        criticalIssues.push('VAE feedback loop not functioning properly');
      }
      totalScore += feedbackScore;
      scoredSections++;
      console.log(`  Feedback Loop: ${feedbackScore}/25 (effective: ${feedback.summary.effective}, stable: ${feedback.summary.stable})`);

      // Score system convergence (25 points)
      const convergence = scenario.systemConvergence;
      let convergenceScore = 0;
      if (convergence.summary.converging && convergence.summary.systemStable) {
        convergenceScore = 25;
      } else if (convergence.summary.converging || convergence.summary.systemStable) {
        convergenceScore = 15;
      } else {
        convergenceScore = 5;
        criticalIssues.push('System not converging properly');
      }
      totalScore += convergenceScore;
      scoredSections++;
      console.log(`  System Convergence: ${convergenceScore}/25 (converging: ${convergence.summary.converging}, stable: ${convergence.summary.systemStable})`);

      const overallScore = Math.round(totalScore);
      console.log(`  OVERALL SCORE: ${overallScore}/100`);
      console.log(`  Critical Issues: ${criticalIssues.length}`);
    }
  }

  // Helper methods
  calculatePredictionError(predicted, actual) {
    const errors = predicted.map((pred, i) => Math.abs(pred - actual[i]));
    const squaredErrors = predicted.map((pred, i) => Math.pow(pred - actual[i], 2));
    
    return {
      mae: errors.reduce((sum, err) => sum + err, 0) / errors.length,
      mse: squaredErrors.reduce((sum, err) => sum + err, 0) / squaredErrors.length,
      maxAbsError: Math.max(...errors)
    };
  }

  calculateArrayStats(arr) {
    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      stdDev,
      min: Math.min(...arr),
      max: Math.max(...arr),
      range: Math.max(...arr) - Math.min(...arr)
    };
  }

  calculateExpectedSigmaRange(gameCount) {
    const baseSigma = 1.0;
    const decayRate = 0.95;
    const minSigma = 0.1;
    
    const expectedMean = Math.max(baseSigma * Math.pow(decayRate, gameCount), minSigma);
    
    return {
      min: expectedMean * 0.5,
      max: expectedMean * 2.0,
      expected: expectedMean
    };
  }
}

// Main execution
async function main() {
  const validator = new ValidationDebugger();
  
  console.log('VAE-NN VALIDATION DEBUGGING');
  console.log('===========================');
  
  try {
    await validator.debugGameAnalysis();
    await validator.debugTeamDistributions();
    await validator.debugScoring();
    
    console.log('\n=== RECOMMENDATIONS ===');
    console.log('1. Game Analysis: Ensure all teams have statistical representations');
    console.log('2. Team Distributions: Lower thresholds for early-stage systems');
    console.log('3. Scoring: Consider graduated scoring based on system maturity');
    console.log('4. Validation: Add system maturity detection to adjust expectations');
    
  } catch (error) {
    console.error('Debug failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ValidationDebugger;