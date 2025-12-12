#!/usr/bin/env node

/**
 * Script to extract VAE features from StatBroadcast game XML
 * Processes unprocessed games and extracts 80-dimensional features
 */

const VAEFeatureExtractor = require('../src/modules/sports/VAEFeatureExtractor');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

class VAEFeatureExtractionScript {
  constructor() {
    this.extractor = new VAEFeatureExtractor();
  }

  /**
   * Parse command line arguments
   * @returns {Object} - Parsed arguments
   */
  parseArguments() {
    const args = process.argv.slice(2);
    const options = {
      limit: null,
      gameId: null,
      batchSize: 10,
      continueOnError: true,
      verbose: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === '--limit' && i + 1 < args.length) {
        options.limit = parseInt(args[i + 1]);
        i++;
      } else if (arg === '--game-id' && i + 1 < args.length) {
        options.gameId = args[i + 1];
        i++;
      } else if (arg === '--batch-size' && i + 1 < args.length) {
        options.batchSize = parseInt(args[i + 1]);
        i++;
      } else if (arg === '--stop-on-error') {
        options.continueOnError = false;
      } else if (arg === '--verbose') {
        options.verbose = true;
      } else if (arg === '--help') {
        this.printUsage();
        process.exit(0);
      }
    }

    return options;
  }

  /**
   * Print usage information
   */
  printUsage() {
    console.log(`
Usage: node scripts/extract-vae-features.js [options]

Options:
  --limit <number>        Limit number of games to process
  --game-id <id>          Process specific game ID only
  --batch-size <number>   Number of games to process in each batch (default: 10)
  --stop-on-error         Stop processing on first error (default: continue)
  --verbose               Enable verbose logging
  --help                  Show this help message

Examples:
  node scripts/extract-vae-features.js --limit 50
  node scripts/extract-vae-features.js --game-id 123456
  node scripts/extract-vae-features.js --batch-size 5 --verbose
    `);
  }

  /**
   * Process a single game
   * @param {string} gameId - Game ID to process
   * @returns {Promise<Object>} - Processing result
   */
  async processSingleGame(gameId) {
    try {
      console.log(`Processing game: ${gameId}`);
      
      const result = await this.extractor.processGame(gameId);
      
      console.log(`✓ Successfully processed game ${gameId}`);
      console.log(`  - Visitor: ${result.teams.visitor.name}`);
      console.log(`  - Home: ${result.teams.home.name}`);
      console.log(`  - Feature dimensions: ${result.featureDimensions}`);
      
      return result;

    } catch (error) {
      console.error(`✗ Failed to process game ${gameId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process multiple games in batches
   * @param {Array} games - Games to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processing summary
   */
  async processGameBatch(games, options) {
    const { batchSize, continueOnError, verbose } = options;
    let totalProcessed = 0;
    let totalErrors = 0;
    const startTime = Date.now();

    console.log(`Starting batch processing of ${games.length} games...`);
    console.log(`Batch size: ${batchSize}, Continue on error: ${continueOnError}`);

    // Process games in batches
    for (let i = 0; i < games.length; i += batchSize) {
      const batch = games.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(games.length / batchSize);

      console.log(`\nProcessing batch ${batchNumber}/${totalBatches} (${batch.length} games)...`);

      try {
        const gameIds = batch.map(g => g.game_id);
        
        const results = await this.extractor.processGameBatch(gameIds, {
          continueOnError,
          onProgress: (current, total, gameId, error) => {
            if (error) {
              console.error(`  ✗ ${gameId}: ${error.message}`);
              totalErrors++;
            } else {
              console.log(`  ✓ ${gameId} (${current}/${total})`);
              totalProcessed++;
            }
          }
        });

        if (verbose) {
          console.log(`Batch ${batchNumber} completed: ${results.length} successful`);
        }

      } catch (error) {
        console.error(`Batch ${batchNumber} failed: ${error.message}`);
        
        if (!continueOnError) {
          throw error;
        }
        
        totalErrors += batch.length;
      }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    return {
      totalGames: games.length,
      totalProcessed,
      totalErrors,
      duration,
      gamesPerSecond: totalProcessed / duration
    };
  }

  /**
   * Main execution function
   * @returns {Promise<void>}
   */
  async run() {
    try {
      const options = this.parseArguments();

      // Initialize database connection
      if (!dbConnection.isReady()) {
        console.log('Initializing database connection...');
        await dbConnection.initialize();
      }

      if (options.gameId) {
        // Process single game
        await this.processSingleGame(options.gameId);
      } else {
        // Process multiple games
        console.log('Retrieving unprocessed games from database...');
        
        const games = await this.extractor.getUnprocessedGames({
          limit: options.limit,
          orderBy: 'game_date ASC'
        });

        if (games.length === 0) {
          console.log('No unprocessed games found.');
          return;
        }

        console.log(`Found ${games.length} unprocessed games.`);

        if (options.verbose) {
          console.log('Sample games:');
          games.slice(0, 5).forEach(game => {
            console.log(`  - ${game.game_id} (${game.game_date}): ${game.away_team_id} @ ${game.home_team_id}`);
          });
          if (games.length > 5) {
            console.log(`  ... and ${games.length - 5} more`);
          }
        }

        // Process games in batches
        const summary = await this.processGameBatch(games, options);

        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('PROCESSING SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total games: ${summary.totalGames}`);
        console.log(`Successfully processed: ${summary.totalProcessed}`);
        console.log(`Errors: ${summary.totalErrors}`);
        console.log(`Success rate: ${((summary.totalProcessed / summary.totalGames) * 100).toFixed(1)}%`);
        console.log(`Duration: ${summary.duration.toFixed(1)} seconds`);
        console.log(`Processing rate: ${summary.gamesPerSecond.toFixed(2)} games/second`);

        if (summary.totalErrors > 0) {
          console.log(`\nNote: ${summary.totalErrors} games failed to process. Check logs for details.`);
        }
      }

    } catch (error) {
      console.error('Script execution failed:', error.message);
      
      if (options && options.verbose) {
        console.error('Stack trace:', error.stack);
      }
      
      process.exit(1);
    } finally {
      // Clean up resources
      try {
        await this.extractor.close();
        if (dbConnection.isReady()) {
          await dbConnection.close();
        }
      } catch (error) {
        console.error('Error during cleanup:', error.message);
      }
    }
  }

  /**
   * Display feature extraction statistics
   * @returns {Promise<void>}
   */
  async displayStats() {
    try {
      if (!dbConnection.isReady()) {
        await dbConnection.initialize();
      }

      // Get processing statistics
      const totalGames = await dbConnection.get('SELECT COUNT(*) as count FROM game_ids');
      const processedGames = await dbConnection.get('SELECT COUNT(*) as count FROM game_ids WHERE processed = 1');
      const unprocessedGames = await dbConnection.get('SELECT COUNT(*) as count FROM game_ids WHERE processed = 0');

      // Get team statistics
      const totalTeams = await dbConnection.get('SELECT COUNT(*) as count FROM teams');
      const teamsWithRepresentation = await dbConnection.get(
        'SELECT COUNT(*) as count FROM teams WHERE statistical_representation IS NOT NULL'
      );

      console.log('\n' + '='.repeat(50));
      console.log('VAE FEATURE EXTRACTION STATISTICS');
      console.log('='.repeat(50));
      console.log(`Total games in database: ${totalGames.count}`);
      console.log(`Processed games: ${processedGames.count}`);
      console.log(`Unprocessed games: ${unprocessedGames.count}`);
      console.log(`Processing progress: ${((processedGames.count / totalGames.count) * 100).toFixed(1)}%`);
      console.log('');
      console.log(`Total teams: ${totalTeams.count}`);
      console.log(`Teams with latent representations: ${teamsWithRepresentation.count}`);
      console.log(`Team initialization progress: ${((teamsWithRepresentation.count / totalTeams.count) * 100).toFixed(1)}%`);

    } catch (error) {
      console.error('Failed to display statistics:', error.message);
    }
  }
}

// Handle command line execution
if (require.main === module) {
  const script = new VAEFeatureExtractionScript();
  
  // Check for stats command
  if (process.argv.includes('--stats')) {
    script.displayStats().then(() => process.exit(0));
  } else {
    script.run();
  }
}

module.exports = VAEFeatureExtractionScript;