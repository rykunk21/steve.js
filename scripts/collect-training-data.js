#!/usr/bin/env node

/**
 * Script to collect training data from StatBroadcast
 * Fetches historical games and computes transition probabilities
 * 
 * Usage:
 *   node scripts/collect-training-data.js [options]
 * 
 * Options:
 *   --start-date YYYY-MM-DD  Start date for game filtering
 *   --end-date YYYY-MM-DD    End date for game filtering
 *   --max-games N            Maximum number of games to process (for testing)
 *   --output FILE            Output file for training data (JSON)
 *   --sample                 Sample mode: process only first 5 teams
 */

const TrainingDataPipeline = require('../src/modules/sports/TrainingDataPipeline');
const dbConnection = require('../src/database/connection');
const logger = require('../src/utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    startDate: null,
    endDate: null,
    maxGames: null,
    output: 'data/training-dataset.json',
    sample: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start-date':
        options.startDate = args[++i];
        break;
      case '--end-date':
        options.endDate = args[++i];
        break;
      case '--max-games':
        options.maxGames = parseInt(args[++i]);
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--sample':
        options.sample = true;
        break;
      case '--help':
        console.log(`
Usage: node scripts/collect-training-data.js [options]

Options:
  --start-date YYYY-MM-DD  Start date for game filtering
  --end-date YYYY-MM-DD    End date for game filtering
  --max-games N            Maximum number of games to process (for testing)
  --output FILE            Output file for training data (JSON)
  --sample                 Sample mode: process only first 5 teams
  --help                   Show this help message
        `);
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return options;
}

// Format duration in human-readable format
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Main execution
async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log('\n=== Training Data Collection ===\n');
  console.log('Configuration:');
  console.log(`  Start Date: ${options.startDate || 'All'}`);
  console.log(`  End Date: ${options.endDate || 'All'}`);
  console.log(`  Max Games: ${options.maxGames || 'Unlimited'}`);
  console.log(`  Output: ${options.output}`);
  console.log(`  Sample Mode: ${options.sample ? 'Yes (5 teams)' : 'No'}`);
  console.log('');

  try {
    // Initialize database connection
    await dbConnection.initialize();
    
    // Initialize pipeline
    const pipeline = new TrainingDataPipeline();

    // Step 1: Fetch game IDs from all teams
    console.log('Step 1: Fetching game IDs from team schedules...');
    const allGameIds = await pipeline.fetchAllTeamGames({
      startDate: options.startDate,
      endDate: options.endDate,
      continueOnError: true
    });

    const teams = Object.keys(allGameIds);
    console.log(`  ✓ Fetched schedules for ${teams.length} teams`);
    
    // Log extracted game IDs for debugging
    console.log('\n  Game IDs extracted by team:');
    const gameIdDebugData = [];
    for (const teamGid of teams) {
      const gameIds = allGameIds[teamGid];
      const url = `https://www.statbroadcast.com/events/schedule.php?gid=${teamGid}`;
      console.log(`    ${teamGid}: ${gameIds.length} games`);
      
      gameIdDebugData.push({
        teamGid,
        url,
        gameCount: gameIds.length,
        gameIds
      });
    }
    
    // Save game IDs to debug file
    const debugFile = 'data/game-ids-debug.json';
    await fs.writeFile(
      debugFile,
      JSON.stringify(gameIdDebugData, null, 2),
      'utf8'
    );
    console.log(`\n  ✓ Game IDs saved to ${debugFile} for debugging`);

    // Sample mode: limit to first 5 teams
    let teamsToProcess = teams;
    if (options.sample) {
      teamsToProcess = teams.slice(0, 5);
      console.log(`  ℹ Sample mode: processing only ${teamsToProcess.length} teams`);
    }

    // Collect all unique game IDs
    const gameIdSet = new Set();
    for (const team of teamsToProcess) {
      const teamGameIds = allGameIds[team];
      teamGameIds.forEach(id => gameIdSet.add(id));
    }

    let gameIds = Array.from(gameIdSet);
    const totalGames = gameIds.length;
    console.log(`  ✓ Found ${totalGames} unique games`);

    // Apply max games limit if specified
    if (options.maxGames && gameIds.length > options.maxGames) {
      gameIds = gameIds.slice(0, options.maxGames);
      console.log(`  ℹ Limited to ${options.maxGames} games for testing`);
    }

    // Step 2: Process games and compute transition probabilities
    console.log('\nStep 2: Processing games and computing transition probabilities...');
    console.log(`  Total games to process: ${gameIds.length}`);
    console.log('');

    const stats = {
      processed: 0,
      failed: 0,
      startTime: Date.now()
    };

    // Progress callback
    const onProgress = (current, total, gameId, error) => {
      if (error) {
        stats.failed++;
      } else {
        stats.processed++;
      }

      // Print progress every 10 games or on error
      if (current % 10 === 0 || error) {
        const elapsed = Date.now() - stats.startTime;
        const rate = stats.processed / (elapsed / 1000);
        const remaining = (total - current) / rate;

        console.log(`  Progress: ${current}/${total} (${stats.processed} ok, ${stats.failed} failed)`);
        console.log(`    Rate: ${rate.toFixed(2)} games/sec`);
        console.log(`    Estimated time remaining: ${formatDuration(remaining * 1000)}`);
        
        if (error) {
          console.log(`    ✗ Failed: ${gameId} - ${error.message}`);
        }
      }
    };

    // Build training dataset
    const dataset = await pipeline.buildTrainingDataset(gameIds, {
      continueOnError: true,
      onProgress
    });

    console.log('\n  ✓ Processing complete');
    console.log(`    Successful: ${dataset.length}`);
    console.log(`    Failed: ${stats.failed}`);
    console.log(`    Success rate: ${((dataset.length / gameIds.length) * 100).toFixed(1)}%`);

    // Step 3: Verify data quality by sampling
    console.log('\nStep 3: Verifying data quality...');
    
    if (dataset.length === 0) {
      console.log('  ✗ No games processed successfully');
      process.exit(1);
    }

    // Sample 5 random games for verification
    const sampleSize = Math.min(5, dataset.length);
    const samples = [];
    for (let i = 0; i < sampleSize; i++) {
      const randomIndex = Math.floor(Math.random() * dataset.length);
      samples.push(dataset[randomIndex]);
    }

    console.log(`  Sampling ${sampleSize} games for verification:`);
    for (const sample of samples) {
      const { gameData, transitionProbabilities } = sample;
      const visitor = gameData.teams.visitor;
      const home = gameData.teams.home;

      console.log(`\n    Game: ${visitor.name} @ ${home.name}`);
      console.log(`      Score: ${visitor.score} - ${home.score}`);
      console.log(`      Date: ${gameData.metadata.date}`);
      console.log(`      Play-by-play events: ${gameData.playByPlay.length}`);
      
      // Check visitor probabilities sum to ~1.0
      const visitorSum = Object.values(transitionProbabilities.visitor).reduce((a, b) => a + b, 0);
      const homeSum = Object.values(transitionProbabilities.home).reduce((a, b) => a + b, 0);
      
      console.log(`      Visitor prob sum: ${visitorSum.toFixed(4)} ${Math.abs(visitorSum - 1.0) < 0.01 ? '✓' : '✗'}`);
      console.log(`      Home prob sum: ${homeSum.toFixed(4)} ${Math.abs(homeSum - 1.0) < 0.01 ? '✓' : '✗'}`);
    }

    // Step 4: Save dataset to file
    console.log('\nStep 4: Saving training dataset...');
    
    // Ensure output directory exists
    const outputDir = path.dirname(options.output);
    await fs.mkdir(outputDir, { recursive: true });

    // Save dataset
    const outputData = {
      metadata: {
        collectedAt: new Date().toISOString(),
        totalGames: dataset.length,
        failedGames: stats.failed,
        startDate: options.startDate,
        endDate: options.endDate,
        teamsProcessed: teamsToProcess.length,
        totalTeams: teams.length,
        sampleMode: options.sample
      },
      dataset
    };

    await fs.writeFile(
      options.output,
      JSON.stringify(outputData, null, 2),
      'utf8'
    );

    const fileSize = (await fs.stat(options.output)).size;
    console.log(`  ✓ Saved to ${options.output}`);
    console.log(`    File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    // Final summary
    const totalTime = Date.now() - startTime;
    console.log('\n=== Summary ===\n');
    console.log(`  Total time: ${formatDuration(totalTime)}`);
    console.log(`  Teams processed: ${teamsToProcess.length}/${teams.length}`);
    console.log(`  Games found: ${totalGames}`);
    console.log(`  Games processed: ${gameIds.length}`);
    console.log(`  Successful: ${dataset.length}`);
    console.log(`  Failed: ${stats.failed}`);
    console.log(`  Success rate: ${((dataset.length / gameIds.length) * 100).toFixed(1)}%`);
    console.log(`  Average rate: ${(dataset.length / (totalTime / 1000)).toFixed(2)} games/sec`);
    console.log('');

    // Close browser and database connection
    console.log('\nCleaning up...');
    if (pipeline.fetcher && pipeline.fetcher.client) {
      await pipeline.fetcher.client.closeBrowser();
    }
    await dbConnection.close();
    
    process.exit(0);

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    logger.error('Training data collection failed', {
      error: error.message,
      stack: error.stack
    });
    
    // Close browser and database connection on error
    try {
      if (pipeline && pipeline.fetcher && pipeline.fetcher.client) {
        await pipeline.fetcher.client.closeBrowser();
      }
    } catch (closeError) {
      // Ignore close errors
    }
    
    try {
      await dbConnection.close();
    } catch (closeError) {
      // Ignore close errors
    }
    
    process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
