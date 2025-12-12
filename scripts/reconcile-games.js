#!/usr/bin/env node

/**
 * Reconcile and backfill NCAA basketball games
 * Discovers StatBroadcast game IDs for ESPN games and stores mappings
 * Run with: node scripts/reconcile-games.js [--days=30] [--start=2024-11-01] [--end=2024-11-28]
 */

const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

// Repositories
const HistoricalGameRepository = require('../src/database/repositories/HistoricalGameRepository');
const ReconciliationLogRepository = require('../src/database/repositories/ReconciliationLogRepository');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const GameIdMappingRepository = require('../src/database/repositories/GameIdMappingRepository');

// Services
const ESPNAPIClient = require('../src/modules/sports/ESPNAPIClient');
const StatBroadcastClient = require('../src/modules/sports/StatBroadcastClient');
const XMLGameParser = require('../src/modules/sports/XMLGameParser');
const GameIdDiscoveryService = require('../src/modules/sports/GameIdDiscoveryService');
const GameReconciliationService = require('../src/modules/sports/GameReconciliationService');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    days: null,
    startDate: null,
    endDate: null
  };

  args.forEach(arg => {
    if (arg.startsWith('--days=')) {
      options.days = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--start=')) {
      options.startDate = new Date(arg.split('=')[1]);
    } else if (arg.startsWith('--end=')) {
      options.endDate = new Date(arg.split('=')[1]);
    }
  });

  return options;
}

/**
 * Main reconciliation function
 */
async function main() {
  try {
    logger.info('Starting game reconciliation script...');

    // Parse command line arguments
    const options = parseArgs();

    // Initialize database
    await dbConnection.initialize();

    // Initialize repositories
    const historicalGameRepo = new HistoricalGameRepository();
    const reconciliationLogRepo = new ReconciliationLogRepository();
    const teamRepo = new TeamRepository();
    const gameIdMappingRepo = new GameIdMappingRepository();

    // Initialize services
    const espnAPIClient = new ESPNAPIClient();
    const statBroadcastClient = new StatBroadcastClient();
    const xmlGameParser = new XMLGameParser();
    const gameIdDiscoveryService = new GameIdDiscoveryService(
      gameIdMappingRepo,
      statBroadcastClient
    );

    // Initialize reconciliation service
    const reconciliationService = new GameReconciliationService(
      historicalGameRepo,
      reconciliationLogRepo,
      teamRepo,
      gameIdDiscoveryService,
      statBroadcastClient,
      xmlGameParser,
      espnAPIClient,
      null // No model update orchestrator for now
    );

    // Determine date range
    let result;
    if (options.startDate && options.endDate) {
      // Use explicit date range
      logger.info('Reconciling games for date range', {
        startDate: options.startDate.toISOString(),
        endDate: options.endDate.toISOString()
      });
      result = await reconciliationService.reconcileGames(
        options.startDate,
        options.endDate,
        'manual-script'
      );
    } else if (options.days) {
      // Use recent days
      logger.info('Reconciling recent games', { days: options.days });
      result = await reconciliationService.reconcileRecentGames(
        options.days,
        'manual-script'
      );
    } else {
      // Default: current season (Nov 2024 - Mar 2025)
      const startDate = new Date('2024-11-01');
      const endDate = new Date();
      logger.info('Reconciling current season games', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
      result = await reconciliationService.reconcileGames(
        startDate,
        endDate,
        'manual-script'
      );
    }

    // Print summary
    console.log('\n=== Reconciliation Summary ===');
    console.log(`Reconciliation ID: ${result.reconciliationId}`);
    console.log(`Total ESPN games found: ${result.gamesFound}`);
    console.log(`Missing games identified: ${result.missingGames}`);
    console.log(`Games processed: ${result.processed}`);
    console.log(`Games failed: ${result.failed}`);

    if (result.details && result.details.length > 0) {
      console.log('\nSample processed games:');
      result.details.slice(0, 10).forEach(detail => {
        if (detail.success) {
          console.log(`  ✓ ${detail.espnGameId} -> ${detail.statbroadcastGameId} (confidence: ${detail.confidence})`);
        } else {
          console.log(`  ✗ ${detail.espnGameId} - ${detail.reason}`);
        }
      });

      if (result.details.length > 10) {
        console.log(`  ... and ${result.details.length - 10} more`);
      }
    }

    console.log('\nReconciliation complete!');

    await dbConnection.close();
    process.exit(0);

  } catch (error) {
    logger.error('Reconciliation script failed:', error);
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = main;
