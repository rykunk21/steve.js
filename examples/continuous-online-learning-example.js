#!/usr/bin/env node

/**
 * Continuous Online Learning System Example
 * 
 * This example demonstrates how the three main components of the continuous
 * online learning system work together:
 * 
 * 1. PostGameUpdater - Updates models after games complete
 * 2. ModelPerformanceMonitor - Tracks system health and performance
 * 3. IncrementalGameDiscovery - Discovers and processes new games
 */

const PostGameUpdater = require('../src/modules/sports/PostGameUpdater');
const ModelPerformanceMonitor = require('../src/modules/sports/ModelPerformanceMonitor');
const IncrementalGameDiscovery = require('../src/modules/sports/IncrementalGameDiscovery');
const logger = require('../src/utils/logger');

async function demonstrateContinuousLearning() {
  logger.info('Starting Continuous Online Learning System Demo');

  // Initialize components
  const postGameUpdater = new PostGameUpdater({
    feedbackThreshold: 0.6,
    postGameLearningRate: 0.0001,
    maxUpdateAttempts: 3
  });

  const performanceMonitor = new ModelPerformanceMonitor({
    monitoringWindow: 50,
    convergenceThreshold: 0.15,
    degradationThreshold: 0.25
  });

  const gameDiscovery = new IncrementalGameDiscovery({
    maxGamesPerRun: 20,
    autoProcessNewGames: true,
    maxProcessingGames: 5
  });

  try {
    // 1. Set up performance monitoring with alerts
    performanceMonitor.onAlert((alert) => {
      logger.warn('Performance Alert Received', {
        type: alert.type,
        severity: alert.severity,
        data: alert.data
      });
    });

    // 2. Simulate some training results for monitoring
    logger.info('Simulating training results for performance monitoring...');
    
    for (let i = 0; i < 10; i++) {
      const mockTrainingResult = {
        nnLoss: 0.4 + (Math.random() - 0.5) * 0.2, // Random loss around 0.4
        vaeLoss: 0.3 + (Math.random() - 0.5) * 0.1, // Random loss around 0.3
        feedbackTriggered: Math.random() < 0.3, // 30% chance of feedback
        currentAlpha: 0.05 * Math.pow(0.99, i) // Decaying alpha
      };

      performanceMonitor.recordPredictionPerformance(mockTrainingResult, `demo_game_${i}`);
    }

    // 3. Simulate team convergence data
    logger.info('Simulating team convergence data...');
    
    const mockTeams = ['duke', 'unc', 'msu', 'uk', 'kansas'];
    for (const teamId of mockTeams) {
      const mockDistribution = {
        sigma: Array.from({ length: 16 }, () => 0.2 + Math.random() * 0.3), // Random sigma values
        gamesProcessed: Math.floor(Math.random() * 20) + 5
      };

      const mockUpdateResult = {
        sigmaReduction: Math.random() * 0.05
      };

      performanceMonitor.recordTeamConvergence(teamId, mockDistribution, mockUpdateResult);
    }

    // 4. Generate performance report
    logger.info('Generating performance report...');
    
    const performanceReport = await performanceMonitor.generatePerformanceReport({
      includeTrendAnalysis: true,
      includeTeamDetails: false
    });

    logger.info('Performance Report Generated', {
      averageAccuracy: performanceReport.summary.averageNNAccuracy.toFixed(3),
      convergenceRate: performanceReport.summary.convergenceRate.toFixed(1) + '%',
      systemStability: performanceReport.performance.systemStability,
      convergenceProgress: performanceReport.performance.convergenceProgress
    });

    // 5. Demonstrate post-game update workflow
    logger.info('Demonstrating post-game update workflow...');
    
    // Mock a completed game scenario
    const mockGameData = {
      teams: {
        home: { name: 'Duke', score: 78 },
        visitor: { name: 'UNC', score: 75 }
      },
      metadata: {
        date: '2024-12-11',
        neutralGame: 'N',
        postseason: 'N'
      },
      playByPlay: [
        { event: 'shot', result: 'make' },
        { event: 'shot', result: 'miss' }
      ],
      features: {
        home: { fgm: 28, fga: 58, fgPct: 0.483, rebounds: 35, assists: 16 },
        visitor: { fgm: 26, fga: 55, fgPct: 0.473, rebounds: 32, assists: 14 }
      },
      transitionProbabilities: {
        home: {
          twoPointMakeProb: 0.45, twoPointMissProb: 0.25,
          threePointMakeProb: 0.12, threePointMissProb: 0.08,
          freeThrowMakeProb: 0.06, freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.02, turnoverProb: 0.01
        },
        visitor: {
          twoPointMakeProb: 0.43, twoPointMissProb: 0.27,
          threePointMakeProb: 0.11, threePointMissProb: 0.09,
          freeThrowMakeProb: 0.07, freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.01, turnoverProb: 0.01
        }
      }
    };

    // Simulate post-game update (this would normally fetch real game data)
    logger.info('Post-game update would process completed games...');
    logger.info('Game completion check:', {
      isCompleted: postGameUpdater.isGameCompleted(mockGameData)
    });

    // 6. Demonstrate game discovery workflow
    logger.info('Demonstrating game discovery workflow...');
    
    // Get discovery statistics
    const discoveryStats = gameDiscovery.getDiscoveryStats();
    logger.info('Discovery Statistics', discoveryStats);

    // 7. Show how components integrate
    logger.info('Integration Example: Continuous Learning Loop');
    logger.info('1. IncrementalGameDiscovery finds new games');
    logger.info('2. OnlineLearningOrchestrator processes games through VAE-NN system');
    logger.info('3. PostGameUpdater refines models after games complete');
    logger.info('4. ModelPerformanceMonitor tracks system health');
    logger.info('5. Performance alerts trigger when issues are detected');
    logger.info('6. System continuously improves predictions');

    // 8. Demonstrate scheduling capability
    logger.info('Scheduling periodic discovery (demo - will stop after 5 seconds)...');
    
    const scheduler = gameDiscovery.schedulePeriodicDiscovery(2000, {
      // This would run every 2 seconds in the demo
      // In production, you'd use something like 24 * 60 * 60 * 1000 (daily)
    });

    // Stop scheduler after 5 seconds
    setTimeout(() => {
      scheduler.stop();
      logger.info('Stopped periodic discovery scheduler');
    }, 5000);

    // Wait for scheduler demo
    await new Promise(resolve => setTimeout(resolve, 6000));

    logger.info('Continuous Online Learning System Demo Completed Successfully');

  } catch (error) {
    logger.error('Demo failed', {
      error: error.message,
      stack: error.stack
    });
  } finally {
    // Clean up resources
    await postGameUpdater.close();
    await gameDiscovery.close();
    logger.info('Resources cleaned up');
  }
}

// Run the demonstration
if (require.main === module) {
  demonstrateContinuousLearning().catch(error => {
    logger.error('Unhandled error in demo', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}

module.exports = { demonstrateContinuousLearning };