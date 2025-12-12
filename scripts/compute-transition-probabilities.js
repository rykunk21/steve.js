#!/usr/bin/env node

/**
 * Script to compute and store transition probabilities for historical games
 * Processes all games with play-by-play data and stores the computed probabilities
 */

const path = require('path');
const dbConnection = require('../src/database/connection');
const XMLGameParser = require('../src/modules/sports/XMLGameParser');
const TransitionProbabilityComputer = require('../src/modules/sports/TransitionProbabilityComputer');
const logger = require('../src/utils/logger');

async function computeTransitionProbabilities() {
  // Initialize database if not already initialized
  if (!dbConnection.isReady()) {
    await dbConnection.initialize();
  }
  const parser = new XMLGameParser();
  const computer = new TransitionProbabilityComputer();

  try {
    logger.info('Starting transition probability computation');

    // Get all games with play-by-play data
    const games = await dbConnection.all(`
      SELECT id, statbroadcast_game_id, home_team_id, away_team_id
      FROM historical_games
      WHERE has_play_by_play = 1
        AND statbroadcast_game_id IS NOT NULL
        AND transition_probabilities IS NULL
      ORDER BY game_date ASC
    `);

    logger.info(`Found ${games.length} games to process`);

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const game of games) {
      try {
        logger.info(`Processing game ${game.id}`, {
          gameId: game.id,
          sbId: game.statbroadcast_game_id,
          progress: `${processed + failed + skipped + 1}/${games.length}`
        });

        // Fetch XML data from StatBroadcast archive
        const xmlUrl = `http://archive.statbroadcast.com/${game.statbroadcast_game_id}.xml`;
        const response = await fetch(xmlUrl);

        if (!response.ok) {
          logger.warn(`Failed to fetch XML for game ${game.id}`, {
            status: response.status,
            url: xmlUrl
          });
          skipped++;
          continue;
        }

        const xmlData = await response.text();

        // Parse XML
        const gameData = await parser.parseGameXML(xmlData);

        // Check if we have play-by-play data
        if (!gameData.playByPlay || gameData.playByPlay.length === 0) {
          logger.warn(`No play-by-play data for game ${game.id}`);
          skipped++;
          continue;
        }

        // Compute transition probabilities
        const probabilities = computer.computeTransitionProbabilities(gameData);

        // Validate probabilities
        const visitorValid = computer.validateProbabilities(probabilities.visitor);
        const homeValid = computer.validateProbabilities(probabilities.home);

        if (!visitorValid || !homeValid) {
          logger.error(`Invalid probabilities for game ${game.id}`, {
            visitorValid,
            homeValid,
            visitor: probabilities.visitor,
            home: probabilities.home
          });
          failed++;
          continue;
        }

        // Store probabilities as JSON
        const probabilitiesJson = JSON.stringify(probabilities);

        await dbConnection.run(`
          UPDATE historical_games
          SET transition_probabilities = ?
          WHERE id = ?
        `, [probabilitiesJson, game.id]);

        logger.info(`Stored transition probabilities for game ${game.id}`, {
          visitorProbs: probabilities.visitor,
          homeProbs: probabilities.home
        });

        processed++;

        // Rate limiting - wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error(`Failed to process game ${game.id}`, {
          error: error.message,
          stack: error.stack
        });
        failed++;
      }
    }

    logger.info('Transition probability computation complete', {
      total: games.length,
      processed,
      failed,
      skipped
    });

    // Sample some games to verify data quality
    logger.info('Sampling games to verify data quality...');
    
    const samples = await dbConnection.all(`
      SELECT id, home_team_id, away_team_id, transition_probabilities
      FROM historical_games
      WHERE transition_probabilities IS NOT NULL
      ORDER BY RANDOM()
      LIMIT 5
    `);

    for (const sample of samples) {
      const probs = JSON.parse(sample.transition_probabilities);
      logger.info(`Sample game ${sample.id}`, {
        homeTeam: sample.home_team_id,
        awayTeam: sample.away_team_id,
        visitorProbs: probs.visitor,
        homeProbs: probs.home
      });
    }

  } catch (error) {
    logger.error('Fatal error during transition probability computation', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Run the script
if (require.main === module) {
  computeTransitionProbabilities()
    .then(() => {
      logger.info('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Script failed', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

module.exports = { computeTransitionProbabilities };

