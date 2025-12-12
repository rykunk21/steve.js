const OpponentAdjustedMetrics = require('../../src/modules/sports/OpponentAdjustedMetrics');
const dbConnection = require('../../src/database/connection');
const HistoricalGameRepository = require('../../src/database/repositories/HistoricalGameRepository');

describe('OpponentAdjustedMetrics', () => {
  let metrics;
  let gameRepo;

  beforeAll(async () => {
    await dbConnection.initialize();
  });

  beforeEach(async () => {
    metrics = new OpponentAdjustedMetrics(dbConnection);
    gameRepo = new HistoricalGameRepository(dbConnection);
    
    // Clean up test data
    await dbConnection.run('DELETE FROM historical_games');
    await dbConnection.run('DELETE FROM team_strength_history');
  });

  afterAll(async () => {
    await dbConnection.close();
  });

  describe('calculateStrengthOfSchedule', () => {
    it('should calculate strength of schedule for a team', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Create games with varying opponent quality
      const games = [
        {
          id: 'game-1',
          sport,
          season,
          gameDate: new Date('2025-11-20'),
          homeTeamId: teamId,
          awayTeamId: '57', // Strong opponent
          homeScore: 85,
          awayScore: 78
        },
        {
          id: 'game-2',
          sport,
          season,
          gameDate: new Date('2025-11-22'),
          homeTeamId: teamId,
          awayTeamId: '99', // Weak opponent
          homeScore: 95,
          awayScore: 70
        },
        {
          id: 'game-3',
          sport,
          season,
          gameDate: new Date('2025-11-25'),
          homeTeamId: '45', // Average opponent
          awayTeamId: teamId,
          homeScore: 80,
          awayScore: 82
        }
      ];

      for (const game of games) {
        await gameRepo.saveGameResult(game, {}, {});
      }

      // Mock opponent ratings
      const opponentRatings = {
        '57': { rating: 110 }, // Strong
        '99': { rating: 85 },  // Weak
        '45': { rating: 100 }  // Average
      };

      const sos = await metrics.calculateStrengthOfSchedule(teamId, sport, season, opponentRatings);

      expect(sos).toBeDefined();
      expect(sos).toBeCloseTo(98.33, 1); // Average of 110, 85, 100
    });

    it('should return null for teams with no games', async () => {
      const sos = await metrics.calculateStrengthOfSchedule('999', 'ncaa_basketball', 2025, {});

      expect(sos).toBeNull();
    });
  });

  describe('adjustForOpponentQuality', () => {
    it('should adjust team performance based on opponent strength', async () => {
      const teamPerformance = {
        offensiveRating: 105,
        defensiveRating: 95
      };

      const opponentStrength = 110; // Strong opponent
      const leagueAverage = 100;

      const adjusted = metrics.adjustForOpponentQuality(
        teamPerformance,
        opponentStrength,
        leagueAverage
      );

      expect(adjusted.offensiveRating).toBeGreaterThan(105); // Better than raw rating
      expect(adjusted.defensiveRating).toBeLessThan(95); // Better than raw rating
    });

    it('should penalize performance against weak opponents', async () => {
      const teamPerformance = {
        offensiveRating: 105,
        defensiveRating: 95
      };

      const opponentStrength = 85; // Weak opponent
      const leagueAverage = 100;

      const adjusted = metrics.adjustForOpponentQuality(
        teamPerformance,
        opponentStrength,
        leagueAverage
      );

      expect(adjusted.offensiveRating).toBeLessThan(105); // Worse than raw rating
      expect(adjusted.defensiveRating).toBeGreaterThan(95); // Worse than raw rating
    });
  });

  describe('iterativeRatingCalculation', () => {
    it('should solve for true team ratings using iterative algorithm', async () => {
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Create a small league with known results
      const games = [
        // Team A beats Team B
        {
          id: 'game-1',
          sport,
          season,
          gameDate: new Date('2025-11-20'),
          homeTeamId: 'A',
          awayTeamId: 'B',
          homeScore: 85,
          awayScore: 75
        },
        // Team B beats Team C
        {
          id: 'game-2',
          sport,
          season,
          gameDate: new Date('2025-11-21'),
          homeTeamId: 'B',
          awayTeamId: 'C',
          homeScore: 80,
          awayScore: 70
        },
        // Team A beats Team C
        {
          id: 'game-3',
          sport,
          season,
          gameDate: new Date('2025-11-22'),
          homeTeamId: 'A',
          awayTeamId: 'C',
          homeScore: 90,
          awayScore: 65
        }
      ];

      for (const game of games) {
        await gameRepo.saveGameResult(game, {}, {});
      }

      const ratings = await metrics.iterativeRatingCalculation(sport, season, 10);

      expect(ratings).toBeDefined();
      expect(ratings['A']).toBeGreaterThan(ratings['B']); // A > B
      expect(ratings['B']).toBeGreaterThan(ratings['C']); // B > C
      expect(ratings['A']).toBeGreaterThan(ratings['C']); // A > C (transitive)
    });

    it('should converge after multiple iterations', async () => {
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Create games
      const games = [
        {
          id: 'game-1',
          sport,
          season,
          gameDate: new Date('2025-11-20'),
          homeTeamId: 'A',
          awayTeamId: 'B',
          homeScore: 85,
          awayScore: 80
        }
      ];

      for (const game of games) {
        await gameRepo.saveGameResult(game, {}, {});
      }

      const ratings5 = await metrics.iterativeRatingCalculation(sport, season, 5);
      const ratings10 = await metrics.iterativeRatingCalculation(sport, season, 10);

      // Ratings should stabilize (not change much between iterations)
      expect(Math.abs(ratings5['A'] - ratings10['A'])).toBeLessThan(1.0);
    });
  });

  describe('getOpponentAdjustedRatings', () => {
    it('should return both raw and adjusted ratings', async () => {
      const teamId = '12';
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Create games
      const games = [
        {
          id: 'game-1',
          sport,
          season,
          gameDate: new Date('2025-11-20'),
          homeTeamId: teamId,
          awayTeamId: '57',
          homeScore: 85,
          awayScore: 78
        }
      ];

      for (const game of games) {
        await gameRepo.saveGameResult(game, {}, {});
      }

      const ratings = await metrics.getOpponentAdjustedRatings(teamId, sport, season);

      expect(ratings).toBeDefined();
      expect(ratings.raw).toBeDefined();
      expect(ratings.adjusted).toBeDefined();
      expect(ratings.strengthOfSchedule).toBeDefined();
      expect(ratings.raw.offensiveRating).toBeDefined();
      expect(ratings.adjusted.offensiveRating).toBeDefined();
    });
  });

  describe('compareTeamsHeadToHead', () => {
    it('should project head-to-head matchup accounting for schedule difficulty', async () => {
      const team1Id = '12';
      const team2Id = '57';
      const sport = 'ncaa_basketball';
      const season = 2025;

      // Team 1 plays weak schedule
      await gameRepo.saveGameResult({
        id: 'game-1',
        sport,
        season,
        gameDate: new Date('2025-11-20'),
        homeTeamId: team1Id,
        awayTeamId: '99', // Weak opponent
        homeScore: 90,
        awayScore: 70
      }, {}, {});

      // Team 2 plays strong schedule
      await gameRepo.saveGameResult({
        id: 'game-2',
        sport,
        season,
        gameDate: new Date('2025-11-20'),
        homeTeamId: team2Id,
        awayTeamId: '45', // Strong opponent
        homeScore: 85,
        awayScore: 82
      }, {}, {});

      const comparison = await metrics.compareTeamsHeadToHead(team1Id, team2Id, sport, season);

      expect(comparison).toBeDefined();
      expect(comparison.team1Raw).toBeDefined();
      expect(comparison.team1Adjusted).toBeDefined();
      expect(comparison.team2Raw).toBeDefined();
      expect(comparison.team2Adjusted).toBeDefined();
      expect(comparison.projectedMargin).toBeDefined();
    });
  });
});
