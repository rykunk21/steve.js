const PlayByPlayModeler = require('../../src/modules/sports/PlayByPlayModeler');
const dbConnection = require('../../src/database/connection');
const HistoricalGameRepository = require('../../src/database/repositories/HistoricalGameRepository');

describe('PlayByPlayModeler', () => {
  let modeler;
  let gameRepo;

  beforeAll(async () => {
    await dbConnection.initialize();
  });

  beforeEach(async () => {
    modeler = new PlayByPlayModeler(dbConnection);
    gameRepo = new HistoricalGameRepository(dbConnection);
    
    // Clean up test data
    await dbConnection.run('DELETE FROM historical_games');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('parsePossessionOutcomes', () => {
    it('should parse play-by-play data into possession outcomes', () => {
      const playByPlay = [
        { type: 'shot', result: 'made', points: 2, time: '19:45' },
        { type: 'shot', result: 'made', points: 3, time: '19:20' },
        { type: 'shot', result: 'missed', points: 0, time: '18:55' },
        { type: 'turnover', result: 'lost', points: 0, time: '18:30' },
        { type: 'freethrow', result: 'made', points: 1, time: '18:00' }
      ];

      const outcomes = modeler.parsePossessionOutcomes(playByPlay);

      expect(outcomes).toBeDefined();
      expect(outcomes.length).toBe(5);
      expect(outcomes[0].type).toBe('shot');
      expect(outcomes[0].result).toBe('made');
      expect(outcomes[0].points).toBe(2);
    });

    it('should handle empty play-by-play data', () => {
      const outcomes = modeler.parsePossessionOutcomes([]);

      expect(outcomes).toEqual([]);
    });
  });

  describe('buildPossessionTransitionMatrix', () => {
    it('should derive possession probabilities from play-by-play sequences', () => {
      const playByPlay = [
        { type: 'shot', result: 'made', points: 2, shotType: '2pt' },
        { type: 'shot', result: 'made', points: 2, shotType: '2pt' },
        { type: 'shot', result: 'made', points: 3, shotType: '3pt' },
        { type: 'shot', result: 'missed', points: 0, shotType: '2pt' },
        { type: 'turnover', result: 'lost', points: 0 }
      ];

      const matrix = modeler.buildPossessionTransitionMatrix(playByPlay);

      expect(matrix).toBeDefined();
      expect(matrix.twoPointRate).toBeGreaterThan(0);
      expect(matrix.threePointRate).toBeGreaterThan(0);
      expect(matrix.turnoverRate).toBeGreaterThan(0);
      expect(matrix.twoPointPct).toBeDefined();
      expect(matrix.threePointPct).toBeDefined();
    });

    it('should calculate shot selection tendencies', () => {
      const playByPlay = [
        { type: 'shot', result: 'made', points: 2, shotType: '2pt' },
        { type: 'shot', result: 'made', points: 2, shotType: '2pt' },
        { type: 'shot', result: 'made', points: 2, shotType: '2pt' },
        { type: 'shot', result: 'made', points: 3, shotType: '3pt' }
      ];

      const matrix = modeler.buildPossessionTransitionMatrix(playByPlay);

      expect(matrix.twoPointRate).toBeCloseTo(0.75, 2); // 3 out of 4
      expect(matrix.threePointRate).toBeCloseTo(0.25, 2); // 1 out of 4
    });
  });

  describe('modelOffensiveRebounds', () => {
    it('should account for offensive rebounds and second-chance opportunities', () => {
      const playByPlay = [
        { type: 'shot', result: 'missed', points: 0 },
        { type: 'rebound', result: 'offensive', team: 'home' },
        { type: 'shot', result: 'made', points: 2 },
        { type: 'shot', result: 'missed', points: 0 },
        { type: 'rebound', result: 'defensive', team: 'away' }
      ];

      const reboundRate = modeler.modelOffensiveRebounds(playByPlay);

      expect(reboundRate).toBeDefined();
      expect(reboundRate.offensiveReboundRate).toBeCloseTo(0.5, 2); // 1 out of 2 misses
      expect(reboundRate.secondChancePoints).toBe(2);
    });

    it('should return zero rates when no rebounds in data', () => {
      const playByPlay = [
        { type: 'shot', result: 'made', points: 2 }
      ];

      const reboundRate = modeler.modelOffensiveRebounds(playByPlay);

      expect(reboundRate.offensiveReboundRate).toBe(0);
      expect(reboundRate.secondChancePoints).toBe(0);
    });
  });

  describe('calculateTurnoverPatterns', () => {
    it('should model turnover rates and defensive stops', () => {
      const playByPlay = [
        { type: 'shot', result: 'made', points: 2 },
        { type: 'turnover', result: 'lost', turnoverType: 'bad_pass' },
        { type: 'shot', result: 'made', points: 3 },
        { type: 'turnover', result: 'lost', turnoverType: 'traveling' },
        { type: 'shot', result: 'missed', points: 0 }
      ];

      const patterns = modeler.calculateTurnoverPatterns(playByPlay);

      expect(patterns).toBeDefined();
      expect(patterns.turnoverRate).toBeCloseTo(0.4, 2); // 2 out of 5 possessions
      expect(patterns.turnoverTypes).toBeDefined();
      expect(patterns.turnoverTypes.bad_pass).toBe(1);
      expect(patterns.turnoverTypes.traveling).toBe(1);
    });
  });

  describe('getPlayByPlayMatrix', () => {
    it('should return play-by-play based matrix when available', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Mock play-by-play data
      const mockPlayByPlay = [
        { type: 'shot', result: 'made', points: 2, shotType: '2pt' },
        { type: 'shot', result: 'made', points: 3, shotType: '3pt' },
        { type: 'shot', result: 'missed', points: 0, shotType: '2pt' }
      ];

      const matrix = await modeler.getPlayByPlayMatrix(teamId, sport, season, mockPlayByPlay);

      expect(matrix).toBeDefined();
      expect(matrix.dataSource).toBe('play-by-play');
      expect(matrix.twoPointRate).toBeDefined();
      expect(matrix.threePointRate).toBeDefined();
      expect(matrix.confidenceLevel).toBeGreaterThan(0.5);
    });

    it('should fall back to aggregate stats when play-by-play unavailable', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Create game with aggregate stats only
      await gameRepo.saveGameResult({
        id: 'game-1',
        sport,
        season,
        gameDate: new Date('2025-11-20'),
        homeTeamId: teamId,
        awayTeamId: '57',
        homeScore: 85,
        awayScore: 78
      }, {
        homeFieldGoalPct: 0.485,
        homeThreePointPct: 0.375,
        homeFreeThrowPct: 0.800
      }, {});

      const matrix = await modeler.getPlayByPlayMatrix(teamId, sport, season, null);

      expect(matrix).toBeDefined();
      expect(matrix.dataSource).toBe('aggregate');
      expect(matrix.confidenceLevel).toBeLessThan(0.5); // Lower confidence
    });
  });

  describe('simulatePossessionWithPlayByPlay', () => {
    it('should simulate possession using play-by-play derived probabilities', () => {
      const matrix = {
        twoPointRate: 0.60,
        threePointRate: 0.30,
        freeThrowRate: 0.05,
        turnoverRate: 0.05,
        twoPointPct: 0.50,
        threePointPct: 0.35,
        freeThrowPct: 0.75,
        offensiveReboundRate: 0.30
      };

      // Run multiple simulations to test probability distribution
      const results = [];
      for (let i = 0; i < 1000; i++) {
        const result = modeler.simulatePossessionWithPlayByPlay(matrix);
        results.push(result);
      }

      const avgPoints = results.reduce((sum, r) => sum + r.points, 0) / results.length;
      const twoPointers = results.filter(r => r.shotType === '2pt').length;
      const threePointers = results.filter(r => r.shotType === '3pt').length;

      expect(avgPoints).toBeGreaterThan(0);
      expect(avgPoints).toBeLessThan(3); // Reasonable average
      expect(twoPointers).toBeGreaterThan(threePointers); // More 2pt attempts
    });

    it('should handle offensive rebounds for second chances', () => {
      const matrix = {
        twoPointRate: 1.0, // Always shoot 2pt
        threePointRate: 0.0,
        freeThrowRate: 0.0,
        turnoverRate: 0.0,
        twoPointPct: 0.0, // Always miss
        threePointPct: 0.0,
        freeThrowPct: 0.0,
        offensiveReboundRate: 1.0 // Always get offensive rebound
      };

      // Should get second chance opportunities
      const result = modeler.simulatePossessionWithPlayByPlay(matrix);

      expect(result).toBeDefined();
      expect(result.hadSecondChance).toBe(true);
    });
  });

  describe('comparePlayByPlayVsAggregate', () => {
    it('should show confidence difference between data sources', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      const mockPlayByPlay = [
        { type: 'shot', result: 'made', points: 2, shotType: '2pt' },
        { type: 'shot', result: 'made', points: 3, shotType: '3pt' }
      ];

      const comparison = await modeler.comparePlayByPlayVsAggregate(
        teamId,
        sport,
        season,
        mockPlayByPlay
      );

      expect(comparison).toBeDefined();
      expect(comparison.playByPlayConfidence).toBeGreaterThan(comparison.aggregateConfidence);
      expect(comparison.recommendedSource).toBe('play-by-play');
    });
  });
});
