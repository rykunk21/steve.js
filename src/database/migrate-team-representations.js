const dbConnection = require('./connection');
const TeamRepository = require('./repositories/TeamRepository');
const logger = require('../utils/logger');

/**
 * Migration utility to convert existing team representations to posterior format
 * This script handles backward compatibility and data validation
 */
class TeamRepresentationMigrator {
  constructor() {
    this.teamRepo = new TeamRepository();
    this.db = dbConnection;
  }

  /**
   * Run the complete migration process
   */
  async migrate() {
    try {
      logger.info('Starting team representation migration...');

      // Ensure database is connected
      if (!this.db.isReady()) {
        await this.db.initialize();
      }

      // Backup existing data
      await this.backupExistingData();

      // Get all teams with statistical representations
      const teams = await this.getAllTeamsWithRepresentations();
      logger.info(`Found ${teams.length} teams with statistical representations`);

      let migrated = 0;
      let skipped = 0;
      let errors = 0;

      for (const team of teams) {
        try {
          const migrationResult = await this.migrateTeamRepresentation(team);
          
          if (migrationResult.migrated) {
            migrated++;
            logger.debug(`Migrated team: ${team.team_name} (${team.team_id})`);
          } else {
            skipped++;
            logger.debug(`Skipped team: ${team.team_name} (${team.team_id}) - ${migrationResult.reason}`);
          }
        } catch (error) {
          errors++;
          logger.error(`Failed to migrate team: ${team.team_name} (${team.team_id})`, {
            error: error.message
          });
        }
      }

      // Validate migration results
      await this.validateMigration();

      logger.info('Team representation migration completed', {
        total: teams.length,
        migrated,
        skipped,
        errors
      });

      return {
        success: true,
        total: teams.length,
        migrated,
        skipped,
        errors
      };
    } catch (error) {
      logger.error('Team representation migration failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Backup existing team data before migration
   */
  async backupExistingData() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupTable = `teams_backup_${timestamp.substring(0, 19)}`;

      // Create backup table
      await this.db.run(`
        CREATE TABLE ${backupTable} AS 
        SELECT * FROM teams WHERE statistical_representation IS NOT NULL
      `);

      logger.info(`Created backup table: ${backupTable}`);
      return backupTable;
    } catch (error) {
      logger.error('Failed to backup existing data', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all teams with statistical representations
   */
  async getAllTeamsWithRepresentations() {
    try {
      const query = `
        SELECT team_id, team_name, statistical_representation, updated_at
        FROM teams 
        WHERE statistical_representation IS NOT NULL
        ORDER BY updated_at DESC
      `;
      
      return await this.db.all(query);
    } catch (error) {
      logger.error('Failed to get teams with representations', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Migrate a single team's representation to posterior format
   */
  async migrateTeamRepresentation(team) {
    try {
      const representation = JSON.parse(team.statistical_representation);

      // Check if already in posterior format
      if (representation.type === 'bayesian_posterior' && representation.model_version) {
        return {
          migrated: false,
          reason: 'Already in posterior format'
        };
      }

      // Validate existing representation has required fields
      if (!representation.mu || !representation.sigma) {
        return {
          migrated: false,
          reason: 'Missing mu or sigma fields'
        };
      }

      if (!Array.isArray(representation.mu) || !Array.isArray(representation.sigma)) {
        return {
          migrated: false,
          reason: 'mu and sigma must be arrays'
        };
      }

      if (representation.mu.length !== representation.sigma.length) {
        return {
          migrated: false,
          reason: 'mu and sigma dimension mismatch'
        };
      }

      // Create new posterior format
      const posteriorRepresentation = {
        mu: representation.mu,
        sigma: representation.sigma,
        games_processed: representation.games_processed || 0,
        last_season: representation.last_season || null,
        last_updated: new Date().toISOString(),
        model_version: 'v1.0',
        type: 'bayesian_posterior',
        // Preserve any additional fields
        ...Object.fromEntries(
          Object.entries(representation).filter(([key]) => 
            !['mu', 'sigma', 'games_processed', 'last_season'].includes(key)
          )
        )
      };

      // Update the team's representation
      await this.teamRepo.updateStatisticalRepresentation(
        team.team_id,
        posteriorRepresentation
      );

      return {
        migrated: true,
        reason: 'Successfully migrated to posterior format'
      };
    } catch (error) {
      logger.error(`Failed to migrate team representation for ${team.team_id}`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate that all teams have valid posterior distributions after migration
   */
  async validateMigration() {
    try {
      const teams = await this.getAllTeamsWithRepresentations();
      let validCount = 0;
      let invalidCount = 0;

      for (const team of teams) {
        const isValid = await this.validatePosteriorFormat(team);
        if (isValid) {
          validCount++;
        } else {
          invalidCount++;
          logger.warn(`Invalid posterior format for team: ${team.team_name} (${team.team_id})`);
        }
      }

      logger.info('Migration validation completed', {
        total: teams.length,
        valid: validCount,
        invalid: invalidCount
      });

      if (invalidCount > 0) {
        throw new Error(`Migration validation failed: ${invalidCount} teams have invalid posterior formats`);
      }

      return true;
    } catch (error) {
      logger.error('Migration validation failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate that a team has a valid posterior format
   */
  async validatePosteriorFormat(team) {
    try {
      const representation = JSON.parse(team.statistical_representation);

      // Check required fields
      const hasRequiredFields = 
        representation.type === 'bayesian_posterior' &&
        representation.model_version &&
        representation.last_updated &&
        Array.isArray(representation.mu) &&
        Array.isArray(representation.sigma);

      if (!hasRequiredFields) {
        return false;
      }

      // Check dimensions match
      if (representation.mu.length !== representation.sigma.length) {
        return false;
      }

      // Check dimensions are reasonable (should be 16 for InfoNCE)
      if (representation.mu.length === 0 || representation.mu.length > 100) {
        return false;
      }

      // Check values are numeric
      const allNumeric = representation.mu.every(val => typeof val === 'number' && !isNaN(val)) &&
                        representation.sigma.every(val => typeof val === 'number' && !isNaN(val) && val >= 0);

      return allNumeric;
    } catch (error) {
      logger.error(`Failed to validate posterior format for team ${team.team_id}`, {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Rollback migration by restoring from backup
   */
  async rollback(backupTable) {
    try {
      logger.info(`Rolling back migration from backup table: ${backupTable}`);

      // Restore data from backup
      await this.db.run(`
        UPDATE teams 
        SET statistical_representation = backup.statistical_representation,
            updated_at = backup.updated_at
        FROM ${backupTable} backup
        WHERE teams.team_id = backup.team_id
      `);

      logger.info('Migration rollback completed');
      return true;
    } catch (error) {
      logger.error('Migration rollback failed', {
        backupTable,
        error: error.message
      });
      throw error;
    }
  }
}

// Export for use in other modules
module.exports = TeamRepresentationMigrator;

// Allow running as standalone script
if (require.main === module) {
  const migrator = new TeamRepresentationMigrator();
  
  migrator.migrate()
    .then((result) => {
      console.log('Migration completed successfully:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}