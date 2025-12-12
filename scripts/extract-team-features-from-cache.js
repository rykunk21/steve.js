#!/usr/bin/env node

/**
 * Extract and store team features from cached training dataset
 * 
 * This script:
 * 1. Loads cached training data from data/training-dataset.json
 * 2. Verifies dataset contains game metadata, team stats, and transition probabilities
 * 3. Groups games by team for feature extraction
 * 4. Computes statistical representations using FeatureExtractor
 * 5. Stores feature vectors in teams.statistical_representation field
 * 6. Verifies feature quality by sampling teams
 */

const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const dbConnection = require('../src/database/connection');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const FeatureExtractor = require('../src/modules/sports/FeatureExtractor');

class CachedTeamFeatureExtractor {
  constructor() {
    this.teamRepo = new TeamRepository();
    this.featureExtractor = new FeatureExtractor();
    this.stats = {
      teamsProcessed: 0,
      teamsWithFeatures: 0,
      teamsWithoutGames: 0,
      totalGamesProcessed: 0,
      errors: 0
    };
    this.trainingData = null;
    this.gamesByTeam = new Map();
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
   * Load cached training data from JSON file
   */
  loadTrainingData() {
    try {
      const dataPath = path.join(__dirname, '../data/training-dataset.json');
      
      logger.info('Loading training dataset', { path: dataPath });
      
      const rawData = fs.readFileSync(dataPath, 'utf8');
      this.trainingData = JSON.parse(rawData);
      
      // Verify dataset structure
      if (!this.trainingData.metadata || !this.trainingData.dataset) {
        throw new Error('Invalid training dataset structure: missing metadata or dataset');
      }
      
      // Log dataset statistics
      const metadata = this.trainingData.metadata;
      logger.info('Training dataset loaded', {
        totalGames: metadata.totalGames,
        teamsProcessed: metadata.teamsProcessed,
        totalTeams: metadata.totalTeams,
        collectedAt: metadata.collectedAt,
        datasetSize: this.trainingData.dataset.length
      });
      
      // Verify each game has required fields
      const sampleGame = this.trainingData.dataset[0];
      if (!sampleGame.gameData || !sampleGame.transitionProbabilities) {
        throw new Error('Invalid game structure: missing gameData or transitionProbabilities');
      }
      
      logger.info('Dataset structure verified', {
        hasMetadata: !!sampleGame.gameData.metadata,
        hasTeams: !!sampleGame.gameData.teams,
        hasPlayByPlay: !!sampleGame.gameData.playByPlay,
        hasTransitionProbs: !!sampleGame.transitionProbabilities
      });
      
      return this.trainingData;
    } catch (error) {
      logger.error('Failed to load training data', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Group games by team for feature extraction
   */
  groupGamesByTeam() {
    try {
      logger.info('Grouping games by team');
      
      for (const entry of this.trainingData.dataset) {
        const { gameData } = entry;
        const { metadata, teams } = gameData;
        
        if (!teams || !teams.home || !teams.visitor) {
          logger.warn('Game missing team data', { gameId: metadata?.gameId });
          continue;
        }
        
        // Convert game data to format expected by FeatureExtractor
        const game = this.convertGameFormat(gameData);
        
        // Add to home team's games
        const homeTeamId = teams.home.id;
        if (!homeTeamId) {
          logger.warn('Home team missing ID', { gameId: metadata?.gameId });
          continue;
        }
        if (!this.gamesByTeam.has(homeTeamId)) {
          this.gamesByTeam.set(homeTeamId, []);
        }
        this.gamesByTeam.get(homeTeamId).push(game);
        
        // Add to visitor team's games
        const visitorTeamId = teams.visitor.id;
        if (!visitorTeamId) {
          logger.warn('Visitor team missing ID', { gameId: metadata?.gameId });
          continue;
        }
        if (!this.gamesByTeam.has(visitorTeamId)) {
          this.gamesByTeam.set(visitorTeamId, []);
        }
        this.gamesByTeam.get(visitorTeamId).push(game);
      }
      
      logger.info('Games grouped by team', {
        totalTeams: this.gamesByTeam.size,
        totalGames: this.trainingData.dataset.length
      });
      
      // Log sample team statistics
      const teamIds = Array.from(this.gamesByTeam.keys());
      if (teamIds.length > 0) {
        const sampleTeamId = teamIds[0];
        const sampleGames = this.gamesByTeam.get(sampleTeamId);
        logger.info('Sample team games', {
          teamId: sampleTeamId,
          gamesCount: sampleGames.length,
          dateRange: {
            earliest: sampleGames[0].gameDate,
            latest: sampleGames[sampleGames.length - 1].gameDate
          }
        });
      }
      
    } catch (error) {
      logger.error('Failed to group games by team', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Convert game data format to match FeatureExtractor expectations
   */
  convertGameFormat(gameData) {
    const { metadata, teams, status } = gameData;
    
    return {
      gameId: metadata.gameId,
      gameDate: metadata.gameDate || new Date().toISOString(),
      homeTeamId: teams.home.id,
      awayTeamId: teams.visitor.id,
      homeScore: teams.home.score || 0,
      awayScore: teams.visitor.score || 0,
      homeFieldGoalPct: teams.home.statistics?.fieldGoalPct || null,
      awayFieldGoalPct: teams.visitor.statistics?.fieldGoalPct || null,
      homeFreeThrowPct: teams.home.statistics?.freeThrowPct || null,
      awayFreeThrowPct: teams.visitor.statistics?.freeThrowPct || null,
      homeThreePointPct: teams.home.statistics?.threePointPct || null,
      awayThreePointPct: teams.visitor.statistics?.threePointPct || null,
      homeTurnovers: teams.home.statistics?.turnovers || null,
      awayTurnovers: teams.visitor.statistics?.turnovers || null,
      homeRebounds: teams.home.statistics?.rebounds || null,
      awayRebounds: teams.visitor.statistics?.rebounds || null,
      homeAssists: teams.home.statistics?.assists || null,
      awayAssists: teams.visitor.statistics?.assists || null,
      status: status?.type || 'final'
    };
  }

  /**
   * Extract features for all teams
   */
  async extractAllTeamFeatures() {
    try {
      logger.info('Starting team feature extraction from cached data');
      
      const teamIds = Array.from(this.gamesByTeam.keys());
      logger.info(`Found ${teamIds.length} teams to process`);
      
      if (teamIds.length === 0) {
        logger.warn('No teams found in cached data');
        return;
      }
      
      // Process teams in batches
      const batchSize = 10;
      for (let i = 0; i < teamIds.length; i += batchSize) {
        const batch = teamIds.slice(i, i + batchSize);
        await this.processBatch(batch, i + 1, teamIds.length);
      }
      
      // Log final statistics
      this.logFinalStats();
      
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
  async processBatch(teamIds, startIndex, totalTeams) {
    logger.info(`Processing batch ${Math.ceil(startIndex / 10)} - teams ${startIndex} to ${Math.min(startIndex + teamIds.length - 1, totalTeams)}`);
    
    for (const teamId of teamIds) {
      try {
        await this.extractTeamFeatures(teamId);
        this.stats.teamsProcessed++;
      } catch (error) {
        logger.error('Failed to process team', {
          teamId,
          error: error.message
        });
        this.stats.errors++;
      }
    }
  }

  /**
   * Extract features for a single team
   */
  async extractTeamFeatures(teamId) {
    const games = this.gamesByTeam.get(teamId);
    
    if (!games || games.length === 0) {
      logger.warn('No games found for team', { teamId });
      this.stats.teamsWithoutGames++;
      
      // Ensure team exists in database
      await this.ensureTeamExists(teamId);
      
      // Store default features
      const defaultFeatures = this.featureExtractor.getDefaultFeatures();
      await this.teamRepo.updateStatisticalRepresentation(teamId, {
        features: defaultFeatures,
        gamesCount: 0,
        lastUpdated: new Date().toISOString(),
        dataSource: 'default'
      });
      
      return;
    }
    
    // Sort games by date (oldest first)
    games.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
    
    // Extract features using FeatureExtractor
    const features = this.featureExtractor.extractFeatures(games, teamId);
    
    // Create statistical representation object
    const statisticalRepresentation = {
      features: features,
      gamesCount: games.length,
      lastUpdated: new Date().toISOString(),
      dataSource: 'training-dataset',
      featureDimension: this.featureExtractor.getFeatureDimension(),
      seasonRange: {
        earliest: games[0].gameDate,
        latest: games[games.length - 1].gameDate
      }
    };
    
    // Ensure team exists in database before updating
    await this.ensureTeamExists(teamId);
    
    // Store in database
    await this.teamRepo.updateStatisticalRepresentation(teamId, statisticalRepresentation);
    
    this.stats.teamsWithFeatures++;
    this.stats.totalGamesProcessed += games.length;
    
    logger.debug('Extracted features for team', {
      teamId,
      gamesCount: games.length,
      featureCount: features.length
    });
  }

  /**
   * Ensure team exists in database, create if not
   */
  async ensureTeamExists(teamId) {
    try {
      const existing = await this.teamRepo.getTeamByEspnId(teamId);
      
      if (!existing) {
        // Find team name from training data
        const teamName = this.getTeamNameFromTrainingData(teamId);
        
        // Create team record
        await this.teamRepo.saveTeam({
          teamId: teamId,
          teamName: teamName || teamId,
          sport: 'mens-college-basketball',
          statbroadcastGid: null
        });
        
        logger.info('Created team from training data', {
          teamId,
          teamName: teamName || teamId
        });
      }
    } catch (error) {
      logger.error('Failed to ensure team exists', {
        teamId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get team name from training data
   */
  getTeamNameFromTrainingData(teamId) {
    for (const entry of this.trainingData.dataset) {
      const { teams } = entry.gameData;
      
      if (teams?.home?.id === teamId) {
        return teams.home.displayName || teams.home.name || teamId;
      }
      
      if (teams?.visitor?.id === teamId) {
        return teams.visitor.displayName || teams.visitor.name || teamId;
      }
    }
    
    return null;
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
  async verifyFeatureQuality() {
    logger.info('Verifying feature quality...');
    
    const teamIds = Array.from(this.gamesByTeam.keys());
    const sampleSize = Math.min(10, teamIds.length);
    const sampleTeams = [];
    
    // Sample random teams
    for (let i = 0; i < sampleSize; i++) {
      const randomIndex = Math.floor(Math.random() * teamIds.length);
      sampleTeams.push(teamIds[randomIndex]);
    }
    
    for (const teamId of sampleTeams) {
      try {
        // Reload team to get updated statistical representation
        const team = await this.teamRepo.getTeamByEspnId(teamId);
        
        if (!team || !team.statisticalRepresentation) {
          logger.warn('Team has no statistical representation', { teamId });
          continue;
        }
        
        const representation = JSON.parse(team.statisticalRepresentation);
        
        // Verify feature vector properties
        const isValid = this.validateFeatureVector(representation.features);
        
        logger.info('Feature quality check', {
          teamId,
          teamName: team.teamName,
          gamesCount: representation.gamesCount,
          featureCount: representation.features.length,
          isValid: isValid,
          sampleFeatures: representation.features.slice(0, 5).map(f => f.toFixed(3)),
          dataSource: representation.dataSource,
          allFeaturesInRange: this.checkFeatureRange(representation.features)
        });
        
      } catch (error) {
        logger.error('Failed to verify team features', {
          teamId,
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
   * Check if all features are in [0, 1] range
   */
  checkFeatureRange(features) {
    return features.every(f => f >= 0 && f <= 1);
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
  const extractor = new CachedTeamFeatureExtractor();
  
  try {
    // Load training data first
    extractor.loadTrainingData();
    
    // Group games by team
    extractor.groupGamesByTeam();
    
    // Initialize database connection
    await extractor.initialize();
    
    // Extract features for all teams
    await extractor.extractAllTeamFeatures();
    
    // Verify feature quality
    await extractor.verifyFeatureQuality();
    
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

module.exports = CachedTeamFeatureExtractor;
