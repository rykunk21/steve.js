#!/usr/bin/env node

/**
 * Train VAE-NN System on Historical Games
 * 
 * This script implements task 3.2 from the implementation plan:
 * - Query unprocessed games from game_ids table ordered by game_date ASC
 * - For each game chronologically:
 *   - Fetch and parse XML to extract 88-dim normalized features
 *   - VAE encode game features to get team latent distributions
 *   - NN predict transition probabilities from team latents + context
 *   - Compute actual transition probabilities from play-by-play
 *   - Calculate NN cross-entropy loss vs actual probabilities
 *   - If loss > threshold: backprop NN loss through VAE (α coefficient)
 *   - Bayesian update team latent distributions based on performance
 *   - Mark game as processed
 */

const OnlineLearningOrchestrator = require('../src/modules/sports/OnlineLearningOrchestrator');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');

class VAENNTrainingScript {
  constructor() {
    this.orchestrator = new OnlineLearningOrchestrator({
      // VAE-NN feedback parameters
      feedbackThreshold: 0.5,     // NN loss threshold for VAE feedback
      initialAlpha: 0.1,          // Initial feedback coefficient
      alphaDecayRate: 0.99,       // Decay rate for feedback coefficient
      minAlpha: 0.001,            // Minimum feedback coefficient
      
      // Bayesian update parameters
      initialUncertainty: 1.0,    // Initial σ for new teams
      minUncertainty: 0.1,        // Minimum σ after many games
      uncertaintyDecayRate: 0.95, // How fast uncertainty decreases
      learningRate: 0.1,          // Base learning rate for updates
      
      // Training session parameters
      batchSize: 1,               // Process games one at a time for chronological order
      maxGamesPerSession: 100,    // Maximum games per training session
      saveInterval: 10,           // Save models every N games
      validationInterval: 25,     // Validate every N games
      
      // Error handling
      maxRetries: 3,              // Retry failed games up to 3 times
      continueOnError: true,      // Continue training if individual games fail
      rollbackOnError: true       // Rollback changes on game processing errors
    });

    this.stats = {
      totalGamesProcessed: 0,
      successfulGames: 0,
      failedGames: 0,
      startTime: null,
      endTime: null,
      errors: []
    };
  }

  /**
   * Main training function
   * @param {Object} options - Training options
   */
  async train(options = {}) {
    const {
      maxGames = 100,
      startFromGameId = null,
      dryRun = false,
      verbose = false
    } = options;

    try {
      this.stats.startTime = new Date();
      
      logger.info('Starting VAE-NN system training', {
        maxGames,
        startFromGameId,
        dryRun,
        verbose,
        timestamp: this.stats.startTime.toISOString()
      });

      // Initialize and check database connection
      await this.initializeDatabase();
      await this.checkDatabaseConnection();

      // Get training statistics before starting
      const preTrainingStats = await this.getTrainingStatistics();
      logger.info('Pre-training statistics', preTrainingStats);

      if (dryRun) {
        logger.info('Dry run mode - would process games but not make changes');
        return await this.performDryRun(maxGames, startFromGameId);
      }

      // Start the online learning process
      const results = await this.orchestrator.startOnlineLearning({
        maxGames,
        startFromGameId,
        onProgress: this.onProgress.bind(this),
        onGameComplete: this.onGameComplete.bind(this),
        onError: this.onError.bind(this)
      });

      this.stats.endTime = new Date();
      const duration = this.stats.endTime - this.stats.startTime;

      // Get post-training statistics
      const postTrainingStats = await this.getTrainingStatistics();

      // Log final results
      logger.info('VAE-NN training completed', {
        duration: `${Math.round(duration / 1000)}s`,
        ...results.summary,
        preTrainingStats,
        postTrainingStats
      });

      // Display training summary
      this.displayTrainingSummary(results, preTrainingStats, postTrainingStats, duration);

      return results;

    } catch (error) {
      logger.error('VAE-NN training failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Initialize database connection
   */
  async initializeDatabase() {
    try {
      logger.info('Initializing database connection');
      await dbConnection.initialize();
      logger.info('Database connection initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check database connection and table structure
   */
  async checkDatabaseConnection() {
    try {
      // Test database connection
      await dbConnection.get('SELECT 1');
      
      // Check required tables exist
      const tables = await dbConnection.all(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('teams', 'game_ids')
      `);
      
      if (tables.length !== 2) {
        throw new Error('Required database tables (teams, game_ids) not found');
      }

      // Check for unprocessed games (NCAA basketball only)
      const unprocessedCount = await dbConnection.get(`
        SELECT COUNT(*) as count FROM game_ids 
        WHERE processed = 0 AND sport = 'mens-college-basketball'
      `);

      logger.info('Database connection verified', {
        unprocessedGames: unprocessedCount.count
      });

      if (unprocessedCount.count === 0) {
        logger.warn('No unprocessed games found in database');
      }

    } catch (error) {
      logger.error('Database connection check failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get current training statistics
   */
  async getTrainingStatistics() {
    try {
      const stats = await dbConnection.all(`
        SELECT 
          COUNT(*) as totalGames,
          SUM(CASE WHEN processed = 1 THEN 1 ELSE 0 END) as processedGames,
          SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) as unprocessedGames,
          MIN(game_date) as earliestGame,
          MAX(game_date) as latestGame,
          COUNT(DISTINCT home_team_id) + COUNT(DISTINCT away_team_id) as uniqueTeams
        FROM game_ids
        WHERE sport = 'mens-college-basketball'
      `);

      const teamStats = await dbConnection.all(`
        SELECT 
          COUNT(*) as totalTeams,
          SUM(CASE WHEN statistical_representation IS NOT NULL THEN 1 ELSE 0 END) as teamsWithDistributions
        FROM teams
        WHERE sport = 'mens-college-basketball'
      `);

      return {
        games: stats[0],
        teams: teamStats[0]
      };

    } catch (error) {
      logger.error('Failed to get training statistics', {
        error: error.message
      });
      return { games: {}, teams: {} };
    }
  }

  /**
   * Perform a dry run to show what would be processed
   */
  async performDryRun(maxGames, startFromGameId) {
    try {
      logger.info('Performing dry run analysis');

      // Get games that would be processed (NCAA basketball only)
      let sql = `
        SELECT game_id, game_date, home_team_id, away_team_id 
        FROM game_ids 
        WHERE processed = 0 AND sport = 'mens-college-basketball'
      `;
      
      const params = [];
      
      if (startFromGameId) {
        sql += ` AND game_date >= (SELECT game_date FROM game_ids WHERE game_id = ?)`;
        params.push(startFromGameId);
      }
      
      sql += ` ORDER BY game_date ASC, game_id ASC`;
      
      if (maxGames) {
        sql += ` LIMIT ?`;
        params.push(maxGames);
      }

      const games = await dbConnection.all(sql, params);

      logger.info('Dry run results', {
        gamesFound: games.length,
        dateRange: games.length > 0 ? {
          earliest: games[0].game_date,
          latest: games[games.length - 1].game_date
        } : null,
        sampleGames: games.slice(0, 5).map(g => ({
          gameId: g.game_id,
          date: g.game_date,
          homeTeam: g.home_team_id,
          awayTeam: g.away_team_id
        }))
      });

      return {
        dryRun: true,
        summary: {
          totalGamesProcessed: games.length,
          successfulGames: games.length,
          failedGames: 0,
          successRate: 100,
          averageProcessingTime: 0,
          totalProcessingTime: 0,
          modelSaves: 0,
          validationRuns: 0
        },
        lastProcessed: {
          gameId: null,
          gameDate: null
        },
        errors: [],
        trainerStats: null,
        gamesFound: games.length,
        games: games
      };

    } catch (error) {
      logger.error('Dry run failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Progress callback for training
   */
  async onProgress(current, total, result) {
    const percentage = ((current / total) * 100).toFixed(1);
    
    logger.info('Training progress', {
      current,
      total,
      percentage: `${percentage}%`,
      gameId: result?.gameId,
      processingTime: result?.processingTime ? `${result.processingTime}ms` : null
    });

    // Update internal stats
    this.stats.totalGamesProcessed = current;
  }

  /**
   * Game completion callback
   */
  async onGameComplete(result, gameIndex, totalGames) {
    this.stats.successfulGames++;

    logger.info('Game training completed', {
      gameId: result.gameId,
      gameIndex,
      totalGames,
      homeTeam: result.teams.home.name,
      awayTeam: result.teams.away.name,
      homeScore: result.teams.home.score,
      awayScore: result.teams.away.score,
      losses: {
        home: result.losses.home.toFixed(6),
        away: result.losses.away.toFixed(6),
        feedbackTriggered: result.losses.feedbackTriggered
      },
      processingTime: `${result.processingTime}ms`
    });

    // Log team distribution updates
    if (result.teams.home.updateResult) {
      logger.debug('Home team distribution updated', {
        teamId: result.teams.home.id,
        gamesProcessed: result.teams.home.updateResult.games_processed,
        confidence: result.teams.home.updateResult.confidence.toFixed(3)
      });
    }

    if (result.teams.away.updateResult) {
      logger.debug('Away team distribution updated', {
        teamId: result.teams.away.id,
        gamesProcessed: result.teams.away.updateResult.games_processed,
        confidence: result.teams.away.updateResult.confidence.toFixed(3)
      });
    }
  }

  /**
   * Error callback for training
   */
  async onError(error, gameInfo, gameIndex) {
    this.stats.failedGames++;
    this.stats.errors.push({
      gameId: gameInfo.game_id,
      gameIndex,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    logger.error('Game training failed', {
      gameId: gameInfo.game_id,
      gameIndex,
      homeTeam: gameInfo.home_team_id,
      awayTeam: gameInfo.away_team_id,
      error: error.message
    });
  }

  /**
   * Display comprehensive training summary
   */
  displayTrainingSummary(results, preStats, postStats, duration) {
    console.log('\n' + '='.repeat(80));
    console.log('VAE-NN TRAINING SUMMARY');
    console.log('='.repeat(80));
    
    console.log('\nTraining Session:');
    console.log(`  Duration: ${Math.round(duration / 1000)}s`);
    console.log(`  Games Processed: ${results.summary.totalGamesProcessed}`);
    console.log(`  Success Rate: ${results.summary.successRate.toFixed(1)}%`);
    console.log(`  Average Processing Time: ${results.summary.averageProcessingTime.toFixed(0)}ms per game`);
    
    console.log('\nModel Performance:');
    console.log(`  Model Saves: ${results.summary.modelSaves}`);
    console.log(`  Validation Runs: ${results.summary.validationRuns}`);
    
    if (results.trainerStats) {
      console.log(`  Convergence Achieved: ${results.trainerStats.convergenceAchieved ? 'Yes' : 'No'}`);
      console.log(`  Average NN Loss: ${results.trainerStats.averageNNLoss?.toFixed(6) || 'N/A'}`);
      console.log(`  Average VAE Loss: ${results.trainerStats.averageVAELoss?.toFixed(6) || 'N/A'}`);
      console.log(`  Feedback Triggers: ${results.trainerStats.feedbackTriggers || 0}`);
      const currentAlpha = results.trainerStats.stability?.currentAlpha;
      console.log(`  Current Alpha: ${currentAlpha !== undefined ? currentAlpha.toFixed(6) : 'N/A'}`);
    }

    console.log('\nDatabase Changes:');
    console.log(`  Games Before: ${preStats.games.processedGames || 0} processed, ${preStats.games.unprocessedGames || 0} unprocessed`);
    console.log(`  Games After: ${postStats.games.processedGames || 0} processed, ${postStats.games.unprocessedGames || 0} unprocessed`);
    console.log(`  Teams with Distributions: ${postStats.teams.teamsWithDistributions || 0} / ${postStats.teams.totalTeams || 0}`);

    if (results.errors && results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.slice(0, 5).forEach(error => {
        console.log(`  ${error.gameId}: ${error.error}`);
      });
      if (results.errors.length > 5) {
        console.log(`  ... and ${results.errors.length - 5} more errors`);
      }
    }

    console.log('\n' + '='.repeat(80));
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      await this.orchestrator.close();
      logger.debug('Training script cleanup completed');
    } catch (error) {
      logger.error('Error during cleanup', {
        error: error.message
      });
    }
  }

  /**
   * Stop training gracefully
   */
  stop() {
    logger.info('Stopping VAE-NN training');
    this.orchestrator.stop();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--max-games' && i + 1 < args.length) {
      options.maxGames = parseInt(args[++i]);
    } else if (arg === '--start-from' && i + 1 < args.length) {
      options.startFromGameId = args[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--help') {
      console.log(`
Usage: node scripts/train-vae-nn-system.js [options]

Options:
  --max-games <number>     Maximum number of games to process (default: 100)
  --start-from <game-id>   Start processing from specific game ID
  --dry-run               Show what would be processed without making changes
  --verbose               Enable verbose logging
  --help                  Show this help message

Examples:
  node scripts/train-vae-nn-system.js --max-games 50
  node scripts/train-vae-nn-system.js --dry-run
  node scripts/train-vae-nn-system.js --start-from "game123" --max-games 25
      `);
      process.exit(0);
    }
  }

  const trainer = new VAENNTrainingScript();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, stopping training gracefully...');
    trainer.stop();
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, stopping training gracefully...');
    trainer.stop();
  });

  try {
    const results = await trainer.train(options);
    
    if (results.summary.failedGames > 0) {
      process.exit(1); // Exit with error code if some games failed
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Training failed:', error.message);
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

module.exports = VAENNTrainingScript;