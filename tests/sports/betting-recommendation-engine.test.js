const BettingRecommendationEngine = require('../../src/modules/sports/BettingRecommendationEngine');
const BettingSnapshot = require('../../src/database/models/BettingSnapshot');

describe('BettingRecommendationEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new BettingRecommendationEngine({
      iterations: 1000 // Use fewer iterations for faster tests
    });
  });

  describe('generateRecommendation', () => {
    it('should generate fallback recommendation when team stats unavailable', async () => {
      const gameData = {
        id: 'test-game-1',
        sport: 'ncaa_basketball',
        date: new Date(),
        teams: {
          home: {
            id: '999999',
            name: 'Test Home Team',
            abbreviation: 'HOME'
          },
          away: {
            id: '999998',
            name: 'Test Away Team',
            abbreviation: 'AWAY'
          }
        }
      };

      const bettingOdds = new BettingSnapshot({
        gameId: 'test_game',
        sport: 'ncaa_basketball',
        scrapedAt: new Date(),
        homeMoneyline: -150,
        awayMoneyline: 130,
        spreadLine: -3.5,
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        totalLine: 145.5,
        overOdds: -110,
        underOdds: -110,
        source: 'Test',
        sportsbook: 'Test Book'
      });

      const recommendation = await engine.generateRecommendation(gameData, bettingOdds);

      expect(recommendation).toBeDefined();
      expect(recommendation.method).toBe('Fallback');
      expect(recommendation.warning).toContain('Team statistics unavailable');
      expect(recommendation.pick).toBeDefined();
      expect(recommendation.reasoning).toBeDefined();
    });

    it('should handle missing betting odds gracefully', async () => {
      const gameData = {
        id: 'test-game-2',
        sport: 'ncaa_basketball',
        date: new Date(),
        teams: {
          home: {
            id: '999999',
            name: 'Test Home Team',
            abbreviation: 'HOME'
          },
          away: {
            id: '999998',
            name: 'Test Away Team',
            abbreviation: 'AWAY'
          }
        }
      };

      const bettingOdds = new BettingSnapshot({
        gameId: 'test_game',
        sport: 'ncaa_basketball',
        scrapedAt: new Date(),
        homeMoneyline: null,
        awayMoneyline: null,
        spreadLine: null,
        homeSpreadOdds: null,
        awaySpreadOdds: null,
        totalLine: null,
        overOdds: null,
        underOdds: null,
        source: 'Test',
        sportsbook: 'Test Book'
      });

      const recommendation = await engine.generateRecommendation(gameData, bettingOdds);

      expect(recommendation).toBeDefined();
      expect(recommendation.pick).toBeDefined();
      expect(recommendation.reasoning).toBeDefined();
    });
  });

  describe('getSimulationStatistics', () => {
    it('should return null when team stats unavailable', async () => {
      const gameData = {
        id: 'test-game-3',
        sport: 'ncaa_basketball',
        date: new Date(),
        teams: {
          home: {
            id: '999999',
            name: 'Test Home Team',
            abbreviation: 'HOME'
          },
          away: {
            id: '999998',
            name: 'Test Away Team',
            abbreviation: 'AWAY'
          }
        }
      };

      const stats = await engine.getSimulationStatistics(gameData);

      expect(stats).toBeNull();
    });
  });
});
