#!/usr/bin/env node

/**
 * Incremental Game Discovery Script
 * 
 * This script can be run daily or on a schedule to:
 * 1. Discover new games from StatBroadcast
 * 2. Add them to the database
 * 3. Process them through the VAE-NN system
 * 4. Generate reports on discovery and processing results
 * 
 * Usage:
 *   node scripts/run-incremental-discovery.js [options]
 * 
 * Options:
 *   --no-process     Skip automatic processing of new games
 *   --max-games=N    Maximum games to process (default: 10)
 *   --start-date=YYYY-MM-DD  Start date for game discovery
 *   --end-date=YYYY-MM-DD    End date for game discovery
 *   --report-only    Only generate a report, don't discover new games
 *   --verbose        Enable verbose logging
 */

const IncrementalGameDiscovery = require('../src/modules/sports/IncrementalGameDiscovery');
const ModelPerformanceMonitor = require('../src/modules/sports/ModelPerformanceMonitor');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  autoProcess: !args.includes('--no-process'),
  maxGames: parseInt(args.find(arg => arg.startsWith('--max-games='))?.split('=')[1]) || 10,
  startDate: args.find(arg => arg.startsWith('--start-date='))?.split('=')[1] || null,
  endDate: args.find(arg => arg.startsWith('--end-date='))?.split('=')[1] || null,
  reportOnly: args.includes('--report-only'),
  verbose: args.includes('--verbose')
};

async function main() {
  const startTime = Date.now();
  
  try {
    logger.info('Starting incremental game discovery script', {
      options,
      timestamp: new Date().toISOString()
    });

    // Initialize database connection
    logger.info('Initializing database connection...');
    await dbConnection.initialize();
    logger.info('Database connection initialized successfully');

    // Initialize services
    const gameDiscovery = new IncrementalGameDiscovery({
      autoProcessNewGames: options.autoProcess,
      maxProcessingGames: options.maxGames
    });

    const performanceMonitor = new ModelPerformanceMonitor();

    let discoveryResults = null;
    let performanceReport = null;

    if (!options.reportOnly) {
      // Run game discovery
      discoveryResults = await gameDiscovery.runDiscovery({
        startDate: options.startDate,
        endDate: options.endDate,
        onTeamProgress: (current, total, teamResult) => {
          if (options.verbose) {
            logger.info('Team discovery progress', {
              progress: `${current}/${total}`,
              teamId: teamResult.teamId,
              newGames: teamResult.newGames
            });
          }
        }
      });

      logger.info('Game discovery completed', {
        newGames: discoveryResults.results.newGames,
        processedGames: discoveryResults.results.processedGames,
        teamsUpdated: discoveryResults.results.teamsUpdated,
        runTime: discoveryResults.runTime
      });
    }

    // Generate performance report
    performanceReport = await performanceMonitor.generatePerformanceReport({
      includeTrendAnalysis: true,
      includeTeamDetails: options.verbose
    });

    // Create comprehensive report
    const report = {
      timestamp: new Date().toISOString(),
      scriptOptions: options,
      discovery: discoveryResults,
      performance: performanceReport,
      summary: {
        totalRunTime: Date.now() - startTime,
        newGamesFound: discoveryResults?.results.newGames || 0,
        gamesProcessed: discoveryResults?.results.processedGames || 0,
        systemHealth: assessSystemHealth(performanceReport),
        recommendations: generateRecommendations(discoveryResults, performanceReport)
      }
    };

    // Save report to file
    await saveReport(report);

    // Log summary
    logger.info('Incremental discovery script completed', {
      totalRunTime: report.summary.totalRunTime,
      newGamesFound: report.summary.newGamesFound,
      gamesProcessed: report.summary.gamesProcessed,
      systemHealth: report.summary.systemHealth
    });

    // Print recommendations
    if (report.summary.recommendations.length > 0) {
      logger.info('Recommendations:', {
        recommendations: report.summary.recommendations
      });
    }

    // Close resources
    await gameDiscovery.close();

    process.exit(0);

  } catch (error) {
    logger.error('Incremental discovery script failed', {
      error: error.message,
      stack: error.stack,
      totalRunTime: Date.now() - startTime
    });

    process.exit(1);
  }
}

/**
 * Assess overall system health based on performance report
 * @param {Object} performanceReport - Performance report
 * @returns {string} - Health assessment
 */
function assessSystemHealth(performanceReport) {
  if (!performanceReport) return 'unknown';

  const { performance, alerts } = performanceReport;
  
  // Check for critical alerts
  const criticalAlerts = alerts.recentAlerts.filter(alert => alert.severity === 'critical');
  if (criticalAlerts.length > 0) {
    return 'critical';
  }

  // Check system stability
  if (performance.systemStability === 'unstable') {
    return 'poor';
  }

  // Check convergence progress
  if (performance.convergenceProgress === 'poor' || performance.convergenceProgress === 'slow') {
    return 'fair';
  }

  // Check accuracy
  const accuracy = performanceReport.summary.averageNNAccuracy;
  if (accuracy < 0.6) {
    return 'poor';
  } else if (accuracy < 0.75) {
    return 'fair';
  } else if (accuracy < 0.85) {
    return 'good';
  } else {
    return 'excellent';
  }
}

/**
 * Generate recommendations based on discovery and performance results
 * @param {Object} discoveryResults - Discovery results
 * @param {Object} performanceReport - Performance report
 * @returns {Array} - Array of recommendation strings
 */
function generateRecommendations(discoveryResults, performanceReport) {
  const recommendations = [];

  if (!discoveryResults && !performanceReport) {
    return recommendations;
  }

  // Discovery-based recommendations
  if (discoveryResults) {
    const { results } = discoveryResults;
    
    if (results.errors && results.errors.length > 0) {
      recommendations.push(`${results.errors.length} teams had discovery errors - check team configurations`);
    }

    if (results.processingErrors && results.processingErrors.length > 0) {
      recommendations.push(`${results.processingErrors.length} games had processing errors - review game data quality`);
    }

    if (results.newGames === 0) {
      recommendations.push('No new games discovered - verify StatBroadcast connectivity and team schedules');
    }

    if (results.newGames > 50) {
      recommendations.push('Large number of new games found - consider increasing processing capacity');
    }
  }

  // Performance-based recommendations
  if (performanceReport) {
    const { performance, alerts, summary } = performanceReport;

    if (alerts.recentAlerts.length > 0) {
      recommendations.push(`${alerts.recentAlerts.length} recent performance alerts - review model stability`);
    }

    if (performance.systemStability === 'unstable') {
      recommendations.push('System is unstable - consider reducing learning rates or feedback thresholds');
    }

    if (performance.convergenceProgress === 'poor') {
      recommendations.push('Poor team convergence - increase training data or adjust Bayesian parameters');
    }

    if (summary.averageNNAccuracy < 0.7) {
      recommendations.push('Low prediction accuracy - review model architecture or training data quality');
    }

    if (summary.convergenceRate < 50) {
      recommendations.push('Low team convergence rate - consider longer training periods or parameter tuning');
    }

    // Trend-based recommendations
    if (performanceReport.trends) {
      if (performanceReport.trends.accuracyTrend === 'declining' || performanceReport.trends.accuracyTrend === 'strongly_declining') {
        recommendations.push('Model accuracy is declining - investigate recent changes or data quality issues');
      }

      if (performanceReport.trends.feedbackTrend === 'strongly_improving') {
        recommendations.push('Excessive feedback loop activity - system may be unstable');
      }
    }
  }

  return recommendations;
}

/**
 * Save report to file
 * @param {Object} report - Report object
 * @returns {Promise<void>}
 */
async function saveReport(report) {
  try {
    const reportsDir = 'data/reports';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `incremental-discovery-${timestamp}.json`;
    const filepath = path.join(reportsDir, filename);

    // Ensure reports directory exists
    try {
      await fs.mkdir(reportsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Save report
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    
    logger.info('Report saved', { filepath });

    // Also save a "latest" report for easy access
    const latestPath = path.join(reportsDir, 'latest-incremental-discovery.json');
    await fs.writeFile(latestPath, JSON.stringify(report, null, 2));

  } catch (error) {
    logger.error('Failed to save report', {
      error: error.message
    });
  }
}

// Handle process signals for graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Run the script
main().catch(error => {
  logger.error('Unhandled error in main', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});