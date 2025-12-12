#!/usr/bin/env node

/**
 * Seed NCAA Basketball Teams with StatBroadcast GIDs
 * Run with: node scripts/seed-teams.js
 */

const fs = require('fs');
const path = require('path');
const dbConnection = require('../src/database/connection');
const TeamRepository = require('../src/database/repositories/TeamRepository');
const logger = require('../src/utils/logger');

async function seedTeams() {
  try {
    logger.info('Starting team seeding...');
    
    // Initialize database connection
    await dbConnection.initialize();
    
    const teamRepository = new TeamRepository();
    const { seedTeams } = require('../src/database/seeds/teams-seed');
    
    const result = await seedTeams(teamRepository);
    
    logger.info('Team seeding completed', result);
    
    // Seed teams from training dataset
    await seedTeamsFromTrainingDataset(teamRepository);
    
    await dbConnection.close();
    process.exit(0);
  } catch (error) {
    logger.error('Team seeding failed:', error);
    process.exit(1);
  }
}

async function seedTeamsFromTrainingDataset(teamRepository) {
  try {
    logger.info('Seeding teams from training dataset...');
    
    const dataPath = path.join(__dirname, '../data/training-dataset.json');
    const rawData = fs.readFileSync(dataPath, 'utf8');
    const trainingData = JSON.parse(rawData);
    
    const teamsMap = new Map();
    
    // Extract unique teams from training dataset
    for (const entry of trainingData.dataset) {
      const { teams } = entry.gameData;
      
      if (teams?.home?.id) {
        teamsMap.set(teams.home.id, {
          teamId: teams.home.id,
          teamName: teams.home.displayName || teams.home.name || teams.home.id,
          sport: 'mens-college-basketball'
        });
      }
      
      if (teams?.visitor?.id) {
        teamsMap.set(teams.visitor.id, {
          teamId: teams.visitor.id,
          teamName: teams.visitor.displayName || teams.visitor.name || teams.visitor.id,
          sport: 'mens-college-basketball'
        });
      }
    }
    
    logger.info(`Found ${teamsMap.size} unique teams in training dataset`);
    
    let created = 0;
    let updated = 0;
    
    for (const team of teamsMap.values()) {
      const existing = await teamRepository.getTeamByEspnId(team.teamId);
      
      if (!existing) {
        await teamRepository.saveTeam(team);
        created++;
      } else {
        updated++;
      }
    }
    
    logger.info('Training dataset teams seeded', { created, updated, total: teamsMap.size });
    
  } catch (error) {
    logger.error('Failed to seed teams from training dataset', { error: error.message });
    throw error;
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedTeams();
}

module.exports = seedTeams;
