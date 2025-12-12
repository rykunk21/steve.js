#!/usr/bin/env node

/**
 * Analyze training dataset to verify it contains only basketball games
 * 
 * Usage:
 *   node scripts/analyze-training-dataset.js [dataset-file]
 * 
 * Default dataset file: data/training-dataset.json
 */

const fs = require('fs').promises;
const path = require('path');

async function analyzeDataset(datasetFile) {
  try {
    console.log('\n=== Training Dataset Analysis ===\n');
    console.log(`Analyzing: ${datasetFile}\n`);

    // Read dataset
    const data = await fs.readFile(datasetFile, 'utf8');
    const dataset = JSON.parse(data);

    if (!dataset.dataset || !Array.isArray(dataset.dataset)) {
      console.error('Invalid dataset format: missing dataset array');
      process.exit(1);
    }

    const games = dataset.dataset;
    console.log(`Total games in dataset: ${games.length}\n`);

    // Analyze sports distribution
    const sportCounts = {};
    const sportExamples = {};
    const basketballGames = [];
    const nonBasketballGames = [];

    for (const game of games) {
      const gameData = game.gameData;
      
      if (!gameData || !gameData.metadata) {
        console.warn(`Warning: Game ${game.gameId} missing metadata`);
        continue;
      }

      // Try to determine sport from various indicators
      let sport = 'unknown';
      
      // Check competition name
      if (gameData.metadata.competitionName) {
        const compName = gameData.metadata.competitionName.toLowerCase();
        if (compName.includes('basketball') || compName.includes('bball') || compName.includes('hoops')) {
          sport = 'basketball';
        } else if (compName.includes('football')) {
          sport = 'football';
        } else if (compName.includes('volleyball')) {
          sport = 'volleyball';
        } else if (compName.includes('soccer')) {
          sport = 'soccer';
        } else if (compName.includes('hockey')) {
          sport = 'hockey';
        } else if (compName.includes('baseball')) {
          sport = 'baseball';
        }
      }

      // Check team stats for basketball indicators
      if (sport === 'unknown' && gameData.teams) {
        const visitor = gameData.teams.visitor;
        const home = gameData.teams.home;
        
        // Basketball typically has:
        // - Field goals (2pt and 3pt)
        // - Free throws
        // - Scores in 60-120 range typically
        if (visitor && home && visitor.stats && home.stats) {
          const hasThreePointers = visitor.stats.fg3m !== undefined || home.stats.fg3m !== undefined;
          const hasFreeThrows = visitor.stats.ftm !== undefined || home.stats.ftm !== undefined;
          const scoreRange = (visitor.score >= 40 && visitor.score <= 150) && 
                            (home.score >= 40 && home.score <= 150);
          
          if (hasThreePointers && hasFreeThrows && scoreRange) {
            sport = 'basketball';
          }
        }
      }

      // Count by sport
      sportCounts[sport] = (sportCounts[sport] || 0) + 1;

      // Store examples
      if (!sportExamples[sport]) {
        sportExamples[sport] = [];
      }
      
      if (sportExamples[sport].length < 3) {
        sportExamples[sport].push({
          gameId: game.gameId,
          date: gameData.metadata.date,
          visitor: gameData.teams?.visitor?.name,
          home: gameData.teams?.home?.name,
          score: `${gameData.teams?.visitor?.score || 0} - ${gameData.teams?.home?.score || 0}`,
          competitionName: gameData.metadata.competitionName
        });
      }

      // Categorize
      if (sport === 'basketball') {
        basketballGames.push(game);
      } else {
        nonBasketballGames.push(game);
      }
    }

    // Print results
    console.log('Sport Distribution:');
    console.log('─'.repeat(60));
    
    const sortedSports = Object.entries(sportCounts).sort((a, b) => b[1] - a[1]);
    
    for (const [sport, count] of sortedSports) {
      const percentage = ((count / games.length) * 100).toFixed(1);
      console.log(`  ${sport.padEnd(20)} ${count.toString().padStart(6)} games (${percentage}%)`);
    }
    
    console.log('─'.repeat(60));
    console.log(`  ${'TOTAL'.padEnd(20)} ${games.length.toString().padStart(6)} games\n`);

    // Show examples for each sport
    console.log('Examples by Sport:');
    console.log('─'.repeat(60));
    
    for (const [sport, examples] of Object.entries(sportExamples)) {
      console.log(`\n${sport.toUpperCase()}:`);
      for (const ex of examples) {
        console.log(`  Game ${ex.gameId}: ${ex.visitor} vs ${ex.home}`);
        console.log(`    Score: ${ex.score}, Date: ${ex.date}`);
        console.log(`    Competition: ${ex.competitionName || 'N/A'}`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Basketball games: ${basketballGames.length} (${((basketballGames.length / games.length) * 100).toFixed(1)}%)`);
    console.log(`Non-basketball games: ${nonBasketballGames.length} (${((nonBasketballGames.length / games.length) * 100).toFixed(1)}%)`);
    
    if (nonBasketballGames.length > 0) {
      console.log('\n⚠️  WARNING: Dataset contains non-basketball games!');
      console.log('   The training data needs to be filtered to only include basketball.');
    } else {
      console.log('\n✓ Dataset contains only basketball games');
    }
    
    console.log('');

    // Save filtered dataset if needed
    if (nonBasketballGames.length > 0) {
      const filteredFile = datasetFile.replace('.json', '-basketball-only.json');
      const filteredDataset = {
        ...dataset,
        metadata: {
          ...dataset.metadata,
          filteredAt: new Date().toISOString(),
          originalTotal: games.length,
          filteredTotal: basketballGames.length,
          removedGames: nonBasketballGames.length
        },
        dataset: basketballGames
      };

      await fs.writeFile(
        filteredFile,
        JSON.stringify(filteredDataset, null, 2),
        'utf8'
      );

      console.log(`Filtered dataset saved to: ${filteredFile}`);
      console.log(`  Original: ${games.length} games`);
      console.log(`  Filtered: ${basketballGames.length} games`);
      console.log('');
    }

  } catch (error) {
    console.error('Error analyzing dataset:', error.message);
    process.exit(1);
  }
}

// Main execution
const datasetFile = process.argv[2] || 'data/training-dataset.json';

analyzeDataset(datasetFile).catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
