const PostGameUpdater = require('../../src/modules/sports/PostGameUpdater');
const ModelPerformanceMonitor = require('../../src/modules/sports/ModelPerformanceMonitor');
const IncrementalGameDiscovery = require('../../src/modules/sports/IncrementalGameDiscovery');

// Mock the TeamRepository to avoid database issues in tests
jest.mock('../../src/database/repositories/TeamRepository', () => {
  return jest.fn().mockImplementation(() => ({
    findAll: jest.fn().mockResolvedValue([
      {
        team_id: 'test_team_1',
        team_name: 'Test Team 1',
        statistical_representation: JSON.stringify({
          mu: Array.from({ length: 16 }, () => Math.random()),
          sigma: Array.from({ length: 16 }, () => 0.1 + Math.random() * 0.2),
          gamesProcessed: 10,
          lastSeason: '2024-25'
        })
      },
      {
        team_id: 'test_team_2',
        team_name: 'Test Team 2',
        statistical_representation: JSON.stringify({
          mu: Array.from({ length: 16 }, () => Math.random()),
          sigma: Array.from({ length: 16 }, () => 0.05 + Math.random() * 0.1),
          gamesProcessed: 15,
          lastSeason: '2024-25'
        })
      }
    ])
  }));
});

describe('Continuous Online Learning System', () => {
  let postGameUpdater;
  let performanceMonitor;
  let gameDiscovery;

  beforeEach(() => {
    // Initialize with test configurations
    postGameUpdater = new PostGameUpdater({
      feedbackThreshold: 0.7,
      postGameLearningRate: 0.0001,
      maxUpdateAttempts: 2
    });

    performanceMonitor = new ModelPerformanceMonitor({
      monitoringWindow: 10,
      convergenceThreshold: 0.1,
      degradationThreshold: 0.2
    });

    gameDiscovery = new IncrementalGameDiscovery({
      maxGamesPerRun: 5,
      autoProcessNewGames: false, // Disable for testing
      rateLimitDelay: 100 // Faster for testing
    });
  });

  afterEach(async () => {
    // Clean up resources
    await postGameUpdater.close();
    await gameDiscovery.close();
  });

  describe('PostGameUpdater', () => {
    test('should initialize with correct parameters', () => {
      expect(postGameUpdater.feedbackTrainer.feedbackThreshold).toBe(0.7);
      expect(postGameUpdater.postGameLearningRate).toBe(0.0001);
      expect(postGameUpdater.maxUpdateAttempts).toBe(2);
    });

    test('should validate game completion correctly', () => {
      const completedGame = {
        teams: {
          home: { score: 75 },
          visitor: { score: 68 }
        },
        playByPlay: [
          { event: 'shot', result: 'make' },
          { event: 'shot', result: 'miss' }
        ]
      };

      const incompleteGame = {
        teams: {
          home: { score: 0 },
          visitor: { score: 0 }
        },
        playByPlay: []
      };

      expect(postGameUpdater.isGameCompleted(completedGame)).toBe(true);
      expect(postGameUpdater.isGameCompleted(incompleteGame)).toBe(false);
    });

    test('should calculate prediction error correctly', () => {
      const predicted = {
        home: {
          twoPointMakeProb: 0.5,
          twoPointMissProb: 0.2,
          threePointMakeProb: 0.1,
          threePointMissProb: 0.05,
          freeThrowMakeProb: 0.08,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.03,
          turnoverProb: 0.02
        },
        away: {
          twoPointMakeProb: 0.45,
          twoPointMissProb: 0.25,
          threePointMakeProb: 0.12,
          threePointMissProb: 0.06,
          freeThrowMakeProb: 0.07,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.02,
          turnoverProb: 0.01
        }
      };

      const actual = {
        home: {
          twoPointMakeProb: 0.48,
          twoPointMissProb: 0.22,
          threePointMakeProb: 0.12,
          threePointMissProb: 0.06,
          freeThrowMakeProb: 0.07,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.02,
          turnoverProb: 0.01
        },
        away: {
          twoPointMakeProb: 0.47,
          twoPointMissProb: 0.23,
          threePointMakeProb: 0.11,
          threePointMissProb: 0.07,
          freeThrowMakeProb: 0.08,
          freeThrowMissProb: 0.02,
          offensiveReboundProb: 0.01,
          turnoverProb: 0.01
        }
      };

      const error = postGameUpdater.calculatePredictionError(predicted, actual);

      expect(error).toHaveProperty('home');
      expect(error).toHaveProperty('away');
      expect(error).toHaveProperty('totalError');
      expect(error).toHaveProperty('maxError');
      expect(typeof error.totalError).toBe('number');
      expect(error.totalError).toBeGreaterThan(0);
    });

    test('should determine update necessity correctly', () => {
      const highError = { totalError: 0.8, maxError: 0.9 };
      const lowError = { totalError: 0.3, maxError: 0.4 };
      const veryHighMaxError = { totalError: 0.5, maxError: 1.2 };

      expect(postGameUpdater.shouldUpdateModel(highError)).toBe(true);
      expect(postGameUpdater.shouldUpdateModel(lowError)).toBe(false);
      expect(postGameUpdater.shouldUpdateModel(veryHighMaxError)).toBe(true);
    });

    test('should convert features to array correctly', () => {
      const features = {
        fgm: 25, fga: 50, fgPct: 0.5,
        fg3m: 8, fg3a: 20, fg3Pct: 0.4,
        ftm: 15, fta: 20, ftPct: 0.75,
        rebounds: 35, assists: 18, turnovers: 12
      };

      const array = postGameUpdater.convertFeaturesToArray(features);

      expect(Array.isArray(array)).toBe(true);
      expect(array.length).toBe(88); // Expected feature array length
      expect(array[0]).toBe(25); // fgm
      expect(array[1]).toBe(50); // fga
      expect(array[2]).toBe(0.5); // fgPct
    });

    test('should get update statistics', () => {
      const stats = postGameUpdater.getUpdateStats();

      expect(stats).toHaveProperty('totalUpdates');
      expect(stats).toHaveProperty('successfulUpdates');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('improvementRate');
      expect(typeof stats.successRate).toBe('number');
    });
  });

  describe('ModelPerformanceMonitor', () => {
    test('should initialize with correct parameters', () => {
      expect(performanceMonitor.monitoringWindow).toBe(10);
      expect(performanceMonitor.convergenceThreshold).toBe(0.1);
      expect(performanceMonitor.degradationThreshold).toBe(0.2);
    });

    test('should record prediction performance', () => {
      const trainingResult = {
        nnLoss: 0.5,
        vaeLoss: 0.3,
        feedbackTriggered: true,
        currentAlpha: 0.05
      };

      performanceMonitor.recordPredictionPerformance(trainingResult, 'test_game_123');

      expect(performanceMonitor.performanceHistory.length).toBe(1);
      expect(performanceMonitor.performanceHistory[0].gameId).toBe('test_game_123');
      expect(performanceMonitor.performanceHistory[0].nnLoss).toBe(0.5);
    });

    test('should record team convergence', () => {
      const distribution = {
        sigma: [0.2, 0.15, 0.18, 0.12, 0.25, 0.1, 0.08, 0.14, 0.16, 0.11, 0.13, 0.09, 0.17, 0.19, 0.21, 0.07],
        gamesProcessed: 15
      };

      const updateResult = {
        sigmaReduction: 0.05
      };

      performanceMonitor.recordTeamConvergence('team_123', distribution, updateResult);

      expect(performanceMonitor.teamConvergenceHistory.length).toBe(1);
      expect(performanceMonitor.teamConvergenceHistory[0].teamId).toBe('team_123');
    });

    test('should calculate average sigma correctly', () => {
      const sigmaArray = [0.1, 0.2, 0.15, 0.25, 0.18];
      const avgSigma = performanceMonitor.calculateAverageSigma(sigmaArray);

      expect(avgSigma).toBeCloseTo(0.176, 3);
    });

    test('should categorize uncertainty levels correctly', () => {
      expect(performanceMonitor.categorizeUncertaintyLevel(0.05)).toBe('very_low');
      expect(performanceMonitor.categorizeUncertaintyLevel(0.15)).toBe('low');
      expect(performanceMonitor.categorizeUncertaintyLevel(0.3)).toBe('moderate');
      expect(performanceMonitor.categorizeUncertaintyLevel(0.5)).toBe('high');
      expect(performanceMonitor.categorizeUncertaintyLevel(0.8)).toBe('very_high');
    });

    test('should assess system stability', () => {
      // Add some feedback history
      performanceMonitor.feedbackHistory = [
        { feedbackRate: 0.2, alphaDecayRate: 0.1, systemStability: true },
        { feedbackRate: 0.25, alphaDecayRate: 0.12, systemStability: true },
        { feedbackRate: 0.18, alphaDecayRate: 0.08, systemStability: true }
      ];

      const stability = performanceMonitor.assessSystemStability();
      expect(['stable', 'moderate', 'unstable']).toContain(stability);
    });

    test('should generate performance report', async () => {
      // Add some test data
      performanceMonitor.recordPredictionPerformance({
        nnLoss: 0.4,
        vaeLoss: 0.2,
        feedbackTriggered: false,
        currentAlpha: 0.03
      }, 'game1');

      const report = await performanceMonitor.generatePerformanceReport();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('performance');
      expect(report).toHaveProperty('alerts');
      expect(report.summary).toHaveProperty('averageNNAccuracy');
    });

    test('should trigger performance alerts', () => {
      let alertReceived = null;
      
      performanceMonitor.onAlert((alert) => {
        alertReceived = alert;
      });

      performanceMonitor.triggerPerformanceAlert('test_alert', { value: 123 });

      expect(alertReceived).not.toBeNull();
      expect(alertReceived.type).toBe('test_alert');
      expect(alertReceived.data.value).toBe(123);
    });
  });

  describe('IncrementalGameDiscovery', () => {
    test('should initialize with correct parameters', () => {
      expect(gameDiscovery.maxGamesPerRun).toBe(5);
      expect(gameDiscovery.autoProcessNewGames).toBe(false);
      expect(gameDiscovery.rateLimitDelay).toBe(100);
    });

    test('should extract date from game ID', () => {
      const gameIdWithDate = 'game_20241201_duke_unc';
      const gameIdWithoutDate = 'random_game_id';

      const dateWithDate = gameDiscovery.extractDateFromGameId(gameIdWithDate);
      const dateWithoutDate = gameDiscovery.extractDateFromGameId(gameIdWithoutDate);

      expect(dateWithDate).toBe('2024-12-01');
      expect(dateWithoutDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Should be current date format
    });

    test('should get discovery statistics', () => {
      const stats = gameDiscovery.getDiscoveryStats();

      expect(stats).toHaveProperty('totalRuns');
      expect(stats).toHaveProperty('successfulRuns');
      expect(stats).toHaveProperty('totalNewGames');
      expect(stats).toHaveProperty('successRate');
      expect(typeof stats.successRate).toBe('number');
    });

    test('should check running state', () => {
      expect(gameDiscovery.isDiscoveryRunning()).toBe(false);
    });

    test('should reset statistics', () => {
      // Add some fake stats
      gameDiscovery.discoveryStats.totalRuns = 5;
      gameDiscovery.discoveryStats.totalNewGames = 25;

      gameDiscovery.resetStats();

      expect(gameDiscovery.discoveryStats.totalRuns).toBe(0);
      expect(gameDiscovery.discoveryStats.totalNewGames).toBe(0);
    });
  });

  describe('Integration Tests', () => {
    test('should work together for monitoring post-game updates', () => {
      // Simulate a training result
      const trainingResult = {
        nnLoss: 0.6,
        vaeLoss: 0.4,
        feedbackTriggered: true,
        currentAlpha: 0.08
      };

      // Record in performance monitor
      performanceMonitor.recordPredictionPerformance(trainingResult, 'integration_test_game');

      // Check that it was recorded
      expect(performanceMonitor.performanceHistory.length).toBe(1);
      expect(performanceMonitor.currentMetrics.averageNNAccuracy).toBeGreaterThan(0);
    });

    test('should handle error scenarios gracefully', () => {
      // Test error handling in PostGameUpdater
      expect(() => {
        postGameUpdater.calculatePredictionError(null, {});
      }).toThrow();

      // Test error handling in ModelPerformanceMonitor
      expect(() => {
        performanceMonitor.calculateAverageSigma(null);
      }).not.toThrow(); // Should return default value

      // Test error handling in IncrementalGameDiscovery
      expect(() => {
        gameDiscovery.extractDateFromGameId(null);
      }).not.toThrow(); // Should return current date
    });
  });
});