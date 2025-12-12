const TeamRepository = require('../../../src/database/repositories/TeamRepository');
const dbConnection = require('../../../src/database/connection');

describe('TeamRepository', () => {
  let repository;

  beforeAll(async () => {
    if (!dbConnection.isReady()) {
      await dbConnection.initialize();
    }
    
    // Run SQL migration for teams table
    const fs = require('fs').promises;
    const path = require('path');
    
    const migration010 = await fs.readFile(
      path.join(__dirname, '../../../src/database/migrations/010_create_teams_table.sql'),
      'utf-8'
    );
    
    // Split by semicolon and execute each statement
    const statements = migration010.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await dbConnection.run(statement);
      }
    }
  });

  beforeEach(async () => {
    repository = new TeamRepository();
    await dbConnection.run('DELETE FROM teams');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('saveTeam', () => {
    test('should save a new team', async () => {
      const team = {
        teamId: 'MSU',
        statbroadcastGid: 'msu',
        teamName: 'Michigan State',
        sport: 'mens-college-basketball',
        conference: 'Big Ten'
      };

      const result = await repository.saveTeam(team);

      expect(result).toBeDefined();
      expect(result.changes).toBe(1);
    });

    test('should update existing team', async () => {
      const team1 = {
        teamId: 'MSU',
        statbroadcastGid: 'msu',
        teamName: 'Michigan State',
        sport: 'mens-college-basketball'
      };

      await repository.saveTeam(team1);

      const team2 = {
        teamId: 'MSU',
        statbroadcastGid: 'msu',
        teamName: 'Michigan State Spartans',
        sport: 'mens-college-basketball',
        conference: 'Big Ten'
      };

      await repository.saveTeam(team2);

      const retrieved = await repository.getTeamByEspnId('MSU');
      expect(retrieved.teamName).toBe('Michigan State Spartans');
      expect(retrieved.conference).toBe('Big Ten');
    });
  });

  describe('getTeamByEspnId', () => {
    test('should retrieve team by ESPN ID', async () => {
      const team = {
        teamId: 'DUKE',
        statbroadcastGid: 'duke',
        teamName: 'Duke',
        sport: 'mens-college-basketball',
        conference: 'ACC'
      };

      await repository.saveTeam(team);

      const retrieved = await repository.getTeamByEspnId('DUKE');

      expect(retrieved).toBeDefined();
      expect(retrieved.teamId).toBe('DUKE');
      expect(retrieved.statbroadcastGid).toBe('duke');
      expect(retrieved.teamName).toBe('Duke');
      expect(retrieved.conference).toBe('ACC');
    });

    test('should return null if team not found', async () => {
      const retrieved = await repository.getTeamByEspnId('NONEXISTENT');
      expect(retrieved).toBeNull();
    });
  });

  describe('getTeamByStatBroadcastGid', () => {
    test('should retrieve team by StatBroadcast GID', async () => {
      const team = {
        teamId: 'UNC',
        statbroadcastGid: 'unc',
        teamName: 'North Carolina',
        sport: 'mens-college-basketball'
      };

      await repository.saveTeam(team);

      const retrieved = await repository.getTeamByStatBroadcastGid('unc');

      expect(retrieved).toBeDefined();
      expect(retrieved.teamId).toBe('UNC');
      expect(retrieved.statbroadcastGid).toBe('unc');
    });

    test('should return null if team not found', async () => {
      const retrieved = await repository.getTeamByStatBroadcastGid('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('updateStatisticalRepresentation', () => {
    test('should update statistical representation', async () => {
      const team = {
        teamId: 'KU',
        statbroadcastGid: 'kansas',
        teamName: 'Kansas',
        sport: 'mens-college-basketball'
      };

      await repository.saveTeam(team);

      const representation = {
        offensiveRating: 115.5,
        defensiveRating: 98.2,
        pace: 72.3,
        vaeEmbedding: [0.1, 0.2, 0.3, 0.4, 0.5]
      };

      await repository.updateStatisticalRepresentation('KU', representation);

      const retrieved = await repository.getTeamByEspnId('KU');
      expect(retrieved.statisticalRepresentation).toBeDefined();
      
      const parsed = JSON.parse(retrieved.statisticalRepresentation);
      expect(parsed.offensiveRating).toBe(115.5);
      expect(parsed.vaeEmbedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    });
  });

  describe('updatePlayerRoster', () => {
    test('should update player roster', async () => {
      const team = {
        teamId: 'UK',
        statbroadcastGid: 'kentucky',
        teamName: 'Kentucky',
        sport: 'mens-college-basketball'
      };

      await repository.saveTeam(team);

      const roster = [
        { id: 'player1', name: 'John Doe', position: 'G', impact: 0.8 },
        { id: 'player2', name: 'Jane Smith', position: 'F', impact: 0.7 }
      ];

      await repository.updatePlayerRoster('UK', roster);

      const retrieved = await repository.getTeamByEspnId('UK');
      expect(retrieved.playerRoster).toBeDefined();
      
      const parsed = JSON.parse(retrieved.playerRoster);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('John Doe');
      expect(parsed[1].position).toBe('F');
    });
  });

  describe('getTeamsBySport', () => {
    test('should retrieve all teams for a sport', async () => {
      await repository.saveTeam({
        teamId: 'MSU',
        statbroadcastGid: 'msu',
        teamName: 'Michigan State',
        sport: 'mens-college-basketball'
      });

      await repository.saveTeam({
        teamId: 'DUKE',
        statbroadcastGid: 'duke',
        teamName: 'Duke',
        sport: 'mens-college-basketball'
      });

      await repository.saveTeam({
        teamId: 'BAMA',
        statbroadcastGid: 'alabama',
        teamName: 'Alabama',
        sport: 'football'
      });

      const basketballTeams = await repository.getTeamsBySport('mens-college-basketball');

      expect(basketballTeams).toHaveLength(2);
      expect(basketballTeams.map(t => t.teamId)).toContain('MSU');
      expect(basketballTeams.map(t => t.teamId)).toContain('DUKE');
      expect(basketballTeams.map(t => t.teamId)).not.toContain('BAMA');
    });
  });

  describe('updateLastSynced', () => {
    test('should update last synced timestamp', async () => {
      const team = {
        teamId: 'MSU',
        statbroadcastGid: 'msu',
        teamName: 'Michigan State',
        sport: 'mens-college-basketball'
      };

      await repository.saveTeam(team);

      await repository.updateLastSynced('MSU');

      const retrieved = await repository.getTeamByEspnId('MSU');
      expect(retrieved.lastSynced).toBeDefined();
    });
  });
});
