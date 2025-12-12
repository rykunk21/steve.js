const BayesianTeamUpdater = require('../../src/modules/sports/BayesianTeamUpdater');
const TeamRepository = require('../../src/database/repositories/TeamRepository');

// Mock TeamRepository
jest.mock('../../src/database/repositories/TeamRepository');

describe('BayesianTeamUpdater', () => {
  let updater;
  let mockTeamRepo;

  beforeEach(() => {
    mockTeamRepo = new TeamRepository();
    updater = new BayesianTeamUpdater(mockTeamRepo, {
      initialUncertainty: 1.0,
      minUncertainty: 0.1,
      uncertaintyDecayRate: 0.95,
      learningRate: 0.1
    });
  });

  describe('initializeTeamDistribution', () => {
    test('should initialize team with zero mean and initial uncertainty', () => {
      const distribution = updater.initializeTeamDistribution('team1', 16);
      
      expect(distribution.mu).toHaveLength(16);
      expect(distribution.sigma).toHaveLength(16);
      expect(distribution.mu.every(mu => mu === 0.0)).toBe(true);
      expect(distribution.sigma.every(sigma => sigma === 1.0)).toBe(true);
      expect(distribution.games_processed).toBe(0);
      expect(distribution.confidence).toBe(0.0);
    });
  });

  describe('bayesianUpdate', () => {
    test('should perform correct Bayesian update for single dimension', () => {
      const priorMu = 0.5;
      const priorSigma = 1.0;
      const observedValue = 1.0;
      const observationSigma = 0.5;

      const result = updater.bayesianUpdate(priorMu, priorSigma, observedValue, observationSigma);

      // Posterior should be between prior and observation, weighted by precision
      expect(result.mu).toBeGreaterThan(priorMu);
      expect(result.mu).toBeLessThan(observedValue);
      expect(result.sigma).toBeLessThan(Math.min(priorSigma, observationSigma));
      expect(result.sigma).toBeGreaterThanOrEqual(0.1); // Min uncertainty enforced
    });

    test('should handle high-precision observations correctly', () => {
      const priorMu = 0.0;
      const priorSigma = 1.0;
      const observedValue = 2.0;
      const observationSigma = 0.1; // Very precise observation

      const result = updater.bayesianUpdate(priorMu, priorSigma, observedValue, observationSigma);

      // High precision observation should dominate
      expect(result.mu).toBeCloseTo(observedValue, 1);
      expect(result.sigma).toBeCloseTo(observationSigma, 1);
    });
  });

  describe('calculateObservationUncertainty', () => {
    test('should decrease uncertainty with more games', () => {
      const gameContext = { isNeutralSite: false, isConferenceGame: true };
      
      const uncertainty0 = updater.calculateObservationUncertainty(gameContext, 0);
      const uncertainty5 = updater.calculateObservationUncertainty(gameContext, 5);
      const uncertainty10 = updater.calculateObservationUncertainty(gameContext, 10);

      expect(uncertainty5).toBeLessThan(uncertainty0);
      expect(uncertainty10).toBeLessThan(uncertainty5);
      expect(uncertainty10).toBeGreaterThanOrEqual(0.1); // Min uncertainty
    });

    test('should adjust for game context', () => {
      const baseContext = { isNeutralSite: false, isConferenceGame: true };
      const neutralContext = { isNeutralSite: true, isConferenceGame: true };
      const nonConfContext = { isNeutralSite: false, isConferenceGame: false };

      const baseUncertainty = updater.calculateObservationUncertainty(baseContext, 5);
      const neutralUncertainty = updater.calculateObservationUncertainty(neutralContext, 5);
      const nonConfUncertainty = updater.calculateObservationUncertainty(nonConfContext, 5);

      expect(neutralUncertainty).toBeGreaterThan(baseUncertainty);
      expect(nonConfUncertainty).toBeGreaterThan(baseUncertainty);
    });
  });

  describe('calculateOpponentStrengthAdjustment', () => {
    test('should adjust uncertainty based on opponent strength and game result', () => {
      const strongOpponent = {
        mu: new Array(16).fill(1.0), // Strong opponent
        sigma: new Array(16).fill(0.3) // Well-known opponent
      };

      const weakOpponent = {
        mu: new Array(16).fill(-1.0), // Weak opponent
        sigma: new Array(16).fill(0.3)
      };

      // Win against strong opponent (expected to be surprising)
      const winVsStrong = { won: true, pointDifferential: 10 };
      const adjustmentWinStrong = updater.calculateOpponentStrengthAdjustment(strongOpponent, winVsStrong);

      // Loss against weak opponent (expected to be surprising)
      const lossVsWeak = { won: false, pointDifferential: -10 };
      const adjustmentLossWeak = updater.calculateOpponentStrengthAdjustment(weakOpponent, lossVsWeak);

      // Both should increase uncertainty due to surprise
      expect(adjustmentWinStrong).toBeGreaterThan(1.0);
      expect(adjustmentLossWeak).toBeGreaterThan(1.0);
    });

    test('should reduce uncertainty for expected results', () => {
      const strongOpponent = {
        mu: new Array(16).fill(1.0),
        sigma: new Array(16).fill(0.3)
      };

      // Loss against strong opponent (expected result)
      const expectedLoss = { won: false, pointDifferential: -5 };
      const adjustment = updater.calculateOpponentStrengthAdjustment(strongOpponent, expectedLoss);

      // Should reduce uncertainty for expected result
      expect(adjustment).toBeLessThan(1.0);
    });
  });

  describe('calculateConfidence', () => {
    test('should increase confidence with more games', () => {
      const conf0 = updater.calculateConfidence(0);
      const conf5 = updater.calculateConfidence(5);
      const conf20 = updater.calculateConfidence(20);

      expect(conf5).toBeGreaterThan(conf0);
      expect(conf20).toBeGreaterThan(conf5);
      expect(conf20).toBeCloseTo(0.8, 1); // Should approach confidence threshold
    });
  });

  describe('calculatePerformanceDelta', () => {
    test('should calculate positive delta for wins', () => {
      const winResult = { won: true, pointDifferential: 10 };
      const delta = updater.calculatePerformanceDelta(winResult, 0);
      
      expect(delta).toBeGreaterThan(0);
    });

    test('should calculate negative delta for losses', () => {
      const lossResult = { won: false, pointDifferential: -10 };
      const delta = updater.calculatePerformanceDelta(lossResult, 0);
      
      expect(delta).toBeLessThan(0);
    });

    test('should adjust for opponent strength', () => {
      const winResult = { won: true, pointDifferential: 5 };
      
      const deltaVsWeak = updater.calculatePerformanceDelta(winResult, -1.0); // Weak opponent
      const deltaVsStrong = updater.calculatePerformanceDelta(winResult, 1.0); // Strong opponent
      
      // Win vs strong opponent should be more impressive
      expect(deltaVsStrong).toBeGreaterThan(deltaVsWeak);
    });
  });

  describe('updateTeamDistribution', () => {
    beforeEach(() => {
      // Mock repository methods
      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId: 'team1',
        statisticalRepresentation: JSON.stringify({
          mu: new Array(16).fill(0.0),
          sigma: new Array(16).fill(1.0),
          games_processed: 0,
          confidence: 0.0,
          last_updated: new Date().toISOString(),
          initialized_at: new Date().toISOString()
        })
      });
      
      mockTeamRepo.updateStatisticalRepresentation.mockResolvedValue({});
    });

    test('should update team distribution with Bayesian inference', async () => {
      const observedLatent = new Array(16).fill(0.5);
      const gameContext = {
        isNeutralSite: false,
        isConferenceGame: true,
        gameResult: { won: true, pointDifferential: 8 }
      };

      const result = await updater.updateTeamDistribution('team1', observedLatent, gameContext);

      expect(result.games_processed).toBe(1);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.mu.every(mu => mu > 0)).toBe(true); // Should move toward observation
      expect(result.sigma.every(sigma => sigma < 1.0)).toBe(true); // Uncertainty should decrease
      expect(mockTeamRepo.updateStatisticalRepresentation).toHaveBeenCalled();
    });

    test('should initialize team if not exists', async () => {
      mockTeamRepo.getTeamByEspnId.mockResolvedValue(null);

      const observedLatent = new Array(16).fill(0.3);
      const gameContext = {
        isNeutralSite: false,
        isConferenceGame: true,
        gameResult: { won: true, pointDifferential: 5 }
      };

      const result = await updater.updateTeamDistribution('team2', observedLatent, gameContext);

      expect(result.games_processed).toBe(1);
      expect(result.mu.every(mu => mu > 0)).toBe(true);
      expect(mockTeamRepo.updateStatisticalRepresentation).toHaveBeenCalledTimes(2); // Init + update
    });
  });

  describe('getTeamStatistics', () => {
    test('should return comprehensive team statistics', async () => {
      const mockDistribution = {
        mu: [0.5, -0.3, 0.8, 0.1],
        sigma: [0.4, 0.6, 0.3, 0.5],
        games_processed: 10,
        confidence: 0.6,
        last_updated: new Date().toISOString(),
        initialized_at: new Date().toISOString()
      };

      mockTeamRepo.getTeamByEspnId.mockResolvedValue({
        teamId: 'team1',
        statisticalRepresentation: JSON.stringify(mockDistribution)
      });

      const stats = await updater.getTeamStatistics('team1');

      expect(stats.teamId).toBe('team1');
      expect(stats.gamesProcessed).toBe(10);
      expect(stats.confidence).toBe(0.6);
      expect(stats.averageMu).toBeCloseTo(0.275, 2);
      expect(stats.averageSigma).toBeCloseTo(0.45, 2);
      expect(stats.isConverged).toBe(false); // Below 0.8 threshold
      expect(stats.uncertaintyReduction).toBeGreaterThan(0);
    });
  });
});