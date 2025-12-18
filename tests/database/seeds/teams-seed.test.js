const { teams, seedTeams } = require('../../../src/database/seeds/teams-seed');
const TeamRepository = require('../../../src/database/repositories/TeamRepository');
const dbConnection = require('../../../src/database/connection');

describe('Teams Seed Data', () => {
  let teamRepo;

  beforeAll(async () => {
    if (!dbConnection.isReady()) {
      await dbConnection.initialize();
    }
    
    // Run migration
    const fs = require('fs').promises;
    const path = require('path');
    
    const migration003 = await fs.readFile(
      path.join(__dirname, '../../../src/database/migrations/003_create_teams_and_games.sql'),
      'utf-8'
    );
    
    const statements = migration003.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await dbConnection.run(statement);
      }
    }
  });

  beforeEach(async () => {
    teamRepo = new TeamRepository();
    await dbConnection.run('DELETE FROM teams');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  test('should have valid team data structure', () => {
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
    
    teams.forEach(team => {
      expect(team).toHaveProperty('teamId');
      expect(team).toHaveProperty('statbroadcastGid');
      expect(team).toHaveProperty('teamName');
      expect(team).toHaveProperty('sport');
      expect(team).toHaveProperty('conference');
      
      expect(typeof team.teamId).toBe('string');
      expect(typeof team.statbroadcastGid).toBe('string');
      expect(team.sport).toBe('mens-college-basketball');
    });
  });

  test('should have unique team IDs', () => {
    const teamIds = teams.map(t => t.teamId);
    const uniqueIds = new Set(teamIds);
    
    expect(uniqueIds.size).toBe(teamIds.length);
  });

  test('should have unique StatBroadcast GIDs', () => {
    const gids = teams.map(t => t.statbroadcastGid);
    const uniqueGids = new Set(gids);
    
    expect(uniqueGids.size).toBe(gids.length);
  });

  test('should seed teams into database', async () => {
    const results = await seedTeams(teamRepo);
    
    expect(results.total).toBe(teams.length);
    expect(results.created).toBe(teams.length);
    expect(results.updated).toBe(0);
    expect(results.failed).toBe(0);
    
    // Verify teams are in database
    const msu = await teamRepo.getTeamByEspnId('MSU');
    expect(msu).toBeDefined();
    expect(msu.statbroadcastGid).toBe('msu');
    expect(msu.teamName).toBe('Michigan State');
    
    const duke = await teamRepo.getTeamByEspnId('DUKE');
    expect(duke).toBeDefined();
    expect(duke.statbroadcastGid).toBe('duke');
  });

  test('should update existing teams on re-seed', async () => {
    // First seed
    await seedTeams(teamRepo);
    
    // Second seed (should update)
    const results = await seedTeams(teamRepo);
    
    expect(results.total).toBe(teams.length);
    expect(results.created).toBe(0);
    expect(results.updated).toBe(teams.length);
    expect(results.failed).toBe(0);
  });

  test('should include major conference teams', () => {
    const conferences = teams.map(t => t.conference);
    
    expect(conferences).toContain('Big Ten');
    expect(conferences).toContain('ACC');
    expect(conferences).toContain('SEC');
    expect(conferences).toContain('Big 12');
    expect(conferences).toContain('Big East');
  });

  test('should include blue blood programs', () => {
    const teamIds = teams.map(t => t.teamId);
    
    // Major programs that should be included
    expect(teamIds).toContain('DUKE');
    expect(teamIds).toContain('UNC');
    expect(teamIds).toContain('UK'); // Kentucky
    expect(teamIds).toContain('KU'); // Kansas
    expect(teamIds).toContain('MSU');
  });
});
