const TeamStatisticsAggregator = require('../../src/modules/sports/TeamStatisticsAggregator');
const TransitionMatrixBuilder = require('../../src/modules/sports/TransitionMatrixBuilder');
const MCMCSimulator = require('../../src/modules/sports/MCMCSimulator');
const EVCalculator = require('../../src/modules/sports/EVCalculator');
const BettingRecommendationEngine = require('../../src/modules/sports/BettingRecommendationEngine');

describe('MCMC Integration Tests', () => {
  describe('TransitionMatrixBuilder', () => {
    it('should build valid transition matrix for basketball', () => {
      const builder = new TransitionMatrixBuilder();
      
      const homeStats = {
        offensiveEfficiency: 110,
        defensiveEfficiency: 95,
        pace: 72,
        effectiveFieldGoalPct: 0.52,
        turnoverRate: 0.14,
        offensiveReboundRate: 0.32,
        freeThrowRate: 0.75,
        recentForm: [1, 1, 0, 1, 1],
        homeAdvantage: 3.5
      };

      const awayStats = {
        offensiveEfficiency: 105,
        defensiveEfficiency: 100,
        pace: 70,
        effectiveFieldGoalPct: 0.48,
        turnoverRate: 0.16,
        offensiveReboundRate: 0.28,
        freeThrowRate: 0.72,
        recentForm: [1, 0, 1, 0, 1],
        homeAdvantage: 3.5
      };

      const matrix = builder.buildMatrix(homeStats, awayStats, 'ncaa_basketball', false);

      expect(matrix).toBeDefined();
      expect(matrix.home).toBeDefined();
      expect(matrix.away).toBeDefined();
      expect(matrix.possessions).toBeGreaterThan(0);
      expect(matrix.homeAdvantage).toBe(3.5);
      expect(matrix.sport).toBe('ncaa_basketball');
      
      // Verify home team transitions
      expect(matrix.home.scoreProb).toBeGreaterThan(0);
      expect(matrix.home.scoreProb).toBeLessThan(1);
      expect(matrix.home.turnoverProb).toBe(0.14);
      expect(matrix.home.reboundProb).toBe(0.32);
    });

    it('should build valid transition matrix for football', () => {
      const builder = new TransitionMatrixBuilder();
      
      const homeStats = {
        offensiveEfficiency: 28,
        defensiveEfficiency: 18,
        pace: 12,
        effectiveFieldGoalPct: 0.42,
        turnoverRate: 1.2,
        offensiveReboundRate: 120,
        freeThrowRate: 0.60,
        recentForm: [1, 1, 1, 0, 1],
        homeAdvantage: 2.5
      };

      const awayStats = {
        offensiveEfficiency: 24,
        defensiveEfficiency: 22,
        pace: 12,
        effectiveFieldGoalPct: 0.38,
        turnoverRate: 1.5,
        offensiveReboundRate: 100,
        freeThrowRate: 0.55,
        recentForm: [0, 1, 0, 1, 0],
        homeAdvantage: 2.5
      };

      const matrix = builder.buildMatrix(homeStats, awayStats, 'nfl', false);

      expect(matrix).toBeDefined();
      expect(matrix.sport).toBe('nfl');
      expect(matrix.homeAdvantage).toBe(2.5);
    });
  });

  describe('MCMCSimulator', () => {
    it('should simulate basketball game and return valid results', () => {
      const simulator = new MCMCSimulator(1000); // Use 1000 iterations for speed
      
      const matrix = {
        sport: 'ncaa_basketball',
        possessions: 70,
        homeAdvantage: 3.5,
        home: {
          scoreProb: 0.55,
          twoPointProb: 0.60,
          threePointProb: 0.30,
          freeThrowProb: 0.10,
          turnoverProb: 0.14,
          reboundProb: 0.32,
          freeThrowPct: 0.75,
          expectedPoints: 110
        },
        away: {
          scoreProb: 0.50,
          twoPointProb: 0.60,
          threePointProb: 0.30,
          freeThrowProb: 0.10,
          turnoverProb: 0.16,
          reboundProb: 0.28,
          freeThrowPct: 0.72,
          expectedPoints: 105
        }
      };

      const results = simulator.simulate(matrix);

      expect(results).toBeDefined();
      expect(results.homeWinProb).toBeGreaterThan(0);
      expect(results.homeWinProb).toBeLessThan(1);
      expect(results.awayWinProb).toBeGreaterThan(0);
      expect(results.awayWinProb).toBeLessThan(1);
      expect(results.homeWinProb + results.awayWinProb + results.tieProb).toBeCloseTo(1, 1);
      expect(results.avgHomeScore).toBeGreaterThan(0);
      expect(results.avgAwayScore).toBeGreaterThan(0);
      expect(results.margins).toHaveLength(1000);
      expect(results.iterations).toBe(1000);
    });

    it('should simulate football game and return valid results', () => {
      const simulator = new MCMCSimulator(1000);
      
      const matrix = {
        sport: 'nfl',
        possessions: 12,
        homeAdvantage: 2.5,
        home: {
          scoreProb: 0.45,
          touchdownProb: 0.55,
          fieldGoalProb: 0.35,
          safetyProb: 0.01,
          turnoverProb: 0.10,
          puntProb: 0.40,
          redZonePct: 0.60,
          expectedPoints: 28
        },
        away: {
          scoreProb: 0.40,
          touchdownProb: 0.55,
          fieldGoalProb: 0.35,
          safetyProb: 0.01,
          turnoverProb: 0.12,
          puntProb: 0.40,
          redZonePct: 0.55,
          expectedPoints: 24
        }
      };

      const results = simulator.simulate(matrix);

      expect(results).toBeDefined();
      expect(results.homeWinProb).toBeGreaterThan(0);
      expect(results.avgHomeScore).toBeGreaterThan(0);
      expect(results.avgAwayScore).toBeGreaterThan(0);
    });
  });

  describe('EVCalculator', () => {
    it('should calculate moneyline EV correctly', () => {
      const calculator = new EVCalculator({ minEVThreshold: 0.05 });
      
      const simulationResults = {
        homeWinProb: 0.60,
        awayWinProb: 0.40,
        avgHomeScore: 75,
        avgAwayScore: 70,
        avgMargin: 5,
        marginStdDev: 10,
        homeScores: Array(100).fill(75),
        awayScores: Array(100).fill(70),
        margins: Array(100).fill(5),
        iterations: 100
      };

      const bettingOdds = {
        homeMoneyline: -150, // Implied prob: 60%
        awayMoneyline: 130,  // Implied prob: 43.5%
        spreadLine: -3.5,
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        totalLine: 145.5,
        overOdds: -110,
        underOdds: -110
      };

      const gameData = {
        teams: {
          home: { abbreviation: 'HOME', name: 'Home Team' },
          away: { abbreviation: 'AWAY', name: 'Away Team' }
        }
      };

      const opportunities = calculator.calculateEV(simulationResults, bettingOdds, gameData);

      expect(opportunities).toBeDefined();
      expect(Array.isArray(opportunities)).toBe(true);
      
      // Should find no EV on home moneyline (60% sim vs 60% implied)
      // But might find EV on away moneyline or other markets
    });

    it('should convert American odds to implied probability correctly', () => {
      const calculator = new EVCalculator();

      // Favorite odds
      expect(calculator.oddsToImpliedProbability(-200)).toBeCloseTo(0.667, 2);
      expect(calculator.oddsToImpliedProbability(-150)).toBeCloseTo(0.600, 2);
      expect(calculator.oddsToImpliedProbability(-110)).toBeCloseTo(0.524, 2);

      // Underdog odds
      expect(calculator.oddsToImpliedProbability(100)).toBeCloseTo(0.500, 2);
      expect(calculator.oddsToImpliedProbability(150)).toBeCloseTo(0.400, 2);
      expect(calculator.oddsToImpliedProbability(200)).toBeCloseTo(0.333, 2);
    });

    it('should identify positive EV opportunities', () => {
      const calculator = new EVCalculator({ minEVThreshold: 0.05 });
      
      // Simulated probability is higher than implied probability
      const simulationResults = {
        homeWinProb: 0.70, // 70% simulated
        awayWinProb: 0.30,
        avgHomeScore: 80,
        avgAwayScore: 70,
        avgMargin: 10,
        marginStdDev: 12,
        homeScores: Array(100).fill(80),
        awayScores: Array(100).fill(70),
        margins: Array(100).fill(10),
        iterations: 100
      };

      const bettingOdds = {
        homeMoneyline: -150, // Implied prob: 60% (vs 70% simulated = +10% EV)
        awayMoneyline: 130,
        spreadLine: -5.5,
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        totalLine: 150,
        overOdds: -110,
        underOdds: -110
      };

      const gameData = {
        teams: {
          home: { abbreviation: 'HOME', name: 'Home Team' },
          away: { abbreviation: 'AWAY', name: 'Away Team' }
        }
      };

      const opportunities = calculator.calculateEV(simulationResults, bettingOdds, gameData);

      expect(opportunities.length).toBeGreaterThan(0);
      
      // Should find home moneyline as +EV
      const homeML = opportunities.find(opp => opp.type === 'moneyline' && opp.side === 'Home');
      expect(homeML).toBeDefined();
      expect(homeML.ev).toBeGreaterThan(0.05);
    });
  });

  describe('Full MCMC Pipeline', () => {
    it('should complete full recommendation pipeline with mock data', async () => {
      const engine = new BettingRecommendationEngine({ iterations: 500 });

      // This will use fallback since we don't have real team stats
      const gameData = {
        id: 'test-game',
        sport: 'ncaa_basketball',
        date: new Date(),
        teams: {
          home: {
            id: '12',
            name: 'Arizona Wildcats',
            abbreviation: 'ARIZ'
          },
          away: {
            id: '57',
            name: 'Florida Gators',
            abbreviation: 'FLA'
          }
        }
      };

      const bettingOdds = {
        homeMoneyline: -170,
        awayMoneyline: 150,
        spreadLine: -3.5,
        homeSpreadOdds: -110,
        awaySpreadOdds: -110,
        totalLine: 145.5,
        overOdds: -110,
        underOdds: -110
      };

      const recommendation = await engine.generateRecommendation(gameData, bettingOdds);

      expect(recommendation).toBeDefined();
      expect(recommendation.pick).toBeDefined();
      expect(recommendation.reasoning).toBeDefined();
      expect(recommendation.method).toBeDefined();
      expect(['MCMC', 'Fallback']).toContain(recommendation.method);
    });
  });
});
