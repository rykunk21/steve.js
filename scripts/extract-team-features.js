#!/usr/bin/env node

/**
 * Extract and store team features for MLP training
 * 
 * This script:
 * 1. Loads all teams from the teams table
 * 2. Fetches historical game data for each team
 * 3. Computes statistical representations using FeatureExtractor
 * 4. Stores feature vectors in teams.statistical_representation field
 * 5. Verifies feature quality by sampling teams
 */

const path = require('path');
const logger = require('../src/utils/logger');
const dbConnection = require('../src/database/connection');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const HistoricalGameRepository = require('../src/database/repositories/HistoricalGameRepository');
const FeatureExtractor = require('../src/modules/sports/FeatureExtractor');

class TeamFeatureExtractor {
  constructor() {
    this.teamRepo = new TeamRepository();
    this.gameRepo = new HistoricalGameRepository();
    this.featureExtractor = new FeatureExtractor();
    this.stats = {
      teamsProcessed: 0,
      teamsWithFeatures: 0,
      teamsWithoutGames: 0,
      totalGamesProcessed: 0,
      errors: 0
    };
  }

  /**
   * Initialize database connection
   */
  async initialize() {
    try {
      await dbConnection.initialize();
      logger.info('Database connection initialized for feature extraction');
    } catch (error) {
      logger.error('Failed to initialize database connection', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Extract features for all teams
   */
  async extractAllTeamFeatures() {
    try {
      logger.info('Starting team feature extraction');

      // Get all NCAA basketball teams
      const teams = await this.teamRepo.getTeamsBySport('mens-college-basketball');
      logger.info(`Found ${teams.length} teams to process`);

      if (teams.length === 0) {
        logger.warn('No teams found in database. Run team seeding first.');
        return;
      }

      // Process teams in batches to avoid memory issues
      const batchSize = 10;
      for (let i = 0; i < teams.length; i += batchSize) {
        const batch = teams.slice(i, i + batchSize);
        await this.processBatch(batch, i + 1, teams.length);
      }

      // Log final statistics
      this.logFinalStats();

      // Sample and verify feature quality
      await this.verifyFeatureQuality(teams);

    } catch (error) {
      logger.error('Failed to extract team features', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Process a batch of teams
   */
  async processBatch(teams, startIndex, totalTeams) {
    logger.info(`Processing batch ${Math.ceil(startIndex / 10)} - teams ${startIndex} to ${Math.min(startIndex + teams.length - 1, totalTeams)}`);

    for (const team of teams) {
      try {
        await this.extractTeamFeatures(team);
        this.stats.teamsProcessed++;
      } catch (error) {
        logger.error('Failed to process team', {
          teamId: team.teamId,
          teamName: team.teamName,
          error: error.message
        });
        this.stats.errors++;
      }
    }
  }

  /**
   * Extract features for a single team
   */
  async extractTeamFeatures(team) {
    const currentSeason = new Date().getFullYear();
    
    // Try current season first, then previous season if no games
    let games = await this.gameRepo.getTeamGameHistory(team.teamId, currentSeason, 50);
    
    if (games.length === 0) {
      // Try previous season
      games = await this.gameRepo.getTeamGameHistory(team.teamId, currentSeason - 1, 50);
    }

    if (games.length === 0) {
      logger.warn('No historical games found for team', {
        teamId: team.teamId,
        teamName: team.teamName
      });
      this.stats.teamsWithoutGames++;
      
      // Store default features for teams without games
      const defaultFeatures = this.featureExtractor.getDefaultFeatures();
      await this.teamRepo.updateStatisticalRepresentation(team.teamId, {
        features: defaultFeatures,
        gamesCount: 0,
        lastUpdated: new Date().toISOString(),
        dataSource: 'default'
      });
      
      return;
    }

    // Sort games by date (oldest first for proper feature calculation)
    games.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

    // Extract features using FeatureExtractor
    const features = this.featureExtractor.extractFeatures(games, team.teamId);

    // Create statistical representation object
    const statisticalRepresentation = {
      features: features,
      gamesCount: games.length,
      lastUpdated: new Date().toISOString(),
      dataSource: 'historical_games',
      featureDimension: this.featureExtractor.getFeatureDimension(),
      seasonRange: {
        earliest: games[0].gameDate,
        latest: games[games.length - 1].gameDate
      }
    };

    // Store in database
    await this.teamRepo.updateStatisticalRepresentation(team.teamId, statisticalRepresentation);

    this.stats.teamsWithFeatures++;
    this.stats.totalGamesProcessed += games.length;

    logger.debug('Extracted features for team', {
      teamId: team.teamId,
      teamName: team.teamName,
      gamesCount: games.length,
      featureCount: features.length
    });
  }

  /**
   * Log final extraction statistics
   */
  logFinalStats() {
    logger.info('Team feature extraction completed', {
      teamsProcessed: this.stats.teamsProcessed,
      teamsWithFeatures: this.stats.teamsWithFeatures,
      teamsWithoutGames: this.stats.teamsWithoutGames,
      totalGamesProcessed: this.stats.totalGamesProcessed,
      errors: this.stats.errors,
      avgGamesPerTeam: this.stats.teamsWithFeatures > 0 
        ? (this.stats.totalGamesProcessed / this.stats.teamsWithFeatures).toFixed(1)
        : 0
    });
  }

  /**
   * Verify feature quality by sampling teams
   */
  async verifyFeatureQuality(teams) {
    logger.info('Verifying feature quality...');

    // Sample 5 teams for verification
    const sampleSize = Math.min(5, teams.length);
    const sampleTeams = [];
    
    for (let i = 0; i < sampleSize; i++) {
      const randomIndex = Math.floor(Math.random() * teams.length);
      sampleTeams.push(teams[randomIndex]);
    }

    for (const team of sampleTeams) {
      try {
        // Reload team to get updated statistical representation
        const updatedTeam = await this.teamRepo.getTeamByEspnId(team.teamId);
        
        if (!updatedTeam.statisticalRepresentation) {
          logger.warn('Team has no statistical representation', {
            teamId: team.teamId,
            teamName: team.teamName
          });
          continue;
        }

        const representation = JSON.parse(updatedTeam.statisticalRepresentation);
        
        // Verify feature vector properties
        const isValid = this.validateFeatureVector(representation.features);
        
        logger.info('Feature quality check', {
          teamId: team.teamId,
          teamName: team.teamName,
          gamesCount: representation.gamesCount,
          featureCount: representation.features.length,
          isValid: isValid,
          sampleFeatures: representation.features.slice(0, 5).map(f => f.toFixed(3)),
          dataSource: representation.dataSource
        });

      } catch (error) {
        logger.error('Failed to verify team features', {
          teamId: team.teamId,
          error: error.message
        });
      }
    }
  }

  /**
   * Validate feature vector properties
   */
  validateFeatureVector(features) {
    if (!Array.isArray(features)) {
      return false;
    }

    if (features.length !== this.featureExtractor.getFeatureDimension()) {
      return false;
    }

    // Check that all features are numbers in [0, 1] range
    for (const feature of features) {
      if (typeof feature !== 'number' || isNaN(feature)) {
        return false;
      }
      if (feature < 0 || feature > 1) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get extraction statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

// Main execution
async function main() {
  const extractor = new TeamFeatureExtractor();
  
  try {
    // Initialize database connection first
    await extractor.initialize();
    
    await extractor.extractAllTeamFeatures();
    
    const stats = extractor.getStats();
    console.log('\n=== Feature Extraction Summary ===');
    console.log(`Teams processed: ${stats.teamsProcessed}`);
    console.log(`Teams with features: ${stats.teamsWithFeatures}`);
    console.log(`Teams without games: ${stats.teamsWithoutGames}`);
    console.log(`Total games processed: ${stats.totalGamesProcessed}`);
    console.log(`Errors: ${stats.errors}`);
    
    if (stats.teamsWithFeatures > 0) {
      const avgGames = (stats.totalGamesProcessed / stats.teamsWithFeatures).toFixed(1);
      console.log(`Average games per team: ${avgGames}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Feature extraction failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = TeamFeatureExtractor;