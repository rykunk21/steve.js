#!/usr/bin/env node

/**
 * Script to initialize team latent distributions for VAE-NN system
 * 
 * This script:
 * 1. Queries all teams from teams table
 * 2. Initializes statistical_representation with random N(μ=0, σ=1) distributions for 16 dimensions
 * 3. Stores initial distributions as JSON: {"mu": [16-array], "sigma": [16-array], "games_processed": 0}
 * 4. Verifies all teams have valid initial latent distributions
 * 5. Logs initialization statistics (teams initialized, distribution parameters)
 */

const dbConnection = require('../src/database/connection');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const logger = require('../src/utils/logger');

/**
 * Check if a team has recent games (within last 6 months)
 * @param {string} teamId - Team ID to check
 * @returns {Promise<boolean>} - True if team has recent games
 */
async function hasRecentGames(teamId) {
  try {
    // Check if team has any games in the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const recentGameCount = await dbConnection.get(`
      SELECT COUNT(*) as count 
      FROM game_ids 
      WHERE (home_team_id = ? OR away_team_id = ?) 
        AND game_date >= ?
    `, [teamId, teamId, sixMonthsAgo.toISOString().split('T')[0]]);
    
    return recentGameCount.count > 0;
  } catch (error) {
    // If we can't determine, assume no recent games (more conservative)
    logger.warn(`Could not check recent games for team ${teamId}: ${error.message}`);
    return false;
  }
}

/**
 * Generate random normal distribution parameters
 * @param {number} dimensions - Number of dimensions (16 for our VAE)
 * @param {boolean} hasRecentGames - Whether team has recent games (affects initial uncertainty)
 * @returns {Object} - Object with mu and sigma arrays
 */
function generateRandomLatentDistribution(dimensions = 16, hasRecentGames = false) {
  const mu = Array(dimensions).fill(0).map(() => 
    // Initialize with small random values around 0
    (Math.random() - 0.5) * 0.1
  );
  
  // Account for inter-year uncertainty: teams without recent games get higher initial σ values
  const baseSigma = hasRecentGames ? 1.0 : 1.5; // Higher uncertainty for teams without recent games
  const sigma = Array(dimensions).fill(0).map(() => 
    // Initialize with σ=1 (or 1.5 for stale teams) plus small random variation
    baseSigma * (0.8 + Math.random() * 0.4)  // Range: 0.8-1.2 * baseSigma
  );
  
  return {
    mu,
    sigma,
    games_processed: 0,
    last_season: "2024-25", // Current season tracking
    initialized_at: new Date().toISOString(),
    last_updated: new Date().toISOString()
  };
}

/**
 * Validate latent distribution structure
 * @param {Object} distribution - Distribution object to validate
 * @returns {boolean} - True if valid
 */
function validateLatentDistribution(distribution) {
  if (!distribution || typeof distribution !== 'object') {
    return false;
  }
  
  const { mu, sigma, games_processed, last_season } = distribution;
  
  // Check mu array
  if (!Array.isArray(mu) || mu.length !== 16) {
    return false;
  }
  
  // Check sigma array
  if (!Array.isArray(sigma) || sigma.length !== 16) {
    return false;
  }
  
  // Check all values are numbers
  if (!mu.every(val => typeof val === 'number' && !isNaN(val))) {
    return false;
  }
  
  if (!sigma.every(val => typeof val === 'number' && !isNaN(val) && val > 0)) {
    return false;
  }
  
  // Check games_processed is a number
  if (typeof games_processed !== 'number' || games_processed < 0) {
    return false;
  }
  
  // Check last_season is a string (optional for backward compatibility)
  if (last_season !== undefined && typeof last_season !== 'string') {
    return false;
  }
  
  return true;
}

/**
 * Calculate distribution statistics for logging
 * @param {Object} distribution - Distribution object
 * @returns {Object} - Statistics summary
 */
function calculateDistributionStats(distribution) {
  const { mu, sigma } = distribution;
  
  const muMean = mu.reduce((sum, val) => sum + val, 0) / mu.length;
  const muStd = Math.sqrt(mu.reduce((sum, val) => sum + Math.pow(val - muMean, 2), 0) / mu.length);
  
  const sigmaMean = sigma.reduce((sum, val) => sum + val, 0) / sigma.length;
  const sigmaMin = Math.min(...sigma);
  const sigmaMax = Math.max(...sigma);
  
  return {
    mu: { mean: muMean.toFixed(4), std: muStd.toFixed(4) },
    sigma: { mean: sigmaMean.toFixed(4), min: sigmaMin.toFixed(4), max: sigmaMax.toFixed(4) }
  };
}

async function initializeTeamLatentDistributions() {
  try {
    logger.info('Starting team latent distribution initialization...');
    
    // Initialize database connection
    await dbConnection.initialize();
    const teamRepo = new TeamRepository();
    
    // Get all teams
    logger.info('Querying all teams from database...');
    const teams = await teamRepo.getTeamsBySport('mens-college-basketball');
    logger.info(`Found ${teams.length} teams to initialize`);
    
    if (teams.length === 0) {
      logger.warn('No teams found in database. Run reseed-teams.js first.');
      process.exit(1);
    }
    
    // Initialize distributions
    let successCount = 0;
    let skipCount = 0;
    let failureCount = 0;
    let teamsWithRecentGames = 0;
    let teamsWithoutRecentGames = 0;
    const failures = [];
    const sampleDistributions = [];
    
    logger.info('Initializing latent distributions...');
    
    for (const team of teams) {
      try {
        // Check if team already has a valid distribution
        if (team.statisticalRepresentation) {
          try {
            const existing = JSON.parse(team.statisticalRepresentation);
            if (validateLatentDistribution(existing)) {
              skipCount++;
              logger.debug(`Skipping ${team.teamName} - already has valid distribution`);
              continue;
            }
          } catch (parseError) {
            logger.warn(`Invalid existing distribution for ${team.teamName}, reinitializing`);
          }
        }
        
        // Check if team has recent games for inter-year uncertainty adjustment
        const teamHasRecentGames = await hasRecentGames(team.teamId);
        if (teamHasRecentGames) {
          teamsWithRecentGames++;
        } else {
          teamsWithoutRecentGames++;
        }
        
        // Generate new random distribution with appropriate uncertainty
        const distribution = generateRandomLatentDistribution(16, teamHasRecentGames);
        
        // Validate the generated distribution
        if (!validateLatentDistribution(distribution)) {
          throw new Error('Generated invalid distribution');
        }
        
        // Update team in database
        await teamRepo.updateStatisticalRepresentation(team.teamId, distribution);
        
        successCount++;
        
        // Collect sample for logging (first 3 teams)
        if (sampleDistributions.length < 3) {
          sampleDistributions.push({
            teamName: team.teamName,
            teamId: team.teamId,
            hasRecentGames: teamHasRecentGames,
            stats: calculateDistributionStats(distribution)
          });
        }
        
        if (successCount % 50 === 0) {
          logger.info(`Progress: ${successCount} initialized, ${skipCount} skipped, ${failureCount} failed`);
        }
        
      } catch (error) {
        failureCount++;
        failures.push({
          teamName: team.teamName,
          teamId: team.teamId,
          error: error.message
        });
        logger.error(`Failed to initialize ${team.teamName} (${team.teamId}):`, error.message);
      }
    }
    
    // Log final statistics
    logger.info('='.repeat(70));
    logger.info('Team latent distribution initialization completed');
    logger.info(`Total teams processed: ${teams.length}`);
    logger.info(`Successfully initialized: ${successCount}`);
    logger.info(`Skipped (already initialized): ${skipCount}`);
    logger.info(`Failed: ${failureCount}`);
    logger.info(`Teams with recent games (σ=1.0): ${teamsWithRecentGames}`);
    logger.info(`Teams without recent games (σ=1.5): ${teamsWithoutRecentGames}`);
    logger.info('='.repeat(70));
    
    // Log sample distributions
    if (sampleDistributions.length > 0) {
      logger.info('Sample initialized distributions:');
      sampleDistributions.forEach(sample => {
        logger.info(`  ${sample.teamName} (${sample.teamId}):`);
        logger.info(`    Recent games: ${sample.hasRecentGames ? 'Yes' : 'No'}`);
        logger.info(`    μ: mean=${sample.stats.mu.mean}, std=${sample.stats.mu.std}`);
        logger.info(`    σ: mean=${sample.stats.sigma.mean}, range=[${sample.stats.sigma.min}, ${sample.stats.sigma.max}]`);
      });
    }
    
    if (failures.length > 0) {
      logger.warn('Failed initializations:');
      failures.forEach(f => {
        logger.warn(`  - ${f.teamName} (${f.teamId}): ${f.error}`);
      });
    }
    
    // Verify the results
    const verificationQuery = `
      SELECT 
        COUNT(*) as total_teams,
        COUNT(statistical_representation) as teams_with_distributions,
        COUNT(CASE WHEN statistical_representation IS NULL THEN 1 END) as teams_without_distributions
      FROM teams 
      WHERE sport = 'mens-college-basketball'
    `;
    
    const verification = await dbConnection.get(verificationQuery);
    logger.info('Verification results:');
    logger.info(`  Total teams: ${verification.total_teams}`);
    logger.info(`  Teams with distributions: ${verification.teams_with_distributions}`);
    logger.info(`  Teams without distributions: ${verification.teams_without_distributions}`);
    
    // Validate a few random distributions
    logger.info('Validating random sample of distributions...');
    const sampleTeams = await dbConnection.all(
      `SELECT team_id, team_name, statistical_representation 
       FROM teams 
       WHERE sport = 'mens-college-basketball' 
         AND statistical_representation IS NOT NULL 
       ORDER BY RANDOM() 
       LIMIT 3`
    );
    
    let validationErrors = 0;
    for (const team of sampleTeams) {
      try {
        const distribution = JSON.parse(team.statistical_representation);
        if (!validateLatentDistribution(distribution)) {
          logger.error(`Validation failed for ${team.team_name}: Invalid distribution structure`);
          validationErrors++;
        } else {
          const stats = calculateDistributionStats(distribution);
          logger.info(`✓ ${team.team_name}: Valid distribution (μ̄=${stats.mu.mean}, σ̄=${stats.sigma.mean})`);
        }
      } catch (error) {
        logger.error(`Validation failed for ${team.team_name}: ${error.message}`);
        validationErrors++;
      }
    }
    
    if (validationErrors === 0) {
      logger.info('✓ All sampled distributions are valid');
    } else {
      logger.error(`✗ ${validationErrors} validation errors found`);
    }
    
    await dbConnection.close();
    
    // Exit with appropriate code
    const hasErrors = failureCount > 0 || validationErrors > 0;
    process.exit(hasErrors ? 1 : 0);
    
  } catch (error) {
    logger.error('Team latent distribution initialization failed:', error);
    await dbConnection.close();
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  initializeTeamLatentDistributions();
}

module.exports = {
  initializeTeamLatentDistributions,
  generateRandomLatentDistribution,
  validateLatentDistribution,
  calculateDistributionStats,
  hasRecentGames
};