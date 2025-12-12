const OnlineLearningOrchestrator = require('../../src/modules/sports/OnlineLearningOrchestrator');
const dbConnection = require('../../src/database/connection');
const logger = require('../../src/utils/logger');

describe('OnlineLearningOrchestrator', () => {
  let orchestrator;

  beforeEach(() => {
    // Create orchestrator with test configuration
    orchestrator = new OnlineLearningOrchestrator({
      batchSize: 1,
      maxGamesPerSession: 5,
      saveInterval: 2,
      validationInterval: 3,
      maxRetries: 2,
      continueOnError: true,
      feedbackThreshold: 0.5,
      initialAlpha: 0.1
    });
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.close();
    }
  });

  describe('Initialization', () => {
    test('should initialize with correct configuration', () => {
      expect(orchestrator.batchSize).toBe(1);
      expect(orchestrator.maxGamesPerSession).toBe(5);
      expect(orchestrator.saveInterval).toBe(2);
      expect(orchestrator.validationInterval).toBe(3);
      expect(orchestrator.maxRetries).toBe(2);
      expect(orchestrator.continueOnError).toBe(true);
    });

    test('should initialize with default configuration', () => {
      const defaultOrchestrator = new OnlineLearningOrchestrator();
      
      expect(defaultOrchestrator.batchSize).toBe(1);
      expect(defaultOrchestrator.maxGamesPerSession).toBe(100);
      expect(defaultOrchestrator.saveInterval).toBe(10);
      expect(defaultOrchestrator.validationInterval).toBe(25);
      expect(defaultOrchestrator.maxRetries).toBe(3);
      expect(defaultOrchestrator.continueOnError).toBe(true);
      
      defaultOrchestrator.close();
    });

    test('should initialize all required components', () => {
      expect(orchestrator.featureExtractor).toBeDefined();
      expect(orchestrator.vae).toBeDefined();
      expect(orchestrator.transitionNN).toBeDefined();
      expect(orchestrator.feedbackTrainer).toBeDefined();
      expect(orchestrator.bayesianUpdater).toBeDefined();
      expect(orchestrator.teamRepository).toBeDefined();
    });

    test('should initialize with correct statistics', () => {
      const stats = orchestrator.stats;
      
      expect(stats.totalGamesProcessed).toBe(0);
      expect(stats.successfulGames).toBe(0);
      expect(stats.failedGames).toBe(0);
      expect(stats.averageProcessingTime).toBe(0);
      expect(stats.totalProcessingTime).toBe(0);
      expect(stats.lastProcessedGameId).toBeNull();
      expect(stats.lastProcessedDate).toBeNull();
      expect(stats.modelSaves).toBe(0);
      expect(stats.validationRuns).toBe(0);
      expect(stats.errors).toEqual([]);
    });
  });

  describe('Feature Conversion', () => {
    test('should convert features object to array correctly', () => {
      const features = {
        fgm: 25, fga: 50, fgPct: 50.0,
        fg3m: 8, fg3a: 20, fg3Pct: 40.0,
        ftm: 15, fta: 20, ftPct: 75.0,
        rebounds: 35, offensiveRebounds: 10, defensiveRebounds: 25,
        assists: 18, turnovers: 12, steals: 8,
        blocks: 4, personalFouls: 18, technicalFouls: 1,
        points: 73
      };

      const array = orchestrator.convertFeaturesToArray(features);
      
      expect(array).toHaveLength(88); // Should be 88-dimensional
      expect(array[0]).toBe(25); // fgm
      expect(array[1]).toBe(50); // fga
      expect(array[2]).toBe(50.0); // fgPct
      expect(array[3]).toBe(8); // fg3m
      expect(array[18]).toBe(73); // points (position 18: 9+3+6 = 18)
    });

    test('should handle missing features with defaults', () => {
      const features = {
        fgm: 25,
        // Missing most features
      };

      const array = orchestrator.convertFeaturesToArray(features);
      
      expect(array).toHaveLength(88);
      expect(array[0]).toBe(25); // fgm
      expect(array[1]).toBe(0); // fga (default)
      expect(array[2]).toBe(0); // fgPct (default)
    });

    test('should convert transition probabilities to array correctly', () => {
      const transitionProbs = {
        twoPointMakeProb: 0.3,
        twoPointMissProb: 0.2,
        threePointMakeProb: 0.15,
        threePointMissProb: 0.1,
        freeThrowMakeProb: 0.1,
        freeThrowMissProb: 0.05,
        offensiveReboundProb: 0.05,
        turnoverProb: 0.05
      };

      const array = orchestrator.convertTransitionProbsToArray(transitionProbs);
      
      expect(array).toHaveLength(8);
      expect(array[0]).toBe(0.3); // twoPointMakeProb
      expect(array[1]).toBe(0.2); // twoPointMissProb
      expect(array[7]).toBe(0.05); // turnoverProb
    });

    test('should handle missing transition probabilities with defaults', () => {
      const transitionProbs = {
        twoPointMakeProb: 0.3
        // Missing other probabilities
      };

      const array = orchestrator.convertTransitionProbsToArray(transitionProbs);
      
      expect(array).toHaveLength(8);
      expect(array[0]).toBe(0.3); // twoPointMakeProb
      expect(array[1]).toBe(0); // twoPointMissProb (default)
      expect(array[7]).toBe(0); // turnoverProb (default)
    });
  });

  describe('Game Context', () => {
    test('should build game context array correctly', () => {
      const metadata = {
        neutralGame: 'Y',
        postseason: 'Y'
      };
      
      const gameInfo = {
        game_date: '2024-03-15'
      };

      const context = orchestrator.buildGameContext(metadata, gameInfo);
      
      expect(context).toHaveLength(10);
      expect(context[0]).toBe(1); // Neutral site
      expect(context[1]).toBe(1); // Postseason
      // Rest should be 0 (not available in current data)
      for (let i = 2; i < 10; i++) {
        expect(context[i]).toBe(0);
      }
    });

    test('should handle missing metadata', () => {
      const metadata = {};
      const gameInfo = {};

      const context = orchestrator.buildGameContext(metadata, gameInfo);
      
      expect(context).toHaveLength(10);
      // All should be 0
      for (let i = 0; i < 10; i++) {
        expect(context[i]).toBe(0);
      }
    });

    test('should extract Bayesian context correctly', () => {
      const metadata = {
        neutralGame: 'Y',
        postseason: 'N',
        date: '2024-03-15'
      };

      const context = orchestrator.extractGameContextForBayesian(metadata);
      
      expect(context.isNeutralSite).toBe(true);
      expect(context.isPostseason).toBe(false);
      expect(context.isConferenceGame).toBeNull();
      expect(context.restDays).toBeNull();
      expect(context.gameDate).toBe('2024-03-15');
    });
  });

  describe('State Management', () => {
    test('should track running state correctly', () => {
      expect(orchestrator.getIsRunning()).toBe(false);
      expect(orchestrator.shouldStop).toBe(false);
      expect(orchestrator.currentGameId).toBeNull();
    });

    test('should reset statistics correctly', () => {
      // Modify stats
      orchestrator.stats.totalGamesProcessed = 5;
      orchestrator.stats.successfulGames = 4;
      orchestrator.stats.failedGames = 1;
      orchestrator.stats.errors.push({ error: 'test' });

      // Reset
      orchestrator.resetStats();

      // Check reset
      expect(orchestrator.stats.totalGamesProcessed).toBe(0);
      expect(orchestrator.stats.successfulGames).toBe(0);
      expect(orchestrator.stats.failedGames).toBe(0);
      expect(orchestrator.stats.errors).toEqual([]);
    });

    test('should update processing statistics correctly', () => {
      const result = {
        gameId: 'test-game-123',
        gameDate: '2024-03-15'
      };
      const processingTime = 1500;

      orchestrator.updateProcessingStats(result, processingTime);

      expect(orchestrator.stats.totalGamesProcessed).toBe(1);
      expect(orchestrator.stats.successfulGames).toBe(1);
      expect(orchestrator.stats.totalProcessingTime).toBe(1500);
      expect(orchestrator.stats.averageProcessingTime).toBe(1500);
      expect(orchestrator.stats.lastProcessedGameId).toBe('test-game-123');
      expect(orchestrator.stats.lastProcessedDate).toBe('2024-03-15');
    });

    test('should calculate session results correctly', () => {
      // Set up some stats
      orchestrator.stats.totalGamesProcessed = 10;
      orchestrator.stats.successfulGames = 8;
      orchestrator.stats.failedGames = 2;
      orchestrator.stats.totalProcessingTime = 15000;
      orchestrator.stats.averageProcessingTime = 1500;
      orchestrator.stats.modelSaves = 2;
      orchestrator.stats.validationRuns = 1;
      orchestrator.stats.lastProcessedGameId = 'game-123';
      orchestrator.stats.lastProcessedDate = '2024-03-15';

      const results = orchestrator.getSessionResults();

      expect(results.summary.totalGamesProcessed).toBe(10);
      expect(results.summary.successfulGames).toBe(8);
      expect(results.summary.failedGames).toBe(2);
      expect(results.summary.successRate).toBe(80);
      expect(results.summary.averageProcessingTime).toBe(1500);
      expect(results.summary.totalProcessingTime).toBe(15000);
      expect(results.summary.modelSaves).toBe(2);
      expect(results.summary.validationRuns).toBe(1);
      expect(results.lastProcessed.gameId).toBe('game-123');
      expect(results.lastProcessed.gameDate).toBe('2024-03-15');
      expect(results.trainerStats).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should prevent multiple concurrent sessions', async () => {
      orchestrator.isRunning = true;

      await expect(orchestrator.startOnlineLearning()).rejects.toThrow(
        'Online learning is already running'
      );
    });

    test('should handle graceful stop', () => {
      expect(orchestrator.shouldStop).toBe(false);
      
      orchestrator.stop();
      
      expect(orchestrator.shouldStop).toBe(true);
    });
  });

  describe('Team Initialization', () => {
    test('should initialize team with correct distribution structure', async () => {
      // Mock the bayesian updater methods
      const mockInitDistribution = {
        mu: new Array(16).fill(0),
        sigma: new Array(16).fill(1),
        games_processed: 0,
        confidence: 0.0,
        last_updated: expect.any(String),
        initialized_at: expect.any(String)
      };

      orchestrator.bayesianUpdater.initializeTeamDistribution = jest.fn().mockReturnValue(mockInitDistribution);
      orchestrator.bayesianUpdater.saveTeamDistribution = jest.fn().mockResolvedValue();

      await orchestrator.initializeTeam('test-team-123');

      expect(orchestrator.bayesianUpdater.initializeTeamDistribution).toHaveBeenCalledWith('test-team-123');
      expect(orchestrator.bayesianUpdater.saveTeamDistribution).toHaveBeenCalledWith('test-team-123', mockInitDistribution);
    });
  });

  describe('Integration', () => {
    test('should have all components properly connected', () => {
      // Check that VAE and NN are connected to feedback trainer
      expect(orchestrator.feedbackTrainer.vae).toBe(orchestrator.vae);
      expect(orchestrator.feedbackTrainer.transitionNN).toBe(orchestrator.transitionNN);
      
      // Check that team repository is connected to Bayesian updater
      expect(orchestrator.bayesianUpdater.teamRepo).toBe(orchestrator.teamRepository);
    });

    test('should handle component initialization correctly', () => {
      // VAE should be initialized with correct dimensions
      expect(orchestrator.vae.inputDim).toBe(88);
      expect(orchestrator.vae.latentDim).toBe(16);
      
      // NN should be initialized with correct dimensions
      expect(orchestrator.transitionNN.inputDim).toBe(74); // 16+16+16+16+10
      expect(orchestrator.transitionNN.outputDim).toBe(8);
      expect(orchestrator.transitionNN.gameContextDim).toBe(10);
    });
  });
});