const HistoricalGameRepository = require('../../src/database/repositories/HistoricalGameRepository');
const dbConnection = require('../../src/database/connection');

describe('HistoricalGameRepository', () => {
  let repository;

  beforeAll(async () => {
    // Initialize test database
    await dbConnection.initialize();
  });

  beforeEach(async () => {
    repository = new HistoricalGameRepository(dbConnection);
    
    // Clean up test data using the connection's run method
    await dbConnection.run('DELETE FROM historical_games');
    await dbConnection.run('DELETE FROM team_strength_history');
    await dbConnection.run('DELETE FROM model_predictions');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('saveGameResult', () => {
    it('should store complete game result with box scores', async () => {
      const gameData = {
        id: 'test-game-001',
        sport: 'ncaa_basketball',
        season: 2025,
        gameDate: new Date('2025-11-27'),
        homeTeamId: '12',
        awayTeamId: '57',
        homeScore: 85,
        awayScore: 78,
        isNeutralSite: false
      };

      const boxScore = {
        homeFieldGoalPct: 0.485,
        awayFieldGoalPct: 0.442,
        homeThreePointPct: 0.375,
        awayThreePointPct: 0.333,
        homeFreeThrowPct: 0.800,
        awayFreeThrowPct: 0.750,
        homeRebounds: 38,
        awayRebounds: 32,
        homeTurnovers: 12,
        awayTurnovers: 15,
        homeAssists: 18,
        awayAssists: 14
      };

      const bettingOutcome = {
        preGameSpread: -3.5,
        preGameTotal: 145.5,
        preGameHomeML: -150,
        preGameAwayML: 130,
        spreadResult: 'home_cover', // Home won by 7, covered -3.5
        totalResult: 'over' // 163 total > 145.5
      };

      await repository.saveGameResult(gameData, boxScore, bettingOutcome);

      // Verify game was saved
      const saved = await repository.getGameById('test-game-001');
      
      expect(saved).toBeDefined();
      expect(saved.id).toBe('test-game-001');
      expect(saved.homeScore).toBe(85);
      expect(saved.awayScore).toBe(78);
      expect(saved.homeFieldGoalPct).toBe(0.485);
      expect(saved.spreadResult).toBe('home_cover');
      expect(saved.totalResult).toBe('over');
    });

    it('should prevent duplicate game records', async () => {
      const gameData = {
        id: 'test-game-002',
        sport: 'ncaa_basketball',
        season: 2025,
        gameDate: new Date('2025-11-27'),
        homeTeamId: '12',
        awayTeamId: '57',
        homeScore: 85,
        awayScore: 78
      };

      await repository.saveGameResult(gameData, {}, {});

      // Try to save again
      await expect(
        repository.saveGameResult(gameData, {}, {})
      ).rejects.toThrow();
    });
  });

  describe('getTeamGameHistory', () => {
    beforeEach(async () => {
      // Insert test games
      const games = [
        {
          id: 'game-1',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-11-20'),
          homeTeamId: '12',
          awayTeamId: '57',
          homeScore: 80,
          awayScore: 75
        },
        {
          id: 'game-2',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-11-22'),
          homeTeamId: '12',
          awayTeamId: '99',
          homeScore: 88,
          awayScore: 82
        },
        {
          id: 'game-3',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-11-25'),
          homeTeamId: '45',
          awayTeamId: '12',
          homeScore: 70,
          awayScore: 85
        }
      ];

      for (const game of games) {
        await repository.saveGameResult(game, {}, {});
      }
    });

    it('should retrieve all games for a team', async () => {
      const history = await repository.getTeamGameHistory('12', 2025);

      expect(history).toHaveLength(3);
      expect(history[0].id).toBe('game-3'); // Most recent first
      expect(history[1].id).toBe('game-2');
      expect(history[2].id).toBe('game-1');
    });

    it('should limit results when specified', async () => {
      const history = await repository.getTeamGameHistory('12', 2025, 2);

      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('game-3');
      expect(history[1].id).toBe('game-2');
    });

    it('should return empty array for team with no games', async () => {
      const history = await repository.getTeamGameHistory('999', 2025);

      expect(history).toHaveLength(0);
    });
  });

  describe('getHeadToHeadHistory', () => {
    beforeEach(async () => {
      const games = [
        {
          id: 'h2h-1',
          sport: 'ncaa_basketball',
          season: 2024,
          gameDate: new Date('2024-12-01'),
          homeTeamId: '12',
          awayTeamId: '57',
          homeScore: 75,
          awayScore: 70
        },
        {
          id: 'h2h-2',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-01-15'),
          homeTeamId: '57',
          awayTeamId: '12',
          homeScore: 82,
          awayScore: 78
        },
        {
          id: 'h2h-3',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-02-20'),
          homeTeamId: '12',
          awayTeamId: '57',
          homeScore: 88,
          awayScore: 85
        }
      ];

      for (const game of games) {
        await repository.saveGameResult(game, {}, {});
      }
    });

    it('should retrieve head-to-head matchups', async () => {
      const h2h = await repository.getHeadToHeadHistory('12', '57');

      expect(h2h).toHaveLength(3);
      expect(h2h[0].id).toBe('h2h-3'); // Most recent first
    });

    it('should work regardless of team order', async () => {
      const h2h1 = await repository.getHeadToHeadHistory('12', '57');
      const h2h2 = await repository.getHeadToHeadHistory('57', '12');

      expect(h2h1).toHaveLength(3);
      expect(h2h2).toHaveLength(3);
      expect(h2h1[0].id).toBe(h2h2[0].id);
    });

    it('should limit results when specified', async () => {
      const h2h = await repository.getHeadToHeadHistory('12', '57', 2);

      expect(h2h).toHaveLength(2);
    });
  });

  describe('getGamesByDateRange', () => {
    beforeEach(async () => {
      const games = [
        {
          id: 'date-1',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-11-20'),
          homeTeamId: '12',
          awayTeamId: '57',
          homeScore: 80,
          awayScore: 75
        },
        {
          id: 'date-2',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-11-25'),
          homeTeamId: '45',
          awayTeamId: '99',
          homeScore: 70,
          awayScore: 68
        },
        {
          id: 'date-3',
          sport: 'nba',
          season: 2025,
          gameDate: new Date('2025-11-25'),
          homeTeamId: '1',
          awayTeamId: '2',
          homeScore: 110,
          awayScore: 105
        }
      ];

      for (const game of games) {
        await repository.saveGameResult(game, {}, {});
      }
    });

    it('should retrieve games within date range', async () => {
      const games = await repository.getGamesByDateRange(
        new Date('2025-11-24'),
        new Date('2025-11-26'),
        'ncaa_basketball'
      );

      expect(games).toHaveLength(1);
      expect(games[0].id).toBe('date-2');
    });

    it('should filter by sport', async () => {
      const games = await repository.getGamesByDateRange(
        new Date('2025-11-24'),
        new Date('2025-11-26'),
        'nba'
      );

      expect(games).toHaveLength(1);
      expect(games[0].id).toBe('date-3');
    });
  });

  describe('getBettingOutcomes', () => {
    beforeEach(async () => {
      const games = [
        {
          id: 'bet-1',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-11-20'),
          homeTeamId: '12',
          awayTeamId: '57',
          homeScore: 85,
          awayScore: 78
        },
        {
          id: 'bet-2',
          sport: 'ncaa_basketball',
          season: 2025,
          gameDate: new Date('2025-11-22'),
          homeTeamId: '12',
          awayTeamId: '99',
          homeScore: 70,
          awayScore: 75
        }
      ];

      const outcomes = [
        {
          preGameSpread: -3.5,
          preGameTotal: 145.5,
          spreadResult: 'home_cover',
          totalResult: 'over'
        },
        {
          preGameSpread: -5.5,
          preGameTotal: 150.5,
          spreadResult: 'away_cover',
          totalResult: 'under'
        }
      ];

      for (let i = 0; i < games.length; i++) {
        await repository.saveGameResult(games[i], {}, outcomes[i]);
      }
    });

    it('should retrieve betting outcomes for a team', async () => {
      const outcomes = await repository.getBettingOutcomes('12', 2025);

      expect(outcomes).toHaveLength(2);
      expect(outcomes[0].spreadResult).toBeDefined();
      expect(outcomes[0].totalResult).toBeDefined();
    });

    it('should calculate win rate', async () => {
      const outcomes = await repository.getBettingOutcomes('12', 2025);
      
      const wins = outcomes.filter(o => 
        (o.homeTeamId === '12' && o.homeScore > o.awayScore) ||
        (o.awayTeamId === '12' && o.awayScore > o.homeScore)
      ).length;

      expect(wins).toBe(1); // Won game 1, lost game 2
    });
  });
});
